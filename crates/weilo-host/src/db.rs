//! Connection pools, migrations and the rows every host needs (its id, epoch and space).
//!
//! Each `weilo up` raises the host's epoch and moves its threads to it, so a host process
//! from an earlier start that is somehow still running can't append to them any more.

use anyhow::{Context, Result};
use serde_json::json;
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};
use uuid::Uuid;

use crate::ids::new_id;
use crate::pg::{APP_ROLE, DATABASE, OWNER_ROLE, Postgres};

/// Whether an error came from Postgres being out of reach (restarting, a broken
/// connection, no answer in time), so the same thing may work in a moment.
pub fn unreachable(e: &anyhow::Error) -> bool {
    let sql = e
        .downcast_ref::<sqlx::Error>()
        .or_else(|| match e.downcast_ref() {
            Some(crate::events::AppendError::Db(sql)) => Some(sql),
            _ => None,
        });
    sql.is_some_and(unreachable_sql)
}

/// `unreachable`, for a database error.
pub fn unreachable_sql(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Io(_)
        | sqlx::Error::PoolTimedOut
        | sqlx::Error::WorkerCrashed
        | sqlx::Error::Protocol(_) => true,
        sqlx::Error::Database(db) => db.code().is_some_and(|c| {
            // Connection problems, shutdown or crash recovery, too many connections, a
            // statement that ran out of time (`statement_timeout`).
            c.starts_with("08") || c.starts_with("57P") || c == "53300" || c == "57014"
        }),
        _ => false,
    }
}

/// Asks Postgres something small every few seconds, on a connection of its own, and
/// tells the app whether it answers: a database that runs but is stuck (paused, a full
/// disk), missing two checks in a row, is said to every device within seconds, and calls stop waiting on it. While
/// Postgres is known to be restarting, nothing is asked. Ends when the host stops.
pub async fn check_answers(app: std::sync::Arc<crate::app::App>, options: PgConnectOptions) {
    use sqlx::Connection;
    let (every, wait) = (app.settings.db_check_every, app.settings.db_check_wait);
    let mut conn: Option<sqlx::PgConnection> = None;
    // Misses in a row: one alone (a slow moment) isn't said; it is asked again soon,
    // on a new connection.
    let mut misses = 0u32;
    loop {
        let pause = if misses == 1 { AGAIN_AFTER_MISS } else { every };
        tokio::select! {
            _ = tokio::time::sleep(pause) => {}
            _ = app.shutdown.cancelled() => return,
        }
        if !*app.db_up.borrow() {
            conn = None;
            misses = 0;
            continue;
        }
        let asked = tokio::time::timeout(wait, async {
            if conn.is_none() {
                conn = Some(sqlx::PgConnection::connect_with(&options).await?);
            }
            let c = conn.as_mut().expect("connected");
            sqlx::query("SELECT 1").execute(c).await?;
            Ok::<(), sqlx::Error>(())
        })
        .await;
        if matches!(asked, Ok(Ok(()))) {
            misses = 0;
        } else {
            // Its state is unknown: a new connection next time.
            conn = None;
            misses = misses.saturating_add(1);
            if misses == 2 && *app.db_answers.borrow() && *app.db_up.borrow() {
                tracing::warn!("the database doesn't answer: {asked:?}");
            }
        }
        // Postgres may have gone down meanwhile: then that is what is said.
        if *app.db_up.borrow() && misses != 1 {
            app.set_db_answers(misses == 0);
        }
    }
}

/// How soon a database that missed one check is asked again.
const AGAIN_AFTER_MISS: std::time::Duration = std::time::Duration::from_millis(500);

/// The longest one statement of the app may run.
pub const STATEMENT_TIMEOUT: &str = "30s";

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Who may append to a thread: the owning host at its current epoch.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fence {
    pub host: Uuid,
    pub epoch: i64,
}

pub struct Db {
    /// Runs as `weilo_app` (not the owner, no BYPASSRLS).
    pub pool: PgPool,
    pub fence: Fence,
    pub space_id: Uuid,
}

/// Migrates as the owner, then opens the app's pool.
pub async fn open(pg: &Postgres) -> Result<Db> {
    migrate(pg).await?;
    // How long a query waits for Postgres while it restarts (a test knob).
    let wait = std::env::var("WEILO_DB_WAIT_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30);
    // No statement runs for ever: one stuck behind a lock ends after this and fails
    // like an unreachable database (`SET LOCAL statement_timeout = 0` for the few that
    // are long by nature).
    let options = pg
        .options(APP_ROLE, DATABASE)
        .options([("statement_timeout", STATEMENT_TIMEOUT)]);
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .acquire_timeout(std::time::Duration::from_secs(wait))
        .connect_with(options)
        .await
        .context("couldn't connect as weilo_app")?;
    let fence = host_identity(&pool).await?;
    let space_id = home_space(&pool).await?;
    Ok(Db {
        pool,
        fence,
        space_id,
    })
}

pub async fn migrate(pg: &Postgres) -> Result<()> {
    let owner = PgPoolOptions::new()
        .max_connections(2)
        .connect_with(pg.options(OWNER_ROLE, DATABASE))
        .await
        .context("couldn't connect as weilo_owner")?;
    MIGRATOR.run(&owner).await.context("migration failed")?;
    sqlx::raw_sql(&grants_sql()).execute(&owner).await?;
    owner.close().await;
    Ok(())
}

/// What `weilo_app` may do. The audit log and the event log are insert-only for it.
fn grants_sql() -> String {
    format!(
        "GRANT USAGE ON SCHEMA public TO {APP_ROLE};
         GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE};
         REVOKE ALL ON _sqlx_migrations FROM {APP_ROLE};
         REVOKE UPDATE, DELETE, TRUNCATE ON audit FROM {APP_ROLE};
         REVOKE UPDATE, DELETE, TRUNCATE ON events FROM {APP_ROLE};
         REVOKE DELETE, TRUNCATE ON audit_head FROM {APP_ROLE};"
    )
}

pub async fn get_setting(pool: &PgPool, key: &str) -> Result<Option<serde_json::Value>> {
    Ok(
        sqlx::query_scalar("SELECT value FROM settings WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn set_setting<'e>(
    exec: impl sqlx::PgExecutor<'e>,
    key: &str,
    value: &serde_json::Value,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
    )
    .bind(key)
    .bind(value)
    .execute(exec)
    .await?;
    Ok(())
}

/// The host's id, with its epoch raised by one for this start. Its threads move to the
/// new epoch in the same transaction, which fences out any writer still holding the old one.
async fn host_identity(pool: &PgPool) -> Result<Fence> {
    let mut tx = pool.begin().await?;
    let current: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'host' FOR UPDATE")
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(v) = current {
        let host: Uuid = serde_json::from_value(v["id"].clone())?;
        let epoch = v["epoch"].as_i64().unwrap_or(1) + 1;
        set_setting(&mut *tx, "host", &json!({ "id": host, "epoch": epoch })).await?;
        sqlx::query("UPDATE threads SET owner_epoch = $2 WHERE owner_host = $1")
            .bind(host)
            .bind(epoch)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Ok(Fence { host, epoch });
    }
    drop(tx);
    let fence = Fence {
        host: new_id(),
        epoch: 1,
    };
    set_setting(
        pool,
        "host",
        &json!({ "id": fence.host, "epoch": fence.epoch }),
    )
    .await?;
    Ok(fence)
}

async fn home_space(pool: &PgPool) -> Result<Uuid> {
    if let Some(v) = get_setting(pool, "space").await? {
        return Ok(serde_json::from_value(v)?);
    }
    let id = new_id();
    let mut tx = pool.begin().await?;
    sqlx::query("INSERT INTO spaces (id, name) VALUES ($1, 'Home')")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO audit_head (space_id, seq, hash) VALUES ($1, 0, $2)")
        .bind(id)
        .bind(vec![0u8; 32])
        .execute(&mut *tx)
        .await?;
    set_setting(&mut *tx, "space", &json!(id)).await?;
    tx.commit().await?;
    Ok(id)
}
