//! Event fencing, the audit chain and what the app role may do, on a real Postgres.

mod common;

use serde_json::json;
use sqlx::Connection;
use sqlx::postgres::PgConnection;
use weilo_host::audit::{self, Verdict};
use weilo_host::db::{self, Fence};
use weilo_host::events::{self, AppendError, Source};
use weilo_host::home::Home;
use weilo_host::ids::new_id;
use weilo_host::jobs;
use weilo_host::pg::{ADMIN_ROLE, DATABASE, OWNER_ROLE, Postgres};
use weilo_proto::{EventBody, SendWhen};

#[tokio::test]
async fn fencing_audit_and_grants() {
    if !common::postgres_available() {
        return;
    }
    let (_dir, home) = common::temp_home();
    let mut pg = Postgres::start(&Home::new(&home))
        .await
        .expect("postgres starts");
    let result = checks(&pg).await;
    pg.stop().await;
    result.unwrap();
}

async fn checks(pg: &Postgres) -> anyhow::Result<()> {
    let db = db::open(pg).await?;
    let thread = new_id();
    sqlx::query(
        "INSERT INTO threads (id, space_id, kind, owner_host, owner_epoch, title)
         VALUES ($1, $2, 'chat', $3, $4, 'Test')",
    )
    .bind(thread)
    .bind(db.space_id)
    .bind(db.fence.host)
    .bind(db.fence.epoch)
    .execute(&db.pool)
    .await?;
    let body = EventBody::UserMessage {
        text: "hi".into(),
        when: SendWhen::Now,
    };

    // The owner appends gap-free; an old epoch or another host is fenced out.
    let mut tx = db.pool.begin().await?;
    let a = events::append(&mut tx, db.fence, thread, &body, Source::User, false).await?;
    let b = events::append(&mut tx, db.fence, thread, &body, Source::User, false).await?;
    tx.commit().await?;
    assert_eq!((a.seq, b.seq), (1, 2));
    for fence in [
        Fence {
            epoch: db.fence.epoch + 1,
            ..db.fence
        },
        Fence {
            host: new_id(),
            ..db.fence
        },
    ] {
        let mut tx = db.pool.begin().await?;
        let err = events::append(&mut tx, fence, thread, &body, Source::User, false).await;
        assert!(matches!(err, Err(AppendError::Fenced)), "{err:?}");
    }
    assert_eq!(
        events::read_range(&db.pool, thread, 0, i64::MAX)
            .await?
            .len(),
        2
    );

    // The audit chain verifies, and the app role can't rewrite it.
    for n in 0..3 {
        let mut tx = db.pool.begin().await?;
        let entry = audit::Entry {
            actor: "host",
            device_id: None,
            action: "test",
            detail: json!({ "n": n, "b": [1, "x"] }),
        };
        audit::append(&mut tx, db.space_id, entry).await?;
        tx.commit().await?;
    }
    assert_eq!(
        audit::verify(&db.pool, db.space_id).await?,
        Verdict::Intact { rows: 3 }
    );
    let denied = sqlx::query("UPDATE audit SET action = 'x'")
        .execute(&db.pool)
        .await;
    assert!(denied.is_err(), "weilo_app must not update audit");
    assert!(
        sqlx::query("DELETE FROM audit")
            .execute(&db.pool)
            .await
            .is_err()
    );

    // Someone signed in as the owner tampers; verification notices.
    let mut owner = PgConnection::connect_with(&pg.options(OWNER_ROLE, DATABASE)).await?;
    sqlx::query("UPDATE audit SET detail = '{\"n\": 9}' WHERE seq = 2")
        .execute(&mut owner)
        .await?;
    owner.close().await?;
    assert_eq!(
        audit::verify(&db.pool, db.space_id).await?,
        Verdict::BrokenAt { seq: 2 }
    );

    // The app role is not a superuser and can't skip row security.
    let (sup, bypass): (bool, bool) =
        sqlx::query_as("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user")
            .fetch_one(&db.pool)
            .await?;
    assert!(!sup && !bypass);

    // No role has a password: only peer auth over the socket lets anyone in.
    let mut admin = PgConnection::connect_with(&pg.options(ADMIN_ROLE, "postgres")).await?;
    let with_password: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_authid WHERE rolname LIKE 'weilo_%' AND rolpassword IS NOT NULL",
    )
    .fetch_one(&mut admin)
    .await?;
    assert_eq!(with_password, 0);
    admin.close().await?;

    prune_keeps_what_is_recent(&db).await?;
    db.pool.close().await;
    Ok(())
}

/// Call results go after 7 days, finished jobs after 30; newer ones stay.
async fn prune_keeps_what_is_recent(db: &db::Db) -> anyhow::Result<()> {
    let device = new_id();
    sqlx::query("INSERT INTO devices (id, space_id, name, token_hash) VALUES ($1, $2, 'T', $3)")
        .bind(device)
        .bind(db.space_id)
        .bind(device.as_bytes().to_vec())
        .execute(&db.pool)
        .await?;
    for (age, running) in [("8 days", false), ("8 days", true), ("1 day", false)] {
        sqlx::query(
            "INSERT INTO call_results (device_id, call_id, result, running, at)
             VALUES ($1, $2, 'null', $3, now() - $4::interval)",
        )
        .bind(device)
        .bind(new_id())
        .bind(running)
        .bind(age)
        .execute(&db.pool)
        .await?;
    }
    for (key, finished, attempts) in [
        ("old-done", Some("31 days"), 1),
        ("new-done", Some("1 day"), 1),
        ("waiting", None, 0),
        ("gave-up", None, 5),
    ] {
        sqlx::query(
            "INSERT INTO jobs (id, queue, job_key, attempts, finished_at, created_at)
             VALUES ($1, 'test', $2, $3, now() - $4::interval, now() - interval '40 days')",
        )
        .bind(new_id())
        .bind(key)
        .bind(attempts)
        .bind(finished)
        .execute(&db.pool)
        .await?;
    }
    assert_eq!(jobs::prune(&db.pool).await?, (2, 2));
    let left: Vec<String> = sqlx::query_scalar("SELECT job_key FROM jobs ORDER BY job_key")
        .fetch_all(&db.pool)
        .await?;
    assert_eq!(left, ["new-done", "waiting"]);
    Ok(())
}
