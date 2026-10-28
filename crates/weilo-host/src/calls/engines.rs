//! Engines: saving an API key, and checking that an engine works here.

use std::sync::Arc;

use serde_json::json;
use uuid::Uuid;
use weilo_proto::{Changed, EngineCheck, EngineInfo};

use crate::app::App;
use crate::audit;
use crate::engines::check;
use crate::error::{CallError, CallResult};

/// Saves (or, when empty, removes) a key. The key itself is never logged, audited or
/// sent back; the answer is the engine list, with `has_key` updated.
pub async fn set_key(
    app: &App,
    device: Uuid,
    engine: &str,
    provider: &str,
    key: &str,
) -> CallResult<Vec<EngineInfo>> {
    let m = app
        .engines
        .get(engine)
        .ok_or_else(|| CallError::invalid("That engine isn't available."))?;
    app.engines
        .save_key(m, provider, key)
        .map_err(CallError::invalid)?;
    let mut tx = app.db.begin().await?;
    let detail = json!({ "engine": engine, "provider": provider, "removed": key.trim().is_empty() });
    let entry = audit::Entry {
        actor: "device",
        device_id: Some(device),
        action: "engine.set_key",
        detail,
    };
    audit::append(&mut tx, app.space_id, entry).await?;
    tx.commit().await?;
    app.hub.changed(Changed::Engines);
    Ok(app.engines.list())
}

pub async fn check(app: &Arc<App>, engine: &str) -> CallResult<EngineCheck> {
    let m = app
        .engines
        .get(engine)
        .cloned()
        .ok_or_else(|| CallError::invalid("That engine isn't available."))?;
    let result = check::run(app, &m).await;
    app.hub.changed(Changed::Engines);
    Ok(result)
}
