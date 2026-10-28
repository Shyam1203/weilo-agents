//! Engines: ACP processes described by a manifest. One process per thread, started
//! when the thread first needs it and stopped after it has been idle a while.

mod acp;
mod card;
pub mod manifest;
mod runner;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;
use uuid::Uuid;
use weilo_proto::{Decision, EngineInfo, SendWhen};

use crate::app::App;
use crate::home::Home;
use crate::keep_awake::which;
pub use card::permission_card;
pub use manifest::Manifest;

/// The order setup suggests engines in.
const PREFERRED: [&str; 4] = ["claude-code", "codex", "gemini", "pi"];

pub struct Registry {
    manifests: BTreeMap<String, Manifest>,
    home: Home,
}

impl Registry {
    pub fn load(home: &Home) -> Self {
        Self { manifests: manifest::load_all(&home.engines()), home: home.clone() }
    }

    pub fn get(&self, name: &str) -> Option<&Manifest> {
        self.manifests.get(name)
    }

    /// Engines people can pick (hidden ones, like echo, still run when named).
    pub fn list(&self) -> Vec<EngineInfo> {
        let mut out: Vec<EngineInfo> =
            self.manifests.values().filter(|m| !m.hidden).map(|m| self.info(m)).collect();
        out.sort_by_key(|e| rank(&e.id));
        out
    }

    pub fn info(&self, m: &Manifest) -> EngineInfo {
        EngineInfo {
            id: m.name.clone(),
            title: m.title.clone(),
            description: m.description.clone(),
            installed: self.is_installed(m),
            default: m.default,
            binds_approvals: m.binds_approvals,
        }
    }

    /// Ready to start without fetching anything (or `detect.always`).
    pub fn is_installed(&self, m: &Manifest) -> bool {
        if m.command[0] == "{self}" || m.detect.always {
            return true;
        }
        if m.install.as_ref().is_some_and(|i| !i.npm.is_empty()) {
            return self.npm_bin(&m.name).is_dir();
        }
        which(&m.command[0]).is_some()
    }

    /// Engines found on this computer, best first.
    pub fn found(&self) -> Vec<String> {
        let mut out: Vec<&Manifest> = self
            .manifests
            .values()
            .filter(|m| !m.hidden && (self.is_installed(m) || detected(m)))
            .collect();
        out.sort_by_key(|m| rank(&m.name));
        out.into_iter().map(|m| m.name.clone()).collect()
    }

    pub fn install_dir(&self, name: &str) -> PathBuf {
        self.home.engine_install(name)
    }

    fn npm_bin(&self, name: &str) -> PathBuf {
        self.install_dir(name).join("node_modules").join(".bin")
    }

    /// `npm install` of the manifest's exact packages, never `npx -y`. Scripts don't run.
    pub async fn install(&self, m: &Manifest) -> Result<(), String> {
        let Some(pkgs) = m.install.as_ref().map(|i| &i.npm).filter(|p| !p.is_empty()) else {
            return Ok(());
        };
        if self.npm_bin(&m.name).is_dir() {
            return Ok(());
        }
        let npm = which("npm").ok_or("npm isn't installed")?;
        let dir = self.install_dir(&m.name);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let out = tokio::process::Command::new(npm)
            .args(["install", "--prefix"])
            .arg(&dir)
            .args(["--ignore-scripts", "--no-audit", "--no-fund", "--save-exact"])
            .args(pkgs)
            .env_clear()
            .envs(base_env())
            .output()
            .await
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            let err = String::from_utf8_lossy(&out.stderr);
            Err(err.lines().last().unwrap_or("npm install failed").to_string())
        }
    }
}

fn rank(name: &str) -> (usize, String) {
    let pos = PREFERRED.iter().position(|p| *p == name).unwrap_or(PREFERRED.len());
    (pos, name.to_string())
}

fn detected(m: &Manifest) -> bool {
    m.detect.always
        || m.detect.commands.iter().any(|c| which(c).is_some())
        || m.detect.paths.iter().any(|p| expand_tilde(p).exists())
}

pub fn expand_tilde(p: &str) -> PathBuf {
    match (p.strip_prefix("~/"), dirs::home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ if p == "~" => dirs::home_dir().unwrap_or_else(|| PathBuf::from(p)),
        _ => PathBuf::from(p),
    }
}

/// The only variables an engine gets from the host's environment.
pub fn base_env() -> Vec<(String, String)> {
    const KEEP: [&str; 16] = [
        "PATH", "HOME", "LANG", "LC_ALL", "TZ", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
        "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "SSL_CERT_FILE", "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE",
    ];
    KEEP.iter()
        .filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v)))
        .collect()
}

/// What a thread's runner is asked to do.
#[derive(Debug)]
pub enum Cmd {
    Message { text: String, when: SendWhen },
    Stop,
    Decided { approval_id: Uuid, decision: Decision },
}

/// The live runners, by thread.
#[derive(Default)]
pub struct Runners {
    map: Mutex<HashMap<Uuid, mpsc::UnboundedSender<Cmd>>>,
}

impl Runners {
    /// Sends to the thread's runner, starting one if needed.
    pub fn send(&self, app: &Arc<App>, thread_id: Uuid, cmd: Cmd) {
        let mut map = self.map.lock().expect("runners lock");
        let cmd = match map.get(&thread_id) {
            Some(tx) => match tx.send(cmd) {
                Ok(()) => return,
                Err(mpsc::error::SendError(cmd)) => cmd,
            },
            None => cmd,
        };
        let tx = runner::spawn(app.clone(), thread_id);
        let _ = tx.send(cmd);
        map.insert(thread_id, tx);
    }

    /// Sends only if the thread already has a runner. Returns whether it did.
    pub fn send_if_running(&self, thread_id: Uuid, cmd: Cmd) -> bool {
        let map = self.map.lock().expect("runners lock");
        map.get(&thread_id).is_some_and(|tx| tx.send(cmd).is_ok())
    }

    /// Ends every runner; their engine processes are killed as they drop.
    pub fn shutdown(&self) {
        self.map.lock().expect("runners lock").clear();
    }
}

/// Where an engine for this thread works and keeps its own files.
pub fn engine_home(home: &Home, engine: &str, owner: Uuid) -> PathBuf {
    home.engine_home(engine, &owner.to_string())
}

pub fn ensure_dir(p: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(p)
}
