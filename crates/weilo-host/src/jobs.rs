//! A small job queue in Postgres, after Graphile Worker: jobs are claimed with
//! `FOR UPDATE SKIP LOCKED` and leased with `locked_by`/`locked_until`, so a crashed
//! worker's job runs again after its lease ends. Jobs run at least once.
//!
//! A finished job keeps its row (with `finished_at`) for 30 days; `maintenance.prune`
//! clears those, and stored call results after 7 days, once a day.

use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgConnection, PgPool, Row};
use uuid::Uuid;

use crate::app::App;
use crate::approvals;
use crate::ids::new_id;

pub const EXPIRE_APPROVAL: &str = "approvals.expire";
pub const PRUNE: &str = "maintenance.prune";

/// Tries for a job that must not give up (an approval's expiry): with the backoff capped
/// at about 17 minutes, decades of tries.
const KEEP_TRYING: i32 = 1_000_000;
/// How often waiting approvals past their time are closed, whatever their jobs did.
const SWEEP_EVERY: Duration = Duration::from_secs(60);

fn max_attempts(queue: &str) -> i32 {
    if queue == EXPIRE_APPROVAL {
        KEEP_TRYING
    } else {
        5
    }
}

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
        "INSERT INTO jobs (id, space_id, queue, job_key, run_at, payload, max_attempts)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (job_key) DO UPDATE
         SET run_at = EXCLUDED.run_at, payload = EXCLUDED.payload, attempts = 0, last_error = NULL,
             finished_at = NULL, locked_by = NULL, locked_until = NULL,
             max_attempts = EXCLUDED.max_attempts",
    )
    .bind(new_id())
    .bind(space_id)
    .bind(queue)
    .bind(job_key)
    .bind(run_at)
    .bind(payload)
    .bind(max_attempts(queue))
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
        let mut swept = tokio::time::Instant::now();
        loop {
            if swept.elapsed() >= SWEEP_EVERY {
                swept = tokio::time::Instant::now();
                if let Err(e) = sweep_expired(&app).await {
                    tracing::warn!("couldn't close expired approvals: {e:#}");
                }
            }
            match claim(&app, &worker).await {
                Ok(Some(job)) => finish(&app, &worker, &job, run(&app, &job).await).await,
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
             WHERE run_at <= now() AND attempts < max_attempts AND finished_at IS NULL
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
        PRUNE => {
            let (calls, jobs) = prune(&app.db).await?;
            tracing::info!("pruned {calls} old call results and {jobs} old jobs");
            schedule_prune(app, Utc::now() + chrono::Duration::days(1)).await?;
            Ok(())
        }
        other => anyhow::bail!("no handler for queue {other}"),
    }
}

/// Closes approvals still waiting past their time, in case their expiry job is late or
/// gone. Each one is tried on its own; one that fails is tried again next sweep.
pub async fn sweep_expired(app: &Arc<App>) -> Result<()> {
    let due: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM approvals WHERE space_id = $1 AND state = 'pending' AND expires_at <= now()",
    )
    .bind(app.space_id)
    .fetch_all(&app.db)
    .await?;
    for id in due {
        if let Err(e) = approvals::expire(app, id).await {
            tracing::warn!("couldn't expire approval {id}: {e:#}");
        }
    }
    Ok(())
}

/// Runs the prune at `at` (and from then on, once a day).
pub async fn schedule_prune(app: &App, at: DateTime<Utc>) -> sqlx::Result<()> {
    let mut conn = app.db.acquire().await?;
    enqueue(&mut conn, app.space_id, PRUNE, PRUNE, at, Value::Null).await
}

/// Deletes call results older than 7 days, and jobs finished (or given up on) over
/// 30 days ago. Returns how many of each.
pub async fn prune(db: &PgPool) -> sqlx::Result<(u64, u64)> {
    let calls = sqlx::query("DELETE FROM call_results WHERE at < now() - interval '7 days'")
        .execute(db)
        .await?
        .rows_affected();
    let jobs = sqlx::query(
        "DELETE FROM jobs WHERE finished_at < now() - interval '30 days'
            OR (finished_at IS NULL AND attempts >= max_attempts
                AND created_at < now() - interval '30 days')",
    )
    .execute(db)
    .await?
    .rows_affected();
    Ok((calls, jobs))
}

async fn finish(app: &App, worker: &str, job: &Job, result: Result<()>) {
    let outcome = match result {
        // A job that queued itself again (same key) was unlocked by `enqueue`, and stays due.
        Ok(()) => {
            sqlx::query(
                "UPDATE jobs SET finished_at = now(), locked_by = NULL, locked_until = NULL
                 WHERE id = $1 AND locked_by = $2",
            )
            .bind(job.id)
            .bind(worker)
            .execute(&app.db)
            .await
        }
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
