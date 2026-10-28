//! Connection pools, migrations and the rows every host needs (its id, epoch and space).

use anyhow::{Context, Result};
use serde_json::json;
use sqlx::postgres::{PgPool, PgPoolOptions};
use uuid::Uuid;

use crate::ids::new_id;
use crate::pg::{APP_ROLE, DATABASE, OWNER_ROLE, Postgres};

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
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect_with(pg.options(APP_ROLE, DATABASE))
        .await
        .context("couldn't connect as weilo_app")?;
    let fence = host_identity(&pool).await?;
    let space_id = home_space(&pool).await?;
    Ok(Db { pool, fence, space_id })
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

/// What `weilo_app` may do. The audit log is insert-only for it.
fn grants_sql() -> String {
    format!(
        "GRANT USAGE ON SCHEMA public TO {APP_ROLE};
         GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE};
         REVOKE ALL ON _sqlx_migrations FROM {APP_ROLE};
         REVOKE UPDATE, DELETE, TRUNCATE ON audit FROM {APP_ROLE};
         REVOKE DELETE, TRUNCATE ON audit_head FROM {APP_ROLE};"
    )
}

pub async fn get_setting(pool: &PgPool, key: &str) -> Result<Option<serde_json::Value>> {
    Ok(sqlx::query_scalar("SELECT value FROM settings WHERE key = $1")
        .bind(key)
        .fetch_optional(pool)
        .await?)
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

async fn host_identity(pool: &PgPool) -> Result<Fence> {
    if let Some(v) = get_setting(pool, "host").await? {
        let host = serde_json::from_value(v["id"].clone())?;
        let epoch = v["epoch"].as_i64().unwrap_or(1);
        return Ok(Fence { host, epoch });
    }
    let fence = Fence { host: new_id(), epoch: 1 };
    set_setting(pool, "host", &json!({ "id": fence.host, "epoch": fence.epoch })).await?;
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
