//! The ACP client side of one engine process.
//!
//! Callbacks run inside the SDK's dispatch loop, so they only forward what arrives to
//! the runner's channel and return. Because the loop handles messages in order, every
//! `session/update` of a turn reaches the channel before that turn's end.
//!
//! Every message carries the generation of the connection it came from, and a turn's
//! end carries its turn number, so the runner can drop what an old connection or an
//! abandoned turn says late.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    AuthMethod, CancelNotification, ErrorCode, InitializeRequest, InitializeResponse,
    LoadSessionRequest, NewSessionRequest, PromptRequest, RequestPermissionRequest,
    RequestPermissionResponse, ResumeSessionRequest, SessionId, SessionNotification,
    SessionUpdate, StopReason,
};
use agent_client_protocol::{
    Agent, ByteStreams, Client, ConnectionTo, Responder, on_receive_notification,
    on_receive_request,
};
use tokio::process::Child;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
use weilo_proto::AuthMethodInfo;

use super::manifest::LaunchSpec;
use super::process::{self, Group};

pub enum EngineMsg {
    Update(Box<SessionUpdate>),
    Permission {
        request: Box<RequestPermissionRequest>,
        responder: Responder<RequestPermissionResponse>,
    },
    TurnEnded {
        turn: u64,
        result: Result<StopReason, Failure>,
    },
    Closed,
}

/// A message and the connection generation it came from.
pub struct Tagged {
    pub generation: u64,
    pub msg: EngineMsg,
}

pub type EngineTx = mpsc::UnboundedSender<Tagged>;

/// Why an engine couldn't start or finish, with what's needed to explain it plainly.
#[derive(Debug, Clone, Default)]
pub struct Failure {
    /// The program wasn't found.
    pub missing_program: bool,
    /// The engine said it needs to sign in (ACP `auth_required`).
    pub auth_required: bool,
    /// The engine's own words, whole (and its last log lines when it died).
    pub text: String,
}

impl Failure {
    pub fn other(text: impl Into<String>) -> Self {
        Self {
            text: text.into(),
            ..Self::default()
        }
    }
    fn from_acp(e: &agent_client_protocol::Error) -> Self {
        let mut text = e.message.clone();
        if let Some(data) = &e.data {
            text.push_str(": ");
            text.push_str(&match data.as_str() {
                Some(s) => s.to_string(),
                None => data.to_string(),
            });
        }
        Self {
            auth_required: e.code == ErrorCode::AuthRequired,
            text,
            ..Self::default()
        }
    }
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.text)
    }
}

/// How the engine's session began.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Started {
    /// A new conversation: the engine remembers nothing from before.
    New,
    /// The earlier conversation, picked up with `session/resume` or `session/load`.
    Continued,
}

pub struct Connection {
    cx: ConnectionTo<Agent>,
    tx: EngineTx,
    generation: u64,
    pub session_id: SessionId,
    pub started: Started,
    pub auth_methods: Vec<AuthMethodInfo>,
    driver: JoinHandle<()>,
    // Dropped after the driver is stopped: ends the engine's whole process group.
    _group: Group,
    _child: Child,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.driver.abort();
    }
}

struct Ready {
    cx: ConnectionTo<Agent>,
    session_id: SessionId,
    started: Started,
    auth_methods: Vec<AuthMethodInfo>,
}

impl Connection {
    /// Starts the process, then `initialize`, then picks up `resume` (with
    /// `session/resume` or `session/load`, when the engine offers them) or starts a new
    /// session in `cwd`. On failure the process group is ended.
    pub async fn open(
        spec: &LaunchSpec,
        base_env: Vec<(String, String)>,
        cwd: &Path,
        log: &Path,
        tx: EngineTx,
        generation: u64,
        resume: Option<String>,
    ) -> Result<Self, Failure> {
        let log_start = std::fs::metadata(log).map(|m| m.len()).unwrap_or(0);
        let (mut child, group) = spawn(spec, base_env, cwd, log)?;
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            return Err(Failure::other("the engine has no stdio"));
        };
        let transport = ByteStreams::new(stdin.compat_write(), stdout.compat());
        let (ready_tx, ready_rx) = oneshot::channel();
        let driver = tokio::spawn(drive(
            transport,
            cwd.to_path_buf(),
            tx.clone(),
            generation,
            resume,
            ready_tx,
        ));
        let ready = tokio::time::timeout(Duration::from_secs(60), ready_rx).await;
        let fail = |mut f: Failure| {
            driver.abort();
            let tail = log_tail(log, log_start);
            if !tail.is_empty() {
                f.text = format!("{} {tail}", f.text);
            }
            Err(f)
        };
        let ready = match ready {
            Ok(Ok(Ok(ready))) => ready,
            Ok(Ok(Err(f))) => return fail(f),
            Ok(Err(_)) => return fail(Failure::other("The engine closed before it was ready.")),
            Err(_) => return fail(Failure::other("The engine didn't answer in 60 seconds.")),
        };
        Ok(Self {
            cx: ready.cx,
            tx,
            generation,
            session_id: ready.session_id,
            started: ready.started,
            auth_methods: ready.auth_methods,
            driver,
            _group: group,
            _child: child,
        })
    }

    /// Sends a prompt made of text blocks. The end arrives as `TurnEnded { turn }`.
    pub fn prompt(&self, blocks: Vec<String>, turn: u64) {
        let blocks = blocks.into_iter().map(Into::into).collect();
        let request = PromptRequest::new(self.session_id.clone(), blocks);
        let sent = self.cx.send_request(request);
        let (tx, generation) = (self.tx.clone(), self.generation);
        tokio::spawn(async move {
            let result = sent.block_task().await;
            let _ = tx.send(Tagged {
                generation,
                msg: EngineMsg::TurnEnded {
                    turn,
                    result: result
                        .map(|r| r.stop_reason)
                        .map_err(|e| Failure::from_acp(&e)),
                },
            });
        });
    }

    pub fn cancel(&self) {
        let _ = self
            .cx
            .send_notification(CancelNotification::new(self.session_id.clone()));
    }
}

fn spawn(
    spec: &LaunchSpec,
    base_env: Vec<(String, String)>,
    cwd: &Path,
    log: &Path,
) -> Result<(Child, Group), Failure> {
    let stderr = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log)
        .map_err(|e| Failure::other(e.to_string()))?;
    let mut cmd = tokio::process::Command::new(&spec.program);
    cmd.args(&spec.args)
        .env_clear()
        .envs(base_env)
        .envs(&spec.env)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(stderr);
    process::configure(&mut cmd);
    match cmd.spawn() {
        Ok(child) => {
            let group = Group::new(child.id().unwrap_or_default());
            Ok((child, group))
        }
        Err(e) => Err(Failure {
            missing_program: e.kind() == std::io::ErrorKind::NotFound,
            text: format!("couldn't start {}: {e}", spec.program),
            ..Failure::default()
        }),
    }
}

/// What the engine wrote to its log since `from`, last few lines, as one line.
fn log_tail(log: &Path, from: u64) -> String {
    let bytes = std::fs::read(log).unwrap_or_default();
    let new = bytes.get(from as usize..).unwrap_or_default();
    let text = String::from_utf8_lossy(new);
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(5);
    lines[start..].join(" ")
}

type ReadyTx = oneshot::Sender<Result<Ready, Failure>>;

async fn drive<T>(
    transport: T,
    cwd: PathBuf,
    tx: EngineTx,
    generation: u64,
    resume: Option<String>,
    ready: ReadyTx,
) where
    T: agent_client_protocol::ConnectTo<Client> + 'static,
{
    // While `session/load` replays the old conversation, its updates aren't news.
    let loading = Arc::new(AtomicBool::new(false));
    let updates = (tx.clone(), loading.clone());
    let permissions = tx.clone();
    let result = Client
        .builder()
        .name("weilo")
        .on_receive_notification(
            async move |n: SessionNotification, _cx| {
                if !updates.1.load(Ordering::SeqCst) {
                    let msg = EngineMsg::Update(Box::new(n.update));
                    let _ = updates.0.send(Tagged { generation, msg });
                }
                Ok(())
            },
            on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                let msg = EngineMsg::Permission {
                    request: Box::new(request),
                    responder,
                };
                let _ = permissions.send(Tagged { generation, msg });
                Ok(())
            },
            on_receive_request!(),
        )
        .connect_with(transport, async move |cx: ConnectionTo<Agent>| {
            match start_session(&cx, &cwd, resume, &loading).await {
                Ok((session_id, started, auth_methods)) => {
                    let _ = ready.send(Ok(Ready {
                        cx: cx.clone(),
                        session_id,
                        started,
                        auth_methods,
                    }));
                }
                Err(e) => {
                    let _ = ready.send(Err(Failure::from_acp(&e)));
                    return Ok(());
                }
            }
            cx.incoming_closed().await;
            Ok(())
        })
        .await;
    if let Err(e) = result {
        tracing::info!("engine connection ended: {e}");
    }
    let _ = tx.send(Tagged {
        generation,
        msg: EngineMsg::Closed,
    });
}

async fn start_session(
    cx: &ConnectionTo<Agent>,
    cwd: &Path,
    resume: Option<String>,
    loading: &AtomicBool,
) -> agent_client_protocol::Result<(SessionId, Started, Vec<AuthMethodInfo>)> {
    let init: InitializeResponse = cx
        .send_request(InitializeRequest::new(ProtocolVersion::V1))
        .block_task()
        .await?;
    let auth_methods = init.auth_methods.iter().map(auth_info).collect();
    if let Some(id) = resume {
        let caps = &init.agent_capabilities;
        if caps.session_capabilities.resume.is_some() {
            let sent = cx.send_request(ResumeSessionRequest::new(id.clone(), cwd));
            match sent.block_task().await {
                Ok(_) => return Ok((SessionId::new(id), Started::Continued, auth_methods)),
                Err(e) => tracing::info!("session/resume failed: {e}"),
            }
        } else if caps.load_session {
            loading.store(true, Ordering::SeqCst);
            let result = cx
                .send_request(LoadSessionRequest::new(id.clone(), cwd))
                .block_task()
                .await;
            loading.store(false, Ordering::SeqCst);
            match result {
                Ok(_) => return Ok((SessionId::new(id), Started::Continued, auth_methods)),
                Err(e) => tracing::info!("session/load failed: {e}"),
            }
        }
    }
    let session = cx
        .send_request(NewSessionRequest::new(cwd))
        .block_task()
        .await?;
    Ok((session.session_id, Started::New, auth_methods))
}

fn auth_info(m: &AuthMethod) -> AuthMethodInfo {
    let (id, name, description) = match m {
        AuthMethod::Terminal(t) => (&t.id, &t.name, &t.description),
        AuthMethod::Agent(a) => (&a.id, &a.name, &a.description),
        #[allow(unreachable_patterns)]
        _ => {
            return AuthMethodInfo {
                id: String::new(),
                name: "Sign in".into(),
                description: None,
            };
        }
    };
    AuthMethodInfo {
        id: id.0.to_string(),
        name: name.clone(),
        description: description.clone(),
    }
}
