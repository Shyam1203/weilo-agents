//! Says plainly why an engine can't work, and checks one by starting it once.

use std::sync::Arc;

use tokio::sync::mpsc;
use weilo_proto::{EngineCheck, EngineNeed};

use super::acp::{Connection, Failure};
use super::{Manifest, base_env, engine_home, spec_for};
use crate::app::App;

/// What went wrong, in one plain line, and the button that helps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Explained {
    pub needs: EngineNeed,
    pub message: String,
    pub action: &'static str,
}

/// The longest engine message shown; the whole text is in the engine's log.
const MAX_SHOWN: usize = 300;

pub fn explain(m: &Manifest, f: &Failure) -> Explained {
    let title = &m.title;
    if f.text.contains(super::NO_NPM) {
        return Explained {
            needs: EngineNeed::Node,
            message: format!("Weilo needs Node.js to download {title}. Get it from nodejs.org."),
            action: "Install",
        };
    }
    if f.missing_program {
        let how = m.install.as_ref().and_then(|i| i.how.clone());
        return Explained {
            needs: EngineNeed::Install,
            message: match how {
                Some(how) => format!("{title} isn't on this computer. {how}"),
                None => format!("{title} isn't on this computer."),
            },
            action: "Install",
        };
    }
    if f.auth_required || looks_like_auth(&f.text) {
        return needs_sign_in(m);
    }
    Explained {
        needs: EngineNeed::Error,
        message: format!("{title} hit a problem: {}", one_line(&f.text, MAX_SHOWN)),
        action: "Try again",
    }
}

/// "Isn't signed in" for engines with a sign-in, "needs an API key" for the rest.
pub fn needs_sign_in(m: &Manifest) -> Explained {
    match &m.sign_in {
        Some(s) => Explained {
            needs: EngineNeed::SignIn,
            message: format!("{} isn't signed in. {}", m.title, s.how),
            action: "Sign in",
        },
        None => Explained {
            needs: EngineNeed::Key,
            message: format!("{} needs an API key to work.", m.title),
            action: "Add a key",
        },
    }
}

/// True for the ways engines say "sign in first", in errors and in replies.
pub fn looks_like_auth(text: &str) -> bool {
    let t = text.to_lowercase();
    [
        "/login",
        "please log in",
        "please login",
        "not logged in",
        "not signed in",
        "sign in again",
        "authentication",
        "unauthorized",
        "invalid api key",
        "invalid x-api-key",
        "api key not",
        "no api key",
        "missing api key",
        "oauth token",
        "credit balance",
        "auth_required",
        "401",
    ]
    .iter()
    .any(|w| t.contains(w))
}

/// Whitespace collapsed to single spaces, cut at `max` characters.
pub fn one_line(text: &str, max: usize) -> String {
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if joined.chars().count() <= max {
        return joined;
    }
    let cut: String = joined.chars().take(max).collect();
    format!("{}…", cut.trim_end())
}

/// Installs the engine if needed, starts it, says hello and opens a session, then stops
/// it. Never sends a prompt, so it costs nothing.
pub async fn run(app: &Arc<App>, m: &Manifest) -> EngineCheck {
    let readiness = app.engines.readiness(m);
    let not_ready = |e: Explained, auth_methods| EngineCheck {
        engine: m.name.clone(),
        ready: false,
        needs: Some(e.needs),
        message: e.message,
        action: Some(e.action.into()),
        auth_methods,
    };
    if let Err(e) = app.engines.install(m).await {
        return not_ready(explain(m, &Failure::other(e)), vec![]);
    }
    let spec = match spec_for(app, m, None) {
        Ok(spec) => spec,
        Err(f) => return not_ready(explain(m, &f), vec![]),
    };
    let cwd = engine_home(&app.home, &m.name);
    if let Err(e) = std::fs::create_dir_all(&cwd) {
        return not_ready(explain(m, &Failure::other(e.to_string())), vec![]);
    }
    let log = app.home.logs().join(format!("engine-{}.log", m.name));
    let (tx, _rx) = mpsc::unbounded_channel();
    match Connection::open(&spec, base_env(), &cwd, &log, tx, 0, None).await {
        Ok(conn) => {
            let methods = conn.auth_methods.clone();
            drop(conn);
            if matches!(readiness.needs, Some(EngineNeed::SignIn | EngineNeed::Key)) {
                return not_ready(needs_sign_in(m), methods);
            }
            EngineCheck {
                engine: m.name.clone(),
                ready: true,
                needs: None,
                message: format!("{} is ready.", m.title),
                action: None,
                auth_methods: methods,
            }
        }
        Err(f) => not_ready(explain(m, &f), vec![]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn manifest(name: &str) -> Manifest {
        super::super::manifest::load_all(Path::new("/nonexistent"))[name].clone()
    }

    #[test]
    fn missing_gemini_says_it_isnt_installed() {
        let f = Failure {
            missing_program: true,
            text: "couldn't start gemini: No such file or directory".into(),
            ..Failure::default()
        };
        let e = explain(&manifest("gemini"), &f);
        assert_eq!(e.needs, EngineNeed::Install);
        assert!(e.message.starts_with("Gemini CLI isn't on this computer."));
        assert_eq!(e.action, "Install");
    }

    #[test]
    fn sign_in_errors_ask_to_sign_in_and_pi_asks_for_a_key() {
        let f = Failure::other("Invalid API key · Please run /login");
        let e = explain(&manifest("claude-code"), &f);
        assert_eq!((e.needs, e.action), (EngineNeed::SignIn, "Sign in"));
        assert_eq!(
            e.message,
            "Claude Code isn't signed in. Open Terminal, run `claude` and sign in."
        );
        let f = Failure {
            auth_required: true,
            ..Failure::default()
        };
        assert_eq!(explain(&manifest("pi"), &f).action, "Add a key");
    }

    #[test]
    fn no_npm_needs_node() {
        let e = explain(&manifest("codex"), &Failure::other(super::super::NO_NPM));
        assert_eq!((e.needs, e.action), (EngineNeed::Node, "Install"));
    }

    #[test]
    fn other_errors_keep_the_whole_message_on_one_line() {
        let f = Failure::other(
            "Request failed for the OAuth provider.: {\n  \"error\": \"overloaded\"\n}",
        );
        let e = explain(&manifest("codex"), &f);
        assert_eq!(e.action, "Try again");
        assert_eq!(
            e.message,
            "Codex hit a problem: Request failed for the OAuth provider.: { \"error\": \"overloaded\" }"
        );
        assert!(one_line(&"x".repeat(400), 300).ends_with('…'));
    }
}
