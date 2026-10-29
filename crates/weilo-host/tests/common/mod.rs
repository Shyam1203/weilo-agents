//! Boots a real `weilo up` on a temp home and a free port, pairs a device, and talks to
//! it over the WebSocket. Tests skip (with a message) when Postgres isn't installed,
//! except in CI (`CI=true`), where they fail.
//! As root, Postgres runs as `WEILO_PG_USER` (default `weilo`), so the temp folder is
//! made passable for that user.

#![allow(dead_code)]

use std::collections::VecDeque;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use futures::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use uuid::Uuid;
use weilo_proto::{
    Call, CallResult, CallValue, ClientFrame, EventBody, PROTOCOL_VERSION, SendWhen, ServerFrame,
    WorkState,
};

pub const WAIT: Duration = Duration::from_secs(20);

pub struct Host {
    child: Child,
    pub home: PathBuf,
    pub port: u16,
    env: Vec<(String, String)>,
    _dir: tempfile::TempDir,
}

/// False when Postgres isn't installed here. In CI that is a failure, not a skip.
pub fn postgres_available() -> bool {
    match weilo_host::pg::find_bin_dir() {
        Ok(_) => true,
        Err(e) if std::env::var("CI").is_ok_and(|v| v == "true") => {
            panic!("CI needs Postgres for these tests: {e}")
        }
        Err(e) => {
            eprintln!("skipping: {e}");
            false
        }
    }
}

pub fn temp_home() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::Builder::new()
        .prefix("weilo-test-")
        .tempdir_in("/tmp")
        .unwrap();
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o711)).unwrap();
    let home = dir.path().join("home");
    (dir, home)
}

impl Host {
    pub async fn start() -> Option<Host> {
        Self::start_with(&[]).await
    }

    pub async fn start_with(env: &[(&str, &str)]) -> Option<Host> {
        if !postgres_available() {
            return None;
        }
        let (dir, home) = temp_home();
        let env: Vec<(String, String)> = env
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        let child = spawn_up(&home, dir.path(), &env);
        let mut host = Host {
            child,
            home,
            port: 0,
            env,
            _dir: dir,
        };
        host.port = host.wait_port().await;
        Some(host)
    }

    /// Runs another `weilo up` on the same home and waits for it to exit.
    pub fn second_up(&self) -> std::process::Output {
        Command::new(env!("CARGO_BIN_EXE_weilo"))
            .args(["up", "--port", "0", "--home"])
            .arg(&self.home)
            .output()
            .unwrap()
    }

    /// Kills the host at once (no clean stop), then starts it again on the same home.
    pub async fn crash_and_restart(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_file(self.home.join("host.json"));
        self.child = spawn_up(&self.home, self._dir.path(), &self.env);
        self.port = self.wait_port().await;
    }

    /// Stops the host cleanly, then starts it again on the same home with `env` added.
    pub async fn restart_with(&mut self, env: &[(&str, &str)]) {
        self.stop();
        let _ = std::fs::remove_file(self.home.join("host.json"));
        self.env
            .extend(env.iter().map(|(k, v)| (k.to_string(), v.to_string())));
        self.child = spawn_up(&self.home, self._dir.path(), &self.env);
        self.port = self.wait_port().await;
    }

    /// Stops the host cleanly and waits for it.
    pub fn stop(&mut self) {
        // SAFETY: signalling our own child.
        unsafe {
            libc::kill(self.child.id() as i32, libc::SIGTERM);
        }
        let _ = self.child.wait();
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    async fn wait_port(&mut self) -> u16 {
        let file = self.home.join("host.json");
        let started = Instant::now();
        loop {
            if let Ok(text) = std::fs::read_to_string(&file) {
                let v: serde_json::Value = serde_json::from_str(&text).unwrap();
                return v["port"].as_u64().unwrap() as u16;
            }
            if let Some(status) = self.child.try_wait().unwrap() {
                panic!("weilo up exited ({status}):\n{}", self.log());
            }
            assert!(
                started.elapsed() < Duration::from_secs(60),
                "host didn't start:\n{}",
                self.log()
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    pub fn log(&self) -> String {
        std::fs::read_to_string(self._dir.path().join("host.log")).unwrap_or_default()
    }

    /// The test's temp folder (outside the home).
    pub fn dir(&self) -> &std::path::Path {
        self._dir.path()
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    /// Adds an engine manifest to the home (`HOME/engines/<name>/weilo.json`). It is
    /// read when the host starts.
    pub fn add_engine(&self, name: &str, manifest: serde_json::Value) {
        let dir = self.home.join("engines").join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("weilo.json"), manifest.to_string()).unwrap();
    }

    /// A pairing code from `weilo pair`.
    pub fn pairing_code(&self) -> String {
        let out = Command::new(env!("CARGO_BIN_EXE_weilo"))
            .args(["pair", "--home"])
            .arg(&self.home)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let text = String::from_utf8(out.stdout).unwrap();
        text.lines()
            .find_map(|l| l.strip_prefix("Your code: "))
            .expect("a code")
            .to_string()
    }

    /// Pairs a device and returns its token.
    pub async fn pair(&self) -> String {
        let code = self.pairing_code();
        let res = reqwest::Client::new()
            .post(self.url("/api/pair"))
            .json(&serde_json::json!({ "code": code, "name": "Test" }))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
        let body: serde_json::Value = res.json().await.unwrap();
        body["token"].as_str().expect("a token").to_string()
    }

    pub async fn connect(&self) -> Client {
        let token = self.pair().await;
        Client::connect(self, Some(&token))
            .await
            .expect("socket opens")
    }
}

fn spawn_up(home: &std::path::Path, dir: &std::path::Path, env: &[(String, String)]) -> Child {
    let log = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("host.log"))
        .unwrap();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_weilo"));
    cmd.args(["up", "--port", "0", "--home"])
        .arg(home)
        .env("WEILO_JOB_POLL_MS", "200")
        .env("WEILO_WORKSPACES", dir.join("agents"))
        .env("RUST_LOG", "weilo_host=debug,warn")
        .stdout(Stdio::null())
        .stderr(log);
    for (k, v) in env {
        cmd.env(k, v);
    }
    cmd.spawn().expect("start weilo up")
}

impl Drop for Host {
    fn drop(&mut self) {
        // SAFETY: signalling our own child.
        unsafe {
            libc::kill(self.child.id() as i32, libc::SIGTERM);
        }
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(20) {
            if let Ok(Some(_)) = self.child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        let _ = self.child.kill();
    }
}

pub struct Client {
    ws: WebSocketStream<MaybeTlsStream<TcpStream>>,
    /// Frames read while waiting for something else.
    pub seen: VecDeque<ServerFrame>,
    /// From the welcome.
    pub device_id: Uuid,
}

impl Client {
    /// Opens a socket and says hello with `token`. On refusal, the close code.
    pub async fn connect(host: &Host, token: Option<&str>) -> Result<Client, Option<u16>> {
        let mut c = Self::open(host).await;
        c.send(&ClientFrame::Hello {
            version: PROTOCOL_VERSION,
            token: token.map(Into::into),
        })
        .await;
        loop {
            match tokio::time::timeout(WAIT, c.ws.next()).await {
                Ok(Some(Ok(Message::Text(t)))) => {
                    let frame: ServerFrame = serde_json::from_str(&t).unwrap();
                    if let ServerFrame::Welcome { device_id, .. } = frame {
                        c.device_id = device_id;
                        return Ok(c);
                    }
                    c.seen.push_back(frame);
                }
                Ok(Some(Ok(Message::Close(frame)))) => return Err(frame.map(|f| u16::from(f.code))),
                Ok(Some(Ok(_))) => {}
                _ => return Err(None),
            }
        }
    }

    /// Opens a socket without saying hello.
    pub async fn open(host: &Host) -> Client {
        let mut req = format!("ws://127.0.0.1:{}/api/ws", host.port)
            .into_client_request()
            .unwrap();
        req.headers_mut().insert(
            "origin",
            format!("http://127.0.0.1:{}", host.port).parse().unwrap(),
        );
        let (ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
        Client {
            ws,
            seen: VecDeque::new(),
            device_id: Uuid::nil(),
        }
    }

    pub async fn send(&mut self, frame: &ClientFrame) {
        let text = serde_json::to_string(frame).unwrap();
        self.ws.send(Message::Text(text.into())).await.unwrap();
    }

    async fn read(&mut self) -> Option<ServerFrame> {
        loop {
            match self.ws.next().await? {
                Ok(Message::Text(t)) => return Some(serde_json::from_str(&t).unwrap()),
                Ok(Message::Close(_)) | Err(_) => return None,
                Ok(_) => {}
            }
        }
    }

    /// The first frame (already seen or new) matching `want`, within the wait limit.
    pub async fn next(&mut self, want: impl Fn(&ServerFrame) -> bool) -> ServerFrame {
        if let Some(i) = self.seen.iter().position(&want) {
            return self.seen.remove(i).unwrap();
        }
        let deadline = Instant::now() + WAIT;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let frame = tokio::time::timeout(left, self.read())
                .await
                .expect("timed out waiting for a frame")
                .expect("socket closed");
            if want(&frame) {
                return frame;
            }
            self.seen.push_back(frame);
        }
    }

    /// Like `next`, but says what went wrong instead of panicking.
    pub async fn try_next(
        &mut self,
        want: impl Fn(&ServerFrame) -> bool,
    ) -> Result<ServerFrame, String> {
        if let Some(i) = self.seen.iter().position(&want) {
            return Ok(self.seen.remove(i).unwrap());
        }
        let deadline = Instant::now() + WAIT;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let msg = tokio::time::timeout(left, self.ws.next())
                .await
                .map_err(|_| format!("timed out; saw {:?}", self.seen))?;
            let frame = match msg {
                Some(Ok(Message::Text(t))) => serde_json::from_str(&t).unwrap(),
                Some(Ok(Message::Close(c))) => return Err(format!("closed: {c:?}")),
                Some(Ok(_)) => continue,
                other => return Err(format!("socket ended: {other:?}")),
            };
            if want(&frame) {
                return Ok(frame);
            }
            self.seen.push_back(frame);
        }
    }

    pub async fn call_with_id(&mut self, call_id: Uuid, call: Call) -> CallResult {
        self.send(&ClientFrame::Call { call_id, call }).await;
        match self
            .next(|f| matches!(f, ServerFrame::Ret { call_id: id, .. } if *id == call_id))
            .await
        {
            ServerFrame::Ret { result, .. } => result,
            _ => unreachable!(),
        }
    }

    pub async fn call(&mut self, call: Call) -> CallResult {
        self.call_with_id(Uuid::now_v7(), call).await
    }

    /// The value of a call that must succeed.
    pub async fn ok(&mut self, call: Call) -> CallValue {
        match self.call(call).await {
            CallResult::Done { value } => value,
            CallResult::Failed { error } => panic!("call failed: {} {}", error.code, error.message),
        }
    }

    pub async fn sub(&mut self, thread_id: Uuid, after_seq: i64) {
        self.send(&ClientFrame::Sub {
            thread_id,
            after_seq,
        })
        .await;
    }

    /// Reads until the socket closes; returns the close code.
    pub async fn close_code(&mut self) -> Option<u16> {
        let deadline = Instant::now() + WAIT;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match tokio::time::timeout(left, self.ws.next()).await.ok()?? {
                Ok(Message::Close(frame)) => return frame.map(|f| u16::from(f.code)),
                Ok(_) => {}
                Err(_) => return None,
            }
        }
    }
}

/// Finishes setup with the echo engine; returns Ava's main thread.
pub async fn setup_with_echo(c: &mut Client) -> Uuid {
    let value = c
        .ok(Call::FinishSetup {
            engine: "echo".into(),
            keep_awake: false,
        })
        .await;
    assert!(matches!(value, CallValue::Setup(s) if s.done));
    match c.ok(Call::Snapshot).await {
        CallValue::Snapshot(s) => s.agents[0].main_thread_id,
        other => panic!("{other:?}"),
    }
}

impl Host {
    /// Where this host's Postgres keeps its data (`HOME/db`, or under
    /// `/var/lib/weilo-agents` when the home isn't reachable for the Postgres user).
    pub fn pg_root(&self) -> PathBuf {
        if self.home.join("db").exists() {
            return self.home.clone();
        }
        let hash = {
            use sha2::Digest;
            hex::encode(&sha2::Sha256::digest(self.home.as_os_str().as_encoded_bytes())[..8])
        };
        PathBuf::from("/var/lib/weilo-agents").join(hash)
    }

    /// A connection to this host's database as `role` (peer auth: tests run as the same
    /// OS user as the host).
    pub async fn connect_as(&self, role: &str) -> Result<sqlx::PgConnection, sqlx::Error> {
        use sqlx::Connection;
        let pg: serde_json::Value =
            serde_json::from_slice(&std::fs::read(self.home.join("secrets/pg.json")).unwrap())
                .unwrap();
        let opts = sqlx::postgres::PgConnectOptions::new()
            .socket(self.pg_root().join("run"))
            .port(pg["port"].as_u64().unwrap() as u16)
            .username(role)
            .database("weilo");
        sqlx::PgConnection::connect_with(&opts).await
    }

    /// A connection as the owner. While Weilo runs only its app role may sign in, so,
    /// as anything running as this user could, the test widens the sign-in rules for a
    /// moment, signs in, and narrows them again.
    pub async fn db(&self) -> sqlx::PgConnection {
        let ident = self.pg_root().join("db/pg_ident.conf");
        let narrow = std::fs::read_to_string(&ident).unwrap();
        let user = narrow
            .lines()
            .find(|l| l.starts_with("weilo "))
            .and_then(|l| l.split_whitespace().nth(1))
            .expect("a sign-in rule")
            .to_string();
        let reload = || {
            // SAFETY: asking the test host's Postgres to read its rules again.
            unsafe {
                libc::kill(self.postgres_pid().expect("postgres runs"), libc::SIGHUP);
            }
        };
        std::fs::write(&ident, format!("{narrow}weilo {user} weilo_owner\n")).unwrap();
        reload();
        let until = Instant::now() + WAIT;
        let conn = loop {
            match self.connect_as("weilo_owner").await {
                Ok(conn) => break conn,
                Err(e) => assert!(Instant::now() < until, "owner can't sign in: {e}"),
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        };
        std::fs::write(&ident, narrow).unwrap();
        reload();
        conn
    }

    /// Postgres' pid, from `postmaster.pid`.
    pub fn postgres_pid(&self) -> Option<i32> {
        std::fs::read_to_string(self.pg_root().join("db/postmaster.pid"))
            .ok()?
            .lines()
            .next()?
            .trim()
            .parse()
            .ok()
    }
}

/// Whether a process is alive (and not a zombie).
pub fn pid_alive(pid: i32) -> bool {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
    // SAFETY: signal 0 only checks.
    let exists = unsafe { libc::kill(pid, 0) } == 0;
    exists && !stat.split(") ").nth(1).is_some_and(|s| s.starts_with('Z'))
}

/// Waits until `check` is true, up to the wait limit.
pub async fn eventually(what: &str, check: impl Fn() -> bool) {
    let until = Instant::now() + WAIT;
    while !check() {
        assert!(Instant::now() < until, "timed out waiting for {what}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

pub fn agent_text(f: &ServerFrame) -> Option<&str> {
    match f {
        ServerFrame::Ev { event, .. } => match &event.body {
            EventBody::AgentMessage { text, .. } => Some(text),
            _ => None,
        },
        _ => None,
    }
}

pub fn is_state(f: &ServerFrame, want: WorkState) -> bool {
    matches!(f, ServerFrame::Ev { event, .. } if matches!(event.body, EventBody::State { state, .. } if state == want))
}

pub async fn send(c: &mut Client, thread_id: Uuid, text: &str) {
    let call = Call::Send {
        thread_id,
        text: text.into(),
        when: SendWhen::AfterJob,
    };
    assert!(matches!(c.ok(call).await, CallValue::None));
}
