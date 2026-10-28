//! Settings: paired devices and "Always allow" rules, each listed with a way to revoke.

use std::path::Path;

use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::Row;
use uuid::Uuid;
use weilo_proto::{AllowRuleInfo, Changed, DeviceInfo};

use crate::app::{App, HubMsg};
use crate::audit;
use crate::error::{CallError, CallResult};

pub async fn devices(app: &App, caller: Uuid) -> CallResult<Vec<DeviceInfo>> {
    let rows = sqlx::query(
        "SELECT id, name, paired_at, last_seen_at FROM devices
         WHERE space_id = $1 AND revoked_at IS NULL ORDER BY paired_at DESC",
    )
    .bind(app.space_id)
    .fetch_all(&app.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let id: Uuid = r.get("id");
            let paired_at: DateTime<Utc> = r.get("paired_at");
            let seen: Option<DateTime<Utc>> = r.get("last_seen_at");
            DeviceInfo {
                id,
                name: r.get("name"),
                paired_at: paired_at.to_rfc3339(),
                last_seen_at: seen.map(|s| s.to_rfc3339()),
                this_device: id == caller,
            }
        })
        .collect())
}

/// Unpairs a device and closes its connections. The last paired device stays, so
/// there is always one that can open Weilo.
pub async fn revoke_device(app: &App, caller: Uuid, device_id: Uuid) -> CallResult<()> {
    let mut tx = app.db.begin().await?;
    // Locked, so two removals at once can't leave no device at all.
    let live: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM devices WHERE space_id = $1 AND revoked_at IS NULL FOR UPDATE",
    )
    .bind(app.space_id)
    .fetch_all(&mut *tx)
    .await?;
    if !live.contains(&device_id) {
        return Err(CallError::not_found("That device is already removed."));
    }
    if live.len() == 1 {
        return Err(CallError::invalid(
            "This is your only paired device. Pair another one before removing it.",
        ));
    }
    sqlx::query("UPDATE devices SET revoked_at = now() WHERE id = $1")
        .bind(device_id)
        .execute(&mut *tx)
        .await?;
    let entry = audit::Entry {
        actor: "device",
        device_id: Some(caller),
        action: "device.revoke",
        detail: json!({ "device_id": device_id }),
    };
    audit::append(&mut tx, app.space_id, entry).await?;
    tx.commit().await?;
    app.hub.send(HubMsg::DeviceRevoked(device_id));
    app.hub.changed(Changed::Devices);
    Ok(())
}

pub async fn allow_rules(app: &App) -> CallResult<Vec<AllowRuleInfo>> {
    let rows = sqlx::query(
        "SELECT r.id, r.agent_id, r.tool, r.scope, r.created_at, a.name
         FROM allow_rules r LEFT JOIN agents a ON a.id = r.agent_id
         WHERE r.space_id = $1 AND r.revoked_at IS NULL ORDER BY r.created_at DESC",
    )
    .bind(app.space_id)
    .fetch_all(&app.db)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let created_at: DateTime<Utc> = r.get("created_at");
            let agent: Option<String> = r.get("name");
            AllowRuleInfo {
                id: r.get("id"),
                agent_id: r.get("agent_id"),
                description: rule_line(agent.as_deref(), r.get("tool"), r.get("scope")),
                created_at: created_at.to_rfc3339(),
            }
        })
        .collect())
}

pub async fn revoke_allow_rule(app: &App, caller: Uuid, rule_id: Uuid) -> CallResult<()> {
    let mut tx = app.db.begin().await?;
    let done = sqlx::query(
        "UPDATE allow_rules SET revoked_at = now()
         WHERE id = $1 AND space_id = $2 AND revoked_at IS NULL",
    )
    .bind(rule_id)
    .bind(app.space_id)
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() == 0 {
        return Err(CallError::not_found("That rule is already gone."));
    }
    let entry = audit::Entry {
        actor: "device",
        device_id: Some(caller),
        action: "allow_rule.revoke",
        detail: json!({ "rule_id": rule_id }),
    };
    audit::append(&mut tx, app.space_id, entry).await?;
    tx.commit().await?;
    app.hub.changed(Changed::AllowRules);
    Ok(())
}

/// One plain line: "Ava may always run `npm test` in shop".
pub fn rule_line(agent: Option<&str>, tool: &str, scope: &str) -> String {
    let who = agent.unwrap_or("Your agents");
    let place = scope
        .strip_prefix("folder:")
        .and_then(|p| Path::new(p).file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "this folder".into());
    let (kind, what) = tool.split_once(':').unwrap_or(("other", tool));
    let what = (!what.is_empty() && !what.starts_with('{')).then(|| short(what, 60));
    match (kind, what) {
        ("execute", Some(cmd)) => format!("{who} may always run `{cmd}` in {place}"),
        (_, Some(cmd)) => format!("{who} may always use `{cmd}` in {place}"),
        ("edit", None) => format!("{who} may always make the same edit in {place}"),
        ("fetch", None) => format!("{who} may always open the same web page in {place}"),
        _ => format!("{who} may always repeat the same step in {place}"),
    }
}

fn short(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let cut: String = text.chars().take(max).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::rule_line;

    #[test]
    fn rules_read_as_one_plain_line() {
        assert_eq!(
            rule_line(Some("Ava"), "execute:npm test", "folder:/home/me/shop"),
            "Ava may always run `npm test` in shop"
        );
        assert_eq!(
            rule_line(None, "edit:{\"path\":\"a\"}", "folder:/w/site"),
            "Your agents may always make the same edit in site"
        );
        let long = format!("execute:{}", "x".repeat(100));
        assert!(rule_line(Some("Ava"), &long, "folder:/w/a").contains("…`"));
    }
}
