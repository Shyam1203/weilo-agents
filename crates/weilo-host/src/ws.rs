//! One WebSocket per device, speaking `weilo-proto` frames as JSON text.
//!
//! The device proves itself in its first frame (`hello` with its token), not with a
//! cookie: cookies on 127.0.0.1 are shared by every port, the token in the app's own
//! storage is not. A bad token closes the socket with 4401 (unpaired). A hello with no
//! token closes it with 4001: the app may still hold an old device cookie to trade for a
//! token (`POST /api/token`), so it checks before it calls itself unpaired. A device
//! unpaired from Settings has its sockets closed with 4401 at once.
//!
//! The socket subscribes to the broadcast when it opens, before any backlog is read,
//! and sends each thread's events strictly in `seq` order: a live event that skips
//! ahead first fills the gap from the database, and anything at or below the last
//! sent `seq` is dropped. The backlog is read a page at a time and waits for room in
//! the socket's queue, so a long chat opens on a slow device too. A socket that falls
//! behind on live frames (the broadcast, or its own bounded queue of frames to write)
//! or whose backlog can't be read is closed with code 4008 and must resubscribe with
//! `after_seq`. A backlog that can't be read because the database doesn't answer is
//! read again a little later instead: the thread's live events wait for it.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::response::{IntoResponse, Response};
use futures::{SinkExt, StreamExt};
use tokio::sync::{Semaphore, broadcast, mpsc, oneshot};
use uuid::Uuid;
use weilo_proto::{ApiError, CallResult, ClientFrame, Event, PROTOCOL_VERSION, ServerFrame};

use crate::app::{App, HubMsg};
use crate::{auth, calls, events};

pub const CLOSE_BEHIND: u16 = 4008;
pub const CLOSE_UNPAIRED: u16 = 4401;
pub const CLOSE_NO_TOKEN: u16 = 4001;
pub const CLOSE_BAD_FRAME: u16 = 4400;
pub const CLOSE_OLD_VERSION: u16 = 4426;

/// Calls one socket may have running at once.
pub const MAX_CALLS: usize = 32;
/// Events read from the database at a time for a backlog.
const BACKLOG_PAGE: i64 = 500;
/// How long a new socket has to say hello.
const HELLO_WAIT: Duration = Duration::from_secs(5);
/// The largest frame (or message) a device may send. Calls are small.
const MAX_MESSAGE: usize = 1024 * 1024;
/// How soon a backlog the database didn't give is read again.
const CATCH_UP_AGAIN: Duration = Duration::from_secs(2);
/// How long one frame may take to reach a device. A device that stops reading is let go
/// after this, so it can't hold its socket's place forever.
const WRITE_WAIT: Duration = Duration::from_secs(20);

pub async fn upgrade(State(app): State<Arc<App>>, ws: WebSocketUpgrade) -> Response {
    // Every open socket holds one place; when they're all taken, new ones are refused.
    let Ok(place) = app.sockets.clone().try_acquire_owned() else {
        tracing::warn!("too many open sockets; refused one");
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "Too many connections. Try again soon.",
        )
            .into_response();
    };
    ws.max_message_size(MAX_MESSAGE)
        .max_frame_size(MAX_MESSAGE)
        .on_upgrade(move |socket| async move {
            Session::run(app, socket).await;
            drop(place);
        })
}

struct Session {
    app: Arc<App>,
    /// Set by a `hello` with a valid token.
    device_id: Option<Uuid>,
    out: mpsc::Sender<Message>,
    /// Followed threads and the last `seq` sent for each.
    subs: HashMap<Uuid, i64>,
    /// Followed threads whose backlog the database didn't give yet, and whether the
    /// thread is still to be checked as this space's. Their live events wait for it.
    behind: HashMap<Uuid, bool>,
    /// When `behind` is read again.
    again_at: Option<tokio::time::Instant>,
    calls: Arc<Semaphore>,
    rets: mpsc::Sender<ServerFrame>,
}

/// Ends the session, with a close frame to send first.
struct Close(u16, &'static str);

const BEHIND: Close = Close(CLOSE_BEHIND, "Fell behind. Subscribe again.");

impl Session {
    async fn run(app: Arc<App>, socket: WebSocket) {
        let mut hub = app.hub.subscribe();
        let (mut sink, mut stream) = socket.split();
        let (out, mut out_rx) = mpsc::channel::<Message>(app.settings.ws_queue.max(1));
        let (close_tx, mut close_rx) = oneshot::channel::<Message>();
        // The close frame skips the queue: a full queue is one reason to close.
        let writer = tokio::spawn(async move {
            loop {
                tokio::select! {
                    biased;
                    close = &mut close_rx => {
                        if let Ok(close) = close {
                            let _ = tokio::time::timeout(WRITE_WAIT, sink.send(close)).await;
                        }
                        break;
                    }
                    msg = out_rx.recv() => match msg {
                        Some(msg) => {
                            let sent = tokio::time::timeout(WRITE_WAIT, sink.send(msg)).await;
                            if !matches!(sent, Ok(Ok(()))) {
                                break;
                            }
                        }
                        None => {
                            // The session can end between the two checks above (it runs
                            // on another thread). Its close frame is handed over before
                            // the queue closes, so it is here now: send it, or the
                            // device sees the connection drop with no reason.
                            if let Ok(close) = close_rx.try_recv() {
                                let _ = tokio::time::timeout(WRITE_WAIT, sink.send(close)).await;
                            }
                            break;
                        }
                    },
                }
            }
        });
        let shutdown = app.shutdown.clone();
        let (rets, mut rets_rx) = mpsc::channel(MAX_CALLS);
        let mut s = Session {
            app,
            device_id: None,
            out,
            subs: HashMap::new(),
            behind: HashMap::new(),
            again_at: None,
            calls: Arc::new(Semaphore::new(MAX_CALLS)),
            rets,
        };
        let hello_by = tokio::time::Instant::now() + HELLO_WAIT;
        // Ends the session when the writer gave up on the device.
        let writing = s.out.clone();
        let close = loop {
            let greeted = s.device_id.is_some();
            let step = tokio::select! {
                msg = stream.next() => match msg {
                    Some(Ok(Message::Text(text))) => s.on_frame(&text).await,
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break None,
                    Some(Ok(_)) => Ok(()),
                },
                msg = hub.recv() => match msg {
                    Ok(msg) => s.on_hub(&msg).await,
                    Err(broadcast::error::RecvError::Lagged(_)) => Err(BEHIND),
                    Err(broadcast::error::RecvError::Closed) => break None,
                },
                Some(frame) = rets_rx.recv() => s.send(&frame),
                _ = sleep_until(s.again_at) => s.catch_up_behind().await,
                _ = tokio::time::sleep_until(hello_by), if !greeted => {
                    Err(Close(CLOSE_BAD_FRAME, "Say hello first."))
                }
                _ = shutdown.cancelled() => Err(Close(1001, "Weilo is stopping.")),
                () = writing.closed() => break None,
            };
            if let Err(close) = step {
                break Some(close);
            }
        };
        if let Some(Close(code, reason)) = close {
            let _ = close_tx.send(Message::Close(Some(CloseFrame {
                code,
                reason: reason.into(),
            })));
        }
        drop(s);
        drop(writing);
        let mut writer = writer;
        if tokio::time::timeout(WRITE_WAIT, &mut writer).await.is_err() {
            writer.abort();
        }
    }

    /// Queues a frame. A full queue means the device can't keep up.
    fn send(&self, frame: &ServerFrame) -> Result<(), Close> {
        let Ok(text) = serde_json::to_string(frame) else {
            return Ok(());
        };
        match self.out.try_send(Message::Text(text.into())) {
            Ok(()) => Ok(()),
            Err(mpsc::error::TrySendError::Full(_)) => Err(BEHIND),
            Err(mpsc::error::TrySendError::Closed(_)) => Err(Close(1000, "")),
        }
    }

    async fn on_frame(&mut self, text: &str) -> Result<(), Close> {
        let frame: ClientFrame = serde_json::from_str(text)
            .map_err(|_| Close(CLOSE_BAD_FRAME, "That frame isn't valid."))?;
        let Some(device_id) = self.device_id else {
            let ClientFrame::Hello { version, token } = frame else {
                return Err(Close(CLOSE_BAD_FRAME, "Say hello first."));
            };
            return self.hello(version, token).await;
        };
        match frame {
            ClientFrame::Hello { .. } => {}
            ClientFrame::Sub {
                thread_id,
                after_seq,
            } => self.subscribe(thread_id, after_seq).await?,
            ClientFrame::Unsub { thread_id } => {
                self.subs.remove(&thread_id);
                self.behind.remove(&thread_id);
            }
            ClientFrame::Call { call_id, call } => {
                let Ok(permit) = self.calls.clone().try_acquire_owned() else {
                    let result = CallResult::Failed {
                        error: ApiError {
                            code: "busy".into(),
                            message: "Too many requests at once. Try again.".into(),
                        },
                    };
                    return self.send(&ServerFrame::Ret { call_id, result });
                };
                let (app, rets) = (self.app.clone(), self.rets.clone());
                tokio::spawn(async move {
                    let result = calls::handle(&app, device_id, call_id, call).await;
                    let _ = rets.send(ServerFrame::Ret { call_id, result }).await;
                    drop(permit);
                });
            }
            ClientFrame::Presence { .. } => {}
        }
        Ok(())
    }

    async fn hello(&mut self, version: u32, token: Option<String>) -> Result<(), Close> {
        if version.abs_diff(PROTOCOL_VERSION) > 1 || version == 0 {
            return Err(Close(
                CLOSE_OLD_VERSION,
                "Update Weilo to keep using this app.",
            ));
        }
        let Some(token) = token.filter(|t| !t.is_empty()) else {
            return Err(Close(CLOSE_NO_TOKEN, "Send this device's token."));
        };
        // A device checked earlier in this run still connects while the database
        // doesn't answer: it hears so (`Status`) instead of waiting.
        let hash = auth::token_hash(&token);
        let cant_check = Close(1011, "Weilo can't check this device right now.");
        let device = match self
            .app
            .bounded(auth::device_for_token(&self.app.db, &token))
            .await
        {
            Ok(device) => {
                self.app.note_device(hash, device);
                device
            }
            Err(e) if crate::db::unreachable(&e) => {
                tracing::info!("checked a device from memory: {e:#}");
                Some(self.app.known_device(&hash).ok_or(cant_check)?)
            }
            Err(e) => {
                tracing::warn!("couldn't check a device: {e:#}");
                return Err(cant_check);
            }
        };
        let Some(device_id) = device else {
            return Err(Close(CLOSE_UNPAIRED, "Pair this device first."));
        };
        self.device_id = Some(device_id);
        self.send(&ServerFrame::Welcome {
            version: PROTOCOL_VERSION,
            host_name: self.app.host_name.clone(),
            device_id,
        })?;
        if let Some(message) = self.app.status_message() {
            self.send(&ServerFrame::Status {
                ok: false,
                message: Some(message),
            })?;
        }
        Ok(())
    }

    /// Sends the backlog after `after_seq`, then follows the thread live.
    async fn subscribe(&mut self, thread_id: Uuid, after_seq: i64) -> Result<(), Close> {
        let last = after_seq.max(0);
        match self.in_space(thread_id).await {
            Ok(true) => {}
            Ok(false) => return Ok(()),
            Err(e) if crate::db::unreachable(&e) => {
                // Checked, then read, once the database answers.
                self.subs.insert(thread_id, last);
                self.wait_for_db(thread_id, true);
                return Ok(());
            }
            Err(_) => return Err(BEHIND),
        }
        self.subs.insert(thread_id, last);
        self.behind.remove(&thread_id);
        self.catch_up(thread_id, i64::MAX).await
    }

    async fn in_space(&self, thread_id: Uuid) -> anyhow::Result<bool> {
        let asked = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM threads WHERE id = $1 AND space_id = $2)",
        )
        .bind(thread_id)
        .bind(self.app.space_id)
        .fetch_one(&self.app.db);
        self.app.bounded(asked).await
    }

    /// Reads a thread's backlog again a little later (`check`: and whether it is this
    /// space's first).
    fn wait_for_db(&mut self, thread_id: Uuid, check: bool) {
        let check = check || self.behind.get(&thread_id) == Some(&true);
        self.behind.insert(thread_id, check);
        self.again_at
            .get_or_insert_with(|| tokio::time::Instant::now() + CATCH_UP_AGAIN);
    }

    /// Reads again the backlogs the database didn't give.
    async fn catch_up_behind(&mut self) -> Result<(), Close> {
        self.again_at = None;
        let waiting: Vec<(Uuid, bool)> = self.behind.iter().map(|(t, c)| (*t, *c)).collect();
        for (thread_id, check) in waiting {
            if check {
                match self.in_space(thread_id).await {
                    Ok(true) => {
                        self.behind.insert(thread_id, false);
                    }
                    Ok(false) => {
                        self.subs.remove(&thread_id);
                        self.behind.remove(&thread_id);
                        continue;
                    }
                    Err(e) if crate::db::unreachable(&e) => {
                        self.wait_for_db(thread_id, true);
                        return Ok(());
                    }
                    Err(_) => return Err(BEHIND),
                }
            }
            self.behind.remove(&thread_id);
            self.catch_up(thread_id, i64::MAX).await?;
            if self.behind.contains_key(&thread_id) {
                // Still no answer: the rest waits too.
                return Ok(());
            }
        }
        Ok(())
    }

    /// Sends stored events after the last sent one, up to `to`, a page at a time,
    /// waiting for room in the queue. When the database doesn't answer, the thread is
    /// read again later (`behind`); when they can't be read otherwise, the device would
    /// miss them: it is told to subscribe again.
    async fn catch_up(&mut self, thread_id: Uuid, to: i64) -> Result<(), Close> {
        loop {
            let Some(&from) = self.subs.get(&thread_id) else {
                return Ok(());
            };
            let read = events::read_page(&self.app.db, thread_id, from, to, BACKLOG_PAGE);
            let page = match self.app.bounded(read).await {
                Ok(page) => page,
                Err(e) if crate::db::unreachable(&e) => {
                    tracing::info!("backlog for {thread_id} waits for the database: {e}");
                    self.wait_for_db(thread_id, false);
                    return Ok(());
                }
                Err(e) => {
                    tracing::warn!("backlog for {thread_id}: {e}");
                    return Err(BEHIND);
                }
            };
            let full = page.len() as i64 == BACKLOG_PAGE;
            for event in page {
                if let Some(frame) = self.next_event(thread_id, event) {
                    self.send_waiting(&frame).await?;
                }
            }
            if !full {
                return Ok(());
            }
        }
    }

    /// Queues a frame, waiting for room.
    async fn send_waiting(&self, frame: &ServerFrame) -> Result<(), Close> {
        let Ok(text) = serde_json::to_string(frame) else {
            return Ok(());
        };
        self.out
            .send(Message::Text(text.into()))
            .await
            .map_err(|_| Close(1000, ""))
    }

    fn send_event(&mut self, thread_id: Uuid, event: Event) -> Result<(), Close> {
        match self.next_event(thread_id, event) {
            Some(frame) => self.send(&frame),
            None => Ok(()),
        }
    }

    /// The frame for an event the device hasn't had yet, noting it as sent.
    fn next_event(&mut self, thread_id: Uuid, event: Event) -> Option<ServerFrame> {
        let last = self.subs.get_mut(&thread_id)?;
        if event.seq <= *last {
            return None;
        }
        *last = event.seq;
        Some(ServerFrame::Ev { thread_id, event })
    }

    async fn on_hub(&mut self, msg: &HubMsg) -> Result<(), Close> {
        if self.device_id.is_none() {
            return Ok(());
        }
        match msg {
            HubMsg::Event { thread_id, event } => {
                let Some(&last) = self.subs.get(thread_id) else {
                    return Ok(());
                };
                if self.behind.contains_key(thread_id) {
                    // Sent in order once the backlog before it is read.
                    return Ok(());
                }
                if event.seq > last + 1 {
                    self.catch_up(*thread_id, event.seq - 1).await?;
                    if self.behind.contains_key(thread_id) {
                        return Ok(());
                    }
                }
                self.send_event(*thread_id, (**event).clone())
            }
            HubMsg::Delta {
                thread_id,
                after_seq,
                sub_seq,
                delta,
            } => {
                if !self.subs.contains_key(thread_id) {
                    return Ok(());
                }
                self.send(&ServerFrame::Delta {
                    thread_id: *thread_id,
                    after_seq: *after_seq,
                    sub_seq: *sub_seq,
                    delta: delta.clone(),
                })
            }
            HubMsg::Changed(what) => self.send(&ServerFrame::Changed { what: *what }),
            HubMsg::Status { ok, message } => self.send(&ServerFrame::Status {
                ok: *ok,
                message: message.clone(),
            }),
            HubMsg::DeviceRevoked(id) if self.device_id == Some(*id) => {
                Err(Close(CLOSE_UNPAIRED, "This device was removed."))
            }
            HubMsg::DeviceRevoked(_) => Ok(()),
        }
    }
}

/// Sleeps until `at`, or for ever when there's nothing to wait for.
async fn sleep_until(at: Option<tokio::time::Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}
