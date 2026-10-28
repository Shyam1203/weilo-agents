//! Keeps each thread's state and live line up to date from its events.
//!
//! Reads events after `projector_cursors.seq` in order, and updates the thread and the
//! cursor in one transaction, so it can always be re-run or rebuilt. In this release it
//! runs right after each commit instead of as a job.

use anyhow::Result;
use sqlx::Row;
use uuid::Uuid;
use weilo_proto::{Changed, EventBody, StepStatus, WorkState};

use crate::app::App;
use crate::events;

const PROJECTION: &str = "threads";

pub async fn run(app: &App, thread_id: Uuid) -> Result<()> {
    let mut tx = app.db.begin().await?;
    sqlx::query(
        "INSERT INTO projector_cursors (projection, thread_id, seq) VALUES ($1, $2, 0)
         ON CONFLICT DO NOTHING",
    )
    .bind(PROJECTION)
    .bind(thread_id)
    .execute(&mut *tx)
    .await?;
    let cursor: i64 = sqlx::query_scalar(
        "SELECT seq FROM projector_cursors WHERE projection = $1 AND thread_id = $2 FOR UPDATE",
    )
    .bind(PROJECTION)
    .bind(thread_id)
    .fetch_one(&mut *tx)
    .await?;
    let thread = sqlx::query("SELECT state, live_line, agent_id, last_seq FROM threads WHERE id = $1")
        .bind(thread_id)
        .fetch_one(&mut *tx)
        .await?;
    let last_seq: i64 = thread.get("last_seq");
    if last_seq <= cursor {
        return Ok(());
    }
    let evs = events::read_range(&mut *tx, thread_id, cursor, last_seq).await?;
    let before = (parse_state(thread.get("state")), thread.get::<String, _>("live_line"));
    let mut view = before.clone();
    let mut needs_you = false;
    for ev in &evs {
        needs_you |= apply(&mut view, &ev.body);
    }
    let new_cursor = evs.last().map_or(cursor, |e| e.seq);
    sqlx::query("UPDATE threads SET state = $2, live_line = $3 WHERE id = $1")
        .bind(thread_id)
        .bind(state_str(view.0))
        .bind(&view.1)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE projector_cursors SET seq = $3 WHERE projection = $1 AND thread_id = $2")
        .bind(PROJECTION)
        .bind(thread_id)
        .bind(new_cursor)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    if view != before {
        app.hub.changed(Changed::Threads);
        if thread.get::<Option<Uuid>, _>("agent_id").is_some() {
            app.hub.changed(Changed::Agents);
        }
    }
    if needs_you {
        app.hub.changed(Changed::NeedsYou);
    }
    Ok(())
}

/// Applies one event to (state, live line). Returns true when Needs you changed.
fn apply(view: &mut (WorkState, String), body: &EventBody) -> bool {
    match body {
        EventBody::State { state, live_line } => {
            *view = (*state, live_line.clone());
            false
        }
        EventBody::Step { title, status: StepStatus::Running, .. } => {
            view.1 = title.clone();
            false
        }
        EventBody::Card { .. } | EventBody::ApprovalDecided { .. } => true,
        _ => false,
    }
}

pub fn parse_state(s: &str) -> WorkState {
    match s {
        "working" => WorkState::Working,
        "needs_you" => WorkState::NeedsYou,
        _ => WorkState::Idle,
    }
}

pub fn state_str(s: WorkState) -> &'static str {
    match s {
        WorkState::Idle => "idle",
        WorkState::Working => "working",
        WorkState::NeedsYou => "needs_you",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn running_step_sets_live_line_and_state_resets_it() {
        let mut view = (WorkState::Idle, String::new());
        apply(&mut view, &EventBody::State { state: WorkState::Working, live_line: String::new() });
        apply(
            &mut view,
            &EventBody::Step { step_id: "1".into(), title: "Read the request".into(), status: StepStatus::Running },
        );
        assert_eq!(view, (WorkState::Working, "Read the request".to_string()));
        apply(&mut view, &EventBody::State { state: WorkState::Idle, live_line: String::new() });
        assert_eq!(view, (WorkState::Idle, String::new()));
    }
}
