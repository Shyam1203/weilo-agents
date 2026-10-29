//! One runner per thread: it owns the engine process, the turn in progress and the
//! queue of messages waiting for it.
//!
//! ACP can't add to a turn that is running, so a message sent with **Tell now** while
//! the agent works waits for the end of the turn and goes first, before any **After
//! this job** messages. **Stop** cancels the turn and clears the queue.
//!
//! Each engine connection has a generation and each turn a number; messages from an
//! older connection or another turn are dropped, so a late answer from an engine that
//! was replaced can't end the turn that followed.
//!
//! What the runner writes to the thread goes through an outbox, in order. When Postgres
//! is unreachable the outbox keeps it (the reply text included) and tries again until
//! the database is back, then says the runner's current state once more, so the thread
//! never stays "working" after its turn ended. Closing a card that waited goes through
//! the outbox too, in its place. Each event is named before it is first tried, so one
//! whose commit went through but whose reply was lost isn't written twice. While
//! Postgres is known to be down nothing is tried (so Stop is taken at once); the outbox
//! is written as soon as it is back.
//!
//! Bring back runs here too, between turns: no turn can start while it merges.
//!
//! Engine processes are capped across all threads (`App::engine_slots`). A thread that
//! needs one when none is free waits with a plain status, and idle engines give theirs
//! up. A runner with nothing left to do ends after a while.

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use agent_client_protocol::Responder;
use agent_client_protocol::schema::v1::{
    ContentBlock, RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionUpdate, StopReason, ToolCallStatus,
};
use anyhow::{Context, Result};
use sqlx::Row;
use tokio::sync::mpsc;
use tokio::time::Instant;
use uuid::Uuid;
use weilo_proto::{Decision, Delta, EngineNeed, EventBody, SendWhen, StepStatus, WorkState};

use super::acp::{Connection, EngineMsg, EngineTx, Failure, Started, Tagged};
use super::card::{AlwaysScope, ToolInfo, allow_once, permission_card, rule_key, tool_info};
use super::check::{Explained, explain, looks_like_auth, needs_sign_in};
use super::{Cmd, Manifest, base_env, engine_home, spec_for};
use crate::app::App;
use crate::approvals;
use crate::events::{AppendError, Source};

/// How soon a write that failed because Postgres was unreachable is tried again (also
/// tried as soon as Postgres is back).
const RETRY_WRITE: std::time::Duration = std::time::Duration::from_secs(2);
/// The most events kept while Postgres is unreachable; older ones are dropped beyond it.
const OUTBOX_MAX: usize = 10_000;
/// The live line while a thread waits for an engine slot.
const WAITING_FOR_SLOT: &str = "Waiting for another agent to finish";

pub fn spawn(app: Arc<App>, thread_id: Uuid) -> mpsc::UnboundedSender<Cmd> {
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        let (engine_tx, engine_rx) = mpsc::unbounded_channel();
        let mut runner = Runner {
            app,
            thread_id,
            conn: None,
            generation: 0,
            turns: 0,
            engine_tx,
            now_queue: VecDeque::new(),
            after_queue: VecDeque::new(),
            turn: None,
            text: String::new(),
            reply_after: None,
            sub_seq: 0,
            tools: HashMap::new(),
            running_tools: HashSet::new(),
            pending: HashMap::new(),
            fresh: false,
            restart: false,
            installs: 0,
            installing: None,
            log: None,
            outbox: VecDeque::new(),
            retry_at: None,
            dropped: false,
            state: (WorkState::Idle, String::new()),
            agent_id: None,
            slot: None,
            slots: 0,
            waiting_slot: None,
        };
        runner.run(rx, engine_rx).await;
    });
    tx
}

/// Who the thread belongs to and where its engine works.
struct ThreadCtx {
    agent_id: Option<Uuid>,
    agent_name: String,
    instructions: Option<String>,
    /// Bumped each time the instructions change.
    instructions_rev: i64,
    /// The revision this thread's engine was last told (`None`: before revisions).
    instructions_sent: Option<i64>,
    session: bool,
    engine: String,
    model: Option<String>,
    cwd: PathBuf,
    engine_session_id: Option<String>,
}

struct Turn {
    id: u64,
    stop_by: Option<Instant>,
    /// When the engine last said anything in this turn.
    heard_at: Instant,
    /// Everything the agent wrote in this turn, to spot "please sign in" replies.
    said: String,
    /// Whether the engine did anything but write (a step, a question).
    acted: bool,
    /// Where the engine's log was when the turn began, and when it began: what it
    /// wrote and stored since then explains a turn that ended without a word.
    log_from: u64,
    started: std::time::SystemTime,
}

struct Pending {
    /// In a mutex only so the runner stays `Sync`; it is used once.
    responder: std::sync::Mutex<Responder<RequestPermissionResponse>>,
    request: Box<RequestPermissionRequest>,
}

impl Pending {
    fn answer(self, response: RequestPermissionResponse) {
        let responder = self
            .responder
            .into_inner()
            .unwrap_or_else(|e| e.into_inner());
        let _ = responder.respond(response);
    }
}

/// An engine download in progress; the message that needs it waits here. Dropping it
/// stops the download.
struct Installing {
    id: u64,
    text: String,
    manifest: Manifest,
    step_id: String,
    title: String,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Installing {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct Runner {
    app: Arc<App>,
    thread_id: Uuid,
    conn: Option<Connection>,
    /// Bumped for every engine connection.
    generation: u64,
    /// Bumped for every turn.
    turns: u64,
    engine_tx: EngineTx,
    now_queue: VecDeque<String>,
    after_queue: VecDeque<String>,
    turn: Option<Turn>,
    /// The agent's reply so far, sent as deltas until it becomes one event.
    text: String,
    /// The thread's last seq when the reply in `text` began; every delta of it says so.
    reply_after: Option<i64>,
    sub_seq: i64,
    tools: HashMap<String, ToolInfo>,
    /// Tool calls started and not yet done; a running tool may be quiet a long time.
    running_tools: HashSet<String>,
    pending: HashMap<Uuid, Pending>,
    /// A new engine conversation began: the next prompt starts with who the agent is
    /// and its instructions.
    fresh: bool,
    /// Start a new engine process once this turn ends (the agent was changed).
    restart: bool,
    /// Bumped for every engine download.
    installs: u64,
    installing: Option<Installing>,
    /// The engine's log, once it has started.
    log: Option<PathBuf>,
    /// Events not yet written, in order (Postgres was unreachable).
    outbox: VecDeque<Out>,
    /// When to try the outbox again.
    retry_at: Option<Instant>,
    /// The outbox overflowed and lost events while Postgres was away.
    dropped: bool,
    /// The state this runner last said, said again after an outage.
    state: (WorkState, String),
    /// The thread's agent, kept for when the database can't be read.
    agent_id: Option<Uuid>,
    /// This thread's place among the running engine processes, held while `conn` is.
    slot: Option<tokio::sync::OwnedSemaphorePermit>,
    /// Bumped for every wait for a slot.
    slots: u64,
    /// The message waiting for a slot, with the wait's id and the task asking for one.
    waiting_slot: Option<WaitingSlot>,
}

/// Something the runner writes, in order.
#[derive(Clone)]
enum Out {
    /// An event, named so that trying it again never writes it twice.
    Event {
        id: Uuid,
        body: EventBody,
        source: Source,
    },
    /// Closes a card nobody answered: Stop was pressed, or the turn ended.
    Close { approval_id: Uuid, stopped: bool },
}

struct WaitingSlot {
    id: u64,
    text: String,
    task: tokio::task::JoinHandle<()>,
}

/// Waits for a free engine slot, asking idle engines, one at a time, to give theirs
/// up: the one that has waited longest for something to do goes first.
pub(crate) async fn engine_slot(app: &Arc<App>) -> tokio::sync::OwnedSemaphorePermit {
    if let Ok(permit) = app.engine_slots.clone().try_acquire_owned() {
        return permit;
    }
    let _waiting = SlotWaiter::new(app);
    loop {
        app.slot_wanted.notify_one();
        let wait = app.engine_slots.clone().acquire_owned();
        if let Ok(Ok(permit)) = tokio::time::timeout(RETRY_WRITE, wait).await {
            return permit;
        }
    }
}

/// Counts a thread among those waiting for a slot while it lives.
struct SlotWaiter(Arc<App>);

impl SlotWaiter {
    fn new(app: &Arc<App>) -> Self {
        app.slot_waiters
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Self(app.clone())
    }
}

impl Drop for SlotWaiter {
    fn drop(&mut self) {
        self.0
            .slot_waiters
            .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}

impl Drop for WaitingSlot {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Runner {
    async fn run(
        &mut self,
        mut cmds: mpsc::UnboundedReceiver<Cmd>,
        mut engine: mpsc::UnboundedReceiver<Tagged>,
    ) {
        let mut db_up = self.app.db_up.subscribe();
        let app = self.app.clone();
        loop {
            let db_ok = *self.app.db_up.borrow();
            let idle = self.turn.is_none() && self.conn.is_some();
            let idle_at = idle.then(|| Instant::now() + self.app.settings.engine_idle);
            let retire_at = self
                .quiet()
                .then(|| Instant::now() + self.app.settings.runner_idle);
            let stop_by = self.turn.as_ref().and_then(|t| t.stop_by);
            let hang_at = self.hang_at();
            tokio::select! {
                cmd = cmds.recv() => match cmd {
                    Some(cmd) => self.on_cmd(cmd).await,
                    None => break,
                },
                Some(msg) = engine.recv() => self.on_engine(msg).await,
                Ok(()) = db_up.changed() => {
                    if *db_up.borrow_and_update() {
                        self.drain().await;
                        if self.turn.is_none() {
                            self.start_next().await;
                        }
                    }
                }
                // While Postgres is known to be down, nothing is tried: it is written
                // when Postgres is back (above).
                _ = sleep_until(self.retry_at), if db_ok => self.drain().await,
                _ = sleep_until(idle_at) => {
                    tracing::info!("stopping the idle engine of {}", self.thread_id);
                    self.drop_conn();
                }
                _ = app.slot_wanted.notified(), if idle => {
                    // Only while a thread still waits: a call left over from a wait
                    // that already got its slot is let go.
                    if app.slot_waiters.load(std::sync::atomic::Ordering::SeqCst) > 0 {
                        tracing::info!("the idle engine of {} gives its place up", self.thread_id);
                        self.drop_conn();
                    }
                }
                _ = sleep_until(retire_at) => {
                    if self.app.runners.retire(self.thread_id, &cmds) {
                        self.app.forget_seq(self.thread_id);
                        tracing::debug!("runner of {} ends: nothing to do", self.thread_id);
                        break;
                    }
                }
                _ = sleep_until(stop_by) => {
                    tracing::warn!("engine ignored Stop; ending it");
                    self.drop_conn();
                    self.end_turn(Ok(StopReason::Cancelled)).await;
                }
                _ = sleep_until(hang_at) => self.hung().await,
            }
        }
    }

    /// Nothing running, waiting or left to write: the runner may end.
    fn quiet(&self) -> bool {
        self.turn.is_none()
            && self.conn.is_none()
            && self.installing.is_none()
            && self.waiting_slot.is_none()
            && self.now_queue.is_empty()
            && self.after_queue.is_empty()
            && self.pending.is_empty()
            && self.outbox.is_empty()
            && self.text.is_empty()
    }

    /// Whether a turn is under way or about to start.
    fn busy(&self) -> bool {
        self.turn.is_some()
            || self.installing.is_some()
            || self.waiting_slot.is_some()
            || !self.now_queue.is_empty()
            || !self.after_queue.is_empty()
    }

    /// When the turn counts as hung: no word from the engine for a while, with no tool
    /// running and nobody being asked.
    fn hang_at(&self) -> Option<Instant> {
        let turn = self.turn.as_ref()?;
        if turn.stop_by.is_some() || !self.pending.is_empty() || !self.running_tools.is_empty() {
            return None;
        }
        Some(turn.heard_at + self.app.settings.engine_hang)
    }

    async fn on_cmd(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Message { text, when } => {
                match when {
                    SendWhen::Now => self.now_queue.push_back(text),
                    SendWhen::AfterJob => self.after_queue.push_back(text),
                }
                if self.turn.is_none() {
                    self.start_next().await;
                }
            }
            Cmd::Stop => self.stop().await,
            Cmd::Decided {
                approval_id,
                decision,
            } => self.decided(approval_id, decision).await,
            Cmd::Restart => {
                if self.turn.is_none() {
                    self.drop_conn();
                } else {
                    self.restart = true;
                }
            }
            Cmd::BringBack {
                folder,
                worktree,
                title,
                reply,
            } => {
                if self.busy() {
                    let _ = reply.send(Err(STILL_WORKING.into()));
                    return;
                }
                // Awaited here: commands (a new message, say) wait in the queue until
                // the merge is done, so no turn touches the copy meanwhile.
                let result = crate::worktree::merge_back(&folder, &worktree, &title).await;
                if let Ok(said) = &result
                    && said.starts_with(crate::worktree::BROUGHT_BACK)
                {
                    // A line in the thread, so devices see it and read the changes
                    // again (there are none left to bring back).
                    let body = EventBody::Step {
                        step_id: format!("bring-back-{}", crate::ids::new_id()),
                        title: said.clone(),
                        status: StepStatus::Done,
                    };
                    self.append(body, Source::Host).await;
                }
                let _ = reply.send(result);
            }
        }
    }

    async fn on_engine(&mut self, tagged: Tagged) {
        let tagged = match tagged.msg {
            EngineMsg::Installed { id, result } => return self.installed(id, result).await,
            EngineMsg::Slot { id, permit } => return self.slot_free(id, permit).await,
            msg => Tagged { msg, ..tagged },
        };
        if tagged.generation != self.generation {
            // From an engine process that was replaced: nothing it says matters now.
            if let EngineMsg::Permission { responder, .. } = tagged.msg {
                let _ = responder.respond(cancelled());
            }
            return;
        }
        if let Some(turn) = self.turn.as_mut() {
            turn.heard_at = Instant::now();
        }
        match tagged.msg {
            EngineMsg::Update(update) => self.on_update(*update).await,
            EngineMsg::Permission { request, responder } => {
                self.on_permission(request, responder).await;
            }
            EngineMsg::TurnEnded { turn, result } => {
                if self.turn.as_ref().is_some_and(|t| t.id == turn) {
                    self.end_turn(result).await;
                }
            }
            EngineMsg::Closed => {
                let had = self.conn.take().is_some();
                if had {
                    self.slot = None;
                }
                if had && self.turn.is_some() {
                    self.problem(
                        "stopped",
                        "The engine stopped unexpectedly.",
                        Some("Try again"),
                    )
                    .await;
                    self.end_turn(Ok(StopReason::Cancelled)).await;
                }
            }
            EngineMsg::Installed { .. } | EngineMsg::Slot { .. } => {}
        }
    }

    async fn start_next(&mut self) {
        if !*self.app.db_up.borrow() || self.installing.is_some() || self.waiting_slot.is_some() {
            // Postgres is restarting, the engine is downloading, or every engine slot is
            // taken; the queue waits.
            return;
        }
        let Some(text) = self
            .now_queue
            .pop_front()
            .or_else(|| self.after_queue.pop_front())
        else {
            return;
        };
        self.set_state(WorkState::Working, "").await;
        if self.conn.is_none() {
            match self.download_needed().await {
                Ok(Some(m)) => return self.begin_install(m, text).await,
                Ok(None) => {}
                Err(e) => return self.start_failed(e).await,
            }
        }
        self.begin_turn(text).await;
    }

    /// Connects if needed, then sends the prompt. A new engine process needs a free
    /// slot; without one, the message waits for it.
    async fn begin_turn(&mut self, text: String) {
        if self.conn.is_none() && self.slot.is_none() {
            match self.app.engine_slots.clone().try_acquire_owned() {
                Ok(permit) => self.slot = Some(permit),
                Err(_) => return self.wait_for_slot(text).await,
            }
        }
        if self.conn.is_none()
            && let Err(e) = self.connect().await
        {
            self.slot = None;
            return self.start_failed(e).await;
        }
        self.turns += 1;
        self.turn = Some(Turn {
            id: self.turns,
            stop_by: None,
            heard_at: Instant::now(),
            said: String::new(),
            acted: false,
            log_from: self
                .log
                .as_ref()
                .and_then(|l| std::fs::metadata(l).ok())
                .map_or(0, |m| m.len()),
            started: std::time::SystemTime::now(),
        });
        let mut blocks = Vec::new();
        let mut told = None;
        match load_ctx(&self.app, self.thread_id).await {
            Ok(ctx) => {
                if std::mem::take(&mut self.fresh) {
                    blocks.push(preamble(&ctx));
                    told = Some(ctx.instructions_rev);
                } else if ctx.instructions_sent.unwrap_or(0) != ctx.instructions_rev {
                    // The instructions changed after this conversation began.
                    blocks.push(changed_instructions(&ctx));
                    told = Some(ctx.instructions_rev);
                }
            }
            Err(e) => tracing::warn!("no thread context for {}: {e:#}", self.thread_id),
        }
        blocks.push(text);
        let conn = self.conn.as_ref().expect("connected");
        conn.prompt(blocks, self.turns);
        if let Some(rev) = told {
            let saved = sqlx::query("UPDATE threads SET instructions_rev_sent = $2 WHERE id = $1")
                .bind(self.thread_id)
                .bind(rev)
                .execute(&self.app.db)
                .await;
            if let Err(e) = saved {
                tracing::warn!("couldn't note the instructions sent: {e}");
            }
        }
    }

    /// Every engine slot is taken: says so, asks idle engines to give theirs up, and
    /// waits for one in the background (Stop still works meanwhile).
    async fn wait_for_slot(&mut self, text: String) {
        tracing::info!("{} waits for a free engine slot", self.thread_id);
        self.set_state(WorkState::Working, WAITING_FOR_SLOT).await;
        self.slots += 1;
        let id = self.slots;
        let (app, tx) = (self.app.clone(), self.engine_tx.clone());
        let task = tokio::spawn(async move {
            let permit = engine_slot(&app).await;
            let msg = EngineMsg::Slot { id, permit };
            let _ = tx.send(Tagged { generation: 0, msg });
        });
        self.waiting_slot = Some(WaitingSlot { id, text, task });
    }

    async fn slot_free(&mut self, id: u64, permit: tokio::sync::OwnedSemaphorePermit) {
        if self.waiting_slot.as_ref().is_none_or(|w| w.id != id) {
            return;
        }
        let Some(waiting) = self.waiting_slot.take() else {
            return;
        };
        self.slot = Some(permit);
        self.set_state(WorkState::Working, "").await;
        self.begin_turn(waiting.text.clone()).await;
    }

    async fn start_failed(&mut self, e: (Explained, String)) {
        tracing::warn!("engine start failed for {}: {}", self.thread_id, e.1);
        self.problem(e.0.code(), &e.0.message, Some(e.0.action))
            .await;
        self.now_queue.clear();
        self.after_queue.clear();
        self.set_state(WorkState::Idle, "").await;
    }

    /// The thread's engine, when it must be downloaded before it can start.
    async fn download_needed(&self) -> Result<Option<Manifest>, (Explained, String)> {
        let ctx = load_ctx(&self.app, self.thread_id)
            .await
            .map_err(internal)?;
        let m = self
            .app
            .engines
            .get(&ctx.engine)
            .with_context(|| format!("no engine named {}", ctx.engine))
            .map_err(internal)?;
        Ok(self.app.engines.needs_download(m).then(|| m.clone()))
    }

    /// Downloads the engine in the background, so Stop still works meanwhile; the
    /// message waits for it.
    async fn begin_install(&mut self, m: Manifest, text: String) {
        let step_id = format!("install-{}", m.name);
        let title = format!("Installing {}", m.title);
        self.step(&step_id, &title, StepStatus::Running).await;
        self.installs += 1;
        let id = self.installs;
        let (app, tx, manifest) = (self.app.clone(), self.engine_tx.clone(), m.clone());
        let task = tokio::spawn(async move {
            let result = app.engines.install(&manifest).await;
            let msg = EngineMsg::Installed { id, result };
            let _ = tx.send(Tagged { generation: 0, msg });
        });
        self.installing = Some(Installing {
            id,
            text,
            manifest: m,
            step_id,
            title,
            task,
        });
    }

    async fn installed(&mut self, id: u64, result: Result<(), String>) {
        if self.installing.as_ref().is_none_or(|i| i.id != id) {
            return;
        }
        let Some(inst) = self.installing.take() else {
            return;
        };
        let status = if result.is_ok() {
            StepStatus::Done
        } else {
            StepStatus::Failed
        };
        self.step(&inst.step_id, &inst.title, status).await;
        match result {
            Ok(()) => self.begin_turn(inst.text.clone()).await,
            Err(e) => {
                let f = Failure::other(e);
                let key = self.app.engines.key_in_use(&inst.manifest);
                let explained = (explain(&inst.manifest, &f, key.as_deref()), f.text);
                self.start_failed(explained).await;
            }
        }
    }

    /// Starts the engine, picking up the thread's earlier engine conversation when the
    /// engine can. Errors are explained for people (and kept whole for the log).
    async fn connect(&mut self) -> Result<(), (Explained, String)> {
        let ctx = load_ctx(&self.app, self.thread_id)
            .await
            .map_err(internal)?;
        let manifest = self
            .app
            .engines
            .get(&ctx.engine)
            .cloned()
            .with_context(|| format!("no engine named {}", ctx.engine))
            .map_err(internal)?;
        super::check::recheck_keys(&self.app, &manifest);
        let key = self.app.engines.key_in_use(&manifest);
        let explained = |f: Failure| (explain(&manifest, &f, key.as_deref()), f.text.clone());
        let spec = spec_for(&self.app, &manifest, ctx.model.clone()).map_err(explained)?;
        std::fs::create_dir_all(&ctx.cwd).map_err(|e| internal(e.into()))?;
        let log = self
            .app
            .home
            .logs()
            .join(format!("engine-{}.log", manifest.name));
        self.log = Some(log.clone());
        self.generation += 1;
        let resume = ctx.engine_session_id.clone();
        let conn = Connection::open(
            &spec,
            base_env(),
            &ctx.cwd,
            &log,
            self.engine_tx.clone(),
            self.generation,
            resume.clone(),
        )
        .await
        .map_err(explained)?;
        sqlx::query("UPDATE threads SET engine_session_id = $2 WHERE id = $1")
            .bind(self.thread_id)
            .bind(conn.session_id.0.as_ref())
            .execute(&self.app.db)
            .await
            .map_err(|e| internal(e.into()))?;
        self.fresh = conn.started == Started::New;
        if conn.started == Started::New && resume.is_some() {
            let message = format!(
                "{} started a fresh conversation; earlier messages aren't in its memory.",
                ctx.agent_name
            );
            self.problem("fresh_start", &message, None).await;
        }
        self.conn = Some(conn);
        Ok(())
    }

    async fn on_update(&mut self, update: SessionUpdate) {
        match update {
            SessionUpdate::AgentMessageChunk(chunk) => {
                if let ContentBlock::Text(t) = chunk.content
                    && !is_startup_banner(&t.text)
                {
                    self.delta(t.text).await;
                }
            }
            SessionUpdate::ToolCall(call) => {
                let id = call.tool_call_id.0.to_string();
                let info = ToolInfo {
                    title: call.title.clone(),
                    kind: Some(call.kind),
                    raw_input: call.raw_input.clone(),
                };
                self.tools.insert(id.clone(), info);
                let status = step_status(call.status);
                self.track_tool(&id, status);
                self.step(&id, &call.title, status).await;
            }
            SessionUpdate::ToolCallUpdate(update) => {
                let id = update.tool_call_id.0.to_string();
                let info = self.tools.entry(id.clone()).or_default();
                if let Some(title) = update.fields.title.clone() {
                    info.title = title;
                }
                if update.fields.kind.is_some() {
                    info.kind = update.fields.kind;
                }
                if update.fields.raw_input.is_some() {
                    info.raw_input = update.fields.raw_input.clone();
                }
                let title = info.title.clone();
                if let Some(status) = update.fields.status {
                    let status = step_status(status);
                    self.track_tool(&id, status);
                    self.step(&id, &title, status).await;
                }
            }
            _ => {}
        }
    }

    /// Ends the engine process. Anything it still sends is ignored from now on.
    fn drop_conn(&mut self) {
        self.conn = None;
        self.slot = None;
        self.generation += 1;
    }

    fn track_tool(&mut self, id: &str, status: StepStatus) {
        if status == StepStatus::Running {
            self.running_tools.insert(id.to_string());
        } else {
            self.running_tools.remove(id);
        }
    }

    async fn delta(&mut self, text: String) {
        if text.is_empty() {
            return;
        }
        if let Some(turn) = self.turn.as_mut() {
            turn.said.push_str(&text);
        }
        // Pinned when the reply begins. If another event lands in the thread meanwhile
        // (a message from the person, say), devices drop pieces older than it, so the
        // reply starts again under the new seq, with the text so far as piece 0.
        self.text.push_str(&text);
        let now = self.app.last_seq(self.thread_id).await;
        let text = match self.reply_after {
            Some(seq) if seq >= now => text,
            _ => {
                self.reply_after = Some(now);
                self.sub_seq = 0;
                self.text.clone()
            }
        };
        let after_seq = self.reply_after.unwrap_or(now);
        self.app.publish_delta(
            self.thread_id,
            after_seq,
            self.sub_seq,
            Delta::AgentText { text },
        );
        self.sub_seq += 1;
    }

    /// The reply so far becomes one durable message.
    async fn flush_text(&mut self) {
        if self.text.is_empty() {
            return;
        }
        let text = std::mem::take(&mut self.text);
        self.sub_seq = 0;
        self.reply_after = None;
        if let Ok(ctx) = load_ctx(&self.app, self.thread_id).await {
            self.agent_id = ctx.agent_id;
        }
        // The text goes into the outbox, so it is kept even when it can't be written yet.
        let agent_id = self.agent_id;
        self.append(EventBody::AgentMessage { text, agent_id }, Source::Agent)
            .await;
    }

    async fn step(&mut self, step_id: &str, title: &str, status: StepStatus) {
        if let Some(turn) = self.turn.as_mut() {
            turn.acted = true;
        }
        self.flush_text().await;
        let body = EventBody::Step {
            step_id: step_id.into(),
            title: title.into(),
            status,
        };
        self.append(body, Source::Engine).await;
    }

    async fn on_permission(
        &mut self,
        request: Box<RequestPermissionRequest>,
        responder: Responder<RequestPermissionResponse>,
    ) {
        // Outside a turn, or once Stop was pressed, nobody will answer: no card.
        match self.turn.as_mut() {
            Some(turn) if turn.stop_by.is_none() => turn.acted = true,
            _ => {
                let _ = responder.respond(cancelled());
                return;
            }
        }
        self.flush_text().await;
        let known = self.tools.get(request.tool_call.tool_call_id.0.as_ref());
        let tool = tool_info(&request, known);
        let ctx = match load_ctx(&self.app, self.thread_id).await {
            Ok(ctx) => ctx,
            Err(e) => {
                tracing::error!("permission without a thread: {e:#}");
                let _ = responder.respond(cancelled());
                return;
            }
        };
        // A session's rule covers its folder; an agent's chats have no folder of the
        // person's, so their rule covers that agent.
        let (always, scope) = if ctx.session {
            (AlwaysScope::Folder, folder_scope(&ctx.cwd))
        } else {
            (AlwaysScope::Agent, "agent".to_string())
        };
        // "Always allow" lives here, never in the engine: the engine only ever hears
        // "allow once", for this exact command in this folder.
        let key = rule_key(&tool);
        if let Some(key) = &key
            && approvals::always_allowed(&self.app, ctx.agent_id, key, &scope).await
        {
            let _ = responder.respond(selected(&request, &Decision::Allow));
            return;
        }
        let approval_id = crate::ids::new_id();
        let always = key.is_some().then_some(always);
        let card = permission_card(&ctx.agent_name, approval_id, &tool, always);
        // What came before the card is written first, so the thread reads in order.
        self.drain().await;
        if !self.outbox.is_empty() {
            tracing::warn!("couldn't write {} before a card", self.thread_id);
            return self.couldnt_ask(&card.title, &request, responder).await;
        }
        // Live before it is saved, so the sweep never takes it for one nobody waits on.
        self.app
            .live_approvals
            .lock()
            .expect("live approvals lock")
            .insert(approval_id);
        let opened = approvals::open(
            &self.app,
            approvals::NewApproval {
                id: approval_id,
                thread_id: self.thread_id,
                card: card.clone(),
                tool: key.unwrap_or_default(),
                scope,
                agent_id: ctx.agent_id,
            },
        )
        .await;
        if let Err(e) = opened {
            tracing::error!("couldn't save an approval: {e:#}");
            self.app
                .live_approvals
                .lock()
                .expect("live approvals lock")
                .remove(&approval_id);
            return self.couldnt_ask(&card.title, &request, responder).await;
        }
        self.pending.insert(
            approval_id,
            Pending {
                responder: responder.into(),
                request,
            },
        );
        self.set_state(WorkState::NeedsYou, &card.title).await;
    }

    /// The card couldn't be saved, so nobody could be asked: the engine is told no, and
    /// the person is told why.
    async fn couldnt_ask(
        &mut self,
        title: &str,
        request: &RequestPermissionRequest,
        responder: Responder<RequestPermissionResponse>,
    ) {
        let _ = responder.respond(selected(request, &Decision::Deny));
        let message = format!("Weilo couldn't ask you about this, so it wasn't allowed: {title}");
        self.problem("couldnt_ask", &message, Some("Try again"))
            .await;
    }

    async fn decided(&mut self, approval_id: Uuid, decision: Decision) {
        let Some(p) = self.pending.remove(&approval_id) else {
            return;
        };
        self.app
            .live_approvals
            .lock()
            .expect("live approvals lock")
            .remove(&approval_id);
        let response = selected(&p.request, &decision);
        p.answer(response);
        if let Some(turn) = self.turn.as_mut() {
            turn.heard_at = Instant::now();
        }
        if self.pending.is_empty() && self.turn.is_some() {
            self.set_state(WorkState::Working, "").await;
        }
    }

    async fn stop(&mut self) {
        self.now_queue.clear();
        self.after_queue.clear();
        if self.waiting_slot.take().is_some() {
            // Dropping it stops the wait.
            self.set_state(WorkState::Idle, "").await;
            return;
        }
        if let Some(inst) = self.installing.take() {
            let (step_id, title) = (inst.step_id.clone(), inst.title.clone());
            // Dropping it stops the download.
            drop(inst);
            self.step(&step_id, &title, StepStatus::Failed).await;
            self.set_state(WorkState::Idle, "").await;
            return;
        }
        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        if turn.stop_by.is_some() {
            return;
        }
        turn.stop_by = Some(Instant::now() + self.app.settings.stop_grace);
        if let Some(conn) = &self.conn {
            conn.cancel();
        }
        self.close_pending(true).await;
    }

    /// Closes the cards still waiting: as stopped (Stop was pressed) or interrupted (the
    /// turn ended without an answer, say because the engine died).
    async fn close_pending(&mut self, stopped: bool) {
        let pending = std::mem::take(&mut self.pending);
        if pending.is_empty() {
            return;
        }
        for (approval_id, p) in pending {
            p.answer(cancelled());
            // In line with the events around it; kept and tried again while Postgres
            // is away, so the card never waits on an engine that isn't listening.
            self.outbox.push_back(Out::Close {
                approval_id,
                stopped,
            });
        }
        self.write_soon().await;
    }

    /// The engine went quiet: cancel the turn and say so.
    async fn hung(&mut self) {
        let title = load_ctx(&self.app, self.thread_id)
            .await
            .ok()
            .and_then(|c| self.app.engines.get(&c.engine).map(|m| m.title.clone()))
            .unwrap_or_else(|| "The engine".into());
        tracing::warn!("engine of {} stopped responding", self.thread_id);
        self.problem(
            "not_responding",
            &format!("{title} stopped responding, so this reply stopped."),
            Some("Try again"),
        )
        .await;
        self.now_queue.clear();
        self.after_queue.clear();
        if let Some(conn) = &self.conn {
            conn.cancel();
        }
        // A fresh process next time; this one may be stuck for good.
        self.drop_conn();
        self.end_turn(Ok(StopReason::Cancelled)).await;
    }

    async fn end_turn(&mut self, result: Result<StopReason, Failure>) {
        let Some(turn) = self.turn.take() else {
            return;
        };
        self.flush_text().await;
        self.running_tools.clear();
        self.close_pending(false).await;
        let manifest = load_ctx(&self.app, self.thread_id)
            .await
            .ok()
            .and_then(|c| self.app.engines.get(&c.engine).cloned());
        match (result, manifest) {
            (Ok(StopReason::Refusal), _) => {
                self.problem("refused", "The engine refused this request.", None)
                    .await;
            }
            (Ok(_), Some(m)) if asks_to_sign_in(&turn.said) => {
                let f = Failure {
                    auth_required: true,
                    ..Failure::default()
                };
                self.key_turned_down(&m);
                let e = explain(&m, &f, self.app.engines.key_in_use(&m).as_deref());
                self.problem(e.code(), &e.message, Some(e.action)).await;
                // A new key or sign-in only reaches a new engine process.
                self.drop_conn();
            }
            (Ok(StopReason::EndTurn), Some(m)) if turn.said.trim().is_empty() && !turn.acted => {
                self.no_answer(&m, &turn).await;
            }
            (Ok(_), _) => {}
            (Err(f), m) => {
                tracing::warn!("turn failed in {}: {f}", self.thread_id);
                match m {
                    Some(m) => {
                        let e = explain(&m, &f, self.app.engines.key_in_use(&m).as_deref());
                        if e.needs == EngineNeed::Key {
                            self.key_turned_down(&m);
                        }
                        self.problem(e.code(), &e.message, Some(e.action)).await;
                        if matches!(e.needs, EngineNeed::SignIn | EngineNeed::Key) {
                            self.drop_conn();
                        }
                    }
                    None => {
                        self.problem(
                            "engine_error",
                            "The engine hit an error and stopped this reply.",
                            Some("Try again"),
                        )
                        .await;
                    }
                }
            }
        }
        if std::mem::take(&mut self.restart) {
            self.drop_conn();
        }
        if self.now_queue.is_empty() && self.after_queue.is_empty() {
            self.set_state(WorkState::Idle, "").await;
        } else {
            self.start_next().await;
        }
    }

    /// A turn that ended normally without a word: said plainly, with the reason when the
    /// engine's log or its stored conversation shows a key that didn't work.
    async fn no_answer(&mut self, m: &Manifest, turn: &Turn) {
        let name = load_ctx(&self.app, self.thread_id)
            .await
            .map_or_else(|_| "The agent".into(), |c| c.agent_name);
        let mut found = self
            .log
            .as_ref()
            .map(|l| log_since(l, turn.log_from))
            .unwrap_or_default();
        found.push_str(&stored_errors(
            &engine_home(&self.app.home, &m.name),
            turn.started,
        ));
        if !looks_like_auth(&found) {
            let message = format!("{name} didn't answer.");
            return self
                .problem("didnt_answer", &message, Some("Try again"))
                .await;
        }
        self.key_turned_down(m);
        let (code, message, action) = match self.app.engines.key_in_use(m) {
            Some(provider) => (
                "key_rejected",
                format!("{name} didn't answer: your {provider} key didn't work."),
                "Change key",
            ),
            None => {
                let e = needs_sign_in(m);
                (
                    e.code(),
                    format!("{name} didn't answer. {}", e.message),
                    e.action,
                )
            }
        };
        self.problem(code, &message, Some(action)).await;
        // A new key only reaches a new engine process.
        self.drop_conn();
    }

    /// The engine's provider turned its key down: readiness says so from now on (until a
    /// new key is saved or a check finds it works).
    fn key_turned_down(&self, m: &Manifest) {
        if let Some((spec, _)) = self.app.engines.keys_in_use(m).into_iter().next() {
            self.app.engines.mark_key(m, &spec.id, Some(false));
            self.app.hub.changed(weilo_proto::Changed::Engines);
        }
    }

    /// `code` is the kind of problem (`EventBody::Problem::code`); the engine is this
    /// thread's.
    async fn problem(&mut self, code: &str, message: &str, action: Option<&str>) {
        self.flush_text().await;
        let engine = load_ctx(&self.app, self.thread_id)
            .await
            .ok()
            .map(|c| c.engine);
        self.append(
            EventBody::Problem {
                message: message.into(),
                action: action.map(Into::into),
                code: Some(code.into()),
                engine,
            },
            Source::Host,
        )
        .await;
    }

    async fn set_state(&mut self, state: WorkState, live_line: &str) {
        self.flush_text().await;
        self.state = (state, live_line.to_string());
        self.append(
            EventBody::State {
                state,
                live_line: live_line.into(),
            },
            Source::Host,
        )
        .await;
    }

    /// Writes an event after any still waiting in the outbox.
    async fn append(&mut self, body: EventBody, source: Source) {
        let id = crate::ids::new_id();
        self.outbox.push_back(Out::Event { id, body, source });
        if self.outbox.len() > OUTBOX_MAX {
            // The oldest event goes; a card's closing never does.
            if let Some(at) = self
                .outbox
                .iter()
                .position(|o| matches!(o, Out::Event { .. }))
            {
                self.outbox.remove(at);
                self.dropped = true;
            }
        }
        self.write_soon().await;
    }

    /// Writes the outbox now, unless it waits for a retry or Postgres is known to be
    /// down (then it is written when Postgres is back).
    async fn write_soon(&mut self) {
        if !*self.app.db_up.borrow() {
            if self.outbox.len() == 1 {
                tracing::info!(
                    "keeping what {} writes until the database is back",
                    self.thread_id
                );
            }
            return;
        }
        if self.retry_at.is_none() {
            self.drain().await;
        }
    }

    /// Writes one thing from the outbox.
    async fn write(&self, out: &Out) -> anyhow::Result<()> {
        match out {
            Out::Event { id, body, source } => {
                self.app
                    .append_once(self.thread_id, *id, body, *source)
                    .await?;
            }
            Out::Close {
                approval_id,
                stopped,
            } => {
                if *stopped {
                    approvals::close_stopped(&self.app, *approval_id).await?;
                } else {
                    approvals::close_interrupted(&self.app, *approval_id).await?;
                }
                self.app
                    .live_approvals
                    .lock()
                    .expect("live approvals lock")
                    .remove(approval_id);
            }
        }
        Ok(())
    }

    /// Writes the outbox in order. A write that fails because Postgres can't be reached
    /// stays first in line and is tried again (soon, and when Postgres is back); any
    /// other failure is logged and that event dropped. After an outage, the current
    /// state is said again.
    async fn drain(&mut self) {
        let recovering = self.retry_at.take().is_some() || self.dropped;
        while let Some(out) = self.outbox.front().cloned() {
            match self.write(&out).await {
                Ok(_) => {
                    self.outbox.pop_front();
                }
                Err(e) if unreachable_db(&e) => {
                    if !recovering {
                        tracing::warn!(
                            "couldn't write to {} yet, will try again: {e:#}",
                            self.thread_id
                        );
                    }
                    self.retry_at = Some(Instant::now() + RETRY_WRITE);
                    return;
                }
                Err(e) => {
                    tracing::error!("write to {} failed: {e:#}", self.thread_id);
                    if let Out::Close { approval_id, .. } = out {
                        // Left to the sweep, which closes cards nobody waits on.
                        self.app
                            .live_approvals
                            .lock()
                            .expect("live approvals lock")
                            .remove(&approval_id);
                    }
                    self.outbox.pop_front();
                }
            }
        }
        if recovering {
            tracing::info!(
                "wrote what {} kept while the database was away",
                self.thread_id
            );
            let (state, live_line) = self.state.clone();
            if std::mem::take(&mut self.dropped) || self.turn.is_none() {
                let body = EventBody::State { state, live_line };
                if let Err(e) = self.app.append(self.thread_id, body, Source::Host).await {
                    tracing::warn!("couldn't say the state of {}: {e:#}", self.thread_id);
                }
            }
        }
    }
}

/// The message said when Bring back is asked for while the session works.
pub const STILL_WORKING: &str =
    "The session is still working. Wait for it to finish, then try again.";

/// Whether a failed write failed because Postgres couldn't be reached (restarting, or
/// the connection broke), so it is worth trying again.
fn unreachable_db(e: &anyhow::Error) -> bool {
    let sql = e
        .downcast_ref::<sqlx::Error>()
        .or_else(|| match e.downcast_ref() {
            Some(AppendError::Db(sql)) => Some(sql),
            _ => None,
        });
    match sql {
        Some(
            sqlx::Error::Io(_)
            | sqlx::Error::PoolTimedOut
            | sqlx::Error::WorkerCrashed
            | sqlx::Error::Protocol(_),
        ) => true,
        Some(sqlx::Error::Database(db)) => db.code().is_some_and(|c| {
            // Connection problems, shutdown or crash recovery, too many connections.
            c.starts_with("08") || c.starts_with("57P") || c == "53300"
        }),
        _ => false,
    }
}

/// pi-acp's startup notes ("pi v1.4.0", "---", what it loaded), sent as if the agent
/// said them, and its "New version available" line: not part of any reply.
fn is_startup_banner(text: &str) -> bool {
    let mut lines = text.lines();
    let first = lines.next().unwrap_or_default().trim();
    let versioned = first
        .strip_prefix("pi v")
        .is_some_and(|v| v.starts_with(|c: char| c.is_ascii_digit()));
    (versioned && lines.next().map(str::trim) == Some("---"))
        || text.trim_start().starts_with("New version available: v")
}

/// The last part of what the engine wrote to its log since `from`.
fn log_since(log: &Path, from: u64) -> String {
    let bytes = std::fs::read(log).unwrap_or_default();
    let from = usize::try_from(from).unwrap_or(0).min(bytes.len());
    let start = from.max(bytes.len().saturating_sub(16 * 1024));
    String::from_utf8_lossy(&bytes[start..]).into_owned()
}

/// Errors an engine stored with its conversation since `since`: pi keeps each
/// conversation in `sessions/<folder>/<id>.jsonl`, a failed request's reason as
/// `errorMessage`. Only the newest file's last part is read.
fn stored_errors(engine_home: &Path, since: std::time::SystemTime) -> String {
    let newest = std::fs::read_dir(engine_home.join("sessions"))
        .into_iter()
        .flatten()
        .flatten()
        .flat_map(|d| std::fs::read_dir(d.path()).into_iter().flatten().flatten())
        .filter_map(|f| {
            let modified = f.metadata().ok()?.modified().ok()?;
            (modified >= since && f.path().extension().is_some_and(|e| e == "jsonl"))
                .then(|| (modified, f.path()))
        })
        .max();
    let Some((_, path)) = newest else {
        return String::new();
    };
    let bytes = std::fs::read(path).unwrap_or_default();
    let tail = &bytes[bytes.len().saturating_sub(32 * 1024)..];
    String::from_utf8_lossy(tail)
        .lines()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter_map(|v| v["message"]["errorMessage"].as_str().map(str::to_string))
        .collect::<Vec<_>>()
        .join("\n")
}

/// A short reply that is only the engine asking to sign in ("Please run /login").
fn asks_to_sign_in(said: &str) -> bool {
    let t = said.to_lowercase();
    said.len() < 400
        && [
            "please run /login",
            "invalid api key",
            "not logged in",
            "oauth token has expired",
            "credit balance is too low",
        ]
        .iter()
        .any(|w| t.contains(w))
}

/// Who the agent is, in plain words, plus the person's instructions.
fn preamble(ctx: &ThreadCtx) -> String {
    let mut out = if ctx.session {
        format!(
            "You are {}, working for the person using Weilo in a coding session in {}. \
             Explain what you do in plain words.",
            ctx.agent_name,
            ctx.cwd.display()
        )
    } else {
        format!(
            "You are {}, a teammate who works for the person using Weilo, an app where they \
             chat with their AI teammates. They may not be technical: use plain words, keep \
             replies short, and avoid developer jargon unless they use it.",
            ctx.agent_name
        )
    };
    if let Some(instructions) = ctx.instructions.as_deref().map(str::trim)
        && !instructions.is_empty()
    {
        out.push_str("\n\nTheir instructions for you:\n");
        out.push_str(instructions);
    }
    // A blank line, so engines that join the blocks keep the message apart.
    out.push_str("\n\n");
    out
}

/// Sent on a continued conversation when the instructions changed since it began.
fn changed_instructions(ctx: &ThreadCtx) -> String {
    match ctx.instructions.as_deref().map(str::trim) {
        Some(i) if !i.is_empty() => {
            format!("The person changed their instructions for you. From now on:\n{i}\n\n")
        }
        _ => "The person removed their instructions for you. Ignore the earlier ones.\n\n".into(),
    }
}

/// An error people can't act on, explained plainly (and kept whole for the log).
fn internal(e: anyhow::Error) -> (Explained, String) {
    let text = format!("{e:#}");
    (
        Explained {
            needs: EngineNeed::Error,
            message: "Couldn't start the engine. Try again.".into(),
            action: "Try again",
        },
        text,
    )
}

async fn sleep_until(at: Option<Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

fn step_status(s: ToolCallStatus) -> StepStatus {
    match s {
        ToolCallStatus::Completed => StepStatus::Done,
        ToolCallStatus::Failed => StepStatus::Failed,
        _ => StepStatus::Running,
    }
}

/// Allow (and Always allow) answer "allow once"; Deny answers "reject".
fn selected(req: &RequestPermissionRequest, decision: &Decision) -> RequestPermissionResponse {
    match allow_once(req, decision) {
        Some(id) => RequestPermissionResponse::new(RequestPermissionOutcome::Selected(
            SelectedPermissionOutcome::new(id),
        )),
        None => cancelled(),
    }
}

fn cancelled() -> RequestPermissionResponse {
    RequestPermissionResponse::new(RequestPermissionOutcome::Cancelled)
}

fn folder_scope(cwd: &std::path::Path) -> String {
    format!("folder:{}", cwd.display())
}

async fn load_ctx(app: &App, thread_id: Uuid) -> Result<ThreadCtx> {
    let row = sqlx::query(
        "SELECT t.kind, t.agent_id, t.engine AS thread_engine, t.folder, t.worktree,
                t.engine_session_id, t.instructions_rev_sent, a.name, a.slug,
                a.engine AS agent_engine, a.model, a.instructions,
                COALESCE(a.instructions_rev, 0) AS instructions_rev
         FROM threads t LEFT JOIN agents a ON a.id = t.agent_id WHERE t.id = $1",
    )
    .bind(thread_id)
    .fetch_one(&app.db)
    .await?;
    let kind: String = row.get("kind");
    let agent_name: Option<String> = row.get("name");
    let session = kind == "session";
    let engine: Option<String> = if session {
        row.get("thread_engine")
    } else {
        row.get("agent_engine")
    };
    let cwd = if session {
        let dir: Option<String> = row
            .get::<Option<String>, _>("worktree")
            .or(row.get("folder"));
        PathBuf::from(dir.context("the session has no folder")?)
    } else {
        let slug: Option<String> = row.get("slug");
        app.home.workspace(slug.as_deref().unwrap_or("shared"))
    };
    Ok(ThreadCtx {
        agent_id: row.get("agent_id"),
        agent_name: agent_name.unwrap_or_else(|| "The agent".into()),
        instructions: row.get("instructions"),
        instructions_rev: row.get("instructions_rev"),
        instructions_sent: row.get("instructions_rev_sent"),
        session,
        engine: engine.context("the thread has no engine")?,
        model: row.get("model"),
        cwd,
        engine_session_id: row.get("engine_session_id"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(session: bool, instructions: Option<&str>) -> ThreadCtx {
        ThreadCtx {
            agent_id: None,
            agent_name: "Ava".into(),
            instructions: instructions.map(Into::into),
            instructions_rev: 0,
            instructions_sent: None,
            session,
            engine: "echo".into(),
            model: None,
            cwd: "/work/shop".into(),
            engine_session_id: None,
        }
    }

    #[test]
    fn the_agent_learns_who_it_is_and_its_instructions() {
        let p = preamble(&ctx(false, Some("Answer in French.")));
        assert!(p.starts_with("You are Ava, a teammate"));
        assert!(p.ends_with("Their instructions for you:\nAnswer in French.\n\n"));
        let p = preamble(&ctx(true, None));
        assert!(p.contains("coding session in /work/shop"));
        assert!(!p.contains("instructions"));
    }

    #[test]
    fn only_short_sign_in_replies_count() {
        assert!(asks_to_sign_in("Invalid API key · Please run /login"));
        assert!(!asks_to_sign_in("Here is how OAuth works in your app."));
        assert!(!asks_to_sign_in(&format!(
            "{} please run /login",
            "long answer ".repeat(50)
        )));
    }

    #[test]
    fn pi_startup_notes_are_not_a_reply() {
        assert!(is_startup_banner("pi v1.4.0\n---\n"));
        assert!(is_startup_banner(
            "pi v1.4.0\n---\n\n## Context\n- /x/AGENTS.md\n"
        ));
        assert!(is_startup_banner(
            "New version available: v1.5.0 (installed v1.4.0)."
        ));
        assert!(!is_startup_banner("pi version is fine\n---\n"));
        assert!(!is_startup_banner("Here is the plan:\n---\n"));
    }

    #[test]
    fn a_stored_error_since_the_turn_began_is_found() {
        let dir = tempfile::tempdir().unwrap();
        let before = std::time::SystemTime::now() - std::time::Duration::from_secs(5);
        assert_eq!(stored_errors(dir.path(), before), "");
        let folder = dir.path().join("sessions/--shop--");
        std::fs::create_dir_all(&folder).unwrap();
        let lines = [
            r#"{"type":"session","version":3}"#,
            r#"{"type":"message","message":{"role":"user","content":[]}}"#,
            r#"{"type":"message","message":{"role":"assistant","stopReason":"error","errorMessage":"401 {\"type\":\"authentication_error\"}"}}"#,
        ];
        std::fs::write(folder.join("a.jsonl"), lines.join("\n")).unwrap();
        let found = stored_errors(dir.path(), before);
        assert!(looks_like_auth(&found), "{found}");
        // Files from before the turn don't count.
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        assert_eq!(stored_errors(dir.path(), later), "");
    }
}
