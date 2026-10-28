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
}

fn one() -> u32 {
    1
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Install {
    /// Exact `name@version` packages.
    #[serde(default, deserialize_with = "one_or_many")]
    pub npm: Vec<String>,
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
    for entry in std::fs::read_dir(home_engines).into_iter().flatten().flatten() {
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

/// Values for `{self}`, `{install}`, `{engine_home}`, `{model}` and `{PATH}`.
#[derive(Debug, Clone)]
pub struct Vars {
    pub self_exe: PathBuf,
    pub install: PathBuf,
    pub engine_home: PathBuf,
    pub model: Option<String>,
    pub path: String,
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
    let mut env = BTreeMap::new();
    let blocks = [Some(&m.launch.env), Some(&m.env), m.model.as_ref().map(|b| &b.env), m.gateway.as_ref().map(|b| &b.env)];
    for block in blocks.into_iter().flatten() {
        for (k, v) in block {
            if let Some(v) = expand(v, vars) {
                env.insert(k.clone(), v);
            }
        }
    }
    Ok(LaunchSpec { program, args: parts, env })
}

fn is_denied(arg: &str, deny: &[String]) -> bool {
    deny.iter().any(|d| arg == d || arg.strip_prefix(d.as_str()).is_some_and(|r| r.starts_with('=')))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(model: Option<&str>) -> Vars {
        Vars {
            self_exe: "/bin/weilo".into(),
            install: "/h/engines/pi".into(),
            engine_home: "/h/engine-homes/pi/a1".into(),
            model: model.map(Into::into),
            path: "/usr/bin".into(),
        }
    }

    #[test]
    fn expands_known_placeholders() {
        let v = vars(Some("opus"));
        assert_eq!(expand("{install}/node_modules/.bin/x", &v).unwrap(), "/h/engines/pi/node_modules/.bin/x");
        assert_eq!(expand("{install}/bin:{PATH}", &v).unwrap(), "/h/engines/pi/bin:/usr/bin");
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
        m.gateway = Some(EnvBlock { env: [("KEY".to_string(), "{standin}".to_string())].into() });
        let spec = launch_spec(&m, &vars(None)).unwrap();
        assert_eq!(spec.program, "/h/engines/pi/node_modules/.bin/claude-agent-acp");
        assert!(spec.args.is_empty());
        assert_eq!(spec.env["CLAUDE_CONFIG_DIR"], "/h/engine-homes/pi/a1");
        assert!(!spec.env.contains_key("ANTHROPIC_MODEL"));
        assert!(!spec.env.contains_key("KEY"));
        let spec = launch_spec(&m, &vars(Some("opus"))).unwrap();
        assert_eq!(spec.env["ANTHROPIC_MODEL"], "opus");
    }

    #[test]
    fn echo_runs_this_binary() {
        let m = load_all(Path::new("/nonexistent"))["echo"].clone();
        let spec = launch_spec(&m, &vars(None)).unwrap();
        assert_eq!((spec.program.as_str(), spec.args.clone()), ("/bin/weilo", vec!["engine".to_string(), "echo".to_string()]));
    }
}
