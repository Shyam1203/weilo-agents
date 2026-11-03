//! Every `Call` the apps make. Calls are idempotent by `call_id`: before a call that
//! changes anything runs, a "running" row goes into `call_results`; when it's done the
//! row holds the result, and the same id again returns it without doing the work
//! twice. A row still "running" that no try holds any more (the host stopped mid-call)
//! is settled by the next try with that id (see `unfinished`). Calls that only read run
//! again instead of being stored. A call that changes something is never cut off part
//! way (see `changing`), and stopping Weilo waits a while for those under way.

mod agents;
mod channels;
mod engines;
pub mod read;
mod settings;
mod setup;
mod threads;

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

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
    /// The calls that change something and are under way: stopping waits for them.
    tasks: tokio_util::task::TaskTracker,
    /// Sends whose message went to the thread's runner in this run but whose result
    /// isn't stored yet: settled again, they aren't handed over twice.
    handed: Mutex<HashSet<Uuid>>,
}

impl CallLocks {
    /// Waits, up to `limit`, for the calls under way to finish (Weilo is stopping). One
    /// still running then is settled by the next try with its id after the restart.
    pub async fn finish(&self, limit: Duration) {
        self.tasks.close();
        if tokio::time::timeout(limit, self.tasks.wait())
            .await
            .is_err()
        {
            tracing::warn!(
                "{} calls were still under way when Weilo stopped",
                self.tasks.len()
            );
        }
    }
    /// A send's message went to its runner.
    pub(crate) fn note_handed(&self, call_id: Uuid) {
        self.handed.lock().expect("handed").insert(call_id);
    }
    fn was_handed(&self, call_id: Uuid) -> bool {
        self.handed.lock().expect("handed").contains(&call_id)
    }
    fn forget_handed(&self, call_id: Uuid) {
        self.handed.lock().expect("handed").remove(&call_id);
    }
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
    handle_holding(app, device_id, call_id, call, ()).await
}

/// Like `handle`, keeping `held` (a socket's place for one call) until the call's work
/// ends, which may be after the device stopped waiting for it.
pub async fn handle_holding(
    app: &Arc<App>,
    device_id: Uuid,
    call_id: Uuid,
    call: Call,
    held: impl Send + 'static,
) -> CallResult {
    // Every call but this one reads or writes the database.
    let uses_db = !matches!(call, Call::ListEngines);
    let result = if only_reads(&call) {
        let read = dispatch(app, device_id, call_id, call);
        let result = finish(while_answering(app, uses_db, read).await);
        drop(held);
        result
    } else {
        changing(app, device_id, call_id, call, held).await
    };
    // What the call found of the database is told to every device: one that didn't
    // answer, or that it answers again.
    match &result {
        CallResult::Failed { error } if error.code == "database_away" => {
            if *app.db_up.borrow() {
                app.set_db_answering(Uuid::nil(), false);
            }
        }
        CallResult::Done { .. } if uses_db => app.set_db_answering(Uuid::nil(), true),
        _ => {}
    }
    result
}

/// Where a call that changes something has got to, for when the device stops waiting.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// Not started yet.
    Waiting,
    /// Under way: it is finished, whatever the device was told.
    Running,
    /// The device was told it didn't happen: it never starts.
    LetGo,
}

/// A call that changes something. Its work runs on its own and is never cut off part
/// way: when the database stops answering, the device stops waiting for it. A call
/// that hadn't started then never does (`database_away`: it didn't happen); one under
/// way finishes and stores its result, and the device hears `unknown`: the same call
/// id tried again returns that result (waiting for it if need be).
async fn changing(
    app: &Arc<App>,
    device_id: Uuid,
    call_id: Uuid,
    call: Call,
    held: impl Send + 'static,
) -> CallResult {
    if app.db_silent_now() {
        return failed(CallError::database_away());
    }
    let phase = Arc::new(Mutex::new(Phase::Waiting));
    let mut work = {
        let (app, phase) = (app.clone(), phase.clone());
        app.clone().call_locks.tasks.spawn(async move {
            let _held = held;
            let key = (device_id, call_id);
            let lock = app.call_locks.get(key);
            let result = {
                // A quick retry of the same id waits for this one.
                let _running = lock.lock().await;
                // Its database calls wait out a silence rather than stop between a
                // write and what follows it.
                crate::app::patiently(run_once(&app, device_id, call_id, call, &phase)).await
            };
            drop(lock);
            app.call_locks.release(key);
            result
        })
    };
    let mut answers = app.db_answers.subscribe();
    tokio::select! {
        done = &mut work => done.unwrap_or_else(|e| {
            tracing::error!("a call ended badly: {e}");
            failed(CallError::internal())
        }),
        _ = answers.wait_for(|answers| !answers) => {
            let mut phase = phase.lock().expect("call phase");
            if *phase == Phase::Waiting {
                *phase = Phase::LetGo;
                failed(CallError::database_away())
            } else {
                failed(CallError::new("unknown", CUT_OFF))
            }
        }
    }
}

/// Said when the database stopped answering while a call was under way.
const CUT_OFF: &str = "Weilo's database stopped answering during this, so it may not have \
                       happened yet. Check in a moment.";

async fn run_once(
    app: &Arc<App>,
    device_id: Uuid,
    call_id: Uuid,
    call: Call,
    phase: &Mutex<Phase>,
) -> CallResult {
    let unfinished = match app.within_limit(begin(app, device_id, call_id)).await {
        Ok(Begun::Fresh) => false,
        Ok(Begun::Unfinished) => true,
        Ok(Begun::Done(result)) => return *result,
        Ok(Begun::Unknown) => return interrupted(),
        Err(e) => return failed(e.into()),
    };
    let let_go = {
        let mut phase = phase.lock().expect("call phase");
        if *phase == Phase::LetGo {
            true
        } else {
            *phase = Phase::Running;
            false
        }
    };
    let away = || failed(CallError::database_away());
    if let_go {
        if unfinished {
            // The earlier try's mark stays, for the next try to settle.
            return away();
        }
        // The device was told it didn't happen: it doesn't, and the same id may run
        // later.
        store(app, device_id, call_id, &away(), true).await;
        return away();
    }
    if unfinished {
        match self::unfinished(app, call_id, &call).await {
            Ok(Unfinished::Happened) => {
                let result = CallResult::Done {
                    value: CallValue::None,
                };
                if store(app, device_id, call_id, &result, false).await {
                    app.call_locks.forget_handed(call_id);
                }
                return result;
            }
            // The mark is this try's now.
            Ok(Unfinished::RunAgain) => {}
            Ok(Unfinished::Unknown) => return interrupted(),
            Err(e) => {
                // The mark stays: the next try settles it.
                tracing::warn!("couldn't settle an unfinished call: {e:#}");
                return interrupted();
            }
        }
    }
    let result = finish(dispatch(app, device_id, call_id, call).await);
    // Internal errors, and a database that didn't answer, may pass on a retry, so they
    // aren't kept.
    let retry = matches!(&result, CallResult::Failed { error }
        if error.code == "internal" || error.code == "database_away");
    if store(app, device_id, call_id, &result, retry).await {
        app.call_locks.forget_handed(call_id);
    }
    result
}

/// An earlier try started and never finished: it may or may not have happened.
fn interrupted() -> CallResult {
    failed(CallError::new(
        "unknown",
        "Weilo was interrupted during this, so it may or may not have happened. Check, then try again.",
    ))
}

/// What the next try does with a call an earlier one left unfinished.
enum Unfinished {
    /// It happened (a send whose message was written).
    Happened,
    /// It runs again from the start.
    RunAgain,
    /// It may or may not have happened, and running it again isn't safe.
    Unknown,
}

/// Settles a call an earlier try left unfinished (see `begin`). A send is looked up
/// in its thread: written, it is done (and its agent gets it if nothing answered it
/// yet); not written, it runs again. A call that sets something, or changes it only
/// if it is still as it was, runs again. One that makes something new (an agent, a
/// channel, a thread, a session), brings changes back into a folder or stops a turn
/// stays unknown: run again it could make a second one, or stop a newer turn.
async fn unfinished(app: &Arc<App>, call_id: Uuid, call: &Call) -> anyhow::Result<Unfinished> {
    Ok(match call {
        Call::Send { thread_id, .. } => {
            if threads::settle_unfinished(app, call_id, *thread_id).await? {
                Unfinished::Happened
            } else {
                Unfinished::RunAgain
            }
        }
        // A new engine starts the agent's chats afresh again: kept unknown.
        Call::UpdateAgent { engine: None, .. }
        | Call::ArchiveAgent { .. }
        | Call::SetEngineKey { .. }
        | Call::CheckEngine { .. }
        | Call::RenameChannel { .. }
        | Call::ArchiveChannel { .. }
        | Call::MoveThread { .. }
        | Call::Decide { .. }
        | Call::SetPrefs { .. }
        | Call::FinishSetup { .. }
        | Call::RevokeDevice { .. }
        | Call::RevokeAllowRule { .. } => Unfinished::RunAgain,
        _ => Unfinished::Unknown,
    })
}

/// Stores a call's result (or, `retry`, lets the same id run again), trying again
/// while the database doesn't answer, for a while. A result that isn't stored leaves
/// the call unfinished, for the next try with its id to settle. True when stored.
async fn store(
    app: &App,
    device_id: Uuid,
    call_id: Uuid,
    result: &CallResult,
    retry: bool,
) -> bool {
    let until = tokio::time::Instant::now() + STORE_FOR;
    loop {
        let stored = app
            .within_limit(end(app, device_id, call_id, result, retry))
            .await;
        match stored {
            Ok(()) => return true,
            Err(e) if crate::db::unreachable(&e) && tokio::time::Instant::now() < until => {
                tracing::info!("storing a call result waits for the database: {e:#}");
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
            Err(e) => {
                tracing::error!("couldn't store call result: {e:#}");
                return false;
            }
        }
    }
}

/// How long a call's result is tried to be stored while the database doesn't answer.
const STORE_FOR: std::time::Duration = std::time::Duration::from_secs(600);

/// Runs a call that only reads, unless the database is known not to answer, and stops
/// waiting for it if the database stops answering meanwhile (nothing is lost: it is
/// asked again).
async fn while_answering(
    app: &App,
    uses_db: bool,
    call: impl std::future::Future<Output = Result<CallValue, CallError>>,
) -> Result<CallValue, CallError> {
    if !uses_db {
        return call.await;
    }
    if app.db_silent_now() {
        return Err(CallError::database_away());
    }
    let mut answers = app.db_answers.subscribe();
    tokio::select! {
        result = call => result,
        _ = answers.wait_for(|answers| !answers) => Err(CallError::database_away()),
    }
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
    /// An earlier try started and never finished: this one settles it.
    Unfinished,
    /// Its result can't be read, or its row went (the daily tidy-up) meanwhile.
    Unknown,
}

/// Marks the call running, unless an earlier try already did.
///
/// It runs with the call's lock held, and every try holds that lock until its result
/// is stored; only one host runs per home. So a row still running here was left by a
/// try that ended without storing its result: Weilo stopped (or crashed) part way, its
/// `begin` failed after the mark was written, or its result couldn't be stored.
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
        Some((_, true)) => Begun::Unfinished,
        Some((value, false)) => match serde_json::from_value(value) {
            Ok(result) => Begun::Done(Box::new(result)),
            Err(_) => Begun::Unknown,
        },
        // Removed between the two queries (tidied away): treat as unknown, not run.
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

async fn dispatch(
    app: &Arc<App>,
    device: Uuid,
    call_id: Uuid,
    call: Call,
) -> Result<CallValue, CallError> {
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
            threads::send(app, call_id, thread_id, text, when).await?;
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
