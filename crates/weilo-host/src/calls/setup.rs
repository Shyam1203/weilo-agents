//! First run: make Ava and #general, and keep the computer awake if asked.
//!
//! The chosen engine is tried first. Ava is made either way (so the person can fix the
//! engine and carry on), but a failed try is never quiet: it comes back as `check`, and
//! as a problem with the fix at the top of Ava's chat.

use std::sync::Arc;

use serde_json::json;
use uuid::Uuid;
use weilo_proto::{Changed, EventBody, SetupStatus};

use super::{agents, channels, read};
use crate::app::App;
use crate::audit;
use crate::db;
use crate::engines::check;
use crate::error::{CallError, CallResult};
use crate::events::Source;

pub async fn finish(
    app: &Arc<App>,
    device: Uuid,
    engine: &str,
    keep_awake: bool,
) -> CallResult<SetupStatus> {
    if read::setup(app).await?.done {
        return Err(CallError::conflict("Setup is already done."));
    }
    let m = app
        .engines
        .get(engine)
        .cloned()
        .ok_or_else(|| CallError::invalid("That engine isn't available."))?;
    let tried = check::run(app, &m).await;
    let mut tx = app.db.begin().await?;
    // Two finishes at once: the second waits here and then sees setup done.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('weilo.setup'))")
        .execute(&mut *tx)
        .await?;
    let done: Option<bool> =
        sqlx::query_scalar("SELECT (value->>'done')::bool FROM settings WHERE key = 'setup'")
            .fetch_optional(&mut *tx)
            .await?
            .flatten();
    if done == Some(true) {
        return Err(CallError::conflict("Setup is already done."));
    }
    let ava = agents::create_in(app, &mut tx, device, "Ava", engine, None).await?;
    channels::create_in(app, &mut tx, device, "general").await?;
    let setup = json!({ "done": true, "keep_awake": keep_awake, "engine": engine });
    db::set_setting(&mut *tx, "setup", &setup).await?;
    let entry = audit::Entry {
        actor: "device",
        device_id: Some(device),
        action: "setup.finish",
        detail: setup,
    };
    audit::append(&mut tx, app.space_id, entry).await?;
    tx.commit().await?;
    if keep_awake && !app.keep_awake.start() {
        tracing::info!("nothing here can keep the computer awake");
    }
    for what in [Changed::Agents, Changed::Channels, Changed::Threads] {
        app.hub.changed(what);
    }
    if !tried.ready {
        let thread: Option<Uuid> =
            sqlx::query_scalar("SELECT id FROM threads WHERE agent_id = $1 AND kind = 'agent'")
                .bind(ava)
                .fetch_optional(&app.db)
                .await?;
        if let Some(thread) = thread {
            let problem = EventBody::Problem {
                message: tried.message.clone(),
                action: tried.action.clone(),
            };
            if let Err(e) = app.append(thread, problem, Source::Host).await {
                tracing::warn!("couldn't note the engine problem: {e:#}");
            }
        }
    }
    let mut status = read::setup(app).await?;
    status.check = Some(tried);
    Ok(status)
}
