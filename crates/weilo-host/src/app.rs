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

/// Said to every device while Postgres runs but doesn't answer.
pub const DB_SILENT: &str = "Weilo's database isn't answering. Your messages are kept.";

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
    /// How soon a message that couldn't start (the database didn't answer) is tried again.
    pub start_retry: Duration,
    /// How long a message waits for a database that is running but doesn't answer before
    /// the person is told it didn't start.
    pub start_give_up: Duration,
    /// The longest one database call may take before it counts as unanswered.
    pub db_call_limit: Duration,
    /// How often the database is asked whether it answers.
    pub db_check_every: Duration,
    /// How long that check waits for an answer.
    pub db_check_wait: Duration,
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
            start_retry: Duration::from_millis(secs("WEILO_START_RETRY_MS", 2000)),
            start_give_up: Duration::from_secs(secs("WEILO_START_GIVE_UP_SECS", 120)),
            db_call_limit: Duration::from_secs(secs("WEILO_DB_CALL_LIMIT_SECS", 45)),
            db_check_every: Duration::from_millis(secs("WEILO_DB_CHECK_MS", 2000)),
            db_check_wait: Duration::from_millis(secs("WEILO_DB_CHECK_WAIT_MS", 3000)),
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
    /// Held while a session's copy of its repo is made.
    pub worktrees: tokio::sync::Mutex<()>,
    /// Sessions whose changes are being brought back right now.
    pub bringing_back: Mutex<std::collections::HashSet<Uuid>>,
    /// Threads waiting for an engine slot right now; an idle engine gives its slot up
    /// only while some do.
    pub slot_waiters: std::sync::atomic::AtomicUsize,
    /// Approvals an engine is waiting on in this process. A pending approval not in
    /// here has no one to tell its answer to, and the job sweep closes it.
    pub live_approvals: Mutex<std::collections::HashSet<Uuid>>,
    /// Threads whose writes or reads found Postgres running but not answering (the nil
    /// id: a device's call). While any do, every device is told (that needs no
    /// database).
    db_silent: Mutex<std::collections::HashSet<Uuid>>,
    /// What the regular check last found: false while Postgres runs but doesn't answer.
    pub db_answers: tokio::sync::watch::Sender<bool>,
    /// Devices whose tokens were checked in this run (by token hash), so a device can
    /// still connect while the database doesn't answer.
    known_devices: Mutex<HashMap<Vec<u8>, Uuid>>,
    /// The "not ready" line devices were last told (`None`: all is well).
    shown_status: Mutex<Option<String>>,
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

tokio::task_local! {
    /// Set while work that must not be cut off part way runs (see `patiently`).
    static PATIENT: ();
}

/// Runs `work` so that its database calls (`App::bounded`) wait out a silent database
/// up to `Settings::db_call_limit` instead of giving up at once: work that changes
/// something then never stops between a write and what has to follow it.
pub async fn patiently<T>(work: impl std::future::Future<Output = T>) -> T {
    PATIENT.scope((), work).await
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
            worktrees: tokio::sync::Mutex::new(()),
            bringing_back: Mutex::default(),
            slot_waiters: std::sync::atomic::AtomicUsize::new(0),
            live_approvals: Mutex::default(),
            db_silent: Mutex::default(),
            shown_status: Mutex::default(),
            db_answers: tokio::sync::watch::Sender::new(true),
            known_devices: Mutex::default(),
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
        let event = self
            .bounded(async {
                let mut tx = self.db.begin().await?;
                let event =
                    events::append(&mut tx, self.fence, thread_id, &body, source, false).await?;
                tx.commit().await?;
                anyhow::Ok(event)
            })
            .await?;
        self.db_answered();
        self.committed(thread_id, vec![event.clone()]).await;
        Ok(event)
    }

    /// Appends an event its writer named, once: tried again after a lost reply, it
    /// isn't written twice (`None` then), but is still projected and told to devices.
    pub async fn append_once(
        &self,
        thread_id: Uuid,
        event_id: Uuid,
        body: &EventBody,
        source: Source,
    ) -> Result<Option<Event>> {
        let event = self
            .bounded(async {
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
                anyhow::Ok(event)
            })
            .await?;
        self.db_answered();
        match &event {
            Some(event) => self.committed(thread_id, vec![event.clone()]).await,
            None => {
                // Written by an earlier try that stopped before what follows a write:
                // that is done now (projecting it and telling devices more than once
                // is harmless).
                let earlier = self
                    .bounded(events::read_named(&self.db, thread_id, event_id))
                    .await;
                match earlier {
                    Ok(Some(earlier)) => self.committed(thread_id, vec![earlier]).await,
                    Ok(None) => {}
                    Err(e) => tracing::warn!("couldn't read back an event for {thread_id}: {e:#}"),
                }
            }
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
        // Projected first, so whoever sees the event and then reads the thread finds
        // its state already moved on.
        if let Err(e) = self.bounded(projector::run(self, thread_id)).await {
            tracing::error!("projector failed for {thread_id}: {e:#}");
        }
        for event in evs {
            self.hub.send(HubMsg::Event {
                thread_id,
                event: Box::new(event),
            });
        }
    }

    /// Gives up on a database call that takes longer than `Settings::db_call_limit`, or
    /// (except within `patiently`)
    /// as soon as the database is found not answering (`db_silent_now`; then it isn't
    /// tried at all): one stuck in Postgres (which `statement_timeout` can't end when
    /// the server itself is stuck) would otherwise hold its caller, a runner and its
    /// Stop, or a device waiting for an answer, up for a long time. It then fails as
    /// the database being out of reach.
    pub async fn bounded<T, E: Into<anyhow::Error>>(
        &self,
        call: impl std::future::Future<Output = Result<T, E>>,
    ) -> Result<T> {
        if PATIENT.try_with(|_| ()).is_ok() {
            return self.within_limit(call).await;
        }
        let away =
            |why: &'static str| Err(anyhow::Error::new(sqlx::Error::PoolTimedOut).context(why));
        if self.db_silent_now() {
            return away("the database isn't answering");
        }
        let mut answers = self.db_answers.subscribe();
        tokio::select! {
            result = tokio::time::timeout(self.settings.db_call_limit, call) => match result {
                Ok(result) => result.map_err(Into::into),
                Err(_) => away("the database didn't answer in time"),
            },
            _ = answers.wait_for(|answers| !answers) => away("the database stopped answering"),
        }
    }

    /// Gives up on a database call that takes longer than `Settings::db_call_limit`, but
    /// not because the database was found silent: for work that must not be cut off
    /// part way (a call's own bookkeeping).
    pub async fn within_limit<T, E: Into<anyhow::Error>>(
        &self,
        call: impl std::future::Future<Output = Result<T, E>>,
    ) -> Result<T> {
        match tokio::time::timeout(self.settings.db_call_limit, call).await {
            Ok(result) => result.map_err(Into::into),
            Err(_) => Err(anyhow::Error::new(sqlx::Error::PoolTimedOut)
                .context("the database didn't answer in time")),
        }
    }

    /// Postgres runs, but the check that asks it something every few seconds got no
    /// answer: calls fail at once instead of waiting.
    pub fn db_silent_now(&self) -> bool {
        *self.db_up.borrow() && !*self.db_answers.borrow()
    }

    /// What the regular check found: the database answers, or not. Every device is told.
    pub fn set_db_answers(&self, answers: bool) {
        if self.db_answers.send_replace(answers) == answers {
            return;
        }
        if answers {
            // It answers: whatever found it silent before no longer counts. One that
            // still does says so again.
            self.db_silent
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clear();
        }
        self.publish_status();
    }

    /// The device of a token checked earlier in this run, for when the database can't
    /// be asked.
    pub fn known_device(&self, token_hash: &[u8]) -> Option<Uuid> {
        self.known_devices
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(token_hash)
            .copied()
    }

    /// Notes what the database said of a token (`None`: no such device).
    pub fn note_device(&self, token_hash: Vec<u8>, device: Option<Uuid>) {
        let mut known = self.known_devices.lock().unwrap_or_else(|e| e.into_inner());
        match device {
            Some(id) => {
                known.insert(token_hash, id);
            }
            None => {
                known.remove(&token_hash);
            }
        }
    }

    /// A device was removed: its token no longer counts, even unchecked.
    pub fn forget_device(&self, device: Uuid) {
        self.known_devices
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .retain(|_, id| *id != device);
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
        self.db_up.send_replace(up);
        if up {
            // Freshly started, it answers; the regular check says otherwise if not.
            self.db_answers.send_replace(true);
            // Back after a restart: it answers. A thread that still finds it silent
            // says so again.
            self.db_silent
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clear();
        }
        self.publish_status();
    }

    /// A thread found Postgres running but not answering (`false`), or answering again.
    pub fn set_db_answering(&self, thread_id: Uuid, answering: bool) {
        let changed = {
            let mut silent = self.db_silent.lock().unwrap_or_else(|e| e.into_inner());
            if answering {
                silent.remove(&thread_id)
            } else {
                silent.insert(thread_id)
            }
        };
        if changed {
            self.publish_status();
        }
    }

    /// Something was written: a device call that found the database silent earlier no
    /// longer counts.
    fn db_answered(&self) {
        self.set_db_answering(Uuid::nil(), true);
    }

    /// Tells every socket the host's health, when it changed since they were last told.
    fn publish_status(&self) {
        let mut shown = self.shown_status.lock().unwrap_or_else(|e| e.into_inner());
        let message = self.status_message();
        if *shown != message {
            shown.clone_from(&message);
            self.hub.send(HubMsg::Status {
                ok: message.is_none(),
                message,
            });
        }
    }

    /// The plain line to show while something is wrong, if anything is.
    pub fn status_message(&self) -> Option<String> {
        if !*self.db_up.borrow() {
            return Some("Your Weilo computer is restarting its data. (a few seconds)".into());
        }
        let silent = !*self.db_answers.borrow()
            || !self
                .db_silent
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .is_empty();
        silent.then(|| DB_SILENT.to_string())
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
