//! End-to-end: a real host when things go wrong. Stops that time out, engines that hang
//! or forget, crashes and restarts, slow devices, and what people may and may not do.

mod common;

use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use common::{Client, Host, agent_text, eventually, is_state, pid_alive, send, setup_with_echo};
use uuid::Uuid;
use weilo_proto::{
    ApprovalState, Call, CallResult, CallValue, Decision, Delta, EngineNeed, EventBody, SendWhen,
    ServerFrame, WorkState,
};

fn problem(f: &ServerFrame) -> Option<(&str, Option<&str>)> {
    match f {
        ServerFrame::Ev { event, .. } => match &event.body {
            EventBody::Problem { message, action } => Some((message, action.as_deref())),
            _ => None,
        },
        _ => None,
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
async fn a_slow_device_is_told_to_subscribe_again() {
    let Some(mut host) = Host::start().await else {
        return;
    };
    let token = host.pair().await;
    let mut c = Client::connect(&host, Some(&token)).await.unwrap();
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    for i in 0..4 {
        send(&mut c, thread, &format!("message {i}")).await;
        c.next(|f| agent_text(f) == Some(&format!("You said: message {i}")))
            .await;
    }
    drop(c);
    // A device whose queue holds one frame can't take the backlog.
    host.restart_with(&[("WEILO_WS_QUEUE", "1")]).await;
    let mut d = Client::connect(&host, Some(&token)).await.unwrap();
    d.sub(thread, 0).await;
    assert_eq!(d.close_code().await, Some(4008));
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
async fn pairing_hands_the_token_over_once() {
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
    let cookie = res.headers()["set-cookie"].to_str().unwrap().to_string();
    assert!(cookie.starts_with("weilo_handoff=") && cookie.contains("Path=/api/token"));
    let body: serde_json::Value = res.json().await.unwrap();
    let token = body["token"].as_str().unwrap().to_string();
    let claim = || {
        http.post(host.url("/api/token"))
            .header("cookie", cookie.split(';').next().unwrap().to_string())
            .send()
    };
    let res = claim().await.unwrap();
    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["token"], token.as_str());
    assert_eq!(claim().await.unwrap().status(), 401);
    Client::connect(&host, Some(&token)).await.unwrap();
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
    let Some(host) = Host::start().await else {
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
