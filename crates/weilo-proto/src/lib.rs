//! The protocol between `weilo-host` and every client (web, desktop, phone).
//!
//! One WebSocket per device. The client sends [`ClientFrame`]s and the host sends
//! [`ServerFrame`]s, as JSON text frames. TypeScript types for the apps are generated
//! from this crate (`cargo test -p weilo-proto`), so the two sides never drift.

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

/// Bumped when a frame changes shape. Host and clients stay compatible one version apart.
pub const PROTOCOL_VERSION: u32 = 1;

pub type Id = Uuid;

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
#[ts(export)]
pub enum ClientFrame {
    /// First frame on every connection. `token` is the device token from pairing; the
    /// host answers `welcome` only when it is valid, and closes with 4401 when it isn't.
    Hello {
        version: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        token: Option<String>,
    },
    /// Follow a thread. The host sends every durable event after `after_seq`, then live ones.
    Sub {
        thread_id: Id,
        after_seq: i64,
    },
    Unsub {
        thread_id: Id,
    },
    /// Every action the UI takes. Idempotent by `call_id`.
    Call {
        call_id: Id,
        call: Call,
    },
    /// Which thread this device is looking at (push is skipped while someone looks).
    Presence {
        thread_id: Option<Id>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "t", rename_all = "snake_case")]
#[ts(export)]
pub enum ServerFrame {
    Welcome {
        version: u32,
        host_name: String,
        device_id: Id,
    },
    /// A durable event of a thread the device follows.
    Ev {
        thread_id: Id,
        event: Event,
    },
    /// A temporary piece of a reply being written. Never stored. The pieces of one reply
    /// carry the same `after_seq` (the thread's last `seq` when the reply began) and a
    /// `sub_seq` counting from 0; the text is the pieces under the highest `after_seq`,
    /// in `sub_seq` order. Any event with a `seq` above `after_seq` replaces them: the
    /// host stores the reply so far before its own events, and when another event lands
    /// mid-reply it starts again under the new `after_seq`, with the whole text so far
    /// as `sub_seq` 0.
    Delta {
        thread_id: Id,
        after_seq: i64,
        sub_seq: i64,
        delta: Delta,
    },
    Ret {
        call_id: Id,
        result: CallResult,
    },
    /// Something the sidebar or Needs you shows changed. The client asks again.
    Changed {
        what: Changed,
    },
    /// The host's own health. Sent after `welcome` when something is wrong, and again
    /// when it changes. `message` is one plain line to show while `ok` is false.
    Status {
        ok: bool,
        message: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Changed {
    Agents,
    Channels,
    Threads,
    NeedsYou,
    Engines,
    Prefs,
    /// Paired devices (`list_devices`).
    Devices,
    /// Always-allow rules (`list_allow_rules`).
    AllowRules,
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "method", content = "params", rename_all = "snake_case")]
#[ts(export)]
pub enum Call {
    /// Everything the first screen needs, in one round trip.
    Snapshot,
    ListEngines,
    CreateAgent {
        name: String,
        engine: String,
        model: Option<String>,
    },
    UpdateAgent {
        agent_id: Id,
        name: Option<String>,
        model: Option<String>,
        instructions: Option<String>,
        /// Moves the agent to another engine. Its next reply starts a fresh conversation.
        #[serde(default)]
        #[ts(optional)]
        engine: Option<String>,
    },
    StopAgent {
        agent_id: Id,
    },
    /// Removes the agent from the sidebar and stops it. Its threads are kept.
    ArchiveAgent {
        agent_id: Id,
    },
    /// Saves an API key for an engine (one of its `key_providers`). An empty key removes
    /// it. The key is never sent back.
    SetEngineKey {
        engine: String,
        provider: String,
        key: String,
    },
    /// Starts the engine once to see whether it works here (installs it first if needed).
    CheckEngine {
        engine: String,
    },
    CreateChannel {
        title: String,
    },
    RenameChannel {
        channel_id: Id,
        title: String,
    },
    ArchiveChannel {
        channel_id: Id,
        archived: bool,
    },
    /// A new thread (tab) in a channel, owned by one agent.
    CreateThread {
        channel_id: Id,
        agent_id: Id,
        title: Option<String>,
    },
    MoveThread {
        thread_id: Id,
        channel_id: Id,
    },
    /// Start a coding session in a folder. `agent_id` is the agent that watches it, if any.
    StartSession {
        folder: String,
        engine: String,
        title: Option<String>,
        channel_id: Option<Id>,
        agent_id: Option<Id>,
        /// What it should do ("Fix the checkout bug"): sent as the session's first
        /// message once it starts.
        #[serde(default)]
        #[ts(optional)]
        task: Option<String>,
    },
    Send {
        thread_id: Id,
        text: String,
        when: SendWhen,
    },
    Stop {
        thread_id: Id,
    },
    /// Brings a session's changes back into the folder it started from (merges its
    /// branch). Refuses, changing nothing, when that can't be done cleanly.
    MergeSession {
        thread_id: Id,
    },
    Decide {
        approval_id: Id,
        decision: Decision,
    },
    NeedsYou,
    SetPrefs {
        prefs: UiPrefs,
    },
    SetupStatus,
    FinishSetup {
        engine: String,
        keep_awake: bool,
    },
    /// Devices paired with this computer, newest first.
    ListDevices,
    /// Unpairs a device. Its open connections close at once (4401). Refused for the
    /// last paired device; the app confirms before removing the device it runs on.
    RevokeDevice {
        device_id: Id,
    },
    /// Every "Always allow" rule still in force.
    ListAllowRules,
    /// Ends an "Always allow" rule: the agent asks again next time.
    RevokeAllowRule {
        rule_id: Id,
    },
    /// What a session has changed so far: its files and the diff, from its copy of the
    /// repo (for a folder that isn't a git repo, the files changed since it started).
    SessionChanges {
        thread_id: Id,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SendWhen {
    /// Tell now: the agent reads it before its next step.
    Now,
    /// After this job: queued until the agent is free.
    AfterJob,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum Decision {
    Allow,
    /// Always allow, with a named scope ("in this folder", "for this site").
    AllowAlways {
        scope: String,
    },
    Deny,
}

// A short-lived wire value; boxing the large answer would only add an allocation.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "ok", rename_all = "snake_case")]
#[ts(export)]
pub enum CallResult {
    Done { value: CallValue },
    Failed { error: ApiError },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
#[ts(export)]
pub enum CallValue {
    None,
    Snapshot(Snapshot),
    Engines(Vec<EngineInfo>),
    Agent(AgentSummary),
    Channel(ChannelSummary),
    Thread(ThreadSummary),
    NeedsYou(Vec<NeedsYouItem>),
    Setup(SetupStatus),
    EngineCheck(EngineCheck),
    /// One plain line saying what happened.
    Message(String),
    Devices(Vec<DeviceInfo>),
    AllowRules(Vec<AllowRuleInfo>),
    SessionChanges(SessionChanges),
}

/// What a session changed, for its Changes panel.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionChanges {
    pub files: Vec<ChangedFile>,
    /// The whole diff as text, cut near 200 KB; `None` when there is none to show (a
    /// folder that isn't a git repo).
    pub diff: Option<String>,
    /// The diff was cut short.
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChangedFile {
    /// Relative to the session's folder.
    pub path: String,
    pub status: FileChange,
    /// Lines added and removed (both 0 for binary files and outside git).
    pub added: u32,
    pub removed: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum FileChange {
    Added,
    Modified,
    Deleted,
}

/// A paired device, for Settings.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct DeviceInfo {
    pub id: Id,
    /// The name it gave when it paired ("Browser").
    pub name: String,
    pub paired_at: String,
    pub last_seen_at: Option<String>,
    /// The device making this call.
    pub this_device: bool,
}

/// An "Always allow" rule, for Settings.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AllowRuleInfo {
    pub id: Id,
    pub agent_id: Option<Id>,
    /// One plain line: "Ava may always run `npm test` in shop".
    pub description: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ApiError {
    /// Stable code for programs (`not_found`, `conflict`, `invalid`, `engine`, `busy`,
    /// `unknown` (it may or may not have happened), `internal`).
    pub code: String,
    /// One plain line for people.
    pub message: String,
}

// ---------------------------------------------------------------------------
// Read models (projections)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Snapshot {
    pub agents: Vec<AgentSummary>,
    pub channels: Vec<ChannelSummary>,
    pub threads: Vec<ThreadSummary>,
    pub needs_you: Vec<NeedsYouItem>,
    pub prefs: UiPrefs,
    pub setup: SetupStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum WorkState {
    Idle,
    Working,
    NeedsYou,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentSummary {
    pub id: Id,
    pub name: String,
    /// One of `violet`, `sky`, `rose`, `teal` (design tokens).
    pub color: String,
    pub engine: String,
    pub model: Option<String>,
    pub state: WorkState,
    /// What it is doing, in plain words ("Checking the shop page"), or empty.
    pub live_line: String,
    /// Its own chat (no `#`).
    pub main_thread_id: Id,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChannelSummary {
    pub id: Id,
    /// Lowercase, one or two words joined by hyphens. Shown as `#slug`.
    pub slug: String,
    pub title: String,
    pub archived: bool,
    pub unread: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ThreadKind {
    /// An agent's own chat.
    Agent,
    /// A thread (tab) in a channel.
    Chat,
    /// A coding session in a folder.
    Session,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ThreadSummary {
    pub id: Id,
    pub kind: ThreadKind,
    pub channel_id: Option<Id>,
    pub agent_id: Option<Id>,
    pub title: String,
    pub state: WorkState,
    pub live_line: String,
    pub last_seq: i64,
    /// Engine id for sessions (shown only as a chip).
    pub engine: Option<String>,
    /// Folder for sessions.
    pub folder: Option<String>,
    pub started_by: Option<String>,
    pub updated_at: String,
    /// For sessions in a git repo: the separate copy the session works in.
    #[ts(optional)]
    pub worktree: Option<String>,
    /// The session's branch (`weilo/<name>`), merged back by `merge_session`.
    #[ts(optional)]
    pub branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NeedsYouItem {
    pub approval_id: Id,
    pub thread_id: Id,
    /// "#shop-launch · Ava" or "Fix checkout · session started by Ava".
    pub source: String,
    pub card: Card,
    pub created_at: String,
    pub expires_at: String,
    pub state: ApprovalState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ApprovalState {
    Pending,
    Allowed,
    Denied,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EngineInfo {
    pub id: String,
    pub title: String,
    /// One plain line.
    pub description: String,
    pub installed: bool,
    pub default: bool,
    pub binds_approvals: bool,
    /// Can be picked now: here (or downloadable on first use) and signed in or keyed.
    #[ts(optional)]
    pub ready: Option<bool>,
    /// What is missing, when not ready.
    #[ts(optional)]
    pub needs: Option<EngineNeed>,
    /// One plain line: "Signed in on this computer.", "Needs you to sign in.",
    /// "Not on this computer."
    #[ts(optional)]
    pub status: Option<String>,
    /// One plain line on what to do, like "Open Terminal, run `claude` and sign in."
    #[ts(optional)]
    pub how: Option<String>,
    /// Model companies whose API key this engine can use (`set_engine_key`).
    #[ts(optional)]
    pub key_providers: Option<Vec<KeyProvider>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum EngineNeed {
    /// Sign in with the engine's own app.
    SignIn,
    /// An API key (`set_engine_key`).
    Key,
    /// The engine's program isn't on this computer.
    Install,
    /// Node.js (npm), to download the engine.
    Node,
    /// Something else went wrong; the message says what.
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct KeyProvider {
    /// `anthropic`, `openai`, `google`…
    pub id: String,
    pub title: String,
    /// A key is saved in Weilo, or set where Weilo was started.
    pub has_key: bool,
}

/// What `check_engine` found.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EngineCheck {
    pub engine: String,
    pub ready: bool,
    pub needs: Option<EngineNeed>,
    /// One plain line.
    pub message: String,
    /// A button label: `Sign in`, `Add a key`, `Install`, `Try again`.
    pub action: Option<String>,
    /// Ways the engine says it can sign in.
    pub auth_methods: Vec<AuthMethodInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AuthMethodInfo {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SetupStatus {
    pub done: bool,
    /// Engines found on this computer, best first.
    pub found_engines: Vec<String>,
    pub keep_awake: bool,
    /// After `finish_setup`: whether the chosen engine worked. Ava is made either way.
    #[ts(optional)]
    pub check: Option<EngineCheck>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SectionPrefs {
    pub shown: bool,
    pub open: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UiPrefs {
    pub agents: SectionPrefs,
    pub channels: SectionPrefs,
    pub sessions: SectionPrefs,
    pub archived: SectionPrefs,
}

impl Default for UiPrefs {
    fn default() -> Self {
        let on = SectionPrefs {
            shown: true,
            open: true,
        };
        Self {
            agents: on.clone(),
            channels: on.clone(),
            sessions: on,
            archived: SectionPrefs {
                shown: true,
                open: false,
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Events (durable) and deltas (temporary)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Event {
    pub seq: i64,
    pub at: String,
    /// `user`, `agent`, `engine`, `host`.
    pub source: String,
    /// True when the event came from outside content (email, web, webhook).
    pub tainted: bool,
    pub body: EventBody,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum EventBody {
    UserMessage {
        text: String,
        when: SendWhen,
    },
    AgentMessage {
        text: String,
        agent_id: Option<Id>,
    },
    /// A step the agent took ("Read the checkout code").
    Step {
        step_id: String,
        title: String,
        status: StepStatus,
    },
    Card {
        card: Card,
    },
    ApprovalDecided {
        approval_id: Id,
        decision: Decision,
        via: String,
    },
    State {
        state: WorkState,
        live_line: String,
    },
    Filed {
        channel_id: Id,
    },
    /// Something went wrong or needs attention. `action` is a button label: `Try again`
    /// (send the last message again), `Sign in`, `Add a key`, `Install`,
    /// `Choose another folder`.
    Problem {
        message: String,
        action: Option<String>,
    },
    Usage {
        tokens_in: i64,
        tokens_out: i64,
        cost_micros: i64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum StepStatus {
    Running,
    Done,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum Delta {
    AgentText { text: String },
}

/// What an action can do, so every card shows one risk line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum RiskClass {
    /// Reading or looking; no card is needed.
    Read,
    /// "Changes nothing" or "Can undo".
    Reversible,
    /// Sends, posts or submits.
    Send,
    /// Pays, deletes or signs.
    Destructive,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Card {
    /// `approval`, `draft`, `question`.
    pub kind: String,
    pub approval_id: Option<Id>,
    pub title: String,
    pub body: Option<String>,
    /// Hidden behind "Show details" (a command, a diff, a URL).
    pub details: Option<String>,
    pub risk: RiskClass,
    /// "Changes nothing", "Can't unsend after Fri 9:00", "Costs about $0.20".
    pub risk_line: String,
    pub actions: Vec<CardAction>,
    /// For surfaces that can't draw this card.
    pub fallback_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CardAction {
    pub id: String,
    pub label: String,
    pub primary: bool,
    pub decision: Option<Decision>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let f = ClientFrame::Call {
            call_id: Uuid::nil(),
            call: Call::Send {
                thread_id: Uuid::nil(),
                text: "hi".into(),
                when: SendWhen::Now,
            },
        };
        let s = serde_json::to_string(&f).unwrap();
        assert!(s.contains(r#""t":"call""#) && s.contains(r#""method":"send""#));
        let back: ClientFrame = serde_json::from_str(&s).unwrap();
        assert!(matches!(
            back,
            ClientFrame::Call {
                call: Call::Send { .. },
                ..
            }
        ));
    }

    #[test]
    fn default_prefs_show_everything_but_fold_archived() {
        let p = UiPrefs::default();
        assert!(p.agents.shown && p.sessions.open && p.archived.shown && !p.archived.open);
    }
}
