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
use std::time::Duration;

use tokio::sync::mpsc;
use uuid::Uuid;
use weilo_proto::{Decision, EngineInfo, EngineNeed, KeyProvider, SendWhen};

use crate::app::App;
use crate::home::{Home, write_private};
use crate::keep_awake::which;
pub use card::permission_card;
pub use manifest::Manifest;
pub use runner::STILL_WORKING;

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
    /// One download at a time per engine.
    install_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// How long a download may take before it counts as failed.
    install_timeout: Duration,
    /// Held while the saved keys file is read, changed and written.
    keys_lock: Mutex<()>,
    /// Engines being downloaded right now.
    downloading: Mutex<std::collections::HashSet<String>>,
    /// What the provider said of a key (by engine and provider), when it wasn't "yes".
    key_states: Mutex<HashMap<(String, String), KeyState>>,
}

/// A key the provider hasn't taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum KeyState {
    /// The provider couldn't be asked yet.
    Unchecked,
    /// The provider turned it down.
    Rejected,
}

/// Written inside an engine's install folder once its download is complete; an install
/// folder without it is unfinished and is replaced.
const INSTALLED_MARKER: &str = ".weilo-installed";

/// The install error when a download takes too long (explained plainly).
pub const INSTALL_TIMED_OUT: &str = "the download took too long";

impl Registry {
    pub fn load(home: &Home) -> Self {
        let secs = std::env::var("WEILO_INSTALL_TIMEOUT_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(600);
        Self {
            manifests: manifest::load_all(&home.engines()),
            home: home.clone(),
            install_locks: Mutex::default(),
            install_timeout: Duration::from_secs(secs),
            keys_lock: Mutex::default(),
            downloading: Mutex::default(),
            key_states: Mutex::default(),
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
        // An engine that isn't on this computer can't use a key yet.
        let keys = (r.needs != Some(EngineNeed::Install)).then_some(keys);
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
            key_providers: keys,
        }
    }

    /// Readiness against this computer: its environment, saved keys and home folder.
    pub fn readiness(&self, m: &Manifest) -> Readiness {
        let mut r = self.probe_readiness(m);
        if r.needs.is_none() && r.status == HAS_KEY {
            match self.key_state(m) {
                Some(KeyState::Rejected) => {
                    let names: Vec<&str> = m.keys.iter().map(|k| k.title.as_str()).collect();
                    return Readiness {
                        needs: Some(EngineNeed::Key),
                        status: "The key didn't work.".into(),
                        how: Some(format!("Add another API key from {}.", or_list(&names))),
                    };
                }
                Some(KeyState::Unchecked) => {
                    r.status = "Has an API key. Weilo couldn't check it yet.".into();
                }
                None => {}
            }
        }
        if r.needs.is_none() && self.is_downloading(m) {
            r.status = "Downloading now.".into();
        }
        r
    }

    /// Whether the engine is being downloaded right now.
    pub fn is_downloading(&self, m: &Manifest) -> bool {
        self.downloading
            .lock()
            .expect("downloading lock")
            .contains(&m.name)
    }

    /// The state of the key the engine uses (the first in use), when it isn't "taken".
    fn key_state(&self, m: &Manifest) -> Option<KeyState> {
        let (spec, _) = self.keys_in_use(m).into_iter().next()?;
        let states = self.key_states.lock().expect("key states lock");
        states.get(&(m.name.clone(), spec.id)).copied()
    }

    /// Notes what the provider said of a key: `Some(true)` taken, `Some(false)` turned
    /// down, `None` couldn't ask.
    pub fn mark_key(&self, m: &Manifest, provider: &str, answer: Option<bool>) {
        let mut states = self.key_states.lock().expect("key states lock");
        let entry = (m.name.clone(), provider.to_string());
        match answer {
            Some(true) => {
                states.remove(&entry);
            }
            Some(false) => {
                states.insert(entry, KeyState::Rejected);
            }
            None => {
                states.insert(entry, KeyState::Unchecked);
            }
        }
    }

    fn probe_readiness(&self, m: &Manifest) -> Readiness {
        let installable = self.is_installed(m) || (is_npm(m) && which("npm").is_some());
        readiness(
            m,
            Probe {
                installed: self.is_installed(m),
                installable,
                npm_engine: is_npm(m),
                has_credentials: !self.credentials(m).is_empty(),
                sign_in_cli: sign_in_cli_present(m),
                engine_home: self.home.engine_state(&m.name),
                user_home: dirs::home_dir(),
                keychain: &keychain_has,
            },
        )
    }

    /// The provider ("Anthropic") of the API key the engine is given, if any: the first
    /// of its `keys` saved in Weilo or set where Weilo runs. That is the one the engine
    /// uses (Weilo's built-in AI is told so, see `spec_for`).
    pub fn key_in_use(&self, m: &Manifest) -> Option<String> {
        self.keys_in_use(m).into_iter().next().map(|(k, _)| k.title)
    }

    /// Each key the engine is given, with its value, in the manifest's order.
    pub fn keys_in_use(&self, m: &Manifest) -> Vec<(manifest::KeySpec, String)> {
        let saved = self.saved_keys(&m.name);
        m.keys
            .iter()
            .filter_map(|k| {
                let v = saved
                    .get(&k.id)
                    .cloned()
                    .or_else(|| {
                        std::env::var(&k.env)
                            .ok()
                            .filter(|_| m.pass_env.contains(&k.env))
                    })
                    .filter(|v| !v.is_empty())?;
                Some((k.clone(), v))
            })
            .collect()
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
        // Two saves at once must not lose one another's key.
        let _held = self.keys_lock.lock().expect("keys lock");
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

    /// Ready to start without fetching anything. An engine Weilo downloads counts only
    /// once its download is complete (`detect.always` only means it is always offered).
    pub fn is_installed(&self, m: &Manifest) -> bool {
        if m.command[0] == "{self}" {
            return true;
        }
        if is_npm(m) {
            return self.install_dir(&m.name).join(INSTALLED_MARKER).is_file();
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

    /// True when the engine must be downloaded before it can start.
    pub fn needs_download(&self, m: &Manifest) -> bool {
        is_npm(m) && !self.is_installed(m)
    }

    fn install_lock(&self, name: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.install_locks
            .lock()
            .expect("install locks")
            .entry(name.to_string())
            .or_default()
            .clone()
    }

    /// Downloads the manifest's exact packages with npm, never `npx -y`, and runs no
    /// install scripts. From the lockfile shipped with the engine (`npm ci`) when there
    /// is one. One download per engine at a time, into a fresh folder that replaces
    /// the install folder only once npm is done; the marker is written last.
    pub async fn install(&self, m: &Manifest) -> Result<(), String> {
        let Some(pkgs) = m.install.as_ref().map(|i| &i.npm).filter(|p| !p.is_empty()) else {
            return Ok(());
        };
        let lock = self.install_lock(&m.name);
        let _held = lock.lock().await;
        if self.is_installed(m) {
            // Another thread finished it while this one waited.
            return Ok(());
        }
        let npm = which("npm").ok_or(NO_NPM)?;
        let dir = self.install_dir(&m.name);
        let parent = dir.parent().ok_or("no folder for engines")?.to_path_buf();
        std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
        remove_leftovers(&parent, &m.name);
        let staging = parent.join(format!(".install-{}-{}", m.name, crate::auth::new_token()));
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        self.downloading
            .lock()
            .expect("downloading lock")
            .insert(m.name.clone());
        let result = self.npm(&npm, m, pkgs, &staging).await;
        self.downloading
            .lock()
            .expect("downloading lock")
            .remove(&m.name);
        let result = result.and_then(|()| put_in_place(&staging, &dir, &parent, &m.name));
        if result.is_err() {
            let _ = std::fs::remove_dir_all(&staging);
        }
        result?;
        write_private(&dir.join(INSTALLED_MARKER), b"ok\n").map_err(|e| e.to_string())
    }

    async fn npm(
        &self,
        npm: &Path,
        m: &Manifest,
        pkgs: &[String],
        dir: &Path,
    ) -> Result<(), String> {
        let (package, lockfile) = npm_files(m, pkgs);
        std::fs::write(dir.join("package.json"), package).map_err(|e| e.to_string())?;
        let verb = match lockfile {
            Some(lock) => {
                std::fs::write(dir.join("package-lock.json"), lock).map_err(|e| e.to_string())?;
                "ci"
            }
            None => "install",
        };
        let run = tokio::process::Command::new(npm)
            .args([verb, "--ignore-scripts", "--no-audit", "--no-fund"])
            .current_dir(dir)
            .env_clear()
            .envs(base_env())
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output();
        let out = match tokio::time::timeout(self.install_timeout, run).await {
            Err(_) => return Err(INSTALL_TIMED_OUT.into()),
            Ok(out) => out.map_err(|e| e.to_string())?,
        };
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

/// `package.json` for the engine's packages, and the lockfile shipped with it when that
/// lockfile is for exactly these packages.
fn npm_files(m: &Manifest, pkgs: &[String]) -> (Vec<u8>, Option<&'static [u8]>) {
    let wanted: BTreeMap<String, String> = pkgs
        .iter()
        .filter_map(|p| {
            let at = p.rfind('@').filter(|&i| i > 0)?;
            Some((p[..at].to_string(), p[at + 1..].to_string()))
        })
        .collect();
    let shipped = manifest::built_in_file(&m.name, "package.json")
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(b).ok())
        .and_then(|v| {
            serde_json::from_value::<BTreeMap<String, String>>(v["dependencies"].clone()).ok()
        });
    let lockfile = manifest::built_in_file(&m.name, "package-lock.json")
        .filter(|_| shipped.as_ref() == Some(&wanted));
    let package = serde_json::json!({
        "name": format!("weilo-engine-{}", m.name),
        "private": true,
        "dependencies": wanted,
    });
    (package.to_string().into_bytes(), lockfile)
}

/// Removes downloads that never finished (Weilo stopped, or Stop was pressed).
fn remove_leftovers(parent: &Path, name: &str) {
    let prefixes = [format!(".install-{name}-"), format!(".old-{name}-")];
    for entry in std::fs::read_dir(parent).into_iter().flatten().flatten() {
        let file = entry.file_name();
        let file = file.to_string_lossy();
        if prefixes.iter().any(|p| file.starts_with(p.as_str())) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Moves a finished download into the install folder, replacing an unfinished one but
/// keeping a manifest the person put there.
fn put_in_place(staging: &Path, dir: &Path, parent: &Path, name: &str) -> Result<(), String> {
    let old = parent.join(format!(".old-{name}-{}", crate::auth::new_token()));
    let had_old = dir.exists();
    if had_old {
        std::fs::rename(dir, &old).map_err(|e| e.to_string())?;
    }
    std::fs::rename(staging, dir).map_err(|e| e.to_string())?;
    if had_old {
        let manifest = old.join("weilo.json");
        if manifest.is_file() {
            let _ = std::fs::copy(&manifest, dir.join("weilo.json"));
        }
        let _ = std::fs::remove_dir_all(&old);
    }
    Ok(())
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
    if let Some(settings) = &m.settings {
        let keys = app.engines.keys_in_use(m);
        let provider = keys.first().map(|(k, _)| k.id.as_str());
        if let Err(e) = keep_settings(settings, &vars.engine_home, provider) {
            tracing::warn!("couldn't write {}'s settings: {e}", m.name);
        }
    }
    manifest::launch_spec(m, &vars).map_err(|e| acp::Failure {
        text: e,
        ..Default::default()
    })
}

/// Puts the manifest's `settings` in the engine's settings file. What Weilo wrote last
/// is kept beside it (`<file>.weilo`), so a value the person has since changed stays theirs.
fn keep_settings(
    s: &manifest::SettingsFile,
    engine_home: &Path,
    provider: Option<&str>,
) -> std::io::Result<()> {
    use serde_json::{Map, Value};
    let Some(path) = resolve_path(&s.file, engine_home, None) else {
        return Ok(());
    };
    let ours = path.with_extension("weilo");
    let read = |p: &Path| -> Option<Map<String, Value>> {
        match std::fs::read(p) {
            Ok(b) => serde_json::from_slice(&b).ok(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some(Map::new()),
            Err(_) => None,
        }
    };
    // A file that isn't a JSON object is the person's business.
    let Some(mut current) = read(&path) else {
        return Ok(());
    };
    let last = read(&ours).unwrap_or_default();
    let mut want = s.always.clone();
    if let Some(extra) = provider.and_then(|p| s.by_key.get(p)) {
        want.extend(extra.clone());
    }
    let mut wrote = Map::new();
    let mut changed = false;
    for (k, v) in want {
        match current.get(&k) {
            Some(cur) if cur == &v => {}
            Some(cur) if last.get(&k) != Some(cur) => continue,
            _ => {
                current.insert(k.clone(), v.clone());
                changed = true;
            }
        }
        wrote.insert(k, v);
    }
    if changed {
        let bytes = serde_json::to_vec_pretty(&current).map_err(std::io::Error::other)?;
        write_private(&path, &bytes)?;
    }
    if wrote != last {
        let bytes = serde_json::to_vec(&wrote).map_err(std::io::Error::other)?;
        write_private(&ours, &bytes)?;
    }
    Ok(())
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
    /// The program the engine signs in with is here (or it needs none).
    pub sign_in_cli: bool,
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
    let wants_sign_in = m.sign_in.is_some() || !m.keys.is_empty();
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
            status: HAS_KEY.into(),
            how: None,
        };
    }
    let names: Vec<&str> = m.keys.iter().map(|k| k.title.as_str()).collect();
    let Some(s) = &m.sign_in else {
        return Readiness {
            needs: Some(EngineNeed::Key),
            status: "Needs an API key.".into(),
            how: Some(format!("Add an API key from {}.", or_list(&names))),
        };
    };
    // Signing in needs the engine's own program. Without it, a key is the one way here
    // (Weilo downloads the engine itself), so that is all that is said.
    if !p.sign_in_cli {
        if names.is_empty() {
            let get = s.get.clone();
            return Readiness {
                needs: Some(EngineNeed::Install),
                status: "Not on this computer.".into(),
                how: Some(get.unwrap_or_else(|| format!("Install {} first.", m.title))),
            };
        }
        return Readiness {
            needs: Some(EngineNeed::Key),
            status: "Needs an API key.".into(),
            how: Some(format!("Add an API key from {}.", or_list(&names))),
        };
    }
    if names.is_empty() {
        return Readiness {
            needs: Some(EngineNeed::SignIn),
            status: "Needs you to sign in.".into(),
            how: Some(s.how.clone()),
        };
    }
    Readiness {
        needs: Some(EngineNeed::Key),
        status: "Needs you to sign in.".into(),
        how: Some(format!(
            "{} Or add an API key from {}.",
            s.how,
            or_list(&names)
        )),
    }
}

/// The status of an engine that has an API key.
const HAS_KEY: &str = "Has an API key.";

/// Whether the program an engine signs in with is on this computer (or it needs none).
pub fn sign_in_cli_present(m: &Manifest) -> bool {
    m.sign_in
        .as_ref()
        .and_then(|s| s.command.as_deref())
        .is_none_or(|c| which(c).is_some())
}

/// "A", "A or B", "A, B or C".
pub(crate) fn or_list(items: &[&str]) -> String {
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

/// Offered first in setup: always (Weilo's built-in AI), or its program is on this
/// computer. A leftover settings folder (`detect.paths`) alone isn't the program, so it
/// doesn't count.
fn detected(m: &Manifest) -> bool {
    m.detect.always || m.detect.commands.iter().any(|c| which(c).is_some())
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
    /// Bring a session's changes back into its folder (`worktree::merge_back`). The
    /// runner does it between turns, so no turn starts or runs meanwhile.
    BringBack {
        folder: PathBuf,
        worktree: PathBuf,
        title: String,
        reply: tokio::sync::oneshot::Sender<Result<String, String>>,
    },
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

    /// Called by a runner with nothing to do: removes it, unless a command reached it
    /// meanwhile (`send` holds the same lock, so none can slip in between). True when
    /// the runner should end.
    pub(crate) fn retire(&self, thread_id: Uuid, cmds: &mpsc::UnboundedReceiver<Cmd>) -> bool {
        let mut map = self.map.lock().expect("runners lock");
        if !cmds.is_empty() {
            return false;
        }
        // While this runner's receiver lives, the entry is its own: `send` replaces an
        // entry only once its receiver is gone.
        map.remove(&thread_id);
        true
    }

    /// How many threads have a runner now.
    pub fn count(&self) -> usize {
        self.map.lock().expect("runners lock").len()
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
            sign_in_cli: true,
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
        // Signing in or a key: both work, so the key can be added right here.
        assert_eq!(r.needs, Some(EngineNeed::Key));
        assert_eq!(r.status, "Needs you to sign in.");
        assert_eq!(
            r.how.as_deref(),
            Some("Open Terminal, run `claude` and sign in. Or add an API key from Anthropic.")
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
    fn the_built_in_ai_is_downloaded_not_assumed() {
        let dir = tempfile::tempdir().unwrap();
        let reg = Registry::load(&Home::new(dir.path()));
        let pi = reg.get("pi").unwrap().clone();
        assert!(pi.detect.always, "always offered in setup");
        assert!(!reg.is_installed(&pi));
        assert!(reg.needs_download(&pi));
        assert!(reg.found().contains(&"pi".to_string()));
        // Once its download is complete, it is installed.
        let marker = reg.install_dir("pi").join(INSTALLED_MARKER);
        std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
        std::fs::write(&marker, "ok\n").unwrap();
        assert!(reg.is_installed(&pi) && !reg.needs_download(&pi));
    }

    #[test]
    fn codex_without_its_program_offers_a_key() {
        let dir = tempfile::tempdir().unwrap();
        let mut p = probe(dir.path(), false);
        p.sign_in_cli = false;
        let r = readiness(&manifest("codex"), p);
        // Weilo downloads the engine itself; without the program to sign in with, a key
        // is the one way, and that is all that is said.
        assert_eq!(r.needs, Some(EngineNeed::Key));
        assert_eq!(r.status, "Needs an API key.");
        assert_eq!(r.how.as_deref(), Some("Add an API key from OpenAI."));
        // With a key it's ready, program or not.
        let mut p = probe(dir.path(), true);
        p.sign_in_cli = false;
        assert!(readiness(&manifest("codex"), p).ready());
    }

    #[test]
    fn an_engine_not_on_this_computer_offers_no_keys() {
        if which("gemini").is_some() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let reg = Registry::load(&Home::new(dir.path()));
        let info = reg.info(reg.get("gemini").unwrap());
        assert_eq!(info.needs, Some(EngineNeed::Install));
        assert_eq!(info.status.as_deref(), Some("Not on this computer."));
        assert!(info.key_providers.is_none());
        assert!(reg.info(reg.get("pi").unwrap()).key_providers.is_some());
    }

    #[test]
    fn the_built_in_ai_starts_on_a_cheaper_model_unless_the_person_chose() {
        let dir = tempfile::tempdir().unwrap();
        let s = manifest("pi").settings.unwrap();
        let file = dir.path().join("settings.json");
        let read = || -> serde_json::Value {
            serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap()
        };
        keep_settings(&s, dir.path(), Some("anthropic")).unwrap();
        assert_eq!(read()["defaultProvider"], "anthropic");
        assert_eq!(read()["defaultModel"], "claude-sonnet-5-5");
        assert_eq!(read()["quietStartup"], true);
        // Another key: Weilo's own choice follows it.
        keep_settings(&s, dir.path(), Some("google")).unwrap();
        assert_eq!(read()["defaultModel"], "gemini-3.8-flash");
        // The person picks a model in the engine: it stays, and so do their other settings.
        let mut v = read();
        v["defaultModel"] = "gemini-3.1-pro-preview".into();
        v["theme"] = "dark".into();
        std::fs::write(&file, serde_json::to_vec(&v).unwrap()).unwrap();
        keep_settings(&s, dir.path(), Some("google")).unwrap();
        assert_eq!(read()["defaultModel"], "gemini-3.1-pro-preview");
        assert_eq!(read()["theme"], "dark");
        keep_settings(&s, dir.path(), Some("openai")).unwrap();
        assert_eq!(read()["defaultModel"], "gemini-3.1-pro-preview");
        assert_eq!(read()["defaultProvider"], "openai");
    }

    #[test]
    fn echo_needs_nothing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(readiness(&manifest("echo"), probe(dir.path(), false)).ready());
    }

    #[test]
    fn keys_saved_at_once_are_all_kept() {
        let dir = tempfile::tempdir().unwrap();
        let home = Home::new(dir.path());
        let reg = Arc::new(Registry::load(&home));
        let mut m = reg.get("pi").unwrap().clone();
        m.keys = (0..24)
            .map(|i| manifest::KeySpec {
                id: format!("p{i}"),
                title: format!("P{i}"),
                env: format!("WEILO_TEST_KEY_{i}"),
            })
            .collect();
        let m = Arc::new(m);
        let threads: Vec<_> = (0..24)
            .map(|i| {
                let (reg, m) = (reg.clone(), m.clone());
                std::thread::spawn(move || reg.save_key(&m, &format!("p{i}"), "k").unwrap())
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(reg.saved_keys("pi").len(), 24);
    }

    #[test]
    fn a_shipped_lockfile_is_used_only_for_its_own_packages() {
        for name in ["claude-code", "codex", "pi"] {
            let m = manifest(name);
            let pkgs = m.install.as_ref().unwrap().npm.clone();
            let (package, lock) = npm_files(&m, &pkgs);
            assert!(lock.is_some(), "{name} has no lockfile for its packages");
            let package: serde_json::Value = serde_json::from_slice(&package).unwrap();
            assert_eq!(
                package["dependencies"].as_object().unwrap().len(),
                pkgs.len()
            );
            let (_, lock) = npm_files(&m, &["other@1.0.0".to_string()]);
            assert!(lock.is_none());
        }
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
        assert!(
            !reg.credentials(&pi).contains_key("OPENAI_API_KEY")
                || std::env::var_os("OPENAI_API_KEY").is_some()
        );
    }
}
