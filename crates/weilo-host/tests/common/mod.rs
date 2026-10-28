//! Boots a real `weilo up` on a temp home and a free port, pairs a device, and talks to
//! it over the WebSocket. Tests skip (with a message) when Postgres isn't installed.
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
use weilo_proto::{Call, CallResult, CallValue, ClientFrame, PROTOCOL_VERSION, ServerFrame};

pub const WAIT: Duration = Duration::from_secs(20);

pub struct Host {
    child: Child,
    pub home: PathBuf,
    pub port: u16,
    _dir: tempfile::TempDir,
}

/// `None` when Postgres isn't installed here.
pub fn postgres_available() -> bool {
    match weilo_host::pg::find_bin_dir() {
        Ok(_) => true,
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
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_weilo"));
        cmd.args(["up", "--port", "0", "--home"])
            .arg(&home)
            .env("WEILO_JOB_POLL_MS", "200")
            .env("RUST_LOG", "weilo_host=debug,warn")
            .stdout(Stdio::null())
            .stderr(std::fs::File::create(dir.path().join("host.log")).unwrap());
        for (k, v) in env {
            cmd.env(k, v);
        }
        let child = cmd.spawn().expect("start weilo up");
        let mut host = Host {
            child,
            home,
            port: 0,
            _dir: dir,
        };
        host.port = host.wait_port().await;
        Some(host)
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

    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
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

    /// Pairs a device and returns its cookie token.
    pub async fn pair(&self) -> String {
        let code = self.pairing_code();
        let res = reqwest::Client::new()
            .post(self.url("/api/pair"))
            .json(&serde_json::json!({ "code": code, "name": "Test" }))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
        let cookie = res.headers()["set-cookie"].to_str().unwrap().to_string();
        assert!(cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict"));
        cookie
            .split(';')
            .next()
            .unwrap()
            .trim_start_matches("weilo_device=")
            .to_string()
    }

    pub async fn connect(&self) -> Client {
        let token = self.pair().await;
        Client::connect(self, Some(&token))
            .await
            .expect("socket opens")
    }
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
}

impl Client {
    pub async fn connect(
        host: &Host,
        token: Option<&str>,
    ) -> Result<Client, tokio_tungstenite::tungstenite::Error> {
        let mut req = format!("ws://127.0.0.1:{}/api/ws", host.port).into_client_request()?;
        req.headers_mut().insert(
            "origin",
            format!("http://127.0.0.1:{}", host.port).parse().unwrap(),
        );
        if let Some(t) = token {
            req.headers_mut()
                .insert("cookie", format!("weilo_device={t}").parse().unwrap());
        }
        let (ws, _) = tokio_tungstenite::connect_async(req).await?;
        let mut c = Client {
            ws,
            seen: VecDeque::new(),
        };
        c.send(&ClientFrame::Hello {
            version: PROTOCOL_VERSION,
        })
        .await;
        let welcome = c.next(|f| matches!(f, ServerFrame::Welcome { .. })).await;
        assert!(matches!(welcome, ServerFrame::Welcome { .. }));
        Ok(c)
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
