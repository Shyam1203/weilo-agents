import type { Call } from "../proto/Call";
import type { CallValue } from "../proto/CallValue";
import type { Changed } from "../proto/Changed";
import type { Decision } from "../proto/Decision";
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
  removeQueued,
  removeSending,
  setDraft,
  setNeedsYou,
  setPrefs,
  setStreaming,
  store,
  threadState,
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
};

export function connect(h: HostApi): void {
  host = h;
  h.start();
}

function need(): HostApi {
  if (!host) throw new HostError("offline", "Not connected yet.");
  return host;
}

export function call(c: Call): Promise<CallValue> {
  return need().call(c);
}

export function showError(e: unknown): void {
  const message = e instanceof Error ? e.message : "Something went wrong. Try again.";
  store.set((s) => ({ ...s, error: message }));
  if (errorTimer) clearTimeout(errorTimer);
  errorTimer = setTimeout(() => store.set((s) => ({ ...s, error: null })), 6000);
}

export function clearError(): void {
  store.set((s) => ({ ...s, error: null }));
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

export async function send(threadId: string, text: string, when: SendWhen = "now"): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const id = localId();
  store.set((s) => addSending(s, threadId, { id, text: trimmed }));
  try {
    await call({ method: "send", params: { thread_id: threadId, text: trimmed, when } });
    // The host echoes the message as an event; drop the placeholder if it hasn't.
    setTimeout(() => store.set((s) => removeSending(s, threadId, id)), 4000);
  } catch (e) {
    store.set((s) => setDraft(removeSending(s, threadId, id), threadId, trimmed));
    showError(e instanceof HostError ? e : new Error("Couldn't send that. Try again."));
  }
}

/** "After this job": kept as Next up until the agent is free. */
export function queue(threadId: string, text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  store.set((s) => addQueued(s, threadId, { id: localId(), text: trimmed }));
  flushQueued(threadId);
}

export function unqueue(threadId: string, id: string): void {
  store.set((s) => removeQueued(s, threadId, id));
}

function flushQueued(threadId: string): void {
  const s = store.get();
  const next = s.queued[threadId]?.[0];
  if (!next) return;
  const summary = findThread(s, threadId);
  if (!summary || threadState(summary, s.feeds[threadId]) === "working") return;
  store.set((st) => removeQueued(st, threadId, next.id));
  void send(threadId, next.text, "after_job");
}

export function setComposerDraft(threadId: string, text: string): void {
  store.set((s) => setDraft(s, threadId, text));
}

export async function stop(threadId: string): Promise<void> {
  try {
    await call({ method: "stop", params: { thread_id: threadId } });
  } catch (e) {
    showError(e);
  }
}

export async function decide(approvalId: string, decision: Decision): Promise<boolean> {
  const before = store.get();
  store.set((s) => decideLocally(s, approvalId, decision.kind !== "deny"));
  try {
    await call({ method: "decide", params: { approval_id: approvalId, decision } });
    return true;
  } catch (e) {
    store.set((s) => (s.snapshot && before.snapshot ? setNeedsYou(s, before.snapshot.needs_you) : s));
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
    if (before) store.set((s) => setPrefs(s, before));
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

export async function finishSetup(engine: string, keepAwake: boolean): Promise<void> {
  await call({ method: "finish_setup", params: { engine, keep_awake: keepAwake } });
  await loadSnapshot();
}

export function closeFirstRun(): void {
  store.set((s) => ({ ...s, firstRunOpen: false }));
}
