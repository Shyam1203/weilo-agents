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
use weilo_host::pg::{DATABASE, OWNER_ROLE, Postgres};
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

    // Someone with the owner's password tampers; verification notices.
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
    db.pool.close().await;
    Ok(())
}
