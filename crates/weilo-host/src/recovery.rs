//! What `weilo up` tidies before it serves: the projector catches up on every thread,
//! approvals left waiting by the last run are closed as "restarted", and threads that
//! were working go back to Idle with a problem the person can retry. Session starts cut
//! off half way are taken back.

use std::sync::Arc;

use anyhow::Result;
use uuid::Uuid;
use weilo_proto::{EventBody, WorkState};

use crate::app::App;
use crate::events::Source;
use crate::{approvals, projector};

pub const INTERRUPTED: &str = "Weilo restarted while this was working, so it stopped.";

/// Each item is handled on its own: one that fails is logged and the rest still are.
/// Errors only when the lists can't be read at all.
pub async fn run(app: &Arc<App>) -> Result<()> {
    // A session is saved in two steps (its name, then where it works). One cut off
    // between them never started: it has no copy of its repo and nothing in its chat.
    let unfinished = sqlx::query(
        "DELETE FROM threads WHERE space_id = $1 AND kind = 'session'
           AND worktree IS NULL AND last_seq = 0",
    )
    .bind(app.space_id)
    .execute(&app.db)
    .await;
    match unfinished {
        Ok(done) if done.rows_affected() > 0 => {
            tracing::info!(
                "took back {} unfinished session starts",
                done.rows_affected()
            );
        }
        Ok(_) => {}
        Err(e) => tracing::warn!("couldn't take back unfinished session starts: {e}"),
    }
    let behind: Vec<Uuid> = sqlx::query_scalar(
        "SELECT t.id FROM threads t
         LEFT JOIN projector_cursors c ON c.thread_id = t.id AND c.projection = 'threads'
         WHERE t.space_id = $1 AND t.last_seq > COALESCE(c.seq, 0)",
    )
    .bind(app.space_id)
    .fetch_all(&app.db)
    .await?;
    for thread_id in behind {
        if let Err(e) = projector::run(app, thread_id).await {
            tracing::warn!("couldn't bring thread {thread_id} up to date: {e:#}");
        }
    }

    let waiting: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM approvals WHERE space_id = $1 AND state = 'pending'")
            .bind(app.space_id)
            .fetch_all(&app.db)
            .await?;
    for approval_id in waiting {
        if let Err(e) = approvals::close_restarted(app, approval_id).await {
            tracing::warn!("couldn't close approval {approval_id}: {e:#}");
        }
    }

    let busy: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM threads WHERE space_id = $1 AND state IN ('working', 'needs_you')",
    )
    .bind(app.space_id)
    .fetch_all(&app.db)
    .await?;
    for thread_id in busy {
        if let Err(e) = settle(app, thread_id).await {
            tracing::warn!("couldn't settle thread {thread_id}: {e:#}");
        }
    }
    Ok(())
}

/// A thread that was working: says why it stopped, and goes back to Idle.
async fn settle(app: &Arc<App>, thread_id: Uuid) -> Result<()> {
    let problem = EventBody::Problem {
        message: INTERRUPTED.into(),
        action: Some("Try again".into()),
        code: Some("restarted".into()),
        engine: None,
    };
    app.append(thread_id, problem, Source::Host).await?;
    let idle = EventBody::State {
        state: WorkState::Idle,
        live_line: String::new(),
    };
    app.append(thread_id, idle, Source::Host).await?;
    Ok(())
}
