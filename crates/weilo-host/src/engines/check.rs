//! Says plainly why an engine can't work, and checks one by starting it once.

use std::sync::Arc;
use std::time::Duration;

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

impl Explained {
    /// The kind of problem, for `EventBody::Problem::code`.
    pub fn code(&self) -> &'static str {
        problem_code(Some(self.needs), Some(self.action))
    }
}

/// What kind of problem an engine need is, for `EventBody::Problem::code`: `key_rejected`
/// (a key it was given didn't work), `needs_key`, `not_signed_in`, `not_installed` or
/// `engine_error`.
pub fn problem_code(needs: Option<EngineNeed>, action: Option<&str>) -> &'static str {
    match needs {
        Some(EngineNeed::Key) if action == Some("Change key") => "key_rejected",
        Some(EngineNeed::Key) => "needs_key",
        Some(EngineNeed::SignIn) => "not_signed_in",
        Some(EngineNeed::Install | EngineNeed::Node) => "not_installed",
        Some(EngineNeed::Error) | None => "engine_error",
    }
}

/// The longest engine message shown; the whole text is in the engine's log.
const MAX_SHOWN: usize = 300;

/// `key` is the provider of the API key the engine was given ("Anthropic"), if any: a
/// sign-in failure then means that key didn't work.
pub fn explain(m: &Manifest, f: &Failure, key: Option<&str>) -> Explained {
    let title = &m.title;
    if f.text.contains(super::NO_NPM) {
        return Explained {
            needs: EngineNeed::Node,
            message: format!("Weilo needs Node.js to download {title}. Get it from nodejs.org."),
            action: "Install",
        };
    }
    if f.text.contains(super::INSTALL_TIMED_OUT) {
        return Explained {
            needs: EngineNeed::Error,
            message: format!(
                "Downloading {title} took too long. Check your internet connection, then try again."
            ),
            action: "Try again",
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
        return match key {
            Some(provider) => key_failed(&format!("Your {provider} key didn't work.")),
            None => needs_sign_in(m),
        };
    }
    Explained {
        needs: EngineNeed::Error,
        message: format!("{title} hit a problem: {}", one_line(&f.text, MAX_SHOWN)),
        action: "Try again",
    }
}

/// An API key the provider turned down.
pub fn key_failed(message: &str) -> Explained {
    Explained {
        needs: EngineNeed::Key,
        message: message.into(),
        action: "Change key",
    }
}

/// "Isn't signed in" for engines with a sign-in, "needs an API key" for the rest. When
/// the program it signs in with isn't on this computer, a key is the one way, and only
/// that is said.
pub fn needs_sign_in(m: &Manifest) -> Explained {
    let names: Vec<&str> = m.keys.iter().map(|k| k.title.as_str()).collect();
    match &m.sign_in {
        Some(s) if !super::sign_in_cli_present(m) => match names.as_slice() {
            [] => Explained {
                needs: EngineNeed::Install,
                message: match &s.get {
                    Some(get) => format!("{} isn't on this computer. {get}", m.title),
                    None => format!("{} isn't on this computer.", m.title),
                },
                action: "Install",
            },
            _ => Explained {
                needs: EngineNeed::Key,
                message: format!(
                    "{} needs an API key from {} to work here.",
                    m.title,
                    super::or_list(&names)
                ),
                action: "Add a key",
            },
        },
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
        "incorrect api key",
        "invalid_api_key",
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
    let key = app.engines.key_in_use(m);
    let not_ready = |e: Explained, auth_methods| EngineCheck {
        engine: m.name.clone(),
        ready: false,
        needs: Some(e.needs),
        message: e.message,
        action: Some(e.action.into()),
        auth_methods,
    };
    // Not on this computer: say so, and download nothing.
    if readiness.needs == Some(EngineNeed::Install) {
        let message = match &readiness.how {
            Some(how) => format!("{} isn't on this computer. {how}", m.title),
            None => format!("{} isn't on this computer.", m.title),
        };
        let e = Explained {
            needs: EngineNeed::Install,
            message,
            action: "Install",
        };
        return not_ready(e, vec![]);
    }
    if let Err(e) = app.engines.install(m).await {
        return not_ready(explain(m, &Failure::other(e), key.as_deref()), vec![]);
    }
    // Each key is tried with a free call to its provider; one that is turned down is
    // named. When the provider can't be reached, the engine is still started.
    for (spec, value) in app.engines.keys_in_use(m) {
        let answer = try_key(&spec.id, &value).await;
        if answer.is_some() {
            app.engines.mark_key(m, &spec.id, &value, answer);
        }
        if answer == Some(false) {
            return not_ready(
                key_failed(&format!("That {} key didn't work.", spec.title)),
                vec![],
            );
        }
    }
    let spec = match spec_for(app, m, None) {
        Ok(spec) => spec,
        Err(f) => return not_ready(explain(m, &f, key.as_deref()), vec![]),
    };
    let cwd = engine_home(&app.home, &m.name);
    if let Err(e) = std::fs::create_dir_all(&cwd) {
        let f = Failure::other(e.to_string());
        return not_ready(explain(m, &f, key.as_deref()), vec![]);
    }
    let log = app.home.logs().join(format!("engine-{}.log", m.name));
    let (tx, _rx) = mpsc::unbounded_channel();
    // A check starts an engine process too, so it counts against WEILO_MAX_ENGINES.
    let slot = tokio::time::timeout(SLOT_WAIT, super::runner::engine_slot(app)).await;
    let Ok(_slot) = slot else {
        let e = Explained {
            needs: EngineNeed::Error,
            message: "Other agents are busy right now. Try again in a minute.".into(),
            action: "Try again",
        };
        return not_ready(e, vec![]);
    };
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
        Err(f) => not_ready(explain(m, &f, key.as_deref()), vec![]),
    }
}

/// Asks the providers again, in the background, about the engine's keys that couldn't
/// be checked yet; their state is updated when they answer. Cheap: one free call each,
/// and only for keys still unchecked.
pub fn recheck_keys(app: &Arc<App>, m: &Manifest) {
    let unchecked = app.engines.unchecked_keys(m);
    if unchecked.is_empty() {
        return;
    }
    let (app, m) = (app.clone(), m.clone());
    tokio::spawn(async move {
        let mut changed = false;
        for (provider, value) in unchecked {
            // One ask per key at a time, however many engines start.
            let Some(_claim) = app.engines.claim_recheck(&m, &provider) else {
                continue;
            };
            if let Some(answer) = try_key(&provider, &value).await {
                app.engines.mark_key(&m, &provider, &value, Some(answer));
                changed = true;
            }
        }
        if changed {
            app.hub.changed(weilo_proto::Changed::Engines);
        }
    });
}

/// How long a check waits for an engine slot when they are all taken.
const SLOT_WAIT: Duration = Duration::from_secs(60);

/// How long a provider gets to answer a key check.
const KEY_CHECK_TIMEOUT: Duration = Duration::from_secs(10);

/// Asks the provider for its list of models, which costs nothing: `Some(false)` when it
/// turns the key down, `Some(true)` when it takes it, `None` when it can't tell (no
/// answer, a provider Weilo doesn't know, or any other reply).
pub async fn try_key(provider: &str, key: &str) -> Option<bool> {
    let (default, path) = match provider {
        "anthropic" => ("https://api.anthropic.com", "/v1/models"),
        "openai" => ("https://api.openai.com", "/v1/models"),
        "google" => (
            "https://generativelanguage.googleapis.com",
            "/v1beta/models",
        ),
        _ => return None,
    };
    // Tests point this at a stand-in provider.
    let base = std::env::var(format!("WEILO_PROVIDER_URL_{}", provider.to_uppercase()))
        .unwrap_or_else(|_| default.into());
    let client = reqwest::Client::builder()
        .timeout(KEY_CHECK_TIMEOUT)
        .build()
        .ok()?;
    let request = client.get(format!("{}{path}", base.trim_end_matches('/')));
    let request = match provider {
        "anthropic" => request
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"),
        "openai" => request.bearer_auth(key),
        _ => request.header("x-goog-api-key", key),
    };
    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::info!("couldn't reach {provider} to check a key: {e}");
            return None;
        }
    };
    let status = response.status().as_u16();
    match status {
        200..=299 => Some(true),
        401 | 403 => Some(false),
        // Google answers a bad key with 400 and says so in the body.
        400 => {
            let body = response.text().await.unwrap_or_default();
            body.contains("API_KEY_INVALID").then_some(false)
        }
        _ => None,
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
    fn a_saved_key_that_fails_is_named() {
        let f = Failure {
            auth_required: true,
            ..Failure::default()
        };
        let e = explain(&manifest("pi"), &f, Some("Anthropic"));
        assert_eq!(e.needs, EngineNeed::Key);
        assert_eq!(e.message, "Your Anthropic key didn't work.");
        assert_eq!(e.action, "Change key");
        let f = Failure::other("401 invalid x-api-key");
        let e = explain(&manifest("claude-code"), &f, Some("Anthropic"));
        assert_eq!(e.message, "Your Anthropic key didn't work.");
    }

    #[test]
    fn missing_gemini_says_it_isnt_installed() {
        let f = Failure {
            missing_program: true,
            text: "couldn't start gemini: No such file or directory".into(),
            ..Failure::default()
        };
        let e = explain(&manifest("gemini"), &f, None);
        assert_eq!(e.needs, EngineNeed::Install);
        assert!(e.message.starts_with("Gemini CLI isn't on this computer."));
        assert_eq!(e.action, "Install");
    }

    #[test]
    fn sign_in_errors_ask_to_sign_in_and_pi_asks_for_a_key() {
        let f = Failure::other("Invalid API key · Please run /login");
        let mut claude = manifest("claude-code");
        // Its sign-in program is here (any program that is will do).
        claude.sign_in.as_mut().unwrap().command = Some("sh".into());
        let e = explain(&claude, &f, None);
        assert_eq!((e.needs, e.action), (EngineNeed::SignIn, "Sign in"));
        assert_eq!(
            e.message,
            "Claude Code isn't signed in. Open Terminal, run `claude` and sign in."
        );
        let f = Failure {
            auth_required: true,
            ..Failure::default()
        };
        assert_eq!(explain(&manifest("pi"), &f, None).action, "Add a key");
    }

    #[test]
    fn without_its_sign_in_program_only_a_key_is_offered() {
        let mut claude = manifest("claude-code");
        claude.sign_in.as_mut().unwrap().command = Some("weilo-no-such-program".into());
        let e = needs_sign_in(&claude);
        assert_eq!((e.needs, e.action), (EngineNeed::Key, "Add a key"));
        assert_eq!(
            e.message,
            "Claude Code needs an API key from Anthropic to work here."
        );
        assert!(!e.message.contains("Terminal"));
    }

    #[test]
    fn a_slow_download_says_so() {
        let e = explain(
            &manifest("pi"),
            &Failure::other(super::super::INSTALL_TIMED_OUT),
            None,
        );
        assert_eq!(e.action, "Try again");
        assert!(
            e.message
                .starts_with("Downloading Weilo's built-in AI took too long.")
        );
    }

    #[test]
    fn no_npm_needs_node() {
        let e = explain(
            &manifest("codex"),
            &Failure::other(super::super::NO_NPM),
            None,
        );
        assert_eq!((e.needs, e.action), (EngineNeed::Node, "Install"));
    }

    #[test]
    fn other_errors_keep_the_whole_message_on_one_line() {
        let f = Failure::other(
            "Request failed for the OAuth provider.: {\n  \"error\": \"overloaded\"\n}",
        );
        let e = explain(&manifest("codex"), &f, None);
        assert_eq!(e.action, "Try again");
        assert_eq!(
            e.message,
            "Codex hit a problem: Request failed for the OAuth provider.: { \"error\": \"overloaded\" }"
        );
        assert!(one_line(&"x".repeat(400), 300).ends_with('…'));
    }
}
