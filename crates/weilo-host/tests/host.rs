//! End-to-end: a real host, Postgres and the echo engine.

mod common;

use common::{Client, Host, agent_text, is_state, send, setup_with_echo};
use uuid::Uuid;
use weilo_proto::{
    ApprovalState, Call, CallResult, CallValue, Decision, Delta, EventBody, RiskClass, ServerFrame,
    StepStatus, WorkState,
};

#[tokio::test]
async fn setup_send_and_replay() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;

    let thread = setup_with_echo(&mut c).await;
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    assert_eq!(snap.agents.len(), 1);
    assert_eq!(
        (snap.agents[0].name.as_str(), snap.agents[0].color.as_str()),
        ("Ava", "violet")
    );
    assert_eq!(
        snap.channels
            .iter()
            .map(|c| c.slug.as_str())
            .collect::<Vec<_>>(),
        ["general"]
    );
    assert!(snap.setup.done);

    c.sub(thread, 0).await;
    send(&mut c, thread, "hello there").await;

    // Deltas first, then one durable message with the whole reply.
    let mut streamed = String::new();
    let mut deltas = 0;
    let message = loop {
        let f = c
            .next(|f| matches!(f, ServerFrame::Delta { .. }) || agent_text(f).is_some())
            .await;
        match f {
            ServerFrame::Delta {
                delta: Delta::AgentText { text },
                ..
            } => {
                streamed.push_str(&text);
                deltas += 1;
            }
            f => break agent_text(&f).unwrap().to_string(),
        }
    };
    assert!(deltas >= 3, "only {deltas} deltas");
    assert_eq!(message, "You said: hello there");
    assert_eq!(streamed, message);
    let idle = c.next(|f| is_state(f, WorkState::Idle)).await;
    let ServerFrame::Ev { event: idle, .. } = idle else {
        unreachable!()
    };

    // A step was shown along the way.
    let step = c
        .next(|f| matches!(f, ServerFrame::Ev { event, .. } if matches!(&event.body, EventBody::Step { status: StepStatus::Done, .. })))
        .await;
    assert!(
        matches!(step, ServerFrame::Ev { event, .. } if matches!(&event.body, EventBody::Step { title, .. } if title == "Read the request"))
    );

    // A second socket that missed events after seq 2 gets exactly those, in order.
    let token = host.pair().await;
    let mut late = Client::connect(&host, Some(&token)).await.unwrap();
    late.sub(thread, 2).await;
    let mut seqs = Vec::new();
    while seqs.last() != Some(&idle.seq) {
        if let ServerFrame::Ev { event, .. } =
            late.next(|f| matches!(f, ServerFrame::Ev { .. })).await
        {
            seqs.push(event.seq);
        }
    }
    assert_eq!(seqs, (3..=idle.seq).collect::<Vec<_>>());

    // The thread is idle again in the sidebar.
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    let t = snap.threads.iter().find(|t| t.id == thread).unwrap();
    assert_eq!((t.state, t.last_seq), (WorkState::Idle, idle.seq));
}

#[tokio::test]
async fn same_call_id_runs_once() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;

    let id = Uuid::now_v7();
    let first = c
        .call_with_id(
            id,
            Call::CreateChannel {
                title: "Shop Launch 2026".into(),
            },
        )
        .await;
    let second = c
        .call_with_id(
            id,
            Call::CreateChannel {
                title: "Shop Launch 2026".into(),
            },
        )
        .await;
    let (
        CallResult::Done {
            value: CallValue::Channel(a),
        },
        CallResult::Done {
            value: CallValue::Channel(b),
        },
    ) = (first, second)
    else {
        panic!("both should succeed");
    };
    assert_eq!((a.id, a.slug.as_str()), (b.id, "shop-launch"));
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    assert_eq!(snap.channels.len(), 2, "one #general, one #shop-launch");

    // A new call with the same title gets a new slug; setup can't run twice.
    let CallValue::Channel(c3) = c
        .ok(Call::CreateChannel {
            title: "shop launch".into(),
        })
        .await
    else {
        panic!()
    };
    assert_eq!(c3.slug, "shop-launch-2");
    let again = c
        .call(Call::FinishSetup {
            engine: "echo".into(),
            keep_awake: false,
        })
        .await;
    assert!(matches!(again, CallResult::Failed { error } if error.code == "conflict"));
}

#[tokio::test]
async fn approval_allow_then_conflict() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    send(&mut c, thread, "please approve the checks").await;

    let card = c.next(|f| matches!(f, ServerFrame::Ev { event, .. } if matches!(event.body, EventBody::Card { .. }))).await;
    let ServerFrame::Ev { event, .. } = card else {
        unreachable!()
    };
    let EventBody::Card { card } = event.body else {
        unreachable!()
    };
    assert_eq!(card.title, "Run the shop's checks");
    assert_eq!(card.risk, RiskClass::Reversible);
    assert_eq!(card.details.as_deref(), Some("npm test -- checkout"));
    c.next(|f| is_state(f, WorkState::NeedsYou)).await;

    let CallValue::NeedsYou(items) = c.ok(Call::NeedsYou).await else {
        panic!()
    };
    assert_eq!(items.len(), 1);
    assert_eq!(
        (items[0].state, items[0].source.as_str()),
        (ApprovalState::Pending, "Ava")
    );
    assert_eq!(
        (&items[0].decided_at, &items[0].decided_via),
        (&None, &None)
    );
    let approval_id = items[0].approval_id;
    assert_eq!(card.approval_id, Some(approval_id));

    c.ok(Call::Decide {
        approval_id,
        decision: Decision::Allow,
    })
    .await;
    let reply = c.next(|f| agent_text(f) == Some("Allowed.")).await;
    assert!(agent_text(&reply).is_some());
    c.next(|f| is_state(f, WorkState::Idle)).await;

    let again = c
        .call(Call::Decide {
            approval_id,
            decision: Decision::Deny,
        })
        .await;
    assert!(matches!(again, CallResult::Failed { error } if error.code == "conflict"));
    // Still listed, as allowed, so the app can show it under Done today.
    let CallValue::NeedsYou(items) = c.ok(Call::NeedsYou).await else {
        panic!()
    };
    assert_eq!(items.len(), 1);
    assert_eq!(
        (items[0].approval_id, items[0].state),
        (approval_id, ApprovalState::Allowed)
    );
    assert_eq!(items[0].decided_via.as_deref(), Some("you"));
    let at = items[0]
        .decided_at
        .as_deref()
        .expect("when it was answered");
    assert!(chrono::DateTime::parse_from_rfc3339(at).is_ok(), "{at}");
}

#[tokio::test]
async fn unanswered_approval_expires_as_not_allowed() {
    let Some(host) = Host::start_with(&[("WEILO_APPROVAL_TTL_SECS", "1")]).await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    send(&mut c, thread, "approve it").await;
    let decided = c
        .next(|f| matches!(f, ServerFrame::Ev { event, .. } if matches!(&event.body, EventBody::ApprovalDecided { via, .. } if via == "expired")))
        .await;
    assert!(
        matches!(decided, ServerFrame::Ev { event, .. } if matches!(event.body, EventBody::ApprovalDecided { decision: Decision::Deny, .. }))
    );
    c.next(|f| agent_text(f) == Some("Not allowed.")).await;
    let CallValue::NeedsYou(items) = c.ok(Call::NeedsYou).await else {
        panic!()
    };
    assert_eq!(items[0].state, ApprovalState::Expired);
    assert_eq!(items[0].decided_via.as_deref(), Some("expired"));
    assert!(items[0].decided_at.is_some());
}

#[tokio::test]
async fn stop_cancels_a_turn() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    let thread = setup_with_echo(&mut c).await;
    c.sub(thread, 0).await;
    send(&mut c, thread, "a slow one please").await;
    c.next(|f| matches!(f, ServerFrame::Delta { .. })).await;
    let asked = std::time::Instant::now();
    c.ok(Call::Stop { thread_id: thread }).await;
    c.next(|f| is_state(f, WorkState::Idle)).await;
    assert!(
        asked.elapsed().as_millis() < 2000,
        "stop took {:?}",
        asked.elapsed()
    );
    // What was written so far is kept, but the reply never finished.
    let partial = c.next(|f| agent_text(f).is_some()).await;
    assert!(agent_text(&partial).unwrap().len() < "You said: a slow one please".len());
}

#[tokio::test]
async fn sessions_use_a_worktree_or_report_a_missing_folder() {
    let Some(host) = Host::start().await else {
        return;
    };
    let mut c = host.connect().await;
    setup_with_echo(&mut c).await;

    let missing = Call::StartSession {
        folder: "/nowhere/at/all".into(),
        engine: "echo".into(),
        title: Some("Fix checkout".into()),
        channel_id: None,
        agent_id: None,
        task: None,
    };
    // A missing folder is refused before anything is made.
    let refused = c.call(missing).await;
    assert!(
        matches!(&refused, CallResult::Failed { error } if error.message == "This folder doesn't exist."),
        "{refused:?}"
    );
    let CallValue::Snapshot(snap) = c.ok(Call::Snapshot).await else {
        panic!()
    };
    assert!(snap.threads.iter().all(|t| t.folder.is_none()));

    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path().join("shop");
    std::fs::create_dir(&repo).unwrap();
    let git = |args: &[&str]| {
        let ok = std::process::Command::new("git")
            .arg("-C")
            .arg(&repo)
            .args(args)
            .output()
            .unwrap()
            .status
            .success();
        assert!(ok, "git {args:?}");
    };
    git(&["init", "-q"]);
    git(&[
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "start",
    ]);
    let start = Call::StartSession {
        folder: repo.display().to_string(),
        engine: "echo".into(),
        title: Some("Fix checkout".into()),
        channel_id: None,
        agent_id: None,
        task: None,
    };
    let CallValue::Thread(t) = c.ok(start).await else {
        panic!()
    };
    assert!(
        dir.path()
            .join(".weilo-worktrees/fix-checkout/.git")
            .exists()
    );
    c.sub(t.id, 0).await;
    send(&mut c, t.id, "hi").await;
    c.next(|f| agent_text(f) == Some("You said: hi")).await;
}

#[tokio::test]
async fn guard_and_pairing_reject_strangers() {
    let Some(host) = Host::start().await else {
        return;
    };
    let http = reqwest::Client::new();
    let get = |host_header: &str, origin: Option<&str>| {
        let mut req = http
            .get(host.url("/api/health"))
            .header("host", host_header);
        if let Some(o) = origin {
            req = req.header("origin", o);
        }
        req.send()
    };
    let local = format!("127.0.0.1:{}", host.port);
    assert_eq!(get(&local, None).await.unwrap().status(), 200);
    assert_eq!(get("evil.example", None).await.unwrap().status(), 403);
    assert_eq!(
        get(&local, Some("http://evil.example"))
            .await
            .unwrap()
            .status(),
        403
    );
    let res = http
        .get(host.url("/api/health"))
        .header("sec-fetch-site", "cross-site")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 403);
    let res = http.get(host.url("/api/health")).send().await.unwrap();
    assert_eq!(res.headers()["x-content-type-options"], "nosniff");
    assert!(
        res.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'")
    );

    // A wrong code is refused, slowly.
    let started = std::time::Instant::now();
    let res = http
        .post(host.url("/api/pair"))
        .json(&serde_json::json!({ "code": "AAAAAAAA" }))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 401);
    assert!(started.elapsed().as_millis() >= 900);

    // A code works once.
    let code = host.pairing_code();
    let pair = |code: String| {
        http.post(host.url("/api/pair"))
            .json(&serde_json::json!({ "code": code }))
            .send()
    };
    assert_eq!(pair(code.clone()).await.unwrap().status(), 200);
    assert_eq!(pair(code).await.unwrap().status(), 401);

    // No token, or a made-up one: no socket. A cookie alone isn't enough any more.
    assert_eq!(Client::connect(&host, None).await.err(), Some(Some(4001)));
    assert_eq!(
        Client::connect(&host, Some("not-a-token")).await.err(),
        Some(Some(4401))
    );

    // Health tells the app whether this browser is paired, from its token.
    let paired = |header: Option<(&'static str, String)>| {
        let mut req = http.get(host.url("/api/health"));
        if let Some((name, value)) = header {
            req = req.header(name, value);
        }
        async move {
            let body: serde_json::Value = req.send().await.unwrap().json().await.unwrap();
            body["paired"].clone()
        }
    };
    assert_eq!(paired(None).await, false);
    assert_eq!(
        paired(Some(("authorization", "Bearer not-a-token".into()))).await,
        false
    );
    let token = host.pair().await;
    assert_eq!(
        paired(Some(("authorization", format!("Bearer {token}")))).await,
        true
    );
    assert_eq!(
        paired(Some(("cookie", format!("weilo_device={token}")))).await,
        false
    );
}
