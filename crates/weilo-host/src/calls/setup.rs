//! First run: make Ava and #general, and keep the computer awake if asked.

use serde_json::json;
use uuid::Uuid;
use weilo_proto::{Changed, SetupStatus};

use super::{agents, channels, read};
use crate::app::App;
use crate::audit;
use crate::db;
use crate::error::{CallError, CallResult};

pub async fn finish(
    app: &App,
    device: Uuid,
    engine: &str,
    keep_awake: bool,
) -> CallResult<SetupStatus> {
    if read::setup(app).await?.done {
        return Err(CallError::conflict("Setup is already done."));
    }
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
    agents::create_in(app, &mut tx, device, "Ava", engine, None).await?;
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
    read::setup(app).await
}
