//! Read models: the sidebar's agents, channels and threads, prefs and setup.

use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::Row;
use sqlx::postgres::PgRow;
use uuid::Uuid;
use weilo_proto::{
    AgentSummary, Changed, ChannelSummary, SetupStatus, Snapshot, ThreadKind, ThreadSummary,
    UiPrefs,
};

use crate::app::App;
use crate::approvals;
use crate::db;
use crate::error::{CallError, CallResult};
use crate::projector::parse_state;

pub async fn snapshot(app: &App, device: Uuid) -> CallResult<Snapshot> {
    Ok(Snapshot {
        agents: agents(app, None).await?,
        channels: channels(app, None).await?,
        threads: threads(app, None).await?,
        needs_you: approvals::needs_you(app).await?,
        prefs: prefs(app, device).await?,
        setup: setup(app).await?,
    })
}

const AGENTS: &str = "
    SELECT a.id, a.name, a.color, a.engine, a.model, a.main_thread_id,
           COALESCE(s.state, 'idle') AS state, COALESCE(s.live_line, '') AS live_line
    FROM agents a
    LEFT JOIN LATERAL (
        SELECT t.state, t.live_line FROM threads t WHERE t.agent_id = a.id
        ORDER BY CASE t.state WHEN 'needs_you' THEN 0 WHEN 'working' THEN 1 ELSE 2 END,
                 t.updated_at DESC
        LIMIT 1) s ON true
    WHERE a.space_id = $1 AND a.stopped_at IS NULL AND ($2::uuid IS NULL OR a.id = $2)
    ORDER BY a.created_at";

pub async fn agents(app: &App, only: Option<Uuid>) -> CallResult<Vec<AgentSummary>> {
    let rows = sqlx::query(AGENTS)
        .bind(app.space_id)
        .bind(only)
        .fetch_all(&app.db)
        .await?;
    Ok(rows.iter().map(agent_from_row).collect())
}

pub async fn agent(app: &App, id: Uuid) -> CallResult<AgentSummary> {
    agents(app, Some(id))
        .await?
        .pop()
        .ok_or_else(|| CallError::not_found("That agent is gone."))
}

fn agent_from_row(r: &PgRow) -> AgentSummary {
    AgentSummary {
        id: r.get("id"),
        name: r.get("name"),
        color: r.get("color"),
        engine: r.get("engine"),
        model: r.get("model"),
        state: parse_state(r.get("state")),
        live_line: r.get("live_line"),
        main_thread_id: r
            .get::<Option<Uuid>, _>("main_thread_id")
            .unwrap_or_default(),
    }
}

pub async fn channels(app: &App, only: Option<Uuid>) -> CallResult<Vec<ChannelSummary>> {
    let rows = sqlx::query(
        "SELECT id, slug, title, archived_at IS NOT NULL AS archived FROM channels
         WHERE space_id = $1 AND ($2::uuid IS NULL OR id = $2) ORDER BY created_at",
    )
    .bind(app.space_id)
    .bind(only)
    .fetch_all(&app.db)
    .await?;
    Ok(rows
        .iter()
        .map(|r| ChannelSummary {
            id: r.get("id"),
            slug: r.get("slug"),
            title: r.get("title"),
            archived: r.get("archived"),
            unread: false,
        })
        .collect())
}

pub async fn channel(app: &App, id: Uuid) -> CallResult<ChannelSummary> {
    channels(app, Some(id))
        .await?
        .pop()
        .ok_or_else(|| CallError::not_found("That channel is gone."))
}

pub async fn threads(app: &App, only: Option<Uuid>) -> CallResult<Vec<ThreadSummary>> {
    let rows = sqlx::query(
        "SELECT t.id, t.kind, t.channel_id, t.agent_id, t.title, t.state, t.live_line, t.last_seq,
                t.engine, t.folder, t.worktree, t.started_by, t.updated_at
         FROM threads t LEFT JOIN agents a ON a.id = t.agent_id
         WHERE t.space_id = $1 AND ($2::uuid IS NULL OR t.id = $2)
           AND NOT (t.kind = 'agent' AND a.stopped_at IS NOT NULL)
         ORDER BY t.updated_at DESC",
    )
    .bind(app.space_id)
    .bind(only)
    .fetch_all(&app.db)
    .await?;
    Ok(rows.iter().map(thread_from_row).collect())
}

pub async fn thread(app: &App, id: Uuid) -> CallResult<ThreadSummary> {
    threads(app, Some(id))
        .await?
        .pop()
        .ok_or_else(|| CallError::not_found("That thread is gone."))
}

fn thread_from_row(r: &PgRow) -> ThreadSummary {
    let updated_at: DateTime<Utc> = r.get("updated_at");
    let worktree: Option<String> = r.get("worktree");
    ThreadSummary {
        id: r.get("id"),
        kind: match r.get::<&str, _>("kind") {
            "agent" => ThreadKind::Agent,
            "session" => ThreadKind::Session,
            _ => ThreadKind::Chat,
        },
        channel_id: r.get("channel_id"),
        agent_id: r.get("agent_id"),
        title: r.get("title"),
        state: parse_state(r.get("state")),
        live_line: r.get("live_line"),
        last_seq: r.get("last_seq"),
        engine: r.get("engine"),
        folder: r.get("folder"),
        started_by: r.get("started_by"),
        updated_at: updated_at.to_rfc3339(),
        branch: worktree.as_deref().and_then(crate::worktree::branch_of),
        worktree,
    }
}

pub async fn prefs(app: &App, device: Uuid) -> CallResult<UiPrefs> {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT prefs FROM ui_prefs WHERE device_id = $1")
            .bind(device)
            .fetch_optional(&app.db)
            .await?;
    Ok(value
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default())
}

pub async fn set_prefs(app: &App, device: Uuid, prefs: &UiPrefs) -> CallResult<()> {
    sqlx::query(
        "INSERT INTO ui_prefs (device_id, prefs) VALUES ($1, $2)
         ON CONFLICT (device_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()",
    )
    .bind(device)
    .bind(json!(prefs))
    .execute(&app.db)
    .await?;
    app.hub.changed(Changed::Prefs);
    Ok(())
}

pub async fn setup(app: &App) -> CallResult<SetupStatus> {
    let saved = db::get_setting(&app.db, "setup").await?.unwrap_or_default();
    Ok(SetupStatus {
        done: saved["done"].as_bool().unwrap_or(false),
        found_engines: app.engines.found(),
        keep_awake: saved["keep_awake"].as_bool().unwrap_or(false),
        check: None,
    })
}
