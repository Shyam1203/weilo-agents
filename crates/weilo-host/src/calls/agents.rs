//! Agents: a teammate with its own chat (its main thread).

use std::sync::Arc;

use serde_json::json;
use sqlx::PgConnection;
use uuid::Uuid;
use weilo_proto::{AgentSummary, Changed};

use super::read;
use super::threads::{NewThread, insert_thread};
use crate::app::App;
use crate::audit;
use crate::engines::Cmd;
use crate::error::{CallError, CallResult};
use crate::ids::new_id;
use crate::slug::{slugify, unique};

const COLORS: [&str; 4] = ["violet", "sky", "rose", "teal"];

pub async fn create(
    app: &App,
    device: Uuid,
    name: &str,
    engine: &str,
    model: Option<String>,
) -> CallResult<AgentSummary> {
    let mut tx = app.db.begin().await?;
    let id = create_in(app, &mut tx, device, name, engine, model).await?;
    tx.commit().await?;
    app.hub.changed(Changed::Agents);
    app.hub.changed(Changed::Threads);
    read::agent(app, id).await
}

/// Inserts the agent and its main thread. Returns the agent's id.
pub async fn create_in(
    app: &App,
    tx: &mut PgConnection,
    device: Uuid,
    name: &str,
    engine: &str,
    model: Option<String>,
) -> CallResult<Uuid> {
    let name = clean_name(name)?;
    if app.engines.get(engine).is_none() {
        return Err(CallError::invalid("That engine isn't available."));
    }
    let taken: Vec<String> = sqlx::query_scalar("SELECT slug FROM agents WHERE space_id = $1")
        .bind(app.space_id)
        .fetch_all(&mut *tx)
        .await?;
    let slug = unique(&slugify(&name), |s| taken.iter().any(|t| t == s));
    let color = COLORS[taken.len() % COLORS.len()];
    let (id, thread_id) = (new_id(), new_id());
    sqlx::query(
        "INSERT INTO agents (id, space_id, name, slug, color, engine, model, main_thread_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(id)
    .bind(app.space_id)
    .bind(&name)
    .bind(&slug)
    .bind(color)
    .bind(engine)
    .bind(&model)
    .bind(thread_id)
    .execute(&mut *tx)
    .await?;
    let thread = NewThread {
        id: thread_id,
        kind: "agent",
        agent_id: Some(id),
        title: name.clone(),
        ..NewThread::default()
    };
    insert_thread(app, tx, &thread).await?;
    let detail = json!({ "agent_id": id, "name": name, "engine": engine });
    audit::append(
        tx,
        app.space_id,
        audit::Entry {
            actor: "device",
            device_id: Some(device),
            action: "agent.create",
            detail,
        },
    )
    .await?;
    Ok(id)
}

pub async fn update(
    app: &App,
    device: Uuid,
    agent_id: Uuid,
    name: Option<String>,
    model: Option<String>,
    instructions: Option<String>,
) -> CallResult<AgentSummary> {
    let name = name.map(|n| clean_name(&n)).transpose()?;
    let mut tx = app.db.begin().await?;
    let done = sqlx::query(
        "UPDATE agents SET name = COALESCE($3, name), model = COALESCE($4, model),
                instructions = COALESCE($5, instructions)
         WHERE id = $1 AND space_id = $2",
    )
    .bind(agent_id)
    .bind(app.space_id)
    .bind(&name)
    .bind(&model)
    .bind(&instructions)
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() == 0 {
        return Err(CallError::not_found("That agent is gone."));
    }
    if let Some(name) = &name {
        sqlx::query("UPDATE threads SET title = $2 WHERE agent_id = $1 AND kind = 'agent'")
            .bind(agent_id)
            .bind(name)
            .execute(&mut *tx)
            .await?;
    }
    let detail = json!({ "agent_id": agent_id, "name": name, "model": model, "instructions_changed": instructions.is_some() });
    audit::append(
        &mut tx,
        app.space_id,
        audit::Entry {
            actor: "device",
            device_id: Some(device),
            action: "agent.update",
            detail,
        },
    )
    .await?;
    tx.commit().await?;
    app.hub.changed(Changed::Agents);
    read::agent(app, agent_id).await
}

/// Stops whatever the agent is doing, in every thread it owns.
pub async fn stop(app: &Arc<App>, agent_id: Uuid) -> CallResult<()> {
    let threads: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM threads WHERE agent_id = $1 AND space_id = $2")
            .bind(agent_id)
            .bind(app.space_id)
            .fetch_all(&app.db)
            .await?;
    if threads.is_empty() {
        return Err(CallError::not_found("That agent is gone."));
    }
    for thread_id in threads {
        app.runners.send_if_running(thread_id, Cmd::Stop);
    }
    Ok(())
}

fn clean_name(name: &str) -> CallResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return Err(CallError::invalid(
            "Give the agent a name of up to 40 letters.",
        ));
    }
    Ok(name.to_string())
}
