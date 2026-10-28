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

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
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
use super::card::{ToolInfo, allow_once, permission_card, rule_key, tool_info};
use super::check::{Explained, explain, needs_sign_in};
use super::{Cmd, Manifest, base_env, spec_for};
use crate::app::App;
use crate::approvals;
use crate::events::Source;

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
}

impl Runner {
    async fn run(
        &mut self,
        mut cmds: mpsc::UnboundedReceiver<Cmd>,
        mut engine: mpsc::UnboundedReceiver<Tagged>,
    ) {
        let mut db_up = self.app.db_up.subscribe();
        loop {
            let idle_at = (self.turn.is_none() && self.conn.is_some())
                .then(|| Instant::now() + self.app.settings.engine_idle);
            let stop_by = self.turn.as_ref().and_then(|t| t.stop_by);
            let hang_at = self.hang_at();
            tokio::select! {
                cmd = cmds.recv() => match cmd {
                    Some(cmd) => self.on_cmd(cmd).await,
                    None => break,
                },
                Some(msg) = engine.recv() => self.on_engine(msg).await,
                Ok(()) = db_up.changed() => {
                    if *db_up.borrow_and_update() && self.turn.is_none() {
                        self.start_next().await;
                    }
                }
                _ = sleep_until(idle_at) => {
                    tracing::info!("stopping the idle engine of {}", self.thread_id);
                    self.drop_conn();
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
        }
    }

    async fn on_engine(&mut self, tagged: Tagged) {
        if let EngineMsg::Installed { id, result } = tagged.msg {
            self.installed(id, result).await;
            return;
        }
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
                if self.conn.take().is_some() && self.turn.is_some() {
                    self.problem("The engine stopped unexpectedly.", Some("Try again"))
                        .await;
                    self.end_turn(Ok(StopReason::Cancelled)).await;
                }
            }
            EngineMsg::Installed { .. } => {}
        }
    }

    async fn start_next(&mut self) {
        if !*self.app.db_up.borrow() || self.installing.is_some() {
            // Postgres is restarting, or the engine is downloading; the queue waits.
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

    /// Connects if needed, then sends the prompt.
    async fn begin_turn(&mut self, text: String) {
        if self.conn.is_none()
            && let Err(e) = self.connect().await
        {
            return self.start_failed(e).await;
        }
        self.turns += 1;
        self.turn = Some(Turn {
            id: self.turns,
            stop_by: None,
            heard_at: Instant::now(),
            said: String::new(),
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

    async fn start_failed(&mut self, e: (Explained, String)) {
        tracing::warn!("engine start failed for {}: {}", self.thread_id, e.1);
        self.problem(&e.0.message, Some(e.0.action)).await;
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
                let explained = (explain(&inst.manifest, &f), f.text);
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
        let explained = |f: Failure| (explain(&manifest, &f), f.text.clone());
        let spec = spec_for(&self.app, &manifest, ctx.model.clone()).map_err(explained)?;
        std::fs::create_dir_all(&ctx.cwd).map_err(|e| internal(e.into()))?;
        let log = self
            .app
            .home
            .logs()
            .join(format!("engine-{}.log", manifest.name));
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
        if conn.started == Started::New {
            if resume.is_some() {
                let message = format!(
                    "{} started a fresh conversation; earlier messages aren't in its memory.",
                    ctx.agent_name
                );
                self.problem(&message, None).await;
            }
        }
        self.conn = Some(conn);
        Ok(())
    }

    async fn on_update(&mut self, update: SessionUpdate) {
        match update {
            SessionUpdate::AgentMessageChunk(chunk) => {
                if let ContentBlock::Text(t) = chunk.content {
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
        let agent_id = load_ctx(&self.app, self.thread_id)
            .await
            .ok()
            .and_then(|c| c.agent_id);
        self.append(EventBody::AgentMessage { text, agent_id }, Source::Agent)
            .await;
    }

    async fn step(&mut self, step_id: &str, title: &str, status: StepStatus) {
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
        let scope = folder_scope(&ctx.cwd);
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
        let card = permission_card(&ctx.agent_name, approval_id, &tool, key.is_some());
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
            let _ = responder.respond(selected(&request, &Decision::Deny));
            return;
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

    async fn decided(&mut self, approval_id: Uuid, decision: Decision) {
        let Some(p) = self.pending.remove(&approval_id) else {
            return;
        };
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
        for (approval_id, p) in std::mem::take(&mut self.pending) {
            p.answer(cancelled());
            let closed = if stopped {
                approvals::close_stopped(&self.app, approval_id).await
            } else {
                approvals::close_interrupted(&self.app, approval_id).await
            };
            if let Err(e) = closed {
                tracing::warn!("couldn't close approval {approval_id}: {e:#}");
            }
        }
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
                self.problem("The engine refused this request.", None).await;
            }
            (Ok(_), Some(m)) if asks_to_sign_in(&turn.said) => {
                let e = needs_sign_in(&m);
                self.problem(&e.message, Some(e.action)).await;
                // A new key or sign-in only reaches a new engine process.
                self.drop_conn();
            }
            (Ok(_), _) => {}
            (Err(f), m) => {
                tracing::warn!("turn failed in {}: {f}", self.thread_id);
                match m {
                    Some(m) => {
                        let e = explain(&m, &f);
                        self.problem(&e.message, Some(e.action)).await;
                        if matches!(e.needs, EngineNeed::SignIn | EngineNeed::Key) {
                            self.drop_conn();
                        }
                    }
                    None => {
                        self.problem(
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

    async fn problem(&mut self, message: &str, action: Option<&str>) {
        self.flush_text().await;
        self.append(
            EventBody::Problem {
                message: message.into(),
                action: action.map(Into::into),
            },
            Source::Host,
        )
        .await;
    }

    async fn set_state(&mut self, state: WorkState, live_line: &str) {
        self.flush_text().await;
        self.append(
            EventBody::State {
                state,
                live_line: live_line.into(),
            },
            Source::Host,
        )
        .await;
    }

    async fn append(&self, body: EventBody, source: Source) {
        if let Err(e) = self.app.append(self.thread_id, body, source).await {
            tracing::error!("append to {} failed: {e:#}", self.thread_id);
        }
    }
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
    out
}

/// Sent on a continued conversation when the instructions changed since it began.
fn changed_instructions(ctx: &ThreadCtx) -> String {
    match ctx.instructions.as_deref().map(str::trim) {
        Some(i) if !i.is_empty() => {
            format!("The person changed their instructions for you. From now on:\n{i}")
        }
        _ => "The person removed their instructions for you. Ignore the earlier ones.".into(),
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
        assert!(p.ends_with("Their instructions for you:\nAnswer in French."));
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
}
