//! Engines: saving an API key, and checking that an engine works here.

use std::sync::Arc;

use serde_json::json;
use uuid::Uuid;
use weilo_proto::{Changed, EngineCheck, EngineInfo};

use crate::app::App;
use crate::audit;
use crate::engines::{Cmd, check};
use crate::error::{CallError, CallResult};

/// Saves (or, when empty, removes) a key. The key is first shown to its provider (a
/// free call): one it turns down is not saved. When the provider can't be reached, the
/// key is saved and noted as not checked yet. The key itself is never logged, audited
/// or sent back; the answer is the engine list, with `has_key` updated. An engine Weilo
/// downloads starts downloading now, so it is ready sooner.
pub async fn set_key(
    app: &Arc<App>,
    device: Uuid,
    engine: &str,
    provider: &str,
    key: &str,
) -> CallResult<Vec<EngineInfo>> {
    let m = app
        .engines
        .get(engine)
        .ok_or_else(|| CallError::invalid("That engine isn't available."))?;
    let Some(spec) = m.keys.iter().find(|k| k.id == provider) else {
        return Err(CallError::invalid(format!(
            "{} doesn't use {provider} keys.",
            m.title
        )));
    };
    let trimmed = key.trim();
    let answer = if trimmed.is_empty() {
        Some(true)
    } else {
        check::try_key(provider, trimmed).await
    };
    if answer == Some(false) {
        return Err(CallError::invalid(format!(
            "That {} key didn't work, so it wasn't saved. Check it and try again.",
            spec.title
        )));
    }
    app.engines
        .save_key(m, provider, key)
        .map_err(CallError::invalid)?;
    app.engines.mark_key(m, provider, trimmed, answer);
    if !trimmed.is_empty() && app.engines.needs_download(m) {
        let (app, m) = (app.clone(), m.clone());
        tokio::spawn(async move {
            if let Err(e) = app.engines.install(&m).await {
                tracing::warn!("couldn't download {}: {e}", m.name);
            }
            app.hub.changed(Changed::Engines);
        });
    }
    let mut tx = app.db.begin().await?;
    let detail =
        json!({ "engine": engine, "provider": provider, "removed": key.trim().is_empty() });
    let entry = audit::Entry {
        actor: "device",
        device_id: Some(device),
        action: "engine.set_key",
        detail,
    };
    audit::append(&mut tx, app.space_id, entry).await?;
    tx.commit().await?;
    // An engine process reads its key when it starts: running ones start again on their
    // next message (picking up their conversation).
    let threads: Vec<Uuid> = sqlx::query_scalar(
        "SELECT t.id FROM threads t LEFT JOIN agents a ON a.id = t.agent_id
         WHERE t.space_id = $1
           AND (CASE WHEN t.kind = 'session' THEN t.engine ELSE a.engine END) = $2",
    )
    .bind(app.space_id)
    .bind(engine)
    .fetch_all(&app.db)
    .await?;
    for thread_id in threads {
        app.runners.send_if_running(thread_id, Cmd::Restart);
    }
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
