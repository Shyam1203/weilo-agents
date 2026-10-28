//! The audit log: hash-chained rows, insert-only for the app role.
//!
//! Each row's hash is `sha256(prev_hash || canonical_json(row))`, where canonical JSON
//! has sorted keys and no spaces (RFC 8785 for the values we store). Appends lock
//! `audit_head` so the chain never forks.

use chrono::{DateTime, SubsecRound, Utc};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool, Row};
use uuid::Uuid;

pub struct Entry<'a> {
    /// `device`, `host` or an agent's name.
    pub actor: &'a str,
    pub device_id: Option<Uuid>,
    pub action: &'a str,
    pub detail: Value,
}

pub async fn append(conn: &mut PgConnection, space_id: Uuid, entry: Entry<'_>) -> sqlx::Result<()> {
    let head = sqlx::query("SELECT seq, hash FROM audit_head WHERE space_id = $1 FOR UPDATE")
        .bind(space_id)
        .fetch_one(&mut *conn)
        .await?;
    let seq: i64 = head.get::<i64, _>("seq") + 1;
    let prev: Vec<u8> = head.get("hash");
    let at = Utc::now().trunc_subsecs(6);
    let hash = row_hash(&prev, seq, at, &entry);
    sqlx::query(
        "INSERT INTO audit (space_id, seq, at, actor, device_id, action, detail, prev_hash, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(space_id)
    .bind(seq)
    .bind(at)
    .bind(entry.actor)
    .bind(entry.device_id)
    .bind(entry.action)
    .bind(&entry.detail)
    .bind(&prev)
    .bind(&hash)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE audit_head SET seq = $2, hash = $3 WHERE space_id = $1")
        .bind(space_id)
        .bind(seq)
        .bind(&hash)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Where the chain breaks, if it does.
#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Intact { rows: i64 },
    BrokenAt { seq: i64 },
}

pub async fn verify(pool: &PgPool, space_id: Uuid) -> sqlx::Result<Verdict> {
    let rows = sqlx::query(
        "SELECT seq, at, actor, device_id, action, detail, prev_hash, hash
         FROM audit WHERE space_id = $1 ORDER BY seq",
    )
    .bind(space_id)
    .fetch_all(pool)
    .await?;
    let mut prev = vec![0u8; 32];
    let mut expected_seq = 1;
    for row in &rows {
        let seq: i64 = row.get("seq");
        let stored_prev: Vec<u8> = row.get("prev_hash");
        let stored_hash: Vec<u8> = row.get("hash");
        let entry = Entry {
            actor: row.get("actor"),
            device_id: row.get("device_id"),
            action: row.get("action"),
            detail: row.get("detail"),
        };
        let hash = row_hash(&prev, seq, row.get("at"), &entry);
        if seq != expected_seq || stored_prev != prev || stored_hash != hash {
            return Ok(Verdict::BrokenAt { seq });
        }
        prev = hash;
        expected_seq += 1;
    }
    let head: Vec<u8> = sqlx::query_scalar("SELECT hash FROM audit_head WHERE space_id = $1")
        .bind(space_id)
        .fetch_one(pool)
        .await?;
    if head != prev {
        return Ok(Verdict::BrokenAt { seq: expected_seq });
    }
    Ok(Verdict::Intact { rows: rows.len() as i64 })
}

fn row_hash(prev: &[u8], seq: i64, at: DateTime<Utc>, e: &Entry<'_>) -> Vec<u8> {
    let doc = json!({
        "seq": seq,
        "at": at.format("%Y-%m-%dT%H:%M:%S%.6fZ").to_string(),
        "actor": e.actor,
        "device_id": e.device_id,
        "action": e.action,
        "detail": e.detail,
    });
    let mut h = Sha256::new();
    h.update(prev);
    h.update(canonical_json(&doc).as_bytes());
    h.finalize().to_vec()
}

/// JSON with object keys sorted and no whitespace.
pub fn canonical_json(v: &Value) -> String {
    let mut out = String::new();
    write_canonical(v, &mut out);
    out
}

fn write_canonical(v: &Value, out: &mut String) {
    match v {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(k.clone()).to_string());
                out.push(':');
                write_canonical(&map[k], out);
            }
            out.push('}');
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        other => out.push_str(&other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_json_sorts_keys_at_every_level() {
        let v = json!({ "b": 1, "a": { "d": [1, { "z": true, "y": null }], "c": "x" } });
        assert_eq!(canonical_json(&v), r#"{"a":{"c":"x","d":[1,{"y":null,"z":true}]},"b":1}"#);
    }

    #[test]
    fn hash_depends_on_previous_hash_and_content() {
        let at = Utc::now().trunc_subsecs(6);
        let e = Entry { actor: "host", device_id: None, action: "setup", detail: json!({}) };
        let a = row_hash(&[0; 32], 1, at, &e);
        assert_eq!(a, row_hash(&[0; 32], 1, at, &e));
        assert_ne!(a, row_hash(&[1; 32], 1, at, &e));
        let e2 = Entry { action: "setup.done", ..e };
        assert_ne!(a, row_hash(&[0; 32], 1, at, &e2));
    }
}
