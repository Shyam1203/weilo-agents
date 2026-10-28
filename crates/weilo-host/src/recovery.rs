//! What `weilo up` tidies before it serves: the projector catches up on every thread,
//! approvals left waiting by the last run are closed as "interrupted", and threads that
//! were working go back to Idle with a problem the person can retry.

use std::sync::Arc;

use anyhow::Result;
use uuid::Uuid;
use weilo_proto::{EventBody, WorkState};

use crate::app::App;
use crate::events::Source;
use crate::{approvals, projector};

pub const INTERRUPTED: &str = "Weilo restarted while this was working, so it stopped.";

pub async fn run(app: &Arc<App>) -> Result<()> {
    let behind: Vec<Uuid> = sqlx::query_scalar(
        "SELECT t.id FROM threads t
         LEFT JOIN projector_cursors c ON c.thread_id = t.id AND c.projection = 'threads'
         WHERE t.space_id = $1 AND t.last_seq > COALESCE(c.seq, 0)",
    )
    .bind(app.space_id)
    .fetch_all(&app.db)
    .await?;
    for thread_id in behind {
        projector::run(app, thread_id).await?;
    }

    let waiting: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM approvals WHERE space_id = $1 AND state = 'pending'")
            .bind(app.space_id)
            .fetch_all(&app.db)
            .await?;
    for approval_id in waiting {
        approvals::close_interrupted(app, approval_id).await?;
    }

    let busy: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM threads WHERE space_id = $1 AND state IN ('working', 'needs_you')",
    )
    .bind(app.space_id)
    .fetch_all(&app.db)
    .await?;
    for thread_id in busy {
        let problem = EventBody::Problem {
            message: INTERRUPTED.into(),
            action: Some("Try again".into()),
        };
        app.append(thread_id, problem, Source::Host).await?;
        let idle = EventBody::State {
            state: WorkState::Idle,
            live_line: String::new(),
        };
        app.append(thread_id, idle, Source::Host).await?;
    }
    Ok(())
}
