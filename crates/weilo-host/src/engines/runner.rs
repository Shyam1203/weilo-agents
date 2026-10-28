//! One runner per thread: it owns the engine process, the turn in progress and the
//! queue of messages waiting for it.
//!
//! ACP can't add to a turn that is running, so a message sent with **Tell now** while
//! the agent works waits for the end of the turn and goes first, before any **After
//! this job** messages. **Stop** cancels the turn and clears the queue.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

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
use weilo_proto::{Decision, Delta, EventBody, SendWhen, StepStatus, WorkState};

use super::acp::{Connection, EngineMsg, EngineTx};
use super::card::{ToolInfo, option_for, permission_card, tool_info};
use super::manifest::{Vars, launch_spec};
use super::{Cmd, base_env, engine_home};
use crate::app::App;
use crate::approvals;
use crate::events::Source;

const STOP_GRACE: Duration = Duration::from_secs(5);

pub fn spawn(app: Arc<App>, thread_id: Uuid) -> mpsc::UnboundedSender<Cmd> {
    let (tx, rx) = mpsc::unbounded_channel();
    tokio::spawn(async move {
        let (engine_tx, engine_rx) = mpsc::unbounded_channel();
        let mut runner = Runner {
            app,
            thread_id,
            conn: None,
            engine_tx,
            now_queue: VecDeque::new(),
            after_queue: VecDeque::new(),
            turn: None,
            text: String::new(),
            sub_seq: 0,
            tools: HashMap::new(),
            pending: HashMap::new(),
        };
        runner.run(rx, engine_rx).await;
    });
    tx
}

/// Who the thread belongs to and where its engine works.
struct ThreadCtx {
    agent_id: Option<Uuid>,
    agent_name: String,
    engine: String,
    model: Option<String>,
    cwd: PathBuf,
    owner: Uuid,
}

struct Turn {
    stop_by: Option<Instant>,
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

struct Runner {
    app: Arc<App>,
    thread_id: Uuid,
    conn: Option<Connection>,
    engine_tx: EngineTx,
    now_queue: VecDeque<String>,
    after_queue: VecDeque<String>,
    turn: Option<Turn>,
    /// The agent's reply so far, sent as deltas until it becomes one event.
    text: String,
    sub_seq: i64,
    tools: HashMap<String, ToolInfo>,
    pending: HashMap<Uuid, Pending>,
}

impl Runner {
    async fn run(
        &mut self,
        mut cmds: mpsc::UnboundedReceiver<Cmd>,
        mut engine: mpsc::UnboundedReceiver<EngineMsg>,
    ) {
        loop {
            let idle_at = (self.turn.is_none() && self.conn.is_some())
                .then(|| Instant::now() + self.app.settings.engine_idle);
            let stop_by = self.turn.as_ref().and_then(|t| t.stop_by);
            tokio::select! {
                cmd = cmds.recv() => match cmd {
                    Some(cmd) => self.on_cmd(cmd).await,
                    None => break,
                },
                Some(msg) = engine.recv() => self.on_engine(msg).await,
                _ = sleep_until(idle_at) => {
                    tracing::info!("stopping the idle engine of {}", self.thread_id);
                    self.conn = None;
                }
                _ = sleep_until(stop_by) => {
                    tracing::warn!("engine ignored Stop; ending it");
                    self.conn = None;
                    self.end_turn(Ok(StopReason::Cancelled)).await;
                }
            }
        }
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
        }
    }

    async fn on_engine(&mut self, msg: EngineMsg) {
        match msg {
            EngineMsg::Update(update) => self.on_update(*update).await,
            EngineMsg::Permission { request, responder } => {
                self.on_permission(request, responder).await;
            }
            EngineMsg::TurnEnded(result) => self.end_turn(result).await,
            EngineMsg::Closed => {
                if self.conn.take().is_some() && self.turn.is_some() {
                    self.problem("The engine stopped unexpectedly.").await;
                    self.end_turn(Ok(StopReason::Cancelled)).await;
                }
            }
        }
    }

    async fn start_next(&mut self) {
        let Some(text) = self
            .now_queue
            .pop_front()
            .or_else(|| self.after_queue.pop_front())
        else {
            return;
        };
        self.set_state(WorkState::Working, "").await;
        if self.conn.is_none()
            && let Err(e) = self.connect().await
        {
            tracing::warn!("engine start failed for {}: {e:#}", self.thread_id);
            self.problem(&format!("Couldn't start the engine: {}", first_line(&e)))
                .await;
            self.now_queue.clear();
            self.after_queue.clear();
            self.set_state(WorkState::Idle, "").await;
            return;
        }
        let conn = self.conn.as_ref().expect("connected");
        self.turn = Some(Turn { stop_by: None });
        conn.prompt(text, self.engine_tx.clone());
    }

    async fn connect(&mut self) -> Result<()> {
        let ctx = load_ctx(&self.app, self.thread_id).await?;
        let manifest = self
            .app
            .engines
            .get(&ctx.engine)
            .cloned()
            .with_context(|| format!("no engine named {}", ctx.engine))?;
        self.install(&manifest).await?;
        let vars = Vars {
            self_exe: self.app.settings.self_exe.clone(),
            install: self.app.engines.install_dir(&manifest.name),
            engine_home: engine_home(&self.app.home, &manifest.name, ctx.owner),
            model: ctx.model.clone(),
            path: std::env::var("PATH").unwrap_or_default(),
        };
        std::fs::create_dir_all(&vars.engine_home)?;
        std::fs::create_dir_all(&ctx.cwd)?;
        let spec = launch_spec(&manifest, &vars).map_err(anyhow::Error::msg)?;
        let log = self
            .app
            .home
            .logs()
            .join(format!("engine-{}.log", manifest.name));
        let conn =
            Connection::open(&spec, base_env(), &ctx.cwd, &log, self.engine_tx.clone()).await?;
        sqlx::query("UPDATE threads SET engine_session_id = $2 WHERE id = $1")
            .bind(self.thread_id)
            .bind(conn.session_id.0.as_ref())
            .execute(&self.app.db)
            .await?;
        self.conn = Some(conn);
        Ok(())
    }

    async fn install(&mut self, m: &super::Manifest) -> Result<()> {
        let needs = m.install.as_ref().is_some_and(|i| !i.npm.is_empty())
            && !self
                .app
                .engines
                .install_dir(&m.name)
                .join("node_modules/.bin")
                .is_dir();
        if !needs {
            return Ok(());
        }
        let step_id = format!("install-{}", m.name);
        let title = format!("Installing {}", m.title);
        self.step(&step_id, &title, StepStatus::Running).await;
        let result = self.app.engines.install(m).await;
        let status = if result.is_ok() {
            StepStatus::Done
        } else {
            StepStatus::Failed
        };
        self.step(&step_id, &title, status).await;
        result.map_err(anyhow::Error::msg)
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
                self.step(&id, &call.title, step_status(call.status)).await;
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
                let title = info.title.clone();
                if let Some(status) = update.fields.status {
                    self.step(&id, &title, step_status(status)).await;
                }
            }
            _ => {}
        }
    }

    async fn delta(&mut self, text: String) {
        if text.is_empty() {
            return;
        }
        self.text.push_str(&text);
        let after_seq = self.app.last_seq(self.thread_id).await;
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
        if approvals::always_allowed(&self.app, ctx.agent_id, &tool.title, &scope).await {
            let _ = responder.respond(selected(&request, &Decision::Allow));
            return;
        }
        let approval_id = crate::ids::new_id();
        let card = permission_card(&ctx.agent_name, approval_id, &tool, &request);
        let opened = approvals::open(
            &self.app,
            approvals::NewApproval {
                id: approval_id,
                thread_id: self.thread_id,
                card: card.clone(),
                tool: tool.title.clone(),
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
        if self.pending.is_empty() && self.turn.is_some() {
            self.set_state(WorkState::Working, "").await;
        }
    }

    async fn stop(&mut self) {
        self.now_queue.clear();
        self.after_queue.clear();
        let Some(turn) = self.turn.as_mut() else {
            return;
        };
        if turn.stop_by.is_some() {
            return;
        }
        turn.stop_by = Some(Instant::now() + STOP_GRACE);
        if let Some(conn) = &self.conn {
            conn.cancel();
        }
        for (approval_id, p) in std::mem::take(&mut self.pending) {
            p.answer(cancelled());
            if let Err(e) = approvals::close_stopped(&self.app, approval_id).await {
                tracing::warn!("couldn't close approval {approval_id}: {e:#}");
            }
        }
    }

    async fn end_turn(&mut self, result: Result<StopReason, String>) {
        if self.turn.take().is_none() {
            return;
        }
        self.flush_text().await;
        for (_, p) in std::mem::take(&mut self.pending) {
            p.answer(cancelled());
        }
        match result {
            Ok(StopReason::Refusal) => self.problem("The engine refused this request.").await,
            Ok(_) => {}
            Err(e) => {
                tracing::warn!("turn failed in {}: {e}", self.thread_id);
                self.problem("The engine hit an error and stopped this reply.")
                    .await;
            }
        }
        if self.now_queue.is_empty() && self.after_queue.is_empty() {
            self.set_state(WorkState::Idle, "").await;
        } else {
            self.start_next().await;
        }
    }

    async fn problem(&mut self, message: &str) {
        self.flush_text().await;
        self.append(
            EventBody::Problem {
                message: message.into(),
                action: None,
            },
            Source::Host,
        )
        .await;
    }

    async fn set_state(&mut self, state: WorkState, live_line: &str) {
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

fn selected(req: &RequestPermissionRequest, decision: &Decision) -> RequestPermissionResponse {
    match option_for(req, decision) {
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

fn first_line(e: &anyhow::Error) -> String {
    e.to_string()
        .lines()
        .next()
        .unwrap_or("unknown error")
        .to_string()
}

async fn load_ctx(app: &App, thread_id: Uuid) -> Result<ThreadCtx> {
    let row = sqlx::query(
        "SELECT t.kind, t.agent_id, t.engine AS thread_engine, t.folder, t.worktree,
                a.name, a.slug, a.engine AS agent_engine, a.model
         FROM threads t LEFT JOIN agents a ON a.id = t.agent_id WHERE t.id = $1",
    )
    .bind(thread_id)
    .fetch_one(&app.db)
    .await?;
    let kind: String = row.get("kind");
    let agent_id: Option<Uuid> = row.get("agent_id");
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
        agent_id,
        agent_name: agent_name.unwrap_or_else(|| "The agent".into()),
        engine: engine.context("the thread has no engine")?,
        model: row.get("model"),
        cwd,
        owner: if session {
            thread_id
        } else {
            agent_id.unwrap_or(thread_id)
        },
    })
}
