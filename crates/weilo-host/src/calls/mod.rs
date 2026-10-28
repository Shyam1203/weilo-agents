//! Every `Call` the apps make. Calls are idempotent by `call_id`: the result is stored
//! in `call_results`, and the same id again returns it without doing the work twice.

mod agents;
mod channels;
pub mod read;
mod setup;
mod threads;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use uuid::Uuid;
use weilo_proto::{Call, CallResult, CallValue};

use crate::app::App;
use crate::approvals;
use crate::error::CallError;

/// One lock per `(device, call_id)` while that call runs, so a quick retry waits for
/// the first try instead of racing it.
type CallKey = (Uuid, Uuid);

#[derive(Default)]
pub struct CallLocks {
    map: Mutex<HashMap<CallKey, Arc<tokio::sync::Mutex<()>>>>,
}

impl CallLocks {
    fn get(&self, key: (Uuid, Uuid)) -> Arc<tokio::sync::Mutex<()>> {
        self.map
            .lock()
            .expect("call locks")
            .entry(key)
            .or_default()
            .clone()
    }
    fn release(&self, key: (Uuid, Uuid)) {
        let mut map = self.map.lock().expect("call locks");
        if map.get(&key).is_some_and(|l| Arc::strong_count(l) == 1) {
            map.remove(&key);
        }
    }
}

pub async fn handle(app: &Arc<App>, device_id: Uuid, call_id: Uuid, call: Call) -> CallResult {
    let key = (device_id, call_id);
    let lock = app.call_locks.get(key);
    let result = {
        let _running = lock.lock().await;
        run_once(app, device_id, call_id, call).await
    };
    drop(lock);
    app.call_locks.release(key);
    result
}

async fn run_once(app: &Arc<App>, device_id: Uuid, call_id: Uuid, call: Call) -> CallResult {
    match stored(app, device_id, call_id).await {
        Ok(Some(result)) => return result,
        Ok(None) => {}
        Err(e) => return failed(e.into()),
    }
    let result = match dispatch(app, device_id, call).await {
        Ok(value) => CallResult::Done { value },
        Err(e) => failed(e),
    };
    // Internal errors may pass on a retry, so they aren't kept.
    let keep = !matches!(&result, CallResult::Failed { error } if error.code == "internal");
    if keep && let Err(e) = store(app, device_id, call_id, &result).await {
        tracing::error!("couldn't store call result: {e}");
    }
    result
}

fn failed(e: CallError) -> CallResult {
    CallResult::Failed {
        error: e.into_api(),
    }
}

async fn stored(app: &App, device_id: Uuid, call_id: Uuid) -> sqlx::Result<Option<CallResult>> {
    let value: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT result FROM call_results WHERE device_id = $1 AND call_id = $2")
            .bind(device_id)
            .bind(call_id)
            .fetch_optional(&app.db)
            .await?;
    Ok(value.and_then(|v| serde_json::from_value(v).ok()))
}

async fn store(
    app: &App,
    device_id: Uuid,
    call_id: Uuid,
    result: &CallResult,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO call_results (device_id, call_id, result) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING",
    )
    .bind(device_id)
    .bind(call_id)
    .bind(serde_json::to_value(result)?)
    .execute(&app.db)
    .await?;
    Ok(())
}

async fn dispatch(app: &Arc<App>, device: Uuid, call: Call) -> Result<CallValue, CallError> {
    use CallValue as V;
    Ok(match call {
        Call::Snapshot => V::Snapshot(read::snapshot(app, device).await?),
        Call::ListEngines => V::Engines(app.engines.list()),
        Call::CreateAgent {
            name,
            engine,
            model,
        } => V::Agent(agents::create(app, device, &name, &engine, model).await?),
        Call::UpdateAgent {
            agent_id,
            name,
            model,
            instructions,
        } => V::Agent(agents::update(app, device, agent_id, name, model, instructions).await?),
        Call::StopAgent { agent_id } => {
            agents::stop(app, agent_id).await?;
            V::None
        }
        Call::CreateChannel { title } => V::Channel(channels::create(app, device, &title).await?),
        Call::RenameChannel { channel_id, title } => {
            V::Channel(channels::rename(app, device, channel_id, &title).await?)
        }
        Call::ArchiveChannel {
            channel_id,
            archived,
        } => V::Channel(channels::archive(app, device, channel_id, archived).await?),
        Call::CreateThread {
            channel_id,
            agent_id,
            title,
        } => V::Thread(threads::create(app, channel_id, agent_id, title).await?),
        Call::MoveThread {
            thread_id,
            channel_id,
        } => V::Thread(threads::move_to(app, thread_id, channel_id).await?),
        Call::StartSession {
            folder,
            engine,
            title,
            channel_id,
            agent_id,
        } => {
            let s = threads::NewSession {
                folder,
                engine,
                title,
                channel_id,
                agent_id,
            };
            V::Thread(threads::start_session(app, device, s).await?)
        }
        Call::Send {
            thread_id,
            text,
            when,
        } => {
            threads::send(app, thread_id, text, when).await?;
            V::None
        }
        Call::Stop { thread_id } => {
            threads::stop(app, thread_id).await?;
            V::None
        }
        Call::Decide {
            approval_id,
            decision,
        } => {
            approvals::decide(app, device, approval_id, decision).await?;
            V::None
        }
        Call::NeedsYou => V::NeedsYou(approvals::needs_you(app).await?),
        Call::SetPrefs { prefs } => {
            read::set_prefs(app, device, &prefs).await?;
            V::None
        }
        Call::SetupStatus => V::Setup(read::setup(app).await?),
        Call::FinishSetup { engine, keep_awake } => {
            V::Setup(setup::finish(app, device, &engine, keep_awake).await?)
        }
    })
}
