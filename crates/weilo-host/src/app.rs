//! The host's shared state, and the in-process broadcast that carries frames to sockets.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Result;
use sqlx::PgPool;
use tokio::sync::broadcast;
use uuid::Uuid;
use weilo_proto::{Changed, Delta, Event, EventBody};

use crate::auth::Pairing;
use crate::calls::CallLocks;
use crate::db::Fence;
use crate::engines::{Registry, Runners};
use crate::events::{self, Source};
use crate::home::Home;
use crate::keep_awake::KeepAwake;
use crate::projector;

/// What travels on the broadcast. Sockets filter by the threads they follow.
#[derive(Debug, Clone)]
pub enum HubMsg {
    Event {
        thread_id: Uuid,
        event: Box<Event>,
    },
    Delta {
        thread_id: Uuid,
        after_seq: i64,
        sub_seq: i64,
        delta: Delta,
    },
    Changed(Changed),
    /// The host's health changed (`ServerFrame::Status`).
    Status {
        ok: bool,
        message: Option<String>,
    },
    /// This device was unpaired: its sockets close with 4401.
    DeviceRevoked(Uuid),
}

#[derive(Clone)]
pub struct Hub {
    tx: broadcast::Sender<Arc<HubMsg>>,
}

impl Hub {
    pub fn new(capacity: usize) -> Self {
        Self {
            tx: broadcast::channel(capacity).0,
        }
    }
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<HubMsg>> {
        self.tx.subscribe()
    }
    pub fn send(&self, msg: HubMsg) {
        // No receivers is fine: nobody is looking.
        let _ = self.tx.send(Arc::new(msg));
    }
    pub fn changed(&self, what: Changed) {
        self.send(HubMsg::Changed(what));
    }
}

pub struct Settings {
    pub self_exe: PathBuf,
    pub approval_ttl: Duration,
    pub engine_idle: Duration,
    /// No word from an engine this long (no tool running, nobody asked) ends the turn.
    pub engine_hang: Duration,
    /// How long an engine has to honour Stop before it is ended.
    pub stop_grace: Duration,
    pub job_poll: Duration,
    /// Frames waiting for one socket before it counts as fallen behind.
    pub ws_queue: usize,
    /// Sockets open at once, across all devices.
    pub max_sockets: usize,
    /// Engine processes running at once, across all threads.
    pub max_engines: usize,
    /// A thread's runner with nothing to do ends after this.
    pub runner_idle: Duration,
}

impl Settings {
    /// Test knobs come from the environment; defaults are the product's.
    pub fn from_env() -> Self {
        let secs = |key: &str, default: u64| {
            std::env::var(key)
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(default)
        };
        Self {
            self_exe: std::env::current_exe()
                .and_then(std::fs::canonicalize)
                .unwrap_or_else(|_| PathBuf::from("weilo")),
            approval_ttl: Duration::from_secs(secs("WEILO_APPROVAL_TTL_SECS", 24 * 3600)),
            engine_idle: Duration::from_secs(secs("WEILO_ENGINE_IDLE_SECS", 600)),
            engine_hang: Duration::from_secs(secs("WEILO_ENGINE_HANG_SECS", 180)),
            stop_grace: Duration::from_secs(secs("WEILO_STOP_GRACE_SECS", 5)),
            job_poll: Duration::from_millis(secs("WEILO_JOB_POLL_MS", 1000)),
            ws_queue: secs("WEILO_WS_QUEUE", 1024) as usize,
            max_sockets: secs("WEILO_MAX_SOCKETS", 128).max(1) as usize,
            max_engines: secs("WEILO_MAX_ENGINES", 8).max(1) as usize,
            runner_idle: Duration::from_secs(secs("WEILO_RUNNER_IDLE_SECS", 900)),
        }
    }
}

pub struct App {
    pub home: Home,
    pub db: PgPool,
    pub fence: Fence,
    pub space_id: Uuid,
    pub hub: Hub,
    pub engines: Registry,
    pub runners: Runners,
    pub pairing: Pairing,
    pub settings: Settings,
    pub host_name: String,
    pub keep_awake: KeepAwake,
    pub call_locks: CallLocks,
    /// Cancelled when the host is stopping.
    pub shutdown: tokio_util::sync::CancellationToken,
    /// False while Postgres is down and being restarted; new turns wait for it.
    pub db_up: tokio::sync::watch::Sender<bool>,
    /// One place per open socket (`Settings::max_sockets`).
    pub sockets: Arc<tokio::sync::Semaphore>,
    /// One slot per running engine process (`Settings::max_engines`).
    pub engine_slots: Arc<tokio::sync::Semaphore>,
    /// Signalled when a thread waits for an engine slot: idle engines give theirs up.
    pub slot_wanted: tokio::sync::Notify,
    /// Sessions whose changes are being brought back right now.
    pub bringing_back: Mutex<std::collections::HashSet<Uuid>>,
    /// Threads waiting for an engine slot right now; an idle engine gives its slot up
    /// only while some do.
    pub slot_waiters: std::sync::atomic::AtomicUsize,
    /// Approvals an engine is waiting on in this process. A pending approval not in
    /// here has no one to tell its answer to, and the job sweep closes it.
    pub live_approvals: Mutex<std::collections::HashSet<Uuid>>,
    port: AtomicU16,
    /// The newest seq published per thread, so deltas can name it without a query.
    seqs: Mutex<HashMap<Uuid, i64>>,
}

pub struct AppParts {
    pub home: Home,
    pub db: PgPool,
    pub fence: Fence,
    pub space_id: Uuid,
    pub engines: Registry,
    pub settings: Settings,
}

impl App {
    pub fn new(p: AppParts) -> Arc<Self> {
        let sockets = Arc::new(tokio::sync::Semaphore::new(p.settings.max_sockets));
        let engine_slots = Arc::new(tokio::sync::Semaphore::new(p.settings.max_engines));
        Arc::new(Self {
            home: p.home,
            db: p.db,
            fence: p.fence,
            space_id: p.space_id,
            hub: Hub::new(1024),
            engines: p.engines,
            runners: Runners::default(),
            pairing: Pairing::default(),
            settings: p.settings,
            host_name: host_name(),
            keep_awake: KeepAwake::default(),
            call_locks: CallLocks::default(),
            shutdown: Default::default(),
            db_up: tokio::sync::watch::Sender::new(true),
            sockets,
            engine_slots,
            slot_wanted: tokio::sync::Notify::new(),
            bringing_back: Mutex::default(),
            slot_waiters: std::sync::atomic::AtomicUsize::new(0),
            live_approvals: Mutex::default(),
            port: AtomicU16::new(0),
            seqs: Mutex::new(HashMap::new()),
        })
    }

    pub fn port(&self) -> u16 {
        self.port.load(Ordering::Relaxed)
    }
    pub fn set_port(&self, port: u16) {
        self.port.store(port, Ordering::Relaxed);
    }

    /// Appends one event in its own transaction, then publishes and projects it.
    pub async fn append(&self, thread_id: Uuid, body: EventBody, source: Source) -> Result<Event> {
        let mut tx = self.db.begin().await?;
        let event = events::append(&mut tx, self.fence, thread_id, &body, source, false).await?;
        tx.commit().await?;
        self.committed(thread_id, vec![event.clone()]).await;
        Ok(event)
    }

    /// Appends an event its writer named, once: tried again after a lost reply, it
    /// isn't written twice (`None` then).
    pub async fn append_once(
        &self,
        thread_id: Uuid,
        event_id: Uuid,
        body: &EventBody,
        source: Source,
    ) -> Result<Option<Event>> {
        let mut tx = self.db.begin().await?;
        let event = events::append_named(
            &mut tx,
            self.fence,
            thread_id,
            body,
            source,
            false,
            Some(event_id),
        )
        .await?;
        tx.commit().await?;
        if let Some(event) = &event {
            self.committed(thread_id, vec![event.clone()]).await;
        }
        Ok(event)
    }

    /// Call after a transaction with appends commits.
    pub async fn committed(&self, thread_id: Uuid, evs: Vec<Event>) {
        if let Some(last) = evs.last() {
            let mut seqs = self.seqs.lock().expect("seqs lock");
            let seq = seqs.entry(thread_id).or_default();
            *seq = (*seq).max(last.seq);
        }
        for event in evs {
            self.hub.send(HubMsg::Event {
                thread_id,
                event: Box::new(event),
            });
        }
        if let Err(e) = projector::run(self, thread_id).await {
            tracing::error!("projector failed for {thread_id}: {e:#}");
        }
    }

    /// Forgets a thread's cached seq (its runner ended); it is read again when needed.
    pub fn forget_seq(&self, thread_id: Uuid) {
        self.seqs.lock().expect("seqs lock").remove(&thread_id);
    }

    /// The newest durable seq of a thread.
    pub async fn last_seq(&self, thread_id: Uuid) -> i64 {
        if let Some(seq) = self.seqs.lock().expect("seqs lock").get(&thread_id) {
            return *seq;
        }
        sqlx::query_scalar("SELECT last_seq FROM threads WHERE id = $1")
            .bind(thread_id)
            .fetch_optional(&self.db)
            .await
            .ok()
            .flatten()
            .unwrap_or(0)
    }

    /// Marks the database up or down, and tells every socket.
    pub fn set_db_up(&self, up: bool) {
        if self.db_up.send_replace(up) != up {
            self.hub.send(HubMsg::Status {
                ok: up,
                message: self.status_message(),
            });
        }
    }

    /// The plain line to show while something is wrong, if anything is.
    pub fn status_message(&self) -> Option<String> {
        (!*self.db_up.borrow())
            .then(|| "Your Weilo computer is restarting its data. (a few seconds)".to_string())
    }

    /// A temporary piece of a reply. Never stored.
    pub fn publish_delta(&self, thread_id: Uuid, after_seq: i64, sub_seq: i64, delta: Delta) {
        self.hub.send(HubMsg::Delta {
            thread_id,
            after_seq,
            sub_seq,
            delta,
        });
    }
}

fn host_name() -> String {
    let mut buf = [0u8; 256];
    // SAFETY: the buffer is valid for its length.
    let rc = unsafe { libc::gethostname(buf.as_mut_ptr().cast(), buf.len()) };
    let name = if rc == 0 {
        let end = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
        String::from_utf8_lossy(&buf[..end]).into_owned()
    } else {
        String::new()
    };
    if name.is_empty() {
        "This computer".into()
    } else {
        name
    }
}
