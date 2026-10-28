//! Threads, sessions and messages.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::json;
use sqlx::PgConnection;
use uuid::Uuid;
use weilo_proto::{Changed, EventBody, SendWhen, ThreadSummary};

use super::read;
use crate::app::App;
use crate::audit;
use crate::engines::{Cmd, expand_tilde};
use crate::error::{CallError, CallResult};
use crate::events::{self, Source};
use crate::home::is_within;
use crate::ids::new_id;
use crate::slug::slugify;
use crate::worktree::{self, Prepared};

#[derive(Default)]
pub struct NewThread {
    pub id: Uuid,
    pub kind: &'static str,
    pub channel_id: Option<Uuid>,
    pub agent_id: Option<Uuid>,
    pub title: String,
    pub engine: Option<String>,
    pub folder: Option<String>,
    pub worktree: Option<String>,
    pub started_by: Option<String>,
}

pub async fn insert_thread(app: &App, tx: &mut PgConnection, t: &NewThread) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO threads (id, space_id, kind, channel_id, agent_id, owner_host, owner_epoch,
                              title, engine, folder, worktree, started_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    )
    .bind(t.id)
    .bind(app.space_id)
    .bind(t.kind)
    .bind(t.channel_id)
    .bind(t.agent_id)
    .bind(app.fence.host)
    .bind(app.fence.epoch)
    .bind(&t.title)
    .bind(&t.engine)
    .bind(&t.folder)
    .bind(&t.worktree)
    .bind(&t.started_by)
    .execute(tx)
    .await?;
    Ok(())
}

pub async fn create(
    app: &App,
    channel_id: Uuid,
    agent_id: Uuid,
    title: Option<String>,
) -> CallResult<ThreadSummary> {
    require(app, "channels", channel_id, "That channel is gone.").await?;
    require(app, "agents", agent_id, "That agent is gone.").await?;
    let title = title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());
    let thread = NewThread {
        id: new_id(),
        kind: "chat",
        channel_id: Some(channel_id),
        agent_id: Some(agent_id),
        title: title.unwrap_or_else(|| "New thread".into()),
        ..NewThread::default()
    };
    let mut tx = app.db.begin().await?;
    insert_thread(app, &mut tx, &thread).await?;
    tx.commit().await?;
    app.hub.changed(Changed::Threads);
    read::thread(app, thread.id).await
}

pub async fn move_to(app: &App, thread_id: Uuid, channel_id: Uuid) -> CallResult<ThreadSummary> {
    require(app, "channels", channel_id, "That channel is gone.").await?;
    let mut tx = app.db.begin().await?;
    let done = sqlx::query("UPDATE threads SET channel_id = $2 WHERE id = $1 AND space_id = $3")
        .bind(thread_id)
        .bind(channel_id)
        .bind(app.space_id)
        .execute(&mut *tx)
        .await?;
    if done.rows_affected() == 0 {
        return Err(CallError::not_found("That thread is gone."));
    }
    let body = EventBody::Filed { channel_id };
    let ev = events::append(&mut tx, app.fence, thread_id, &body, Source::User, false).await?;
    tx.commit().await?;
    app.committed(thread_id, vec![ev]).await;
    app.hub.changed(Changed::Threads);
    read::thread(app, thread_id).await
}

pub struct NewSession {
    pub folder: String,
    pub engine: String,
    pub title: Option<String>,
    pub channel_id: Option<Uuid>,
    pub agent_id: Option<Uuid>,
}

pub async fn start_session(app: &App, device: Uuid, s: NewSession) -> CallResult<ThreadSummary> {
    if app.engines.get(&s.engine).is_none() {
        return Err(CallError::invalid("That engine isn't available."));
    }
    let folder = expand_tilde(s.folder.trim());
    if !folder.is_absolute() {
        return Err(CallError::invalid("Use a full folder path."));
    }
    if !folder.is_dir() {
        return Err(CallError::invalid("This folder doesn't exist."));
    }
    if let Some(why) = off_limits(app, &folder) {
        return Err(CallError::invalid(why));
    }
    if let Some(channel_id) = s.channel_id {
        require(app, "channels", channel_id, "That channel is gone.").await?;
    }
    let started_by = match s.agent_id {
        Some(id) => Some(agent_name(app, id).await?),
        None => None,
    };
    let title = s
        .title
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| folder_name(&folder));
    let prepared = worktree::prepare(&folder, &slugify(&title)).await;
    let worktree = match &prepared {
        Prepared::Worktree { path, .. } => Some(path.display().to_string()),
        _ => None,
    };
    let thread = NewThread {
        id: new_id(),
        kind: "session",
        channel_id: s.channel_id,
        agent_id: s.agent_id,
        title,
        engine: Some(s.engine.clone()),
        folder: Some(folder.display().to_string()),
        worktree: worktree.clone(),
        started_by: Some(started_by.unwrap_or_else(|| "you".into())),
    };
    let mut tx = app.db.begin().await?;
    insert_thread(app, &mut tx, &thread).await?;
    let detail = json!({ "thread_id": thread.id, "folder": thread.folder, "engine": s.engine, "worktree": worktree });
    let entry = audit::Entry {
        actor: "device",
        device_id: Some(device),
        action: "session.start",
        detail,
    };
    audit::append(&mut tx, app.space_id, entry).await?;
    tx.commit().await?;
    if let Some(problem) = problem_for(&prepared) {
        app.append(thread.id, problem, Source::Host).await?;
    }
    app.hub.changed(Changed::Threads);
    read::thread(app, thread.id).await
}

/// Folders a session may not work in: Weilo's own data folder (and anything inside
/// it), any folder that holds it, and the whole home folder.
fn off_limits(app: &App, folder: &std::path::Path) -> Option<&'static str> {
    let data = app.home.root();
    if is_within(folder, data) {
        return Some("That's Weilo's own data folder. Choose a project folder.");
    }
    if is_within(data, folder) {
        return Some("That folder holds Weilo's data. Choose a project folder inside it.");
    }
    if dirs::home_dir().is_some_and(|home| is_within(&home, folder)) {
        return Some("Choose a project folder, not your whole home folder.");
    }
    None
}

fn problem_for(p: &Prepared) -> Option<EventBody> {
    let message = match p {
        Prepared::Missing => "This folder doesn't exist.",
        Prepared::Plain => "This folder isn't a git repo, so changes go straight into it.",
        Prepared::Failed { .. } => {
            "Couldn't make a separate copy of the repo, so this session works in the folder itself."
        }
        _ => return None,
    };
    let action = matches!(p, Prepared::Missing).then(|| "Choose another folder".to_string());
    Some(EventBody::Problem {
        message: message.into(),
        action,
    })
}

fn folder_name(folder: &std::path::Path) -> String {
    folder
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Session".into())
}

pub async fn send(app: &Arc<App>, thread_id: Uuid, text: String, when: SendWhen) -> CallResult<()> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(CallError::invalid("Write something to send."));
    }
    require(app, "threads", thread_id, "That thread is gone.").await?;
    if let Some(problem) = session_problem(app, thread_id).await? {
        return Err(problem);
    }
    let body = EventBody::UserMessage {
        text: text.clone(),
        when,
    };
    app.append(thread_id, body, Source::User).await?;
    app.runners
        .send(app, thread_id, Cmd::Message { text, when });
    Ok(())
}

/// A session whose folder is missing can't run.
async fn session_problem(app: &App, thread_id: Uuid) -> CallResult<Option<CallError>> {
    let dir: Option<Option<String>> = sqlx::query_scalar(
        "SELECT COALESCE(worktree, folder) FROM threads WHERE id = $1 AND kind = 'session'",
    )
    .bind(thread_id)
    .fetch_optional(&app.db)
    .await?;
    Ok(match dir {
        Some(Some(dir)) if !PathBuf::from(&dir).is_dir() => {
            Some(CallError::invalid("This session's folder doesn't exist."))
        }
        _ => None,
    })
}

/// Brings a session's changes back into its folder (see `worktree::merge_back`).
pub async fn merge_session(app: &App, device: Uuid, thread_id: Uuid) -> CallResult<String> {
    let row: Option<(Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT folder, worktree, title FROM threads
         WHERE id = $1 AND space_id = $2 AND kind = 'session'",
    )
    .bind(thread_id)
    .bind(app.space_id)
    .fetch_optional(&app.db)
    .await?;
    let Some((Some(folder), worktree, title)) = row else {
        return Err(CallError::not_found("That session is gone."));
    };
    let Some(worktree) = worktree else {
        return Err(CallError::invalid(
            "This session works in the folder itself, so its changes are already there.",
        ));
    };
    let result = worktree::merge_back(
        std::path::Path::new(&folder),
        std::path::Path::new(&worktree),
        &title,
    )
    .await;
    let mut tx = app.db.begin().await?;
    let entry = audit::Entry {
        actor: "device",
        device_id: Some(device),
        action: "session.merge",
        detail: json!({ "thread_id": thread_id, "worktree": worktree, "ok": result.is_ok() }),
    };
    audit::append(&mut tx, app.space_id, entry).await?;
    tx.commit().await?;
    result.map_err(CallError::conflict)
}

pub async fn stop(app: &App, thread_id: Uuid) -> CallResult<()> {
    require(app, "threads", thread_id, "That thread is gone.").await?;
    app.runners.send_if_running(thread_id, Cmd::Stop);
    Ok(())
}

async fn require(app: &App, table: &str, id: Uuid, missing: &str) -> CallResult<()> {
    let sql = format!("SELECT EXISTS (SELECT 1 FROM {table} WHERE id = $1 AND space_id = $2)");
    let found: bool = sqlx::query_scalar(&sql)
        .bind(id)
        .bind(app.space_id)
        .fetch_one(&app.db)
        .await?;
    if found {
        Ok(())
    } else {
        Err(CallError::not_found(missing))
    }
}

async fn agent_name(app: &App, id: Uuid) -> CallResult<String> {
    sqlx::query_scalar("SELECT name FROM agents WHERE id = $1 AND space_id = $2")
        .bind(id)
        .bind(app.space_id)
        .fetch_optional(&app.db)
        .await?
        .ok_or_else(|| CallError::not_found("That agent is gone."))
}
