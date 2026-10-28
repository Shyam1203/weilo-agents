//! Approvals: an engine asks, a card goes to Needs you, and the first answer wins.
//!
//! Every decision is a compare-and-set on `state = 'pending' AND expires_at > now()`,
//! with its event and audit row in the same transaction. Unanswered approvals expire
//! (24 h by default) through a job, and the engine is told "not allowed".

use std::sync::Arc;

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;
use weilo_proto::{ApprovalState, Card, Decision, EventBody, NeedsYouItem, RiskClass};

use crate::app::App;
use crate::audit::{self, canonical_json};
use crate::engines::Cmd;
use crate::error::{CallError, CallResult};
use crate::events::{self, Source};
use crate::ids::new_id;
use crate::jobs;

pub struct NewApproval {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub card: Card,
    pub tool: String,
    pub scope: String,
    pub agent_id: Option<Uuid>,
}

/// Saves the approval and its card event, and schedules its expiry.
pub async fn open(app: &App, a: NewApproval) -> Result<()> {
    let mut tx = app.db.begin().await?;
    let body = EventBody::Card {
        card: a.card.clone(),
    };
    let ev = events::append(
        &mut tx,
        app.fence,
        a.thread_id,
        &body,
        Source::Engine,
        false,
    )
    .await?;
    let class = risk_str(a.card.risk);
    let payload = json!({
        "approval_id": a.id, "thread_id": a.thread_id, "seq": ev.seq, "class": class,
        "tool": a.tool, "details": a.card.details, "scope": a.scope,
    });
    let hash = Sha256::digest(canonical_json(&payload).as_bytes()).to_vec();
    let ttl = app.settings.approval_ttl.as_secs_f64();
    let expires_at: DateTime<Utc> = sqlx::query_scalar(
        "INSERT INTO approvals (id, space_id, thread_id, seq, class, agent_id, tool, scope, card,
                                payload_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(secs => $11))
         RETURNING expires_at",
    )
    .bind(a.id)
    .bind(app.space_id)
    .bind(a.thread_id)
    .bind(ev.seq)
    .bind(class)
    .bind(a.agent_id)
    .bind(&a.tool)
    .bind(&a.scope)
    .bind(serde_json::to_value(&a.card)?)
    .bind(hash)
    .bind(ttl)
    .fetch_one(&mut *tx)
    .await?;
    let key = format!("expire:{}", a.id);
    let payload = json!({ "approval_id": a.id });
    jobs::enqueue(
        &mut tx,
        app.space_id,
        jobs::EXPIRE_APPROVAL,
        &key,
        expires_at,
        payload,
    )
    .await?;
    tx.commit().await?;
    app.committed(a.thread_id, vec![ev]).await;
    Ok(())
}

/// A person's answer. Fails with `conflict` when it was already answered or expired.
pub async fn decide(
    app: &Arc<App>,
    device_id: Uuid,
    approval_id: Uuid,
    decision: Decision,
) -> CallResult<()> {
    let state = if decision == Decision::Deny {
        "denied"
    } else {
        "allowed"
    };
    let mut tx = app.db.begin().await?;
    let row = sqlx::query(
        "UPDATE approvals SET state = $2, decided_by_device = $3, decided_via = 'app',
                decided_at = now()
         WHERE id = $1 AND state = 'pending' AND expires_at > now()
         RETURNING thread_id, agent_id, tool, scope",
    )
    .bind(approval_id)
    .bind(state)
    .bind(device_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        return Err(why_not_pending(app, approval_id).await);
    };
    let thread_id: Uuid = row.get("thread_id");
    let body = EventBody::ApprovalDecided {
        approval_id,
        decision: decision.clone(),
        via: "app".into(),
    };
    let ev = events::append(&mut tx, app.fence, thread_id, &body, Source::User, false).await?;
    if let Decision::AllowAlways { .. } = &decision {
        sqlx::query(
            "INSERT INTO allow_rules (id, space_id, agent_id, tool, scope, created_by_device)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(new_id())
        .bind(app.space_id)
        .bind(row.get::<Option<Uuid>, _>("agent_id"))
        .bind(row.get::<String, _>("tool"))
        .bind(row.get::<String, _>("scope"))
        .bind(device_id)
        .execute(&mut *tx)
        .await?;
    }
    let detail = json!({ "approval_id": approval_id, "decision": decision, "via": "app" });
    let entry = audit::Entry {
        actor: "device",
        device_id: Some(device_id),
        action: "approval.decide",
        detail,
    };
    audit::append(&mut tx, app.space_id, entry).await?;
    tx.commit().await?;
    app.committed(thread_id, vec![ev]).await;
    app.runners.send_if_running(
        thread_id,
        Cmd::Decided {
            approval_id,
            decision,
        },
    );
    Ok(())
}

async fn why_not_pending(app: &App, approval_id: Uuid) -> CallError {
    let row =
        sqlx::query("SELECT state, expires_at <= now() AS expired FROM approvals WHERE id = $1")
            .bind(approval_id)
            .fetch_optional(&app.db)
            .await;
    match row {
        Ok(None) => CallError::not_found("This request is gone."),
        Ok(Some(r)) if r.get::<String, _>("state") == "expired" || r.get::<bool, _>("expired") => {
            CallError::conflict("This request expired.")
        }
        Ok(Some(_)) => CallError::conflict("This was already answered."),
        Err(e) => e.into(),
    }
}

/// Run by the job queue when an approval's time is up.
pub async fn expire(app: &Arc<App>, approval_id: Uuid) -> Result<()> {
    close(
        app,
        approval_id,
        "expired",
        "expired",
        "expires_at <= now()",
    )
    .await
}

/// Stop was pressed while the approval waited.
pub async fn close_stopped(app: &Arc<App>, approval_id: Uuid) -> Result<()> {
    close(app, approval_id, "denied", "stopped", "true").await
}

/// Weilo stopped while the approval waited: the engine that asked is gone.
pub async fn close_interrupted(app: &Arc<App>, approval_id: Uuid) -> Result<()> {
    close(app, approval_id, "denied", "interrupted", "true").await
}

async fn close(
    app: &Arc<App>,
    approval_id: Uuid,
    state: &str,
    via: &str,
    when: &str,
) -> Result<()> {
    let mut tx = app.db.begin().await?;
    let sql = format!(
        "UPDATE approvals SET state = $2, decided_via = $3, decided_at = now()
         WHERE id = $1 AND state = 'pending' AND {when} RETURNING thread_id"
    );
    let thread_id: Option<Uuid> = sqlx::query_scalar(&sql)
        .bind(approval_id)
        .bind(state)
        .bind(via)
        .fetch_optional(&mut *tx)
        .await?;
    let Some(thread_id) = thread_id else {
        return Ok(());
    };
    let body = EventBody::ApprovalDecided {
        approval_id,
        decision: Decision::Deny,
        via: via.into(),
    };
    let ev = events::append(&mut tx, app.fence, thread_id, &body, Source::Host, false).await?;
    let detail = json!({ "approval_id": approval_id, "decision": Decision::Deny, "via": via });
    let entry = audit::Entry {
        actor: "host",
        device_id: None,
        action: "approval.decide",
        detail,
    };
    audit::append(&mut tx, app.space_id, entry).await?;
    tx.commit().await?;
    app.committed(thread_id, vec![ev]).await;
    app.runners.send_if_running(
        thread_id,
        Cmd::Decided {
            approval_id,
            decision: Decision::Deny,
        },
    );
    Ok(())
}

/// True when "Always allow" already covers this tool for this agent and folder.
pub async fn always_allowed(app: &App, agent_id: Option<Uuid>, tool: &str, scope: &str) -> bool {
    sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM allow_rules
         WHERE space_id = $1 AND agent_id IS NOT DISTINCT FROM $2 AND tool = $3 AND scope = $4
           AND revoked_at IS NULL)",
    )
    .bind(app.space_id)
    .bind(agent_id)
    .bind(tool)
    .bind(scope)
    .fetch_one(&app.db)
    .await
    .unwrap_or(false)
}

/// Waiting approvals, and those decided or expired in the last day (the app shows them
/// under Done today and Expired).
pub async fn needs_you(app: &App) -> sqlx::Result<Vec<NeedsYouItem>> {
    let rows = sqlx::query(
        "SELECT a.id, a.thread_id, a.card, a.created_at, a.expires_at, a.state,
                t.kind, t.title, t.started_by, c.slug, ag.name
         FROM approvals a
         JOIN threads t ON t.id = a.thread_id
         LEFT JOIN channels c ON c.id = t.channel_id
         LEFT JOIN agents ag ON ag.id = t.agent_id
         WHERE a.space_id = $1
           AND (a.state = 'pending' OR a.decided_at > now() - interval '1 day')
         ORDER BY a.created_at",
    )
    .bind(app.space_id)
    .fetch_all(&app.db)
    .await?;
    rows.into_iter().map(needs_you_item).collect()
}

fn needs_you_item(r: sqlx::postgres::PgRow) -> sqlx::Result<NeedsYouItem> {
    let card: Card =
        serde_json::from_value(r.get("card")).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
    let created_at: DateTime<Utc> = r.get("created_at");
    let expires_at: DateTime<Utc> = r.get("expires_at");
    let state = match r.get::<&str, _>("state") {
        "allowed" => ApprovalState::Allowed,
        "denied" => ApprovalState::Denied,
        "expired" => ApprovalState::Expired,
        _ => ApprovalState::Pending,
    };
    Ok(NeedsYouItem {
        approval_id: r.get("id"),
        thread_id: r.get("thread_id"),
        source: source_line(&r),
        card,
        created_at: created_at.to_rfc3339(),
        expires_at: expires_at.to_rfc3339(),
        state,
    })
}

/// "#shop-launch · Ava", "Ava", or "Fix checkout · session started by Ava".
fn source_line(r: &sqlx::postgres::PgRow) -> String {
    let agent: Option<String> = r.get("name");
    let agent = agent.unwrap_or_default();
    match r.get::<&str, _>("kind") {
        "session" => {
            let by: Option<String> = r.get("started_by");
            format!(
                "{} · session started by {}",
                r.get::<String, _>("title"),
                by.unwrap_or_else(|| "you".into())
            )
        }
        "chat" => match r.get::<Option<String>, _>("slug") {
            Some(slug) => format!("#{slug} · {agent}"),
            None => agent,
        },
        _ => agent,
    }
}

pub fn risk_str(r: RiskClass) -> &'static str {
    match r {
        RiskClass::Read => "read",
        RiskClass::Reversible => "reversible",
        RiskClass::Send => "send",
        RiskClass::Destructive => "destructive",
    }
}
