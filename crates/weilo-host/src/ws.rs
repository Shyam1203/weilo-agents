//! One WebSocket per device, speaking `weilo-proto` frames as JSON text.
//!
//! The device proves itself in its first frame (`hello` with its token), not with a
//! cookie: cookies on 127.0.0.1 are shared by every port, the token in the app's own
//! storage is not. A bad token closes the socket with 4401 (unpaired). A hello with no
//! token closes it with 4001: the app may still hold a fresh pairing to trade for its
//! token (`POST /api/token`), so it checks before it calls itself unpaired.
//!
//! The socket subscribes to the broadcast when it opens, before any backlog is read,
//! and sends each thread's events strictly in `seq` order: a live event that skips
//! ahead first fills the gap from the database, and anything at or below the last
//! sent `seq` is dropped. A socket that falls behind (the broadcast, or its own
//! bounded queue of frames to write) or whose backlog can't be read is closed with
//! code 4008 and must resubscribe with `after_seq`.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::response::Response;
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
/// How long a new socket has to say hello.
const HELLO_WAIT: Duration = Duration::from_secs(10);

pub async fn upgrade(State(app): State<Arc<App>>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| Session::run(app, socket))
}

struct Session {
    app: Arc<App>,
    /// Set by a `hello` with a valid token.
    device_id: Option<Uuid>,
    out: mpsc::Sender<Message>,
    /// Followed threads and the last `seq` sent for each.
    subs: HashMap<Uuid, i64>,
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
                            let _ = sink.send(close).await;
                        }
                        break;
                    }
                    msg = out_rx.recv() => match msg {
                        Some(msg) => if sink.send(msg).await.is_err() { break },
                        None => break,
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
            calls: Arc::new(Semaphore::new(MAX_CALLS)),
            rets,
        };
        let hello_by = tokio::time::Instant::now() + HELLO_WAIT;
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
                _ = tokio::time::sleep_until(hello_by), if !greeted => {
                    Err(Close(CLOSE_BAD_FRAME, "Say hello first."))
                }
                _ = shutdown.cancelled() => Err(Close(1001, "Weilo is stopping.")),
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
        let _ = writer.await;
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
        let device = auth::device_for_token(&self.app.db, &token)
            .await
            .map_err(|_| Close(1011, "Weilo can't check this device right now."))?;
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
        let in_space: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM threads WHERE id = $1 AND space_id = $2)",
        )
        .bind(thread_id)
        .bind(self.app.space_id)
        .fetch_one(&self.app.db)
        .await
        .map_err(|_| BEHIND)?;
        if !in_space {
            return Ok(());
        }
        let last = after_seq.max(0);
        self.subs.insert(thread_id, last);
        self.catch_up(thread_id, i64::MAX).await
    }

    /// Sends stored events after the last sent one, up to `to`. When they can't be
    /// read, the device would miss them: it is told to subscribe again.
    async fn catch_up(&mut self, thread_id: Uuid, to: i64) -> Result<(), Close> {
        let Some(&from) = self.subs.get(&thread_id) else {
            return Ok(());
        };
        match events::read_range(&self.app.db, thread_id, from, to).await {
            Ok(evs) => {
                for event in evs {
                    self.send_event(thread_id, event)?;
                }
                Ok(())
            }
            Err(e) => {
                tracing::warn!("backlog for {thread_id}: {e}");
                Err(BEHIND)
            }
        }
    }

    fn send_event(&mut self, thread_id: Uuid, event: Event) -> Result<(), Close> {
        let Some(last) = self.subs.get_mut(&thread_id) else {
            return Ok(());
        };
        if event.seq <= *last {
            return Ok(());
        }
        *last = event.seq;
        self.send(&ServerFrame::Ev { thread_id, event })
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
                if event.seq > last + 1 {
                    self.catch_up(*thread_id, event.seq - 1).await?;
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
        }
    }
}
