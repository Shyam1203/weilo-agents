import type { Call } from "../proto/Call";
import type { CallValue } from "../proto/CallValue";
import type { Changed } from "../proto/Changed";
import type { Decision } from "../proto/Decision";
import type { EngineCheck } from "../proto/EngineCheck";
import type { SendWhen } from "../proto/SendWhen";
import type { UiPrefs } from "../proto/UiPrefs";
import { HostError, type HostApi, type HostListener } from "./host";
import {
  addQueued,
  addSending,
  appendEvent,
  applySnapshot,
  decideLocally,
  findThread,
  lastUserMessage,
  removeQueued,
  removeSending,
  revertPrefs,
  saveQueued,
  setCheck,
  setDraft,
  setHealth,
  setNeedsYou,
  setPrefs,
  setStreaming,
  stopLocally,
  store,
  threadState,
  undecideLocally,
} from "./store";

let host: HostApi | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const dirty = new Set<Changed | "all">();
let errorTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;
const localId = () => `local-${Date.now()}-${++seq}`;

/** The listener every host (real or fixture) reports to. */
export const listener: HostListener = {
  status(conn) {
    store.set((s) => ({ ...s, conn }));
  },
  welcome(w) {
    store.set((s) => ({ ...s, hostName: w.hostName }));
    markDirty("all");
  },
  event(threadId, event) {
    store.set((s) => appendEvent(s, threadId, event));
    if (event.body.kind === "state" && event.body.state !== "working") flushQueued(threadId);
  },
  streaming(threadId, text) {
    store.set((s) => setStreaming(s, threadId, text));
  },
  changed(what) {
    markDirty(what);
  },
  health(ok, message) {
    store.set((s) => setHealth(s, ok, message));
  },
};

export function connect(h: HostApi): void {
  host = h;
  h.start();
}

/** "Try again": drop the wait between attempts and connect now. */
export function reconnectNow(): void {
  if (!host) return;
  host.stop();
  host.start();
}

function need(): HostApi {
  if (!host) throw new HostError("offline", "Not connected yet.");
  return host;
}

export function call(c: Call): Promise<CallValue> {
  return need().call(c);
}

/** Something you asked for didn't work: said as an alert. */
export function showError(e: unknown): void {
  const message = e instanceof Error ? e.message : "Something went wrong. Try again.";
  store.set((s) => ({ ...s, error: message, notice: null }));
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => store.set((s) => ({ ...s, error: null })), 6000);
}

/** A calm one-line note that something worked: said politely, in the same place. */
export function showNotice(message: string): void {
  store.set((s) => ({ ...s, notice: message, error: null }));
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => store.set((s) => ({ ...s, notice: null })), 6000);
}

export function clearError(): void {
  store.set((s) => ({ ...s, error: null, notice: null }));
}

// -- Refreshing what the sidebar and Needs you show ---------------------------

function markDirty(what: Changed | "all"): void {
  dirty.add(what);
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh();
  }, 30);
}

async function refresh(): Promise<void> {
  const what = new Set(dirty);
  dirty.clear();
  try {
    const needsSnapshot = what.has("all") || ["agents", "channels", "threads", "prefs"].some((k) => what.has(k as Changed));
    if (needsSnapshot) {
      await loadSnapshot();
    } else if (what.has("needs_you")) {
      const v = await call({ method: "needs_you" });
      if (v.type === "needs_you") store.set((s) => setNeedsYou(s, v.data));
    }
    if (what.has("engines") && store.get().engines) await loadEngines();
  } catch (e) {
    if (!(e instanceof HostError && e.code === "offline")) showError(e);
  }
}

export async function loadSnapshot(): Promise<void> {
  const v = await call({ method: "snapshot" });
  if (v.type === "snapshot") {
    store.set((s) => applySnapshot(s, v.data));
    for (const t of v.data.threads) flushQueued(t.id);
  }
}

export async function loadEngines(): Promise<void> {
  const v = await call({ method: "list_engines" });
  if (v.type === "engines") store.set((s) => ({ ...s, engines: v.data }));
}

// -- Threads -----------------------------------------------------------------

export function follow(threadId: string): () => void {
  const h = host;
  if (!h) return () => {};
  h.subscribe(threadId);
  h.presence(threadId);
  return () => {
    h.unsubscribe(threadId);
    h.presence(null);
  };
}

/** Sends a message. False when it didn't go (the text goes back into the message box). */
export async function send(threadId: string, text: string, when: SendWhen = "now"): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const paused = store.get().paused;
  if (paused) {
    store.set((s) => setDraft(s, threadId, trimmed));
    showError(new Error(paused));
    return false;
  }
  const id = localId();
  store.set((s) => addSending(s, threadId, { id, text: trimmed }));
  try {
    // The placeholder stays until the host echoes the message (appendEvent drops it then).
    await call({ method: "send", params: { thread_id: threadId, text: trimmed, when } });
    return true;
  } catch (e) {
    store.set((s) => setDraft(removeSending(s, threadId, id), threadId, trimmed));
    showError(e instanceof HostError ? e : new Error("Couldn't send that. Try again."));
    return false;
  }
}

/** "After this job": kept as Next up until the agent is free. */
export function queue(threadId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  store.set((s) => addQueued(s, threadId, { id: localId(), text: trimmed }));
  saveQueued(store.get().queued);
  flushQueued(threadId);
}

export function unqueue(threadId: string, id: string): void {
  store.set((s) => removeQueued(s, threadId, id));
  saveQueued(store.get().queued);
}

function flushQueued(threadId: string): void {
  const s = store.get();
  const next = s.queued[threadId]?.[0];
  if (!next) return;
  const summary = findThread(s, threadId);
  if (!summary || threadState(summary, s.feeds[threadId]) === "working") return;
  store.set((st) => removeQueued(st, threadId, next.id));
  saveQueued(store.get().queued);
  void send(threadId, next.text, "after_job");
}

/** A problem's "Try again": sends the person's last message in that chat again. */
export async function retryLast(threadId: string): Promise<void> {
  const text = lastUserMessage(store.get().feeds[threadId]?.events ?? []);
  if (!text) {
    showError(new Error("There's no message to send again. Write a new one below."));
    return;
  }
  await send(threadId, text, "now");
}

export function setComposerDraft(threadId: string, text: string): void {
  store.set((s) => setDraft(s, threadId, text));
}

export async function stop(threadId: string): Promise<void> {
  try {
    await call({ method: "stop", params: { thread_id: threadId } });
    store.set((s) => stopLocally(s, threadId));
  } catch (e) {
    showError(e);
  }
}

/** Stops an agent's work in its own chat. */
export async function stopAgent(agent: { id: string; main_thread_id: string }): Promise<void> {
  try {
    await call({ method: "stop_agent", params: { agent_id: agent.id } });
    store.set((s) => stopLocally(s, agent.main_thread_id));
  } catch (e) {
    showError(e);
  }
}

export async function decide(approvalId: string, decision: Decision): Promise<boolean> {
  const allowed = decision.kind !== "deny";
  store.set((s) => decideLocally(s, approvalId, allowed));
  try {
    await call({ method: "decide", params: { approval_id: approvalId, decision } });
    return true;
  } catch (e) {
    store.set((s) => undecideLocally(s, approvalId, allowed));
    showError(e);
    return false;
  }
}

// -- Preferences ---------------------------------------------------------------

/** Optimistic: the sidebar changes at once and goes back if the host says no. */
export async function savePrefs(prefs: UiPrefs): Promise<void> {
  const before = store.get().snapshot?.prefs;
  store.set((s) => setPrefs(s, prefs));
  try {
    await call({ method: "set_prefs", params: { prefs } });
  } catch (e) {
    if (before) store.set((s) => (s.snapshot ? setPrefs(s, revertPrefs(s.snapshot.prefs, before, prefs)) : s));
    showError(e);
  }
}

// -- Making things -------------------------------------------------------------

export async function create<T extends CallValue["type"]>(
  c: Call,
  type: T,
): Promise<Extract<CallValue, { type: T }>> {
  const v = await call(c);
  if (v.type !== type) throw new Error("Unexpected answer from your Weilo computer.");
  markDirty("all");
  return v as Extract<CallValue, { type: T }>;
}

// -- Engines --------------------------------------------------------------------

/** Starts the engine once to see whether it works here. Kept in the store for dialogs. */
export async function checkEngine(engine: string): Promise<EngineCheck> {
  const v = await call({ method: "check_engine", params: { engine } });
  if (v.type !== "engine_check") throw new Error("Unexpected answer from your Weilo computer.");
  store.set((s) => setCheck(s, v.data));
  return v.data;
}

/** Saves an API key (an empty key removes it). The key is never kept in the app. */
export async function setEngineKey(engine: string, provider: string, key: string): Promise<void> {
  const v = await call({ method: "set_engine_key", params: { engine, provider, key } });
  if (v.type === "engines") store.set((s) => ({ ...s, engines: v.data }));
}

/** Moves an agent to another engine. Its next reply starts a new conversation. */
export async function changeAgentEngine(agentId: string, engine: string): Promise<void> {
  await create({ method: "update_agent", params: { agent_id: agentId, name: null, model: null, instructions: null, engine } }, "agent");
}

export async function archiveAgent(agentId: string): Promise<void> {
  await call({ method: "archive_agent", params: { agent_id: agentId } });
  markDirty("all");
}

/** Brings a session's changes back into its folder. Returns the host's one plain line. */
export async function mergeSession(threadId: string): Promise<string> {
  const v = await call({ method: "merge_session", params: { thread_id: threadId } });
  markDirty("threads");
  return v.type === "message" ? v.data : "Done.";
}

export async function finishSetup(engine: string, keepAwake: boolean): Promise<void> {
  await call({ method: "finish_setup", params: { engine, keep_awake: keepAwake } });
  await loadSnapshot();
}

export function closeFirstRun(): void {
  store.set((s) => ({ ...s, firstRunOpen: false }));
}
