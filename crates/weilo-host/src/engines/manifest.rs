//! Engine manifests (`engines/*/weilo.json`) and how a manifest becomes a command line.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use include_dir::{Dir, include_dir};
use serde::Deserialize;

static BUILT_IN: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../engines");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(default = "one")]
    pub api_version: u32,
    pub kind: String,
    pub name: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub install: Option<Install>,
    pub command: Vec<String>,
    #[serde(default)]
    pub launch: Launch,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Variables passed through from the host's environment when set there, like
    /// `ANTHROPIC_API_KEY`. Nothing else from the host's environment reaches an engine
    /// beyond `base_env`.
    #[serde(default)]
    pub pass_env: Vec<String>,
    /// API keys people can save for this engine in Weilo (`set_engine_key`).
    #[serde(default)]
    pub keys: Vec<KeySpec>,
    /// How to tell the engine is signed in, and how to sign in.
    #[serde(default)]
    pub sign_in: Option<SignIn>,
    #[serde(default)]
    pub model: Option<EnvBlock>,
    #[serde(default)]
    pub gateway: Option<EnvBlock>,
    #[serde(default)]
    pub detect: Detect,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub binds_approvals: bool,
    #[serde(default)]
    pub hidden: bool,
    /// Settings Weilo keeps in a file the engine reads.
    #[serde(default)]
    pub settings: Option<SettingsFile>,
}

/// Values Weilo puts in an engine's own settings file before it starts. A value the
/// person changed there since Weilo wrote it is theirs and is left alone.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFile {
    /// A JSON file (`{engine_home}` allowed).
    pub file: String,
    /// Always set.
    #[serde(default)]
    pub always: serde_json::Map<String, serde_json::Value>,
    /// Set by the provider of the key the engine uses (the first of `keys` it has).
    #[serde(default)]
    pub by_key: BTreeMap<String, serde_json::Map<String, serde_json::Value>>,
}

fn one() -> u32 {
    1
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Install {
    /// Exact `name@version` packages.
    #[serde(default, deserialize_with = "one_or_many")]
    pub npm: Vec<String>,
    /// For engines Weilo can't download: one plain line on how to install it.
    #[serde(default)]
    pub how: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KeySpec {
    /// `anthropic`, `openai`, `google`…
    pub id: String,
    pub title: String,
    /// The variable the engine reads the key from.
    pub env: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SignIn {
    /// Files that exist once the engine is signed in (`~` and `{engine_home}` allowed).
    #[serde(default)]
    pub files: Vec<String>,
    /// macOS Keychain items (by service name) that exist once it is signed in.
    #[serde(default)]
    pub keychain: Vec<String>,
    /// One plain line on how to sign in.
    pub how: String,
    /// The program that signs in (`codex`), when the engine needs it on this computer.
    #[serde(default)]
    pub command: Option<String>,
    /// One plain line on how to get that program.
    #[serde(default)]
    pub get: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Launch {
    /// Flags never passed, whatever the command says.
    #[serde(default)]
    pub deny: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct EnvBlock {
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Detect {
    #[serde(default)]
    pub commands: Vec<String>,
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub always: bool,
}

fn one_or_many<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        One(String),
        Many(Vec<String>),
    }
    Ok(match OneOrMany::deserialize(d)? {
        OneOrMany::One(s) => vec![s],
        OneOrMany::Many(v) => v,
    })
}

/// Built-in manifests, then `HOME/engines/*/weilo.json` (which win on the same name).
pub fn load_all(home_engines: &Path) -> BTreeMap<String, Manifest> {
    let mut out = BTreeMap::new();
    for dir in BUILT_IN.dirs() {
        if let Some(file) = dir.get_file(dir.path().join("weilo.json")) {
            add(&mut out, file.contents(), &dir.path().display().to_string());
        }
    }
    for entry in std::fs::read_dir(home_engines)
        .into_iter()
        .flatten()
        .flatten()
    {
        let path = entry.path().join("weilo.json");
        if let Ok(bytes) = std::fs::read(&path) {
            add(&mut out, &bytes, &path.display().to_string());
        }
    }
    out
}

fn add(out: &mut BTreeMap<String, Manifest>, bytes: &[u8], from: &str) {
    match serde_json::from_slice::<Manifest>(bytes) {
        Ok(m) if m.kind == "engine" && !m.command.is_empty() => {
            out.insert(m.name.clone(), m);
        }
        Ok(_) => tracing::warn!("{from} isn't an engine manifest"),
        Err(e) => tracing::warn!("{from}: {e}"),
    }
}

/// A file shipped beside a built-in manifest (`engines/<engine>/<file>`), like the
/// engine's `package-lock.json`.
pub fn built_in_file(engine: &str, file: &str) -> Option<&'static [u8]> {
    BUILT_IN
        .get_file(Path::new(engine).join(file))
        .map(|f| f.contents())
}

/// Values for `{self}`, `{install}`, `{engine_home}`, `{model}` and `{PATH}`, and the
/// sign-in variables (passed-through and saved keys) for the engine.
#[derive(Debug, Clone)]
pub struct Vars {
    pub self_exe: PathBuf,
    pub install: PathBuf,
    pub engine_home: PathBuf,
    pub model: Option<String>,
    pub path: String,
    pub credentials: BTreeMap<String, String>,
}

/// Fills placeholders. `None` when one is unknown here (like `{gateway}`) or has no
/// value (`{model}` when the agent has none), so the caller can leave that entry out.
pub fn expand(template: &str, vars: &Vars) -> Option<String> {
    let mut out = String::new();
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let end = rest[start..].find('}')? + start;
        let value = match &rest[start + 1..end] {
            "self" => vars.self_exe.display().to_string(),
            "install" => vars.install.display().to_string(),
            "engine_home" => vars.engine_home.display().to_string(),
            "model" => vars.model.clone()?,
            "PATH" => vars.path.clone(),
            _ => return None,
        };
        out.push_str(&value);
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

/// The program, its arguments and the extra environment for one engine process.
#[derive(Debug, Clone, PartialEq)]
pub struct LaunchSpec {
    pub program: String,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

pub fn launch_spec(m: &Manifest, vars: &Vars) -> Result<LaunchSpec, String> {
    let mut parts = Vec::new();
    for part in &m.command {
        let value = expand(part, vars).ok_or_else(|| format!("can't fill in `{part}`"))?;
        if !is_denied(&value, &m.launch.deny) {
            parts.push(value);
        }
    }
    let program = parts.remove(0);
    let mut env = vars.credentials.clone();
    // Pinned launch settings go last, so nothing else can undo them.
    let blocks = [
        Some(&m.env),
        m.model.as_ref().map(|b| &b.env),
        m.gateway.as_ref().map(|b| &b.env),
        Some(&m.launch.env),
    ];
    for block in blocks.into_iter().flatten() {
        for (k, v) in block {
            if let Some(v) = expand(v, vars) {
                env.insert(k.clone(), v);
            }
        }
    }
    Ok(LaunchSpec {
        program,
        args: parts,
        env,
    })
}

fn is_denied(arg: &str, deny: &[String]) -> bool {
    deny.iter().any(|d| {
        arg == d
            || arg
                .strip_prefix(d.as_str())
                .is_some_and(|r| r.starts_with('='))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(model: Option<&str>) -> Vars {
        Vars {
            self_exe: "/bin/weilo".into(),
            install: "/h/engines/pi".into(),
            engine_home: "/h/engines-state/pi".into(),
            model: model.map(Into::into),
            path: "/usr/bin".into(),
            credentials: BTreeMap::new(),
        }
    }

    #[test]
    fn expands_known_placeholders() {
        let v = vars(Some("opus"));
        assert_eq!(
            expand("{install}/node_modules/.bin/x", &v).unwrap(),
            "/h/engines/pi/node_modules/.bin/x"
        );
        assert_eq!(
            expand("{install}/bin:{PATH}", &v).unwrap(),
            "/h/engines/pi/bin:/usr/bin"
        );
        assert_eq!(expand("{self}", &v).unwrap(), "/bin/weilo");
        assert_eq!(expand("{model}", &v).unwrap(), "opus");
        assert_eq!(expand("plain", &v).unwrap(), "plain");
    }

    #[test]
    fn unknown_or_empty_placeholders_give_nothing() {
        let v = vars(None);
        assert_eq!(expand("{gateway}", &v), None);
        assert_eq!(expand("{model}", &v), None);
        assert_eq!(expand("{unclosed", &v), None);
    }

    #[test]
    fn built_in_manifests_load() {
        let all = load_all(Path::new("/nonexistent"));
        for name in ["claude-code", "codex", "echo", "gemini", "pi"] {
            assert!(all.contains_key(name), "{name} missing");
        }
        assert!(all["pi"].default && all["pi"].detect.always);
        assert_eq!(all["pi"].install.as_ref().unwrap().npm.len(), 2);
    }

    #[test]
    fn launch_drops_denied_flags_and_unfillable_env() {
        let mut m = load_all(Path::new("/nonexistent"))["claude-code"].clone();
        m.command.push("--dangerously-skip-permissions".into());
        m.command.push("--dangerously-skip-permissions=true".into());
        m.gateway = Some(EnvBlock {
            env: [("KEY".to_string(), "{standin}".to_string())].into(),
        });
        let spec = launch_spec(&m, &vars(None)).unwrap();
        assert_eq!(
            spec.program,
            "/h/engines/pi/node_modules/.bin/claude-agent-acp"
        );
        assert!(spec.args.is_empty());
        assert!(!spec.env.contains_key("CLAUDE_CONFIG_DIR"));
        assert_eq!(spec.env["CLAUDE_CODE_DISABLE_BYPASS"], "1");
        assert!(!spec.env.contains_key("ANTHROPIC_MODEL"));
        assert!(!spec.env.contains_key("KEY"));
        let spec = launch_spec(&m, &vars(Some("opus"))).unwrap();
        assert_eq!(spec.env["ANTHROPIC_MODEL"], "opus");
    }

    #[test]
    fn pinned_env_wins_over_everything() {
        let mut m = load_all(Path::new("/nonexistent"))["claude-code"].clone();
        m.env
            .insert("CLAUDE_CODE_DISABLE_BYPASS".into(), "0".into());
        let mut v = vars(None);
        v.credentials
            .insert("CLAUDE_CODE_DISABLE_BYPASS".into(), "0".into());
        v.credentials
            .insert("ANTHROPIC_API_KEY".into(), "sk-test".into());
        let spec = launch_spec(&m, &v).unwrap();
        assert_eq!(spec.env["CLAUDE_CODE_DISABLE_BYPASS"], "1");
        assert_eq!(spec.env["ANTHROPIC_API_KEY"], "sk-test");
    }

    #[test]
    fn pi_keeps_its_files_in_its_own_folder() {
        let m = load_all(Path::new("/nonexistent"))["pi"].clone();
        let spec = launch_spec(&m, &vars(None)).unwrap();
        assert_eq!(spec.env["PI_CODING_AGENT_DIR"], "/h/engines-state/pi");
        assert!(m.keys.iter().any(|k| k.env == "ANTHROPIC_API_KEY"));
    }

    #[test]
    fn echo_runs_this_binary() {
        let m = load_all(Path::new("/nonexistent"))["echo"].clone();
        let spec = launch_spec(&m, &vars(None)).unwrap();
        assert_eq!(
            (spec.program.as_str(), spec.args.clone()),
            ("/bin/weilo", vec!["engine".to_string(), "echo".to_string()])
        );
    }
}
