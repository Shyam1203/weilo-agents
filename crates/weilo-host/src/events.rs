//! The event store. Appends are fenced by the thread's owner and epoch, and gap-free:
//! `last_seq` is bumped and the event inserted in one transaction.

use chrono::{DateTime, Utc};
use sqlx::{PgConnection, PgExecutor, Row};
use uuid::Uuid;
use weilo_proto::{Event, EventBody};

use crate::db::Fence;

#[derive(Debug, thiserror::Error)]
pub enum AppendError {
    /// The thread is missing, or another host (or a newer epoch) owns it.
    #[error("this host doesn't own the thread")]
    Fenced,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Who wrote an event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    User,
    Agent,
    Engine,
    Host,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::User => "user",
            Source::Agent => "agent",
            Source::Engine => "engine",
            Source::Host => "host",
        }
    }
}

/// The `kind` tag of a body (`user_message`, `step`…).
pub fn kind_of(body: &EventBody) -> String {
    serde_json::to_value(body)
        .ok()
        .and_then(|v| v.get("kind").and_then(|k| k.as_str()).map(str::to_owned))
        .unwrap_or_default()
}

/// Appends one event inside the caller's transaction. Publish it after commit.
pub async fn append(
    tx: &mut PgConnection,
    fence: Fence,
    thread_id: Uuid,
    body: &EventBody,
    source: Source,
    tainted: bool,
) -> Result<Event, AppendError> {
    let row = sqlx::query(
        "UPDATE threads SET last_seq = last_seq + 1, updated_at = now(),
                tainted = tainted OR $4
         WHERE id = $1 AND owner_host = $2 AND owner_epoch = $3
         RETURNING last_seq, space_id",
    )
    .bind(thread_id)
    .bind(fence.host)
    .bind(fence.epoch)
    .bind(tainted)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppendError::Fenced)?;
    let seq: i64 = row.get("last_seq");
    let space_id: Uuid = row.get("space_id");
    let json = serde_json::to_value(body).map_err(|e| sqlx::Error::Encode(Box::new(e)))?;
    let at: DateTime<Utc> = sqlx::query_scalar(
        "INSERT INTO events (thread_id, seq, space_id, source, tainted, kind, body)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING created_at",
    )
    .bind(thread_id)
    .bind(seq)
    .bind(space_id)
    .bind(source.as_str())
    .bind(tainted)
    .bind(kind_of(body))
    .bind(&json)
    .fetch_one(&mut *tx)
    .await?;
    Ok(Event {
        seq,
        at: at.to_rfc3339(),
        source: source.as_str().into(),
        tainted,
        body: body.clone(),
    })
}

/// Events with `from < seq <= to`, in order.
pub async fn read_range<'e>(
    exec: impl PgExecutor<'e>,
    thread_id: Uuid,
    from: i64,
    to: i64,
) -> sqlx::Result<Vec<Event>> {
    read_page(exec, thread_id, from, to, i64::MAX).await
}

/// The first `limit` events with `from < seq <= to`, in order.
pub async fn read_page<'e>(
    exec: impl PgExecutor<'e>,
    thread_id: Uuid,
    from: i64,
    to: i64,
    limit: i64,
) -> sqlx::Result<Vec<Event>> {
    let rows = sqlx::query(
        "SELECT seq, created_at, source, tainted, body FROM events
         WHERE thread_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq LIMIT $4",
    )
    .bind(thread_id)
    .bind(from)
    .bind(to)
    .bind(limit)
    .fetch_all(exec)
    .await?;
    rows.into_iter().map(event_from_row).collect()
}

fn event_from_row(row: sqlx::postgres::PgRow) -> sqlx::Result<Event> {
    let body: serde_json::Value = row.get("body");
    let at: DateTime<Utc> = row.get("created_at");
    Ok(Event {
        seq: row.get("seq"),
        at: at.to_rfc3339(),
        source: row.get("source"),
        tainted: row.get("tainted"),
        body: serde_json::from_value(body).map_err(|e| sqlx::Error::Decode(Box::new(e)))?,
    })
}
