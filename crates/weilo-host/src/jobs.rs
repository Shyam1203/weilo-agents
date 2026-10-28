//! A small job queue in Postgres, after Graphile Worker: jobs are claimed with
//! `FOR UPDATE SKIP LOCKED` and leased with `locked_by`/`locked_until`, so a crashed
//! worker's job runs again after its lease ends. Jobs run at least once.

use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::app::App;
use crate::approvals;
use crate::ids::new_id;

pub const EXPIRE_APPROVAL: &str = "approvals.expire";

/// Adds a job, or moves an existing one with the same key to the new time.
pub async fn enqueue(
    conn: &mut PgConnection,
    space_id: Uuid,
    queue: &str,
    job_key: &str,
    run_at: DateTime<Utc>,
    payload: Value,
) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO jobs (id, space_id, queue, job_key, run_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (job_key) DO UPDATE
         SET run_at = EXCLUDED.run_at, payload = EXCLUDED.payload, attempts = 0, last_error = NULL",
    )
    .bind(new_id())
    .bind(space_id)
    .bind(queue)
    .bind(job_key)
    .bind(run_at)
    .bind(payload)
    .execute(conn)
    .await?;
    Ok(())
}

struct Job {
    id: Uuid,
    queue: String,
    payload: Value,
    attempts: i32,
}

pub fn spawn_worker(app: Arc<App>) -> tokio::task::JoinHandle<()> {
    let worker = format!("host-{}", new_id());
    tokio::spawn(async move {
        loop {
            match claim(&app, &worker).await {
                Ok(Some(job)) => finish(&app, &job, run(&app, &job).await).await,
                Ok(None) => tokio::time::sleep(app.settings.job_poll).await,
                Err(e) => {
                    tracing::warn!("job queue: {e}");
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
            }
        }
    })
}

async fn claim(app: &App, worker: &str) -> sqlx::Result<Option<Job>> {
    let row = sqlx::query(
        "UPDATE jobs SET locked_by = $1, locked_until = now() + interval '5 minutes',
                attempts = attempts + 1
         WHERE id = (
             SELECT id FROM jobs
             WHERE run_at <= now() AND attempts < max_attempts
               AND (locked_until IS NULL OR locked_until < now())
             ORDER BY run_at LIMIT 1
             FOR UPDATE SKIP LOCKED)
         RETURNING id, queue, payload, attempts",
    )
    .bind(worker)
    .fetch_optional(&app.db)
    .await?;
    Ok(row.map(|r| Job {
        id: r.get("id"),
        queue: r.get("queue"),
        payload: r.get("payload"),
        attempts: r.get("attempts"),
    }))
}

async fn run(app: &Arc<App>, job: &Job) -> Result<()> {
    match job.queue.as_str() {
        EXPIRE_APPROVAL => {
            let id: Uuid = serde_json::from_value(job.payload["approval_id"].clone())?;
            approvals::expire(app, id).await
        }
        other => anyhow::bail!("no handler for queue {other}"),
    }
}

async fn finish(app: &App, job: &Job, result: Result<()>) {
    let outcome = match result {
        Ok(()) => sqlx::query("DELETE FROM jobs WHERE id = $1").bind(job.id).execute(&app.db).await,
        Err(e) => {
            tracing::warn!("job {} ({}) failed: {e:#}", job.id, job.queue);
            let backoff = 2f64.powi(job.attempts.min(10));
            sqlx::query(
                "UPDATE jobs SET last_error = $2, locked_by = NULL, locked_until = NULL,
                        run_at = now() + make_interval(secs => $3)
                 WHERE id = $1",
            )
            .bind(job.id)
            .bind(e.to_string())
            .bind(backoff)
            .execute(&app.db)
            .await
        }
    };
    if let Err(e) = outcome {
        tracing::warn!("couldn't record job {}: {e}", job.id);
    }
}
