//! The ACP client side of one engine process.
//!
//! Callbacks run inside the SDK's dispatch loop, so they only forward what arrives to
//! the runner's channel and return. Because the loop handles messages in order, every
//! `session/update` of a turn reaches the channel before that turn's end.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    CancelNotification, InitializeRequest, NewSessionRequest, PromptRequest,
    RequestPermissionRequest, RequestPermissionResponse, SessionId, SessionNotification,
    SessionUpdate, StopReason,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{
    Agent, ByteStreams, Client, ConnectionTo, Responder, on_receive_notification,
    on_receive_request,
};
use anyhow::{Context, Result, anyhow};
use tokio::process::Child;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

use super::manifest::LaunchSpec;

pub enum EngineMsg {
    Update(Box<SessionUpdate>),
    Permission {
        request: Box<RequestPermissionRequest>,
        responder: Responder<RequestPermissionResponse>,
    },
    TurnEnded(Result<StopReason, String>),
    Closed,
}

pub type EngineTx = mpsc::UnboundedSender<EngineMsg>;

pub struct Connection {
    cx: ConnectionTo<Agent>,
    pub session_id: SessionId,
    _child: Child,
    driver: JoinHandle<()>,
}

impl Drop for Connection {
    fn drop(&mut self) {
        // The child is killed as it drops (kill_on_drop).
        self.driver.abort();
    }
}

impl Connection {
    /// Starts the process, then `initialize` and `session/new` in `cwd`.
    pub async fn open(spec: &LaunchSpec, base_env: Vec<(String, String)>, cwd: &Path, log: &Path, tx: EngineTx) -> Result<Self> {
        let mut child = spawn(spec, base_env, cwd, log)?;
        let stdin = child.stdin.take().context("no stdin")?;
        let stdout = child.stdout.take().context("no stdout")?;
        let transport = ByteStreams::new(stdin.compat_write(), stdout.compat());
        let (ready_tx, ready_rx) = oneshot::channel();
        let driver = tokio::spawn(drive(transport, cwd.to_path_buf(), tx, ready_tx));
        let ready = tokio::time::timeout(Duration::from_secs(60), ready_rx).await;
        let (cx, session_id) = match ready {
            Ok(Ok(Ok(pair))) => pair,
            Ok(Ok(Err(e))) => return Err(anyhow!(e)),
            Ok(Err(_)) => return Err(anyhow!("the engine closed before it was ready")),
            Err(_) => return Err(anyhow!("the engine didn't answer in 60 s")),
        };
        Ok(Self { cx, session_id, _child: child, driver })
    }

    /// Sends a prompt. The end of the turn arrives on the channel as `TurnEnded`.
    pub fn prompt(&self, text: String, tx: EngineTx) {
        let request = PromptRequest::new(self.session_id.clone(), vec![text.into()]);
        let sent = self.cx.send_request(request);
        tokio::spawn(async move {
            let result = sent.block_task().await;
            let _ = tx.send(EngineMsg::TurnEnded(
                result.map(|r| r.stop_reason).map_err(|e| e.to_string()),
            ));
        });
    }

    pub fn cancel(&self) {
        let _ = self.cx.send_notification(CancelNotification::new(self.session_id.clone()));
    }
}

fn spawn(spec: &LaunchSpec, base_env: Vec<(String, String)>, cwd: &Path, log: &Path) -> Result<Child> {
    let stderr = std::fs::OpenOptions::new().create(true).append(true).open(log)?;
    tokio::process::Command::new(&spec.program)
        .args(&spec.args)
        .env_clear()
        .envs(base_env)
        .envs(&spec.env)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(stderr)
        .kill_on_drop(true)
        .spawn()
        .with_context(|| format!("couldn't start {}", spec.program))
}

type Ready = oneshot::Sender<Result<(ConnectionTo<Agent>, SessionId), String>>;

async fn drive<T>(transport: T, cwd: PathBuf, tx: EngineTx, ready: Ready)
where
    T: agent_client_protocol::ConnectTo<Client> + 'static,
{
    let updates = tx.clone();
    let permissions = tx.clone();
    let result = Client
        .builder()
        .name("weilo")
        .on_receive_notification(
            async move |n: SessionNotification, _cx| {
                let _ = updates.send(EngineMsg::Update(Box::new(n.update)));
                Ok(())
            },
            on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                let _ = permissions
                    .send(EngineMsg::Permission { request: Box::new(request), responder });
                Ok(())
            },
            on_receive_request!(),
        )
        .connect_with(transport, async move |cx: ConnectionTo<Agent>| {
            match start_session(&cx, &cwd).await {
                Ok(session_id) => {
                    let _ = ready.send(Ok((cx.clone(), session_id)));
                }
                Err(e) => {
                    let _ = ready.send(Err(e.to_string()));
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
    let _ = tx.send(EngineMsg::Closed);
}

async fn start_session(cx: &ConnectionTo<Agent>, cwd: &Path) -> agent_client_protocol::Result<SessionId> {
    cx.send_request(InitializeRequest::new(ProtocolVersion::V1)).block_task().await?;
    let session = cx.send_request(NewSessionRequest::new(cwd)).block_task().await?;
    Ok(session.session_id)
}
