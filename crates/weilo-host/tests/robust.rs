//! End-to-end: a real host when things go wrong. Stops that time out, engines that hang
//! or forget, crashes and restarts, slow devices, and what people may and may not do.

mod common;

use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use common::{Client, Host, agent_text, eventually, is_state, pid_alive, send, setup_with_echo};
use uuid::Uuid;
use weilo_proto::{
    ApprovalState, Call, CallResult, CallValue, Card, ClientFrame, Decision, Delta, EngineNeed,
    EventBody, FileChange, SendWhen, ServerFrame, WorkState,
};

fn problem(f: &ServerFrame) -> Option<(&str, Option<&str>)> {
    match f {
        ServerFrame::Ev { event, .. } => match &event.body {
            EventBody::Problem {
                message, action, ..
            } => Some((message, action.as_deref())),
            _ => None,
        },
        _ => None,
    }
}

/// A problem's code and engine.
fn problem_kind(f: &ServerFrame) -> (Option<&str>, Option<&str>) {
    match f {
        ServerFrame::Ev { event, .. } => match &event.body {
            EventBody::Problem { code, engine, .. } => (code.as_deref(), engine.as_deref()),
            _ => (None, None),
        },
        _ => (None, None),
    }
}

/// Echo's "helper" reply: the pid of the background process it started.
async fn start_helper(c: &mut Client, thread: Uuid) -> i32 {
    send(c, thread, "start a helper").await;
    let f = c
        .next(|f| agent_text(f).is_some_and(|t| t.starts_with("Helper ")))
        .await;
    let pid = agent_text(&f).unwrap()["Helper ".len()..].trim_end_matches('.');
    let pid: i32 = pid.parse().unwrap();
    assert!(pid_alive(pid));
    c.next(|f| is_state(f, WorkState::Idle)).await;
    pid
}

#[tokio::test]
async fn engine_helpers_end_when_the_engine_idles_and_at_shutdown() {
    let Some(mut host) = Host::start_with(&[("WEILO_ENGINE_IDLE_SECS", "1")]).await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;

    // The engine's own children go with it when it idles out.
    let pid = start_helper(&mut c, thread).await;
    eventually("the idle engine's helper to end", || !pid_alive(pid)).await;

    // And when Weilo stops.
    let pid = start_helper(&mut c, thread).await;
    host.stop();
    eventually("the helper to end at shutdown", || !pid_alive(pid)).await;
}

#[tokio::test]
async fn stop_that_times_out_then_send() {
    let Some(host) = Host::start_with(&[("WEILO_STOP_GRACE_SECS", "1")]).await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    send(&mut c, thread, "slow and stubborn").await;
    c.next(|f| matches!(f, ServerFrame::Delta { .. })).await;
    c.ok(Call::Stop { thread_id: thread }).await;
    // Right away, before the stubborn engine has been dealt with.
    send(&mut c, thread, "hi").await;
    c.next(|f| agent_text(f) == Some("You said: hi")).await;
    // Nothing from the stopped reply arrives after it.
    c.next(|f| is_state(f, WorkState::Idle)).await;
    tokio::time::sleep(Duration::from_secs(3)).await;
    c.sub(thread, 0).await;
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    let last = snap
        .threads
        .iter()
        .find(|t| t.id == thread)
        .unwrap()
        .last_seq;
    let mut texts = Vec::new();
    let mut c2 = Client::connect(&host, Some(&host.pair().await))
        .await
        .unwrap();
    c2.sub(thread, 0).await;
    loop {
        let f = c2.next(|f| matches!(f, ServerFrame::Ev { .. })).await;
        let ServerFrame::Ev { event, .. } = &f else {
            unreachable!()
        };
        if let Some(t) = agent_text(&f) {
            texts.push(t.to_string());
        }
        if event.seq == last {
            break;
        }
    }
    assert_eq!(texts.last().map(String::as_str), Some("You said: hi"));
    assert!(
        !texts.iter().any(|t| t == "You said: slow and stubborn"),
        "{texts:?}"
    );
}

#[tokio::test]
async fn a_silent_engine_is_called_stuck() {
    let Some(host) = Host::start_with(&[("WEILO_ENGINE_HANG_SECS", "2")]).await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    send(&mut c, thread, "hang").await;
    let f = c.next(|f| problem(f).is_some()).await;
    assert_eq!(
        problem(&f),
        Some((
            "Echo stopped responding, so this reply stopped.",
            Some("Try again")
        ))
    );
    assert_eq!(problem_kind(&f), (Some("not_responding"), Some("echo")));
    c.next(|f| is_state(f, WorkState::Idle)).await;
    // The next message works.
    send(&mut c, thread, "hello").await;
    c.next(|f| agent_text(f) == Some("You said: hello")).await;
}

#[tokio::test]
async fn instructions_reach_the_engine_and_survive_a_restart() {
    let Some(host) = Host::start_with(&[("WEILO_ENGINE_IDLE_SECS", "1")]).await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    let agent_id = snap.agents[0].id;
    c.ok(Call::UpdateAgent {
        agent_id,
        name: None,
        model: None,
        instructions: Some("Answer like a pirate.".into()),
        engine: None,
    })
    .await;
    c.sub(thread, 0).await;
    send(&mut c, thread, "who are you").await;
    let f = c
        .next(|f| agent_text(f).is_some_and(|t| t.starts_with("I was told")))
        .await;
    let told = agent_text(&f).unwrap();
    assert!(
        told.contains("Ava") && told.contains("Answer like a pirate."),
        "{told}"
    );

    // The engine idles out; the next message loads the same conversation.
    c.next(|f| is_state(f, WorkState::Idle)).await;
    tokio::time::sleep(Duration::from_millis(2500)).await;
    send(&mut c, thread, "who are you").await;
    let f = c
        .next(|f| {
            agent_text(f).is_some_and(|t| t.starts_with("I was told")) || problem(f).is_some()
        })
        .await;
    assert!(problem(&f).is_none(), "{f:?}");
    assert!(agent_text(&f).unwrap().contains("Answer like a pirate."));
}

#[tokio::test]
async fn an_engine_that_cant_continue_says_it_started_fresh() {
    let env = [("WEILO_ENGINE_IDLE_SECS", "1"), ("WEILO_ECHO_NO_LOAD", "1")];
    let Some(host) = Host::start_with(&env).await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    send(&mut c, thread, "hi").await;
    c.next(|f| agent_text(f) == Some("You said: hi")).await;
    c.next(|f| is_state(f, WorkState::Idle)).await;
    tokio::time::sleep(Duration::from_millis(2500)).await;
    send(&mut c, thread, "hi again").await;
    let f = c.next(|f| problem(f).is_some()).await;
    assert_eq!(
        problem(&f).unwrap().0,
        "Ava started a fresh conversation; earlier messages aren't in its memory."
    );
    c.next(|f| agent_text(f) == Some("You said: hi again"))
        .await;
}

#[tokio::test]
async fn always_allow_is_kept_by_weilo_not_the_engine() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    send(&mut c, thread, "approve the checks").await;
    let card = c.next(|f| matches!(f, ServerFrame::Ev { event, .. } if matches!(event.body, EventBody::Card { .. }))).await;
    let ServerFrame::Ev { event, .. } = card else {
        unreachable!()
    };
    let EventBody::Card { card } = event.body else {
        unreachable!()
    };
    let always = card
        .actions
        .iter()
        .find_map(|a| match &a.decision {
            Some(d @ Decision::AllowAlways { .. }) => Some(d.clone()),
            _ => None,
        })
        .expect("an always action");
    c.ok(Call::Decide {
        approval_id: card.approval_id.unwrap(),
        decision: always,
    })
    .await;
    // The engine is only ever told "allow once".
    c.next(|f| agent_text(f) == Some("Allowed.")).await;
    c.next(|f| is_state(f, WorkState::Idle)).await;

    // The same command again: Weilo answers for the person, and still says "once".
    send(&mut c, thread, "approve the checks").await;
    let f = c
        .next(|f| {
            matches!(agent_text(f), Some("Allowed." | "Always allowed."))
                || matches!(f, ServerFrame::Ev { event, .. } if matches!(event.body, EventBody::Card { .. }))
        })
        .await;
    assert_eq!(agent_text(&f), Some("Allowed."), "{f:?}");
}

#[tokio::test]
async fn a_second_up_says_where_weilo_runs() {
    let Some(host) = Host::start().await else {
        return;
    };
    let out = host.second_up();
    assert!(!out.status.success());
    let err = String::from_utf8_lossy(&out.stderr);
    assert!(
        err.contains(&format!(
            "Weilo is already running at http://127.0.0.1:{}",
            host.port
        )),
        "{err}"
    );
    // The first one is unharmed.
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;
}

#[tokio::test]
async fn postgres_comes_back_after_a_crash() {
    let Some(host) = Host::start().await else {
        return;
    };
    let token = host.pair().await;
    let mut c = Client::connect(&host, Some(&token)).await.unwrap();
    let thread = setup_with_echo(&mut c).await;
    let pid = host.postgres_pid().expect("postgres pid");
    // SAFETY: killing the test host's Postgres.
    unsafe {
        libc::kill(pid, libc::SIGKILL);
    }
    // Devices hear that it's restarting (or, if they were reading, are asked to
    // subscribe again).
    match c
        .try_next(|f| matches!(f, ServerFrame::Status { ok: false, .. }))
        .await
    {
        Ok(f) => assert!(matches!(
            f,
            ServerFrame::Status {
                message: Some(_),
                ..
            }
        )),
        Err(e) => assert!(e.contains("4008"), "{e}\n{}", host.log()),
    }
    eventually("Postgres to come back", || {
        host.postgres_pid().is_some_and(|p| p != pid) && host.log().contains("Postgres is back")
    })
    .await;
    let mut c = Client::connect(&host, Some(&token)).await.unwrap();
    c.sub(thread, 0).await;
    send(&mut c, thread, "still there?").await;
    c.next(|f| agent_text(f) == Some("You said: still there?"))
        .await;
}

#[tokio::test]
async fn a_reply_starts_its_pieces_again_when_someone_writes_mid_reply() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    send(&mut c, thread, "slow please").await;
    let first = c.next(|f| matches!(f, ServerFrame::Delta { .. })).await;
    let ServerFrame::Delta {
        after_seq: pinned, ..
    } = first
    else {
        unreachable!()
    };
    let call = Call::Send {
        thread_id: thread,
        text: "and also this".into(),
        when: SendWhen::Now,
    };
    c.ok(call).await;

    // Deltas, as an app keeps them: pieces under each after_seq, dropped by newer events.
    let mut pieces: std::collections::BTreeMap<i64, std::collections::BTreeMap<i64, String>> =
        Default::default();
    pieces.entry(pinned).or_default();
    let mut repinned = false;
    let message = loop {
        let f = c
            .next(|f| matches!(f, ServerFrame::Delta { .. } | ServerFrame::Ev { .. }))
            .await;
        match f {
            ServerFrame::Delta {
                after_seq,
                sub_seq,
                delta: Delta::AgentText { text },
                ..
            } => {
                if after_seq == pinned {
                    continue;
                }
                assert!(after_seq > pinned);
                if !repinned {
                    assert_eq!(sub_seq, 0);
                    // The whole text so far, from the start.
                    assert!(
                        text.len() > 1 && "You said: slow please".starts_with(&text),
                        "{text}"
                    );
                    repinned = true;
                }
                pieces.entry(after_seq).or_default().insert(sub_seq, text);
            }
            ServerFrame::Ev { event, .. } => {
                if let EventBody::AgentMessage { text, .. } = &event.body {
                    break text.clone();
                }
                pieces.retain(|k, _| *k >= event.seq);
            }
            _ => unreachable!(),
        }
    };
    assert!(repinned);
    let (_, newest) = pieces.iter().next_back().unwrap();
    let shown: String = newest.values().cloned().collect();
    assert_eq!(shown, message);
}

#[tokio::test]
async fn a_long_chat_opens_on_a_slow_device() {
    let Some(mut host) = Host::start().await else {
        return;
    };
    let token = host.pair().await;
    let mut c = Client::connect(&host, Some(&token)).await.unwrap();
    let thread = setup_with_echo(&mut c).await;
    drop(c);
    // 2,500 stored events: more than a device's queue holds (16 here).
    sqlx::query(
        "INSERT INTO events (thread_id, seq, space_id, source, tainted, kind, body)
         SELECT t.id, t.last_seq + g, t.space_id, 'agent', false, 'agent_message',
                jsonb_build_object('kind', 'agent_message', 'text', 'line ' || g,
                                   'agent_id', NULL)
         FROM threads t, generate_series(1, 2500) g WHERE t.id = $1",
    )
    .bind(thread)
    .execute(&mut host.db().await)
    .await
    .unwrap();
    let last: i64 = sqlx::query_scalar(
        "UPDATE threads SET last_seq = last_seq + 2500 WHERE id = $1 RETURNING last_seq",
    )
    .bind(thread)
    .fetch_one(&mut host.db().await)
    .await
    .unwrap();
    host.restart_with(&[("WEILO_WS_QUEUE", "16")]).await;
    let mut d = Client::connect(&host, Some(&token)).await.unwrap();
    d.sub(thread, 0).await;
    let mut seen = 0;
    while seen < last {
        let f = d
            .try_next(|f| matches!(f, ServerFrame::Ev { .. }))
            .await
            .unwrap_or_else(|e| panic!("after seq {seen}: {e}"));
        let ServerFrame::Ev { event, .. } = f else {
            unreachable!()
        };
        assert_eq!(event.seq, seen + 1);
        seen = event.seq;
    }
}

#[tokio::test]
async fn a_call_cut_off_by_a_crash_answers_unknown() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;
    let call_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO call_results (device_id, call_id, result, running) VALUES ($1, $2, 'null', true)",
    )
    .bind(c.device_id)
    .bind(call_id)
    .execute(&mut host.db().await)
    .await
    .unwrap();
    let result = c
        .call_with_id(
            call_id,
            Call::CreateChannel {
                title: "Twice?".into(),
            },
        )
        .await;
    assert!(
        matches!(&result, CallResult::Failed { error } if error.code == "unknown"),
        "{result:?}"
    );
}

#[tokio::test]
async fn a_crash_closes_waiting_approvals_and_stops_work() {
    let Some(mut host) = Host::start().await else {
        return;
    };
    let token = host.pair().await;
    let mut c = Client::connect(&host, Some(&token)).await.unwrap();
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    send(&mut c, thread, "approve it").await;
    c.next(|f| is_state(f, WorkState::NeedsYou)).await;
    drop(c);

    host.crash_and_restart().await;
    let mut c = Client::connect(&host, Some(&token)).await.unwrap();
    let CallValue::NeedsYou(items) = c.ok(Call::NeedsYou).await else {
        panic!()
    };
    assert_eq!(items[0].state, ApprovalState::Denied);
    c.sub(thread, 0).await;
    c.next(|f| matches!(f, ServerFrame::Ev { event, .. } if matches!(&event.body, EventBody::ApprovalDecided { via, .. } if via == "interrupted")))
        .await;
    let f = c.next(|f| problem(f).is_some()).await;
    assert_eq!(
        problem(&f),
        Some((
            "Weilo restarted while this was working, so it stopped.",
            Some("Try again")
        ))
    );
    assert_eq!(problem_kind(&f), (Some("restarted"), None));
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    let t = snap.threads.iter().find(|t| t.id == thread).unwrap();
    assert_eq!(t.state, WorkState::Idle);
    // And it works again.
    send(&mut c, thread, "back").await;
    c.next(|f| agent_text(f) == Some("You said: back")).await;
}

#[tokio::test]
async fn pairing_gives_the_token_in_the_body_only() {
    let Some(host) = Host::start().await else {
        return;
    };
    let http = reqwest::Client::new();
    let res = http
        .post(host.url("/api/pair"))
        .json(&serde_json::json!({ "code": host.pairing_code() }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    assert!(res.headers().get("set-cookie").is_none());
    let body: serde_json::Value = res.json().await.unwrap();
    let token = body["token"].as_str().unwrap().to_string();
    Client::connect(&host, Some(&token)).await.unwrap();

    // The cookie older versions kept is traded once for a new token; the old one ends.
    let trade = || {
        http.post(host.url("/api/token"))
            .header("cookie", format!("weilo_device={token}"))
            .send()
    };
    let res = trade().await.unwrap();
    assert_eq!(res.status(), 200);
    let cleared = res.headers()["set-cookie"].to_str().unwrap().to_string();
    assert!(cleared.starts_with("weilo_device=;") && cleared.contains("Max-Age=0"));
    let body: serde_json::Value = res.json().await.unwrap();
    let new = body["token"].as_str().unwrap().to_string();
    assert_ne!(new, token);
    assert_eq!(trade().await.unwrap().status(), 401);
    assert_eq!(
        Client::connect(&host, Some(&token)).await.err(),
        Some(Some(4401))
    );
    Client::connect(&host, Some(&new)).await.unwrap();
}

#[tokio::test]
async fn app_routes_load_the_app() {
    let web = tempfile::tempdir().unwrap();
    std::fs::write(web.path().join("index.html"), "<p>the app</p>").unwrap();
    let dir = web.path().display().to_string();
    let Some(host) = Host::start_with(&[("WEILO_WEB", &dir)]).await else {
        return;
    };
    for path in ["/", "/pair", "/s/some-thread"] {
        let res = reqwest::get(host.url(path)).await.unwrap();
        assert_eq!(res.status(), 200, "{path}");
        assert!(res.text().await.unwrap().contains("the app"));
    }
    let res = reqwest::get(host.url("/api/nothing")).await.unwrap();
    assert_eq!(res.status(), 404);
}

#[tokio::test]
async fn session_folders_are_checked_and_changes_come_back() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;
    let start = |folder: String| Call::StartSession {
        folder,
        engine: "echo".into(),
        title: Some("Fix checkout".into()),
        channel_id: None,
        agent_id: None,
        task: None,
    };

    // Weilo's own folder, and the whole home folder, are off limits.
    let mut refused = vec![host.home.join("engines").display().to_string()];
    if let Some(home) = std::env::var_os("HOME") {
        refused.push(home.to_string_lossy().into_owned());
    }
    for folder in refused {
        let r = c.call(start(folder.clone())).await;
        assert!(
            matches!(&r, CallResult::Failed { error } if error.code == "invalid"),
            "{folder}: {r:?}"
        );
    }

    // A plain folder works, and says changes go straight in.
    let plain = host.dir().join("notes");
    std::fs::create_dir(&plain).unwrap();
    let CallValue::Thread(t) = c.ok(start(plain.display().to_string())).await else {
        panic!()
    };
    assert_eq!(t.worktree, None);
    c.sub(t.id, 0).await;
    let f = c.next(|f| problem(f).is_some()).await;
    assert_eq!(
        problem(&f).unwrap().0,
        "This folder isn't a git repo, so changes go straight into it."
    );
    assert_eq!(problem_kind(&f).0, Some("not_git"));

    // A git repo gets a worktree on its own branch, and the changes can come back.
    let repo = host.dir().join("shop");
    std::fs::create_dir(&repo).unwrap();
    let git = |args: &[&str]| {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["-c", "user.email=t@t", "-c", "user.name=t"])
            .args(args)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}");
    };
    git(&["init", "-q"]);
    git(&["commit", "-q", "--allow-empty", "-m", "start"]);
    let CallValue::Thread(t) = c.ok(start(repo.display().to_string())).await else {
        panic!()
    };
    let worktree = t.worktree.clone().expect("a worktree");
    assert_eq!(t.branch.as_deref(), Some("weilo/fix-checkout"));
    std::fs::write(std::path::Path::new(&worktree).join("cart.txt"), "fixed\n").unwrap();
    let CallValue::Message(said) = c.ok(Call::MergeSession { thread_id: t.id }).await else {
        panic!()
    };
    assert_eq!(said, "Brought the session's changes into shop.");
    assert_eq!(
        std::fs::read_to_string(repo.join("cart.txt")).unwrap(),
        "fixed\n"
    );
    let again = c.ok(Call::MergeSession { thread_id: t.id }).await;
    assert!(
        matches!(&again, CallValue::Message(m) if m == "There's nothing new to bring back."),
        "{again:?}"
    );
}

#[tokio::test]
async fn engine_keys_stay_private() {
    // The provider can't be reached (the key is saved, not checked yet), and saving a
    // key starts a download, here from a stand-in npm.
    let tools = tempfile::Builder::new()
        .prefix("weilo-npm-")
        .tempdir_in("/tmp")
        .unwrap();
    let bin = fake_npm_for(tools.path(), "pi-acp");
    let path = format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let Some(host) = Host::start_with(&[
        ("PATH", &path),
        ("WEILO_PROVIDER_URL_ANTHROPIC", "http://127.0.0.1:9"),
    ])
    .await
    else {
        return;
    };
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;
    let secret = "sk-test-not-a-real-key-123";
    let result = c
        .call(Call::SetEngineKey {
            engine: "pi".into(),
            provider: "anthropic".into(),
            key: secret.into(),
        })
        .await;
    assert!(!format!("{result:?}").contains(secret));
    let CallResult::Done {
        value: CallValue::Engines(engines),
    } = result
    else {
        panic!("{result:?}")
    };
    let pi = engines.iter().find(|e| e.id == "pi").unwrap();
    let anthropic = pi
        .key_providers
        .as_ref()
        .unwrap()
        .iter()
        .find(|k| k.id == "anthropic")
        .unwrap();
    assert!(anthropic.has_key);
    let file = host.home.join("secrets/keys-pi.json");
    assert_eq!(
        std::fs::metadata(&file).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let audit: Vec<serde_json::Value> =
        sqlx::query_scalar("SELECT detail FROM audit WHERE action = 'engine.set_key'")
            .fetch_all(&mut host.db().await)
            .await
            .unwrap();
    assert_eq!(audit.len(), 1);
    assert!(!audit[0].to_string().contains(secret));
    assert!(!host.log().contains(secret));

    // A provider the engine doesn't use is refused.
    let wrong = c
        .call(Call::SetEngineKey {
            engine: "pi".into(),
            provider: "nobody".into(),
            key: secret.into(),
        })
        .await;
    assert!(matches!(wrong, CallResult::Failed { error } if error.code == "invalid"));
}

#[tokio::test]
async fn setup_and_checks_say_whether_an_engine_works() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    let value = c
        .ok(Call::FinishSetup {
            engine: "echo".into(),
            keep_awake: false,
        })
        .await;
    let CallValue::Setup(setup) = value else {
        panic!()
    };
    let check = setup.check.expect("a check");
    assert!(check.ready, "{check:?}");

    if installed("gemini") {
        return;
    }
    let CallValue::EngineCheck(check) = c
        .ok(Call::CheckEngine {
            engine: "gemini".into(),
        })
        .await
    else {
        panic!()
    };
    assert!(!check.ready);
    assert_eq!(check.needs, Some(EngineNeed::Install));
    assert!(
        check
            .message
            .starts_with("Gemini CLI isn't on this computer."),
        "{}",
        check.message
    );
}

fn installed(program: &str) -> bool {
    weilo_host::keep_awake::which(program).is_some()
}

#[tokio::test]
async fn agents_can_change_engine_and_be_archived() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    let ava = snap.agents[0].id;
    let CallValue::Agent(a) = c
        .ok(Call::UpdateAgent {
            agent_id: ava,
            name: None,
            model: None,
            instructions: None,
            engine: Some("pi".into()),
        })
        .await
    else {
        panic!()
    };
    assert_eq!(a.engine, "pi");
    let bad = c
        .call(Call::UpdateAgent {
            agent_id: ava,
            name: None,
            model: None,
            instructions: None,
            engine: Some("no-such-engine".into()),
        })
        .await;
    assert!(matches!(bad, CallResult::Failed { error } if error.code == "invalid"));
    c.ok(Call::ArchiveAgent { agent_id: ava }).await;
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    assert!(snap.agents.is_empty());
    assert!(snap.threads.iter().all(|t| t.agent_id != Some(ava)));
}

/// The first card that arrives.
async fn next_card(c: &mut Client) -> Card {
    let f = c.next(|f| matches!(f, ServerFrame::Ev { event, .. } if matches!(event.body, EventBody::Card { .. }))).await;
    match f {
        ServerFrame::Ev { event, .. } => match event.body {
            EventBody::Card { card } => card,
            _ => unreachable!(),
        },
        _ => unreachable!(),
    }
}

fn failed_with(r: &CallResult, code: &str) -> Option<String> {
    match r {
        CallResult::Failed { error } if error.code == code => Some(error.message.clone()),
        _ => None,
    }
}

#[tokio::test]
async fn changed_instructions_reach_a_conversation_under_way() {
    let Some(host) = Host::start_with(&[("WEILO_ENGINE_IDLE_SECS", "600")]).await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    let agent_id = snap.agents[0].id;
    c.sub(thread, 0).await;
    send(&mut c, thread, "hi").await;
    c.next(|f| agent_text(f) == Some("You said: hi")).await;
    c.next(|f| is_state(f, WorkState::Idle)).await;
    c.ok(Call::UpdateAgent {
        agent_id,
        name: None,
        model: None,
        instructions: Some("Answer like a pirate.".into()),
        engine: None,
    })
    .await;
    send(&mut c, thread, "who are you").await;
    let f = c
        .next(|f| agent_text(f).is_some_and(|t| t.starts_with("I was told")))
        .await;
    let told = agent_text(&f).unwrap();
    assert!(told.contains("Answer like a pirate."), "{told}");
    c.next(|f| is_state(f, WorkState::Idle)).await;

    // Told once: the next message carries only itself.
    send(&mut c, thread, "hello").await;
    c.next(|f| agent_text(f) == Some("You said: hello")).await;
    c.next(|f| is_state(f, WorkState::Idle)).await;
    send(&mut c, thread, "who are you").await;
    let f = c
        .next(|f| agent_text(f).is_some_and(|t| t.starts_with("I was told")))
        .await;
    assert!(agent_text(&f).unwrap().contains("pirate"));
}

#[tokio::test]
async fn an_engine_that_dies_closes_its_waiting_cards() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    let pid = start_helper(&mut c, thread).await;
    // SAFETY: asking for the group of a process this test's host started.
    let pgid = unsafe { libc::getpgid(pid) };
    send(&mut c, thread, "approve the checks").await;
    let card = next_card(&mut c).await;
    c.next(|f| is_state(f, WorkState::NeedsYou)).await;
    // SAFETY: killing the engine's group, as a crash of the engine would.
    unsafe { libc::kill(-pgid, libc::SIGKILL) };
    c.next(|f| matches!(f, ServerFrame::Ev { event, .. } if matches!(&event.body, EventBody::ApprovalDecided { via, .. } if via == "interrupted")))
        .await;
    c.next(|f| is_state(f, WorkState::Idle)).await;
    let CallValue::NeedsYou(items) = c.ok(Call::NeedsYou).await else {
        panic!()
    };
    assert!(items.iter().all(|i| i.state != ApprovalState::Pending));
    let item = items
        .iter()
        .find(|i| Some(i.approval_id) == card.approval_id)
        .unwrap();
    assert_eq!(item.state, ApprovalState::Denied);
    let late = c
        .call(Call::Decide {
            approval_id: card.approval_id.unwrap(),
            decision: Decision::Allow,
        })
        .await;
    assert!(failed_with(&late, "conflict").is_some(), "{late:?}");
}

#[tokio::test]
async fn engine_helpers_end_after_a_host_crash() {
    let Some(mut host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    let pid = start_helper(&mut c, thread).await;
    drop(c);
    host.crash_and_restart().await;
    eventually("the helper left by the crash to end", || !pid_alive(pid)).await;
}

#[tokio::test]
async fn a_saved_key_reaches_the_engine() {
    let Some(mut host) = Host::start().await else {
        return;
    };
    host.add_engine(
        "keyed",
        serde_json::json!({
            "apiVersion": 1, "kind": "engine", "name": "keyed", "title": "Keyed",
            "command": ["{self}", "engine", "echo"],
            "env": { "WEILO_ECHO_STATE": "{engine_home}" },
            "keys": [{ "id": "test", "title": "Test", "env": "WEILO_ECHO_KEY" }],
            "hidden": true, "bindsApprovals": true
        }),
    );
    host.restart_with(&[]).await;
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    c.ok(Call::UpdateAgent {
        agent_id: snap.agents[0].id,
        name: None,
        model: None,
        instructions: None,
        engine: Some("keyed".into()),
    })
    .await;
    let set_key = |key: &str| Call::SetEngineKey {
        engine: "keyed".into(),
        provider: "test".into(),
        key: key.into(),
    };
    c.sub(thread, 0).await;

    // No key: the turn fails asking for one.
    send(&mut c, thread, "check the key").await;
    let f = c.next(|f| problem(f).is_some()).await;
    assert_eq!(
        problem(&f),
        Some(("Keyed needs an API key to work.", Some("Add a key")))
    );
    assert_eq!(problem_kind(&f).0, Some("needs_key"));
    c.next(|f| is_state(f, WorkState::Idle)).await;
    // The key is saved, and Try again uses it.
    c.ok(set_key("k1")).await;
    send(&mut c, thread, "check the key").await;
    c.next(|f| agent_text(f) == Some("Key is set.")).await;
    c.next(|f| is_state(f, WorkState::Idle)).await;
    // A running engine hears of a changed key too.
    c.ok(set_key("")).await;
    send(&mut c, thread, "check the key").await;
    let f = c
        .next(|f| problem(f).is_some() || agent_text(f) == Some("Key is set."))
        .await;
    assert!(
        problem(&f).is_some(),
        "the engine kept the removed key: {f:?}"
    );
}

#[tokio::test]
async fn bring_back_waits_for_the_session_to_finish() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;
    let repo = host.dir().join("shop");
    std::fs::create_dir(&repo).unwrap();
    let git = |args: &[&str]| {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["-c", "user.email=t@t", "-c", "user.name=t"])
            .args(args)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}");
    };
    git(&["init", "-q"]);
    git(&["commit", "-q", "--allow-empty", "-m", "start"]);
    // Signing and hooks would get in the way of Weilo's own commits; they're skipped.
    git(&["config", "commit.gpgsign", "true"]);
    git(&["config", "gpg.program", "false"]);
    let hook = repo.join(".git/hooks/pre-commit");
    std::fs::write(&hook, "#!/bin/sh\nexit 1\n").unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    let CallValue::Thread(t) = c
        .ok(Call::StartSession {
            folder: repo.display().to_string(),
            engine: "echo".into(),
            title: Some("Fix cart".into()),
            channel_id: None,
            agent_id: None,
            task: None,
        })
        .await
    else {
        panic!()
    };
    c.sub(t.id, 0).await;
    let worktree = std::path::PathBuf::from(t.worktree.clone().unwrap());
    std::fs::write(worktree.join("cart.txt"), "fixed\n").unwrap();
    send(&mut c, t.id, "hang").await;
    c.next(|f| is_state(f, WorkState::Working)).await;
    let r = c.call(Call::MergeSession { thread_id: t.id }).await;
    assert_eq!(
        failed_with(&r, "conflict").as_deref(),
        Some("The session is still working. Wait for it to finish, then try again.")
    );
    assert!(!repo.join("cart.txt").exists());
    c.ok(Call::Stop { thread_id: t.id }).await;
    c.next(|f| is_state(f, WorkState::Idle)).await;
    let CallValue::Message(said) = c.ok(Call::MergeSession { thread_id: t.id }).await else {
        panic!()
    };
    assert_eq!(said, "Brought the session's changes into shop.");
    assert!(repo.join("cart.txt").exists());
}

/// A stand-in `npm` that "downloads" an engine running echo, noting each run. With a
/// `slow` file beside it, it takes 30 s.
fn fake_npm(dir: &std::path::Path) -> std::path::PathBuf {
    fake_npm_for(dir, "fake-acp")
}

/// Like `fake_npm`, with the engine's program named `program`.
fn fake_npm_for(dir: &std::path::Path, program: &str) -> std::path::PathBuf {
    let bin = dir.join("fakebin");
    std::fs::create_dir_all(&bin).unwrap();
    let script = format!(
        "#!/bin/sh\n\
         echo \"$*\" >> {runs}\n\
         if [ -f {slow} ]; then sleep 30; fi\n\
         sleep 1\n\
         mkdir -p node_modules/.bin\n\
         printf '#!/bin/sh\\nexec {weilo} engine echo\\n' > node_modules/.bin/{program}\n\
         chmod +x node_modules/.bin/{program}\n",
        runs = dir.join("npm-runs").display(),
        slow = dir.join("slow").display(),
        weilo = env!("CARGO_BIN_EXE_weilo"),
    );
    std::fs::write(bin.join("npm"), script).unwrap();
    std::fs::set_permissions(bin.join("npm"), std::fs::Permissions::from_mode(0o755)).unwrap();
    bin
}

fn npm_runs(dir: &std::path::Path) -> usize {
    std::fs::read_to_string(dir.join("npm-runs"))
        .unwrap_or_default()
        .lines()
        .count()
}

#[tokio::test]
async fn engine_downloads_happen_once_and_can_be_stopped() {
    let Some(mut host) = Host::start().await else {
        return;
    };
    let dir = host.dir().to_path_buf();
    let bin = fake_npm(&dir);
    host.add_engine(
        "fetched",
        serde_json::json!({
            "apiVersion": 1, "kind": "engine", "name": "fetched", "title": "Fetched",
            "install": { "npm": ["fake-acp@1.0.0"] },
            "command": ["{install}/node_modules/.bin/fake-acp"],
            "env": { "WEILO_ECHO_STATE": "{engine_home}" },
            "hidden": true, "bindsApprovals": true
        }),
    );
    let path = format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    host.restart_with(&[("PATH", &path), ("WEILO_INSTALL_TIMEOUT_SECS", "4")])
        .await;
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    c.ok(Call::UpdateAgent {
        agent_id: snap.agents[0].id,
        name: None,
        model: None,
        instructions: None,
        engine: Some("fetched".into()),
    })
    .await;
    c.sub(thread, 0).await;
    let installing = |f: &ServerFrame, want: weilo_proto::StepStatus| matches!(f, ServerFrame::Ev { event, .. } if matches!(&event.body, EventBody::Step { title, status, .. } if title == "Installing Fetched" && *status == want));

    // Stop works while it downloads.
    std::fs::write(dir.join("slow"), "").unwrap();
    send(&mut c, thread, "hi").await;
    c.next(|f| installing(f, weilo_proto::StepStatus::Running))
        .await;
    c.ok(Call::Stop { thread_id: thread }).await;
    c.next(|f| installing(f, weilo_proto::StepStatus::Failed))
        .await;
    c.next(|f| is_state(f, WorkState::Idle)).await;

    // A download that takes too long says so.
    send(&mut c, thread, "hi").await;
    let f = c.next(|f| problem(f).is_some()).await;
    assert_eq!(
        problem(&f),
        Some((
            "Downloading Fetched took too long. Check your internet connection, then try again.",
            Some("Try again")
        ))
    );
    c.next(|f| is_state(f, WorkState::Idle)).await;
    std::fs::remove_file(dir.join("slow")).unwrap();

    // Two chats that need it at once: one download, and both get their answer.
    let before = npm_runs(&dir);
    let CallValue::Channel(ch) = c
        .ok(Call::CreateChannel {
            title: "Shop".into(),
        })
        .await
    else {
        panic!()
    };
    let CallValue::Thread(other) = c
        .ok(Call::CreateThread {
            channel_id: ch.id,
            agent_id: snap.agents[0].id,
            title: None,
        })
        .await
    else {
        panic!()
    };
    c.sub(other.id, 0).await;
    send(&mut c, thread, "one").await;
    send(&mut c, other.id, "two").await;
    c.next(|f| agent_text(f) == Some("You said: one")).await;
    c.next(|f| agent_text(f) == Some("You said: two")).await;
    assert_eq!(npm_runs(&dir) - before, 1);
    let install = host.home.join("engines/fetched");
    assert!(install.join(".weilo-installed").is_file());
    assert!(
        install.join("weilo.json").is_file(),
        "the manifest was kept"
    );
    assert!(npm_runs_used_ci_only_with_a_lockfile(&dir));
}

/// The stand-in engine has no lockfile shipped, so npm ran `install`, never `ci`.
fn npm_runs_used_ci_only_with_a_lockfile(dir: &std::path::Path) -> bool {
    std::fs::read_to_string(dir.join("npm-runs"))
        .unwrap()
        .lines()
        .all(|l| l.starts_with("install --ignore-scripts"))
}

#[tokio::test]
async fn devices_and_rules_can_be_revoked() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    let phone = host.pair().await;
    let mut d = Client::connect(&host, Some(&phone)).await.unwrap();
    let CallValue::Devices(devices) = c.ok(Call::ListDevices).await else {
        panic!()
    };
    assert_eq!(devices.len(), 2);
    assert!(devices.iter().any(|x| x.id == c.device_id && x.this_device));
    assert!(
        devices
            .iter()
            .any(|x| x.id == d.device_id && !x.this_device)
    );

    // The removed device is cut off at once, and can't come back with its token.
    c.ok(Call::RevokeDevice {
        device_id: d.device_id,
    })
    .await;
    assert_eq!(d.close_code().await, Some(4401));
    assert_eq!(
        Client::connect(&host, Some(&phone)).await.err(),
        Some(Some(4401))
    );
    // The last device stays.
    let r = c
        .call(Call::RevokeDevice {
            device_id: c.device_id,
        })
        .await;
    assert_eq!(
        failed_with(&r, "invalid").as_deref(),
        Some("This is your only paired device. Pair another one before removing it.")
    );

    // An "Always allow" rule is listed in plain words, and revoking it brings the card back.
    c.sub(thread, 0).await;
    send(&mut c, thread, "approve the checks").await;
    let card = next_card(&mut c).await;
    let always = card
        .actions
        .iter()
        .find(|a| a.id == "always")
        .expect("an always action");
    assert_eq!(always.label, "Always allow for Ava");
    c.ok(Call::Decide {
        approval_id: card.approval_id.unwrap(),
        decision: always.decision.clone().unwrap(),
    })
    .await;
    c.next(|f| agent_text(f) == Some("Allowed.")).await;
    c.next(|f| is_state(f, WorkState::Idle)).await;
    let CallValue::AllowRules(rules) = c.ok(Call::ListAllowRules).await else {
        panic!()
    };
    assert_eq!(rules.len(), 1);
    assert_eq!(
        rules[0].description,
        "Ava may always run `npm test -- checkout`"
    );
    c.ok(Call::RevokeAllowRule {
        rule_id: rules[0].id,
    })
    .await;
    let CallValue::AllowRules(rules) = c.ok(Call::ListAllowRules).await else {
        panic!()
    };
    assert!(rules.is_empty());
    send(&mut c, thread, "approve the checks").await;
    let f = c
        .next(|f| {
            agent_text(f) == Some("Allowed.")
                || matches!(f, ServerFrame::Ev { event, .. } if matches!(event.body, EventBody::Card { .. }))
        })
        .await;
    assert!(agent_text(&f).is_none(), "the revoked rule still answered");
}

#[tokio::test]
async fn a_session_starts_on_its_task_and_new_chats_take_a_name() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;
    let repo = host.dir().join("shop");
    std::fs::create_dir(&repo).unwrap();
    let CallValue::Thread(t) = c
        .ok(Call::StartSession {
            folder: repo.display().to_string(),
            engine: "echo".into(),
            title: Some("Fix cart".into()),
            channel_id: None,
            agent_id: None,
            task: Some("Make the cart total add up".into()),
        })
        .await
    else {
        panic!()
    };
    c.sub(t.id, 0).await;
    // "What should it do?" is the first message: the person sees it, and the engine gets it.
    // A plain first message, not one waiting "after this job" (nothing ran before it).
    c.next(|f| {
        matches!(f, ServerFrame::Ev { event, .. }
            if matches!(&event.body, EventBody::UserMessage { text, when: SendWhen::Now } if text == "Make the cart total add up"))
    })
    .await;
    c.next(|f| agent_text(f) == Some("You said: Make the cart total add up"))
        .await;

    // A chat with no title is "New chat" until its first message names it.
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    let CallValue::Channel(ch) = c
        .ok(Call::CreateChannel {
            title: "Shop".into(),
        })
        .await
    else {
        panic!()
    };
    let CallValue::Thread(chat) = c
        .ok(Call::CreateThread {
            channel_id: ch.id,
            agent_id: snap.agents[0].id,
            title: None,
        })
        .await
    else {
        panic!()
    };
    assert_eq!(chat.title, "New chat");
    send(
        &mut c,
        chat.id,
        "Plan the spring sale for the shop\nand more",
    )
    .await;
    let mut db = host.db().await;
    let title: String = sqlx::query_scalar("SELECT title FROM threads WHERE id = $1")
        .bind(chat.id)
        .fetch_one(&mut db)
        .await
        .unwrap();
    assert_eq!(title, "Plan the spring sale for the shop");
}

/// A stand-in Anthropic: `/v1/models` takes the key "good" and turns down the rest.
async fn fake_provider() -> String {
    use axum::http::{HeaderMap, StatusCode};
    let app = axum::Router::new().route(
        "/v1/models",
        axum::routing::get(|h: HeaderMap| async move {
            let ok = h.get("x-api-key").is_some_and(|k| k == "good")
                && h.get("anthropic-version").is_some();
            if ok {
                (StatusCode::OK, r#"{"data":[]}"#)
            } else {
                (StatusCode::UNAUTHORIZED, r#"{"type":"error"}"#)
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await });
    url
}

#[tokio::test]
async fn keys_are_checked_and_silent_replies_are_said() {
    let provider = fake_provider().await;
    let Some(mut host) = Host::start_with(&[("WEILO_PROVIDER_URL_ANTHROPIC", &provider)]).await
    else {
        return;
    };
    host.add_engine(
        "keyed",
        serde_json::json!({
            "apiVersion": 1, "kind": "engine", "name": "keyed", "title": "Keyed",
            "command": ["{self}", "engine", "echo"],
            "env": { "WEILO_ECHO_STATE": "{engine_home}" },
            "keys": [{ "id": "anthropic", "title": "Anthropic", "env": "WEILO_ECHO_KEY" }],
            "hidden": true, "bindsApprovals": true
        }),
    );
    host.restart_with(&[("WEILO_PROVIDER_URL_ANTHROPIC", &provider)])
        .await;
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    c.ok(Call::UpdateAgent {
        agent_id: snap.agents[0].id,
        name: None,
        model: None,
        instructions: None,
        engine: Some("keyed".into()),
    })
    .await;
    let set_key = |key: &str| Call::SetEngineKey {
        engine: "keyed".into(),
        provider: "anthropic".into(),
        key: key.into(),
    };
    let check = || Call::CheckEngine {
        engine: "keyed".into(),
    };

    // A key is shown to its provider (for free) before it is saved; one it turns down
    // isn't saved.
    let r = c.call(set_key("bad")).await;
    assert_eq!(
        failed_with(&r, "invalid").as_deref(),
        Some("That Anthropic key didn't work, so it wasn't saved. Check it and try again.")
    );
    assert!(!host.home.join("secrets/keys-keyed.json").exists());
    let CallValue::EngineCheck(r) = c.ok(check()).await else {
        panic!()
    };
    assert!(!r.ready);
    assert_eq!(r.needs, Some(EngineNeed::Key));
    c.ok(set_key("good")).await;
    let CallValue::EngineCheck(r) = c.ok(check()).await else {
        panic!()
    };
    assert!(r.ready, "{r:?}");

    // A reply with no words says so; pi's startup notes are not a reply.
    c.sub(thread, 0).await;
    send(&mut c, thread, "say nothing").await;
    let f = c
        .next(|f| problem(f).is_some() || agent_text(f).is_some())
        .await;
    assert_eq!(problem(&f), Some(("Ava didn't answer.", Some("Try again"))));
    c.next(|f| is_state(f, WorkState::Idle)).await;

    // A key that stops working later (written here as if it had been saved before):
    // when the engine's log shows it was turned down, that is the reason given.
    c.ok(set_key("")).await;
    std::fs::write(
        host.home.join("secrets/keys-keyed.json"),
        r#"{"anthropic":"bad"}"#,
    )
    .unwrap();
    send(&mut c, thread, "say nothing").await;
    let f = c
        .next(|f| problem(f).is_some() || agent_text(f).is_some())
        .await;
    assert_eq!(
        problem(&f),
        Some((
            "Ava didn't answer: your Anthropic key didn't work.",
            Some("Change key")
        ))
    );
    c.next(|f| is_state(f, WorkState::Idle)).await;
    // ("keyed" is hidden from the engine list: its state is read where it is kept.)
    let states = || std::fs::read_to_string(host.home.join("secrets/key-states.json")).unwrap();
    assert!(
        states().contains(r#""keyed/anthropic":["rejected""#),
        "{}",
        states()
    );
    // The same key then gets a real answer from the model: it works after all.
    send(&mut c, thread, "hello").await;
    c.next(|f| agent_text(f) == Some("You said: hello")).await;
    c.next(|f| is_state(f, WorkState::Idle)).await;
    assert!(!states().contains("keyed/anthropic"), "{}", states());
}

#[tokio::test]
async fn a_sessions_changes_can_be_seen() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;
    let repo = host.dir().join("shop");
    std::fs::create_dir(&repo).unwrap();
    let git = |args: &[&str]| {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["-c", "user.email=t@t", "-c", "user.name=t"])
            .args(args)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}");
    };
    git(&["init", "-q"]);
    std::fs::write(repo.join("cart.txt"), "one\ntwo\n").unwrap();
    std::fs::write(repo.join("old.txt"), "gone\n").unwrap();
    git(&["add", "-A"]);
    git(&["commit", "-q", "-m", "start"]);
    let start = |folder: &std::path::Path| Call::StartSession {
        folder: folder.display().to_string(),
        engine: "echo".into(),
        title: Some("Fix cart".into()),
        channel_id: None,
        agent_id: None,
        task: None,
    };
    let CallValue::Thread(t) = c.ok(start(&repo)).await else {
        panic!()
    };
    let wt = std::path::PathBuf::from(t.worktree.clone().unwrap());
    // One edit saved on the session's branch, one not, a removal and a new file.
    std::fs::write(wt.join("cart.txt"), "one\n2\nthree\n").unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&wt)
        .args([
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "commit",
            "-qam",
            "edit",
        ])
        .status()
        .unwrap();
    std::fs::remove_file(wt.join("old.txt")).unwrap();
    std::fs::write(wt.join("new.txt"), "a\nb\nc\n").unwrap();
    // The person keeps working in the original folder meanwhile; that isn't the session's.
    std::fs::write(repo.join("mine.txt"), "x\n").unwrap();
    git(&["add", "-A"]);
    git(&["commit", "-q", "-m", "mine"]);

    let CallValue::SessionChanges(ch) = c.ok(Call::SessionChanges { thread_id: t.id }).await else {
        panic!()
    };
    let files: Vec<(&str, FileChange, u32, u32)> = ch
        .files
        .iter()
        .map(|f| (f.path.as_str(), f.status, f.added, f.removed))
        .collect();
    assert_eq!(
        files,
        [
            ("cart.txt", FileChange::Modified, 2, 1),
            ("new.txt", FileChange::Added, 3, 0),
            ("old.txt", FileChange::Deleted, 0, 1),
        ]
    );
    let diff = ch.diff.unwrap();
    assert!(
        diff.contains("+three") && diff.contains("+++ b/new.txt"),
        "{diff}"
    );
    assert!(!ch.truncated);

    // A big change is cut near 200 KB.
    std::fs::write(wt.join("big.txt"), "line of text\n".repeat(30_000)).unwrap();
    let CallValue::SessionChanges(ch) = c.ok(Call::SessionChanges { thread_id: t.id }).await else {
        panic!()
    };
    assert!(ch.truncated);
    assert!(ch.diff.unwrap().len() <= 200 * 1024);

    // A folder that isn't a repo: the files changed since the session began, no diff.
    let plain = host.dir().join("notes");
    std::fs::create_dir(&plain).unwrap();
    std::fs::write(plain.join("before.txt"), "x").unwrap();
    std::thread::sleep(Duration::from_millis(1100));
    let CallValue::Thread(t) = c.ok(start(&plain)).await else {
        panic!()
    };
    std::fs::create_dir(plain.join("sub")).unwrap();
    std::fs::write(plain.join("sub/after.txt"), "y").unwrap();
    let CallValue::SessionChanges(ch) = c.ok(Call::SessionChanges { thread_id: t.id }).await else {
        panic!()
    };
    let paths: Vec<&str> = ch.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, ["sub/after.txt"]);
    assert!(ch.diff.is_none());
}

/// Makes a git repo `shop` in `dir` with one empty commit.
fn shop_repo(dir: &std::path::Path) -> std::path::PathBuf {
    let repo = dir.join("shop");
    std::fs::create_dir(&repo).unwrap();
    for args in [
        &["init", "-q"][..],
        &["commit", "-q", "--allow-empty", "-m", "start"],
    ] {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(["-c", "user.email=t@t", "-c", "user.name=t"])
            .args(args)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}");
    }
    repo
}

async fn start_session(c: &mut Client, repo: &std::path::Path) -> weilo_proto::ThreadSummary {
    let CallValue::Thread(t) = c
        .ok(Call::StartSession {
            folder: repo.display().to_string(),
            engine: "echo".into(),
            title: Some("Fix cart".into()),
            channel_id: None,
            agent_id: None,
            task: None,
        })
        .await
    else {
        panic!()
    };
    t
}

#[tokio::test]
async fn bring_back_runs_alone() {
    // A git whose merges take 2 s, and which notes when one is done.
    let tools = tempfile::Builder::new()
        .prefix("weilo-git-")
        .tempdir_in("/tmp")
        .unwrap();
    let real = std::process::Command::new("sh")
        .args(["-c", "command -v git"])
        .output()
        .unwrap();
    let real = String::from_utf8(real.stdout).unwrap().trim().to_string();
    let mark = tools.path().join("merged");
    let script = format!(
        "#!/bin/sh\ncase \"$*\" in *\"merge --no-ff\"*) sleep 2; \"{real}\" \"$@\"; s=$?; touch \"{mark}\"; exit $s;; esac\nexec \"{real}\" \"$@\"\n",
        mark = mark.display()
    );
    std::fs::write(tools.path().join("git"), script).unwrap();
    std::fs::set_permissions(
        tools.path().join("git"),
        std::fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    let path = format!(
        "{}:{}",
        tools.path().display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let Some(host) = Host::start_with(&[("PATH", &path)]).await else {
        return;
    };
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;
    let mut d = host.connect().await;
    let repo = shop_repo(host.dir());
    let t = start_session(&mut c, &repo).await;
    c.sub(t.id, 0).await;
    let worktree = std::path::PathBuf::from(t.worktree.clone().unwrap());
    std::fs::write(worktree.join("cart.txt"), "fixed\n").unwrap();

    // One device starts Bring back; the other asks too, and sends a message meanwhile.
    let first = Uuid::now_v7();
    c.send(&ClientFrame::Call {
        call_id: first,
        call: Call::MergeSession { thread_id: t.id },
    })
    .await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    let r = d.call(Call::MergeSession { thread_id: t.id }).await;
    assert_eq!(
        failed_with(&r, "conflict").as_deref(),
        Some("Already bringing these changes back.")
    );
    send(&mut d, t.id, "hi").await;
    // The turn starts only once the merge is done.
    c.next(|f| is_state(f, WorkState::Working)).await;
    assert!(mark.exists(), "a turn started during Bring back");
    let ServerFrame::Ret { result, .. } = c
        .next(|f| matches!(f, ServerFrame::Ret { call_id, .. } if *call_id == first))
        .await
    else {
        unreachable!()
    };
    assert!(
        matches!(&result, CallResult::Done { value: CallValue::Message(m) } if m == "Brought the session's changes into shop."),
        "{result:?}"
    );
    c.next(|f| agent_text(f) == Some("You said: hi")).await;
    assert!(repo.join("cart.txt").exists());
}

#[tokio::test]
async fn a_reply_ending_while_postgres_is_down_is_kept() {
    // Queries give up after 1 s, so writes fail while Postgres is away.
    let Some(host) = Host::start_with(&[("WEILO_DB_WAIT_SECS", "1")]).await else {
        return;
    };
    let token = host.pair().await;
    let mut c = Client::connect(&host, Some(&token)).await.unwrap();
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    send(&mut c, thread, "slow").await;
    c.next(|f| is_state(f, WorkState::Working)).await;
    // Postgres goes away until well after the turn ends (about 3 s): each time it comes
    // back, it is ended again.
    let until = std::time::Instant::now() + Duration::from_secs(7);
    while std::time::Instant::now() < until {
        if let Some(pid) = host.postgres_pid().filter(|p| pid_alive(*p)) {
            // SAFETY: killing the test host's Postgres.
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    // Back soon after the last kill: leftover server processes are waited for, not
    // retried against with ever longer pauses.
    let killed_at = std::time::Instant::now();
    while host.connect_as("weilo_app").await.is_err() {
        assert!(
            killed_at.elapsed() < common::WAIT,
            "Postgres didn't come back\n{}",
            host.log()
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let took = killed_at.elapsed();
    assert!(
        took < Duration::from_secs(10),
        "Postgres took {took:?} to come back\n{}",
        host.log()
    );
    // A device that comes back finds the whole reply, and the thread idle.
    let started = std::time::Instant::now();
    let mut d = loop {
        match Client::connect(&host, Some(&token)).await {
            Ok(d) => break d,
            Err(e) => assert!(
                started.elapsed() < common::WAIT,
                "can't connect: {e:?}\n{}",
                host.log()
            ),
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    };
    d.sub(thread, 0).await;
    d.next(|f| agent_text(f).is_some_and(|t| t.starts_with("You said: slow")))
        .await;
    let started = std::time::Instant::now();
    loop {
        let state: Option<String> = match host.connect_as("weilo_app").await {
            Ok(mut db) => sqlx::query_scalar("SELECT state FROM threads WHERE id = $1")
                .bind(thread)
                .fetch_one(&mut db)
                .await
                .ok(),
            Err(_) => None,
        };
        if state.as_deref() == Some("idle") {
            break;
        }
        assert!(
            started.elapsed() < common::WAIT,
            "the thread stayed {state:?}\n{}",
            host.log()
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert!(
        host.log().contains("will try again") || host.log().contains("until the database is back"),
        "no write waited, so this didn't test anything:\n{}",
        host.log()
    );
    // And it takes the next message.
    send(&mut d, thread, "still there?").await;
    d.next(|f| agent_text(f) == Some("You said: still there?"))
        .await;
}

#[tokio::test]
async fn idle_runners_end_and_engine_processes_are_capped() {
    let Some(host) = Host::start_with(&[
        ("WEILO_MAX_ENGINES", "1"),
        ("WEILO_RUNNER_IDLE_SECS", "1"),
        ("WEILO_ENGINE_IDLE_SECS", "600"),
    ])
    .await
    else {
        return;
    };
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;
    let repo = shop_repo(host.dir());
    let a = start_session(&mut c, &repo).await;
    let b = start_session(&mut c, &repo).await;
    c.sub(a.id, 0).await;
    c.sub(b.id, 0).await;
    let on = |id: Uuid, want: WorkState| {
        move |f: &ServerFrame| {
            matches!(f, ServerFrame::Ev { thread_id, .. } if *thread_id == id) && is_state(f, want)
        }
    };
    // A holds the only engine; B waits, says so, and runs once A's engine is idle.
    send(&mut c, a.id, "slow").await;
    c.next(on(a.id, WorkState::Working)).await;
    send(&mut c, b.id, "hello").await;
    let waiting = c
        .next(|f| match f {
            ServerFrame::Ev { thread_id, event } if *thread_id == b.id => matches!(
                &event.body,
                EventBody::State { live_line, .. } if live_line == "Waiting for another agent to finish"
            ),
            _ => false,
        })
        .await;
    drop(waiting);
    c.next(on(a.id, WorkState::Idle)).await;
    c.next(|f| agent_text(f) == Some("You said: hello")).await;
    c.next(on(b.id, WorkState::Idle)).await;
    // A runner with nothing to do ends (its engine first, after it idles).
    let mut d = host.connect().await;
    let _ = d.ok(Call::Snapshot).await;
    eventually("an idle engine to give its place up", || {
        host.log().contains("gives its place up")
    })
    .await;
}

#[tokio::test]
async fn the_built_in_ai_is_downloaded_on_first_use() {
    let tools = tempfile::Builder::new()
        .prefix("weilo-npm-")
        .tempdir_in("/tmp")
        .unwrap();
    let bin = fake_npm_for(tools.path(), "pi-acp");
    let path = format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    let provider = fake_provider().await;
    let Some(host) =
        Host::start_with(&[("PATH", &path), ("WEILO_PROVIDER_URL_ANTHROPIC", &provider)]).await
    else {
        return;
    };
    let mut c = host.connect().await;
    let CallValue::Engines(engines) = c.ok(Call::ListEngines).await else {
        panic!()
    };
    let pi = engines.iter().find(|e| e.id == "pi").unwrap();
    assert!(!pi.installed, "nothing was downloaded yet");
    assert_eq!(pi.needs, Some(EngineNeed::Key));
    // "Use it" in setup tries it: it is downloaded (once), then asks for a key.
    let CallValue::Setup(setup) = c
        .ok(Call::FinishSetup {
            engine: "pi".into(),
            keep_awake: false,
        })
        .await
    else {
        panic!()
    };
    let check = setup.check.expect("a check");
    assert!(!check.ready);
    assert_eq!(check.needs, Some(EngineNeed::Key), "{check:?}");
    assert_eq!(npm_runs(tools.path()), 1);
    assert!(host.home.join("engines/pi/.weilo-installed").is_file());
    let CallValue::Engines(engines) = c.ok(Call::ListEngines).await else {
        panic!()
    };
    assert!(engines.iter().find(|e| e.id == "pi").unwrap().installed);
    // With a key the provider takes, it is ready.
    c.ok(Call::SetEngineKey {
        engine: "pi".into(),
        provider: "anthropic".into(),
        key: "good".into(),
    })
    .await;
    let CallValue::EngineCheck(check) = c
        .ok(Call::CheckEngine {
            engine: "pi".into(),
        })
        .await
    else {
        panic!()
    };
    assert!(check.ready, "{check:?}");
    assert_eq!(npm_runs(tools.path()), 1);
}

#[tokio::test]
async fn a_card_left_while_postgres_is_down_is_closed_when_it_is_back() {
    let Some(host) = Host::start_with(&[("WEILO_DB_WAIT_SECS", "1")]).await else {
        return;
    };
    let token = host.pair().await;
    let mut c = Client::connect(&host, Some(&token)).await.unwrap();
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    let pid = start_helper(&mut c, thread).await;
    // SAFETY: asking for the group of a process this test's host started.
    let pgid = unsafe { libc::getpgid(pid) };
    send(&mut c, thread, "approve the checks").await;
    let card = next_card(&mut c).await;
    c.next(|f| is_state(f, WorkState::NeedsYou)).await;
    let approval_id = card.approval_id.unwrap();
    // Postgres goes away; meanwhile the engine dies, so the card must be closed, and
    // that can't be written until Postgres is back.
    let kill_postgres = |for_how_long: Duration| {
        let host = &host;
        async move {
            let until = std::time::Instant::now() + for_how_long;
            while std::time::Instant::now() < until {
                if let Some(pid) = host.postgres_pid().filter(|p| pid_alive(*p)) {
                    // SAFETY: killing the test host's Postgres.
                    unsafe {
                        libc::kill(pid, libc::SIGKILL);
                    }
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    };
    kill_postgres(Duration::from_secs(2)).await;
    // SAFETY: killing the engine's group, as a crash of the engine would.
    unsafe { libc::kill(-pgid, libc::SIGKILL) };
    kill_postgres(Duration::from_secs(3)).await;
    eventually("Postgres to come back", || {
        host.postgres_pid().is_some_and(pid_alive)
    })
    .await;
    // Closed as interrupted once Postgres is back, long before the sweep would.
    let started = std::time::Instant::now();
    loop {
        let row: Option<(String, Option<String>)> = match host.connect_as("weilo_app").await {
            Ok(mut db) => sqlx::query_as("SELECT state, decided_via FROM approvals WHERE id = $1")
                .bind(approval_id)
                .fetch_one(&mut db)
                .await
                .ok(),
            Err(_) => None,
        };
        if let Some((state, via)) = &row
            && state != "pending"
        {
            assert_eq!(state, "denied");
            assert_eq!(via.as_deref(), Some("interrupted"));
            break;
        }
        assert!(
            started.elapsed() < common::WAIT,
            "the card stayed {row:?}\n{}",
            host.log()
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    // A late answer finds it closed.
    let mut d = Client::connect(&host, Some(&token)).await.unwrap();
    let late = d
        .call(Call::Decide {
            approval_id,
            decision: Decision::Allow,
        })
        .await;
    assert!(failed_with(&late, "conflict").is_some(), "{late:?}");
}

/// Postgres's server processes other than the postmaster (killing one makes Postgres
/// reset every connection and recover, without stopping).
fn postgres_backends(postmaster: i32) -> Vec<i32> {
    let Ok(dir) = std::fs::read_dir("/proc") else {
        return vec![];
    };
    dir.flatten()
        .filter_map(|e| e.file_name().to_str()?.parse::<i32>().ok())
        .filter(|pid| {
            let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
            // pid (comm) state ppid …
            stat.rsplit_once(") ")
                .and_then(|(_, rest)| rest.split_whitespace().nth(1)?.parse::<i32>().ok())
                == Some(postmaster)
        })
        .collect()
}

#[tokio::test]
async fn a_message_waiting_through_a_database_blip_still_runs() {
    let Some(host) = Host::start_with(&[("WEILO_DB_WAIT_SECS", "1")]).await else {
        return;
    };
    let token = host.pair().await;
    let mut c = Client::connect(&host, Some(&token)).await.unwrap();
    let thread = setup_with_echo(&mut c).await;
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    let agent_id = snap.agents[0].id;
    c.sub(thread, 0).await;
    send(&mut c, thread, "slow").await;
    c.next(|f| is_state(f, WorkState::Working)).await;
    // The next message waits for this turn; a new model means it needs a new engine
    // process, which reads the thread from the database as it starts.
    send(&mut c, thread, "hello again").await;
    c.ok(Call::UpdateAgent {
        agent_id,
        name: None,
        model: Some("another-model".into()),
        instructions: None,
        engine: None,
    })
    .await;
    // Before the turn ends, the database stops answering: its connections are cut and
    // Postgres is paused, so new ones hang. Postgres itself never exits, so Weilo isn't
    // told it's down.
    let postmaster = host.postgres_pid().expect("postgres pid");
    // SAFETY: pausing and killing the test host's own Postgres processes.
    unsafe {
        libc::kill(postmaster, libc::SIGSTOP);
        for pid in postgres_backends(postmaster) {
            libc::kill(pid, libc::SIGKILL);
        }
    }
    // The turn ends (about 3 s) and the next message tries to start meanwhile.
    let paused = std::time::Instant::now();
    while !host.log().contains("waits to start") {
        if paused.elapsed() > Duration::from_secs(15) {
            // SAFETY: as above.
            unsafe { libc::kill(postmaster, libc::SIGCONT) };
            panic!("the message never tried to start:\n{}", host.log());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    tokio::time::sleep(Duration::from_secs(1)).await;
    // SAFETY: as above.
    unsafe { libc::kill(postmaster, libc::SIGCONT) };
    // Once the database answers again, the message runs; nothing said it failed.
    let mut d = loop {
        if let Ok(d) = Client::connect(&host, Some(&token)).await {
            break d;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    };
    d.sub(thread, 0).await;
    let f = d
        .next(|f| agent_text(f) == Some("You said: hello again") || problem(f).is_some())
        .await;
    assert_eq!(
        agent_text(&f),
        Some("You said: hello again"),
        "{f:?}\n{}",
        host.log()
    );
}
