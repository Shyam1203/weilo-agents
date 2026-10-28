//! One WebSocket per device, speaking `weilo-proto` frames as JSON text.
//!
//! The socket subscribes to the broadcast when it opens, before any backlog is read,
//! and sends each thread's events strictly in `seq` order: a live event that skips
//! ahead first fills the gap from the database, and anything at or below the last
//! sent `seq` is dropped. A socket that falls behind the broadcast is closed with
//! code 4008 and must resubscribe with `after_seq`.

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::State;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use futures::{SinkExt, StreamExt};
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;
use weilo_proto::{ClientFrame, Event, PROTOCOL_VERSION, ServerFrame};

use crate::app::{App, HubMsg};
use crate::{auth, calls, events};

pub const CLOSE_BEHIND: u16 = 4008;
pub const CLOSE_BAD_FRAME: u16 = 4400;
pub const CLOSE_OLD_VERSION: u16 = 4426;

pub async fn upgrade(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    let token = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|c| auth::cookie_value(c, auth::COOKIE))
        .map(str::to_owned);
    let device = match token {
        Some(t) => auth::device_for_token(&app.db, &t).await.ok().flatten(),
        None => None,
    };
    let Some(device_id) = device else {
        return (StatusCode::UNAUTHORIZED, "Pair this browser first.").into_response();
    };
    ws.on_upgrade(move |socket| Session::run(app, device_id, socket))
}

struct Session {
    app: Arc<App>,
    device_id: Uuid,
    out: mpsc::UnboundedSender<Message>,
    /// Followed threads and the last `seq` sent for each.
    subs: HashMap<Uuid, i64>,
    greeted: bool,
}

/// Ends the session, with a close frame to send first.
struct Close(u16, &'static str);

impl Session {
    async fn run(app: Arc<App>, device_id: Uuid, socket: WebSocket) {
        let mut hub = app.hub.subscribe();
        let (mut sink, mut stream) = socket.split();
        let (out, mut out_rx) = mpsc::unbounded_channel::<Message>();
        let writer = tokio::spawn(async move {
            while let Some(msg) = out_rx.recv().await {
                let closing = matches!(msg, Message::Close(_));
                if sink.send(msg).await.is_err() || closing {
                    break;
                }
            }
        });
        let shutdown = app.shutdown.clone();
        let mut s = Session {
            app,
            device_id,
            out,
            subs: HashMap::new(),
            greeted: false,
        };
        let close = loop {
            let step = tokio::select! {
                msg = stream.next() => match msg {
                    Some(Ok(Message::Text(text))) => s.on_frame(&text).await,
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break None,
                    Some(Ok(_)) => Ok(()),
                },
                msg = hub.recv() => match msg {
                    Ok(msg) => s.on_hub(&msg).await,
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        Err(Close(CLOSE_BEHIND, "Fell behind. Subscribe again."))
                    }
                    Err(broadcast::error::RecvError::Closed) => break None,
                },
                _ = shutdown.cancelled() => Err(Close(1001, "Weilo is stopping.")),
            };
            if let Err(close) = step {
                break Some(close);
            }
        };
        if let Some(Close(code, reason)) = close {
            let _ = s.out.send(Message::Close(Some(CloseFrame {
                code,
                reason: reason.into(),
            })));
        }
        drop(s);
        let _ = writer.await;
    }

    fn send(&self, frame: &ServerFrame) {
        if let Ok(text) = serde_json::to_string(frame) {
            let _ = self.out.send(Message::Text(text.into()));
        }
    }

    async fn on_frame(&mut self, text: &str) -> Result<(), Close> {
        let frame: ClientFrame = serde_json::from_str(text)
            .map_err(|_| Close(CLOSE_BAD_FRAME, "That frame isn't valid."))?;
        if !self.greeted && !matches!(frame, ClientFrame::Hello { .. }) {
            return Err(Close(CLOSE_BAD_FRAME, "Say hello first."));
        }
        match frame {
            ClientFrame::Hello { version } => {
                if version.abs_diff(PROTOCOL_VERSION) > 1 || version == 0 {
                    return Err(Close(
                        CLOSE_OLD_VERSION,
                        "Update Weilo to keep using this app.",
                    ));
                }
                self.greeted = true;
                self.send(&ServerFrame::Welcome {
                    version: PROTOCOL_VERSION,
                    host_name: self.app.host_name.clone(),
                    device_id: self.device_id,
                });
            }
            ClientFrame::Sub {
                thread_id,
                after_seq,
            } => self.subscribe(thread_id, after_seq).await?,
            ClientFrame::Unsub { thread_id } => {
                self.subs.remove(&thread_id);
            }
            ClientFrame::Call { call_id, call } => {
                let (app, out, device) = (self.app.clone(), self.out.clone(), self.device_id);
                tokio::spawn(async move {
                    let result = calls::handle(&app, device, call_id, call).await;
                    if let Ok(text) = serde_json::to_string(&ServerFrame::Ret { call_id, result }) {
                        let _ = out.send(Message::Text(text.into()));
                    }
                });
            }
            ClientFrame::Presence { .. } => {}
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
        .unwrap_or(false);
        if !in_space {
            return Ok(());
        }
        let last = after_seq.max(0);
        self.subs.insert(thread_id, last);
        self.catch_up(thread_id, i64::MAX).await;
        Ok(())
    }

    /// Sends stored events after the last sent one, up to `to`.
    async fn catch_up(&mut self, thread_id: Uuid, to: i64) {
        let Some(&from) = self.subs.get(&thread_id) else {
            return;
        };
        match events::read_range(&self.app.db, thread_id, from, to).await {
            Ok(evs) => {
                for event in evs {
                    self.send_event(thread_id, event);
                }
            }
            Err(e) => tracing::warn!("backlog for {thread_id}: {e}"),
        }
    }

    fn send_event(&mut self, thread_id: Uuid, event: Event) {
        let Some(last) = self.subs.get_mut(&thread_id) else {
            return;
        };
        if event.seq <= *last {
            return;
        }
        *last = event.seq;
        self.send(&ServerFrame::Ev { thread_id, event });
    }

    async fn on_hub(&mut self, msg: &HubMsg) -> Result<(), Close> {
        if !self.greeted {
            return Ok(());
        }
        match msg {
            HubMsg::Event { thread_id, event } => {
                let Some(&last) = self.subs.get(thread_id) else {
                    return Ok(());
                };
                if event.seq > last + 1 {
                    self.catch_up(*thread_id, event.seq - 1).await;
                }
                self.send_event(*thread_id, (**event).clone());
            }
            HubMsg::Delta {
                thread_id,
                after_seq,
                sub_seq,
                delta,
            } => {
                if self.subs.contains_key(thread_id) {
                    self.send(&ServerFrame::Delta {
                        thread_id: *thread_id,
                        after_seq: *after_seq,
                        sub_seq: *sub_seq,
                        delta: delta.clone(),
                    });
                }
            }
            HubMsg::Changed(what) => self.send(&ServerFrame::Changed { what: *what }),
        }
        Ok(())
    }
}
