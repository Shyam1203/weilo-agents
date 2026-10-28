//! Every `Call` the apps make. Calls are idempotent by `call_id`: before a call that
//! changes anything runs, a "running" row goes into `call_results`; when it's done the
//! row holds the result, and the same id again returns it without doing the work
//! twice. A row still "running" (the host stopped mid-call) answers `unknown`, never a
//! second try. Calls that only read run again instead of being stored.

mod agents;
mod channels;
mod engines;
pub mod read;
mod settings;
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
    if only_reads(&call) {
        return finish(dispatch(app, device_id, call).await);
    }
    match begin(app, device_id, call_id).await {
        Ok(Begun::Fresh) => {}
        Ok(Begun::Done(result)) => return *result,
        Ok(Begun::Unknown) => {
            return failed(CallError::new(
                "unknown",
                "Weilo restarted during this, so it may or may not have happened. Check, then try again.",
            ));
        }
        Err(e) => return failed(e.into()),
    }
    let result = finish(dispatch(app, device_id, call).await);
    // Internal errors may pass on a retry, so they aren't kept.
    let retry = matches!(&result, CallResult::Failed { error } if error.code == "internal");
    if let Err(e) = end(app, device_id, call_id, &result, retry).await {
        tracing::error!("couldn't store call result: {e}");
    }
    result
}

/// Calls that change nothing: safe to run twice, so not stored.
fn only_reads(call: &Call) -> bool {
    matches!(
        call,
        Call::Snapshot
            | Call::ListEngines
            | Call::NeedsYou
            | Call::SetupStatus
            | Call::ListDevices
            | Call::ListAllowRules
            | Call::SessionChanges { .. }
    )
}

fn finish(r: Result<CallValue, CallError>) -> CallResult {
    match r {
        Ok(value) => CallResult::Done { value },
        Err(e) => failed(e),
    }
}

fn failed(e: CallError) -> CallResult {
    CallResult::Failed {
        error: e.into_api(),
    }
}

enum Begun {
    /// No earlier try: this one runs.
    Fresh,
    /// An earlier try finished with this.
    Done(Box<CallResult>),
    /// An earlier try started and never finished.
    Unknown,
}

/// Marks the call running, unless an earlier try already did.
async fn begin(app: &App, device_id: Uuid, call_id: Uuid) -> sqlx::Result<Begun> {
    let fresh = sqlx::query(
        "INSERT INTO call_results (device_id, call_id, result, running)
         VALUES ($1, $2, 'null', true) ON CONFLICT DO NOTHING",
    )
    .bind(device_id)
    .bind(call_id)
    .execute(&app.db)
    .await?
    .rows_affected()
        == 1;
    if fresh {
        return Ok(Begun::Fresh);
    }
    let row: Option<(serde_json::Value, bool)> = sqlx::query_as(
        "SELECT result, running FROM call_results WHERE device_id = $1 AND call_id = $2",
    )
    .bind(device_id)
    .bind(call_id)
    .fetch_optional(&app.db)
    .await?;
    Ok(match row {
        Some((_, true)) => Begun::Unknown,
        Some((value, false)) => match serde_json::from_value(value) {
            Ok(result) => Begun::Done(Box::new(result)),
            Err(_) => Begun::Unknown,
        },
        // Removed between the two queries (a failed try): treat as unknown, not run.
        None => Begun::Unknown,
    })
}

/// Stores the result, or (`retry`) removes the mark so the same id may run again.
async fn end(
    app: &App,
    device_id: Uuid,
    call_id: Uuid,
    result: &CallResult,
    retry: bool,
) -> anyhow::Result<()> {
    if retry {
        sqlx::query("DELETE FROM call_results WHERE device_id = $1 AND call_id = $2")
            .bind(device_id)
            .bind(call_id)
            .execute(&app.db)
            .await?;
        return Ok(());
    }
    sqlx::query(
        "UPDATE call_results SET result = $3, running = false, at = now()
         WHERE device_id = $1 AND call_id = $2",
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
            engine,
        } => {
            let change = agents::Change {
                name,
                model,
                instructions,
                engine,
            };
            V::Agent(agents::update(app, device, agent_id, change).await?)
        }
        Call::ArchiveAgent { agent_id } => {
            agents::archive(app, device, agent_id).await?;
            V::None
        }
        Call::SetEngineKey {
            engine,
            provider,
            key,
        } => V::Engines(engines::set_key(app, device, &engine, &provider, &key).await?),
        Call::CheckEngine { engine } => V::EngineCheck(engines::check(app, &engine).await?),
        Call::MergeSession { thread_id } => {
            V::Message(threads::merge_session(app, device, thread_id).await?)
        }
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
            task,
        } => {
            let s = threads::NewSession {
                folder,
                engine,
                title,
                channel_id,
                agent_id,
                task,
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
        Call::ListDevices => V::Devices(settings::devices(app, device).await?),
        Call::RevokeDevice { device_id } => {
            settings::revoke_device(app, device, device_id).await?;
            V::None
        }
        Call::ListAllowRules => V::AllowRules(settings::allow_rules(app).await?),
        Call::RevokeAllowRule { rule_id } => {
            settings::revoke_allow_rule(app, device, rule_id).await?;
            V::None
        }
        Call::SessionChanges { thread_id } => {
            V::SessionChanges(threads::session_changes(app, thread_id).await?)
        }
    })
}
