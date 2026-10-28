//! Channels: `#name`, lowercase, one or two words joined by a hyphen.

use serde_json::json;
use sqlx::PgConnection;
use uuid::Uuid;
use weilo_proto::{Changed, ChannelSummary};

use super::read;
use crate::app::App;
use crate::audit;
use crate::error::{CallError, CallResult};
use crate::ids::new_id;
use crate::slug::{slugify, unique};

pub async fn create(app: &App, device: Uuid, title: &str) -> CallResult<ChannelSummary> {
    let mut tx = app.db.begin().await?;
    let id = create_in(app, &mut tx, device, title).await?;
    tx.commit().await?;
    app.hub.changed(Changed::Channels);
    read::channel(app, id).await
}

pub async fn create_in(app: &App, tx: &mut PgConnection, device: Uuid, title: &str) -> CallResult<Uuid> {
    let title = clean_title(title)?;
    let slug = free_slug(app, tx, &title, None).await?;
    let id = new_id();
    sqlx::query("INSERT INTO channels (id, space_id, slug, title) VALUES ($1, $2, $3, $4)")
        .bind(id)
        .bind(app.space_id)
        .bind(&slug)
        .bind(&title)
        .execute(&mut *tx)
        .await?;
    let detail = json!({ "channel_id": id, "slug": slug });
    audit::append(tx, app.space_id, audit::Entry { actor: "device", device_id: Some(device), action: "channel.create", detail }).await?;
    Ok(id)
}

pub async fn rename(app: &App, device: Uuid, channel_id: Uuid, title: &str) -> CallResult<ChannelSummary> {
    let title = clean_title(title)?;
    let mut tx = app.db.begin().await?;
    let slug = free_slug(app, &mut tx, &title, Some(channel_id)).await?;
    let done = sqlx::query("UPDATE channels SET slug = $3, title = $4 WHERE id = $1 AND space_id = $2")
        .bind(channel_id)
        .bind(app.space_id)
        .bind(&slug)
        .bind(&title)
        .execute(&mut *tx)
        .await?;
    if done.rows_affected() == 0 {
        return Err(CallError::not_found("That channel is gone."));
    }
    let detail = json!({ "channel_id": channel_id, "slug": slug });
    audit::append(&mut tx, app.space_id, audit::Entry { actor: "device", device_id: Some(device), action: "channel.rename", detail }).await?;
    tx.commit().await?;
    app.hub.changed(Changed::Channels);
    read::channel(app, channel_id).await
}

pub async fn archive(app: &App, device: Uuid, channel_id: Uuid, archived: bool) -> CallResult<ChannelSummary> {
    let mut tx = app.db.begin().await?;
    let done = sqlx::query(
        "UPDATE channels SET archived_at = CASE WHEN $3 THEN COALESCE(archived_at, now()) END
         WHERE id = $1 AND space_id = $2",
    )
    .bind(channel_id)
    .bind(app.space_id)
    .bind(archived)
    .execute(&mut *tx)
    .await?;
    if done.rows_affected() == 0 {
        return Err(CallError::not_found("That channel is gone."));
    }
    let detail = json!({ "channel_id": channel_id, "archived": archived });
    audit::append(&mut tx, app.space_id, audit::Entry { actor: "device", device_id: Some(device), action: "channel.archive", detail }).await?;
    tx.commit().await?;
    app.hub.changed(Changed::Channels);
    read::channel(app, channel_id).await
}

/// The channel's slug if it's free (or already its own), else one with a number.
async fn free_slug(app: &App, tx: &mut PgConnection, title: &str, own: Option<Uuid>) -> CallResult<String> {
    let base = slugify(title);
    if base.is_empty() {
        return Err(CallError::invalid("Use at least one letter or number in the name."));
    }
    let taken: Vec<String> = sqlx::query_scalar(
        "SELECT slug FROM channels WHERE space_id = $1 AND ($2::uuid IS NULL OR id <> $2)",
    )
    .bind(app.space_id)
    .bind(own)
    .fetch_all(&mut *tx)
    .await?;
    Ok(unique(&base, |s| taken.iter().any(|t| t == s)))
}

fn clean_title(title: &str) -> CallResult<String> {
    let title = title.trim().trim_start_matches('#').trim();
    if title.is_empty() || title.chars().count() > 60 {
        return Err(CallError::invalid("Give the channel a name of up to 60 letters."));
    }
    Ok(title.to_string())
}
