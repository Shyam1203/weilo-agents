//! Engines: ACP processes described by a manifest. One process per thread, started
//! when the thread first needs it and stopped after it has been idle a while.
//!
//! An engine signs in one of three ways, checked in this order when it starts: an API
//! key saved in Weilo (`set_engine_key`), a variable from `passEnv` set where Weilo
//! was started, or the engine's own sign-in in the person's own config folder
//! (`~/.claude`, `~/.codex`, `~/.gemini`), which Weilo never copies or redirects.

mod acp;
mod card;
pub mod check;
pub mod manifest;
pub mod process;
mod runner;

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::sync::mpsc;
use uuid::Uuid;
use weilo_proto::{Decision, EngineInfo, EngineNeed, KeyProvider, SendWhen};

use crate::app::App;
use crate::home::{Home, write_private};
use crate::keep_awake::which;
pub use card::permission_card;
pub use manifest::Manifest;

/// Whether an engine can be used now, and if not, what's missing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Readiness {
    pub needs: Option<EngineNeed>,
    /// "Signed in on this computer.", "Needs you to sign in."…
    pub status: String,
    /// What to do, when something is missing.
    pub how: Option<String>,
}

impl Readiness {
    pub fn ready(&self) -> bool {
        self.needs.is_none()
    }
}

/// The order setup suggests engines in.
const PREFERRED: [&str; 4] = ["claude-code", "codex", "gemini", "pi"];

pub struct Registry {
    manifests: BTreeMap<String, Manifest>,
    home: Home,
}

impl Registry {
    pub fn load(home: &Home) -> Self {
        Self {
            manifests: manifest::load_all(&home.engines()),
            home: home.clone(),
        }
    }

    pub fn get(&self, name: &str) -> Option<&Manifest> {
        self.manifests.get(name)
    }

    /// Engines people can pick (hidden ones, like echo, still run when named).
    pub fn list(&self) -> Vec<EngineInfo> {
        let mut out: Vec<EngineInfo> = self
            .manifests
            .values()
            .filter(|m| !m.hidden)
            .map(|m| self.info(m))
            .collect();
        out.sort_by_key(|e| rank(&e.id));
        out
    }

    pub fn info(&self, m: &Manifest) -> EngineInfo {
        let r = self.readiness(m);
        let saved = self.saved_keys(&m.name);
        let keys: Vec<KeyProvider> = m
            .keys
            .iter()
            .map(|k| KeyProvider {
                id: k.id.clone(),
                title: k.title.clone(),
                has_key: saved.contains_key(&k.id) || std::env::var_os(&k.env).is_some(),
            })
            .collect();
        EngineInfo {
            id: m.name.clone(),
            title: m.title.clone(),
            description: m.description.clone(),
            installed: self.is_installed(m),
            default: m.default,
            binds_approvals: m.binds_approvals,
            ready: Some(r.ready()),
            needs: r.needs,
            status: Some(r.status),
            how: r.how,
            key_providers: Some(keys),
        }
    }

    /// Readiness against this computer: its environment, saved keys and home folder.
    pub fn readiness(&self, m: &Manifest) -> Readiness {
        let installable = self.is_installed(m) || (is_npm(m) && which("npm").is_some());
        readiness(m, Probe {
            installed: self.is_installed(m),
            installable,
            npm_engine: is_npm(m),
            has_credentials: !self.credentials(m).is_empty(),
            engine_home: self.home.engine_state(&m.name),
            user_home: dirs::home_dir(),
            keychain: &keychain_has,
        })
    }

    /// API keys saved in Weilo for an engine, by provider.
    pub fn saved_keys(&self, engine: &str) -> BTreeMap<String, String> {
        std::fs::read(self.home.engine_keys(engine))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    /// Saves (or, when empty, removes) a key. Only providers the manifest names.
    pub fn save_key(&self, m: &Manifest, provider: &str, key: &str) -> Result<(), String> {
        if !m.keys.iter().any(|k| k.id == provider) {
            return Err(format!("{} doesn't use {provider} keys.", m.title));
        }
        let key = key.trim();
        if key.chars().any(char::is_whitespace) || key.len() > 4096 {
            return Err("That doesn't look like a key.".into());
        }
        let mut keys = self.saved_keys(&m.name);
        if key.is_empty() {
            keys.remove(provider);
        } else {
            keys.insert(provider.to_string(), key.to_string());
        }
        let bytes = serde_json::to_vec(&keys).map_err(|e| e.to_string())?;
        crate::home::ensure_private_dir(&self.home.secrets()).map_err(|e| e.to_string())?;
        write_private(&self.home.engine_keys(&m.name), &bytes).map_err(|e| e.to_string())
    }

    /// The sign-in variables an engine gets: `passEnv` from the host's environment, then
    /// keys saved in Weilo (which win).
    pub fn credentials(&self, m: &Manifest) -> BTreeMap<String, String> {
        let mut out: BTreeMap<String, String> = m
            .pass_env
            .iter()
            .filter_map(|k| {
                let v = std::env::var(k).ok().filter(|v| !v.is_empty())?;
                Some((k.clone(), v))
            })
            .collect();
        let saved = self.saved_keys(&m.name);
        for spec in &m.keys {
            if let Some(v) = saved.get(&spec.id) {
                out.insert(spec.env.clone(), v.clone());
            }
        }
        out
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
        let npm = which("npm").ok_or(NO_NPM)?;
        let dir = self.install_dir(&m.name);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let out = tokio::process::Command::new(npm)
            .args(["install", "--prefix"])
            .arg(&dir)
            .args([
                "--ignore-scripts",
                "--no-audit",
                "--no-fund",
                "--save-exact",
            ])
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
            Err(err
                .lines()
                .last()
                .unwrap_or("npm install failed")
                .to_string())
        }
    }
}

/// The install error when npm is missing (explained as "needs Node.js").
pub const NO_NPM: &str = "npm isn't installed";

/// The command line and environment for one engine process.
pub fn spec_for(
    app: &App,
    m: &Manifest,
    model: Option<String>,
) -> Result<manifest::LaunchSpec, acp::Failure> {
    let vars = manifest::Vars {
        self_exe: app.settings.self_exe.clone(),
        install: app.engines.install_dir(&m.name),
        engine_home: engine_home(&app.home, &m.name),
        model,
        path: std::env::var("PATH").unwrap_or_default(),
        credentials: app.engines.credentials(m),
    };
    std::fs::create_dir_all(&vars.engine_home).map_err(|e| acp::Failure {
        text: e.to_string(),
        ..Default::default()
    })?;
    manifest::launch_spec(m, &vars).map_err(|e| acp::Failure {
        text: e,
        ..Default::default()
    })
}

fn is_npm(m: &Manifest) -> bool {
    m.install.as_ref().is_some_and(|i| !i.npm.is_empty())
}

/// What readiness looks at, so it can be tested without this computer.
pub struct Probe<'a> {
    pub installed: bool,
    /// Installed, or downloadable on first use.
    pub installable: bool,
    pub npm_engine: bool,
    pub has_credentials: bool,
    pub engine_home: PathBuf,
    pub user_home: Option<PathBuf>,
    pub keychain: &'a dyn Fn(&str) -> bool,
}

pub fn readiness(m: &Manifest, p: Probe<'_>) -> Readiness {
    if !p.installable {
        let (needs, how) = if p.npm_engine {
            (
                EngineNeed::Node,
                "Install Node.js from nodejs.org, then try again.".to_string(),
            )
        } else {
            let how = m.install.as_ref().and_then(|i| i.how.clone());
            (
                EngineNeed::Install,
                how.unwrap_or_else(|| format!("Install {} first.", m.title)),
            )
        };
        let status = match needs {
            EngineNeed::Node => "Needs Node.js to download.",
            _ => "Not on this computer.",
        };
        return Readiness {
            needs: Some(needs),
            status: status.into(),
            how: Some(how),
        };
    }
    let wants_sign_in = m.sign_in.is_some() || !m.keys.is_empty() || !m.pass_env.is_empty();
    if !wants_sign_in {
        return Readiness {
            needs: None,
            status: "Ready.".into(),
            how: None,
        };
    }
    let signed_in = m.sign_in.as_ref().is_some_and(|s| {
        s.files.iter().any(|f| {
            resolve_path(f, &p.engine_home, p.user_home.as_deref()).is_some_and(|f| f.exists())
        }) || s.keychain.iter().any(|k| (p.keychain)(k))
    });
    if signed_in {
        return Readiness {
            needs: None,
            status: "Signed in on this computer.".into(),
            how: None,
        };
    }
    if p.has_credentials {
        return Readiness {
            needs: None,
            status: "Has an API key.".into(),
            how: None,
        };
    }
    match &m.sign_in {
        Some(s) => Readiness {
            needs: Some(EngineNeed::SignIn),
            status: "Needs you to sign in.".into(),
            how: Some(s.how.clone()),
        },
        None => {
            let names: Vec<&str> = m.keys.iter().map(|k| k.title.as_str()).collect();
            Readiness {
                needs: Some(EngineNeed::Key),
                status: "Needs an API key.".into(),
                how: Some(format!("Add an API key from {}.", or_list(&names))),
            }
        }
    }
}

/// "A", "A or B", "A, B or C".
fn or_list(items: &[&str]) -> String {
    match items {
        [] => "your model provider".into(),
        [one] => one.to_string(),
        [rest @ .., last] => format!("{} or {last}", rest.join(", ")),
    }
}

/// `~/x` and `{engine_home}/x` to real paths.
fn resolve_path(p: &str, engine_home: &Path, user_home: Option<&Path>) -> Option<PathBuf> {
    if let Some(rest) = p.strip_prefix("{engine_home}/") {
        return Some(engine_home.join(rest));
    }
    if let Some(rest) = p.strip_prefix("~/") {
        return Some(user_home?.join(rest));
    }
    Some(PathBuf::from(p))
}

/// True when the macOS Keychain has an item for this service. Never reads the secret.
fn keychain_has(service: &str) -> bool {
    cfg!(target_os = "macos")
        && std::process::Command::new("/usr/bin/security")
            .args(["find-generic-password", "-s", service])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|s| s.success())
}

fn rank(name: &str) -> (usize, String) {
    let pos = PREFERRED
        .iter()
        .position(|p| *p == name)
        .unwrap_or(PREFERRED.len());
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
        "PATH",
        "HOME",
        "LANG",
        "LC_ALL",
        "TZ",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "NODE_EXTRA_CA_CERTS",
        "REQUESTS_CA_BUNDLE",
    ];
    KEEP.iter()
        .filter_map(|k| std::env::var(k).ok().map(|v| (k.to_string(), v)))
        .collect()
}

/// What a thread's runner is asked to do.
#[derive(Debug)]
pub enum Cmd {
    Message {
        text: String,
        when: SendWhen,
    },
    Stop,
    Decided {
        approval_id: Uuid,
        decision: Decision,
    },
    /// The agent's engine or model changed: start a new engine process next time.
    Restart,
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

    /// Ends every runner and kills every engine's process group (TERM, then KILL after
    /// `grace`). Blocks until they are gone or the grace is over.
    pub fn shutdown(&self, grace: std::time::Duration) {
        self.map.lock().expect("runners lock").clear();
        process::kill_all(grace);
    }
}

/// Where an engine keeps its own files: one folder per engine, shared by its threads.
pub fn engine_home(home: &Home, engine: &str) -> PathBuf {
    home.engine_state(engine)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(home: &Path, creds: bool) -> Probe<'static> {
        Probe {
            installed: false,
            installable: true,
            npm_engine: true,
            has_credentials: creds,
            engine_home: home.join("state"),
            user_home: Some(home.to_path_buf()),
            keychain: &|_| false,
        }
    }

    fn manifest(name: &str) -> Manifest {
        manifest::load_all(Path::new("/nonexistent"))[name].clone()
    }

    #[test]
    fn claude_uses_the_persons_own_sign_in() {
        let dir = tempfile::tempdir().unwrap();
        let m = manifest("claude-code");
        let r = readiness(&m, probe(dir.path(), false));
        assert_eq!(r.needs, Some(EngineNeed::SignIn));
        assert_eq!(r.status, "Needs you to sign in.");
        assert_eq!(
            r.how.as_deref(),
            Some("Open Terminal, run `claude` and sign in.")
        );
        std::fs::create_dir_all(dir.path().join(".claude")).unwrap();
        std::fs::write(dir.path().join(".claude/.credentials.json"), "{}").unwrap();
        let r = readiness(&m, probe(dir.path(), false));
        assert!(r.ready());
        assert_eq!(r.status, "Signed in on this computer.");
    }

    #[test]
    fn pi_without_a_key_says_so() {
        let dir = tempfile::tempdir().unwrap();
        let m = manifest("pi");
        let r = readiness(&m, probe(dir.path(), false));
        assert_eq!(r.needs, Some(EngineNeed::Key));
        assert_eq!(
            r.how.as_deref(),
            Some("Add an API key from Anthropic, OpenAI or Google.")
        );
        assert!(readiness(&m, probe(dir.path(), true)).ready());
    }

    #[test]
    fn missing_programs_and_node_are_named() {
        let dir = tempfile::tempdir().unwrap();
        let mut p = probe(dir.path(), true);
        p.installable = false;
        let r = readiness(&manifest("claude-code"), p);
        assert_eq!(r.needs, Some(EngineNeed::Node));
        let mut p = probe(dir.path(), true);
        p.installable = false;
        p.npm_engine = false;
        let r = readiness(&manifest("gemini"), p);
        assert_eq!(r.needs, Some(EngineNeed::Install));
        assert_eq!(r.status, "Not on this computer.");
    }

    #[test]
    fn echo_needs_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(readiness(&manifest("echo"), probe(dir.path(), false)).ready());
    }

    #[test]
    fn saved_keys_stay_private_and_reach_the_engine() {
        let dir = tempfile::tempdir().unwrap();
        let home = Home::new(dir.path());
        let reg = Registry::load(&home);
        let pi = reg.get("pi").unwrap().clone();
        assert!(reg.save_key(&pi, "nobody", "x").is_err());
        reg.save_key(&pi, "openai", " sk-test ").unwrap();
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(home.engine_keys("pi"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(reg.credentials(&pi)["OPENAI_API_KEY"], "sk-test");
        reg.save_key(&pi, "openai", "").unwrap();
        assert!(!reg.credentials(&pi).contains_key("OPENAI_API_KEY") || std::env::var_os("OPENAI_API_KEY").is_some());
    }
}
