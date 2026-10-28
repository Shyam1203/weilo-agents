import { useRef, useSyncExternalStore } from "react";
import type { AgentSummary } from "../proto/AgentSummary";
import type { EngineCheck } from "../proto/EngineCheck";
import type { EngineInfo } from "../proto/EngineInfo";
import type { Event } from "../proto/Event";
import type { NeedsYouItem } from "../proto/NeedsYouItem";
import type { Snapshot } from "../proto/Snapshot";
import type { ThreadSummary } from "../proto/ThreadSummary";
import type { UiPrefs } from "../proto/UiPrefs";
import type { WorkState } from "../proto/WorkState";
import type { ConnStatus } from "./host";

// ---------------------------------------------------------------------------
// A tiny store
// ---------------------------------------------------------------------------

export interface Store<S> {
  get(): S;
  set(update: (s: S) => S): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update) {
      const next = update(state);
      if (next === state) return;
      state = next;
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

export interface Feed {
  /** Durable events in seq order. */
  events: Event[];
  /** The reply being written right now. */
  streaming: string | null;
}

export interface Queued {
  id: string;
  text: string;
}

export interface Sending {
  id: string;
  text: string;
}

export interface AppState {
  conn: ConnStatus;
  hostName: string | null;
  snapshot: Snapshot | null;
  engines: EngineInfo[] | null;
  /** The newest check of each engine (first run, Check again). */
  checks: Record<string, EngineCheck>;
  /** While the host says it isn't ok: its one plain line. Sending waits until it clears. */
  paused: string | null;
  feeds: Record<string, Feed>;
  /** "Next up" messages, kept here until the agent is free. */
  queued: Record<string, Queued[]>;
  /** Messages on their way, shown until the host echoes them. */
  sending: Record<string, Sending[]>;
  /** Text to put in a thread's message box (Edit, Ask Ava). */
  drafts: Record<string, string>;
  /** First run stays open for the phone step after setup is saved. */
  firstRunOpen: boolean;
  error: string | null;
}

// "Next up" lives in this browser until the host can hold and cancel queued messages.
const QUEUED_KEY = "weilo.nextUp";

/** Next up messages saved in this browser, per thread. Empty when storage is blocked or broken. */
export function loadQueued(storage?: Pick<Storage, "getItem">): Record<string, Queued[]> {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(QUEUED_KEY);
    if (!raw) return {};
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: Record<string, Queued[]> = {};
    for (const [threadId, list] of Object.entries(data as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      const items = list.filter(
        (q): q is Queued => !!q && typeof q === "object" && typeof (q as Queued).id === "string" && typeof (q as Queued).text === "string",
      );
      if (items.length) out[threadId] = items;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveQueued(
  queued: Record<string, Queued[]>,
  storage?: Pick<Storage, "setItem" | "removeItem">,
): void {
  try {
    const st = storage ?? globalThis.localStorage;
    const kept = Object.fromEntries(Object.entries(queued).filter(([, list]) => list.length > 0));
    if (Object.keys(kept).length === 0) st?.removeItem(QUEUED_KEY);
    else st?.setItem(QUEUED_KEY, JSON.stringify(kept));
  } catch {
    // Private windows and full storage: Next up still works until the page closes.
  }
}

export const initialState: AppState = {
  conn: "connecting",
  hostName: null,
  snapshot: null,
  engines: null,
  checks: {},
  paused: null,
  feeds: {},
  queued: {},
  sending: {},
  drafts: {},
  firstRunOpen: false,
  error: null,
};

export const EMPTY_FEED: Feed = { events: [], streaming: null };

// ---------------------------------------------------------------------------
// Reducers (pure)
// ---------------------------------------------------------------------------

export function applySnapshot(s: AppState, snapshot: Snapshot): AppState {
  return {
    ...s,
    snapshot,
    firstRunOpen: s.firstRunOpen || !snapshot.setup.done,
  };
}

export function patchSnapshot(s: AppState, patch: Partial<Snapshot>): AppState {
  if (!s.snapshot) return s;
  return { ...s, snapshot: { ...s.snapshot, ...patch } };
}

export function setNeedsYou(s: AppState, items: NeedsYouItem[]): AppState {
  return patchSnapshot(s, { needs_you: items });
}

export function setPrefs(s: AppState, prefs: UiPrefs): AppState {
  return patchSnapshot(s, { prefs });
}

/** Adds a durable event, keeping seq order and dropping repeats. */
export function appendEvent(s: AppState, threadId: string, event: Event): AppState {
  const feed = s.feeds[threadId] ?? EMPTY_FEED;
  const last = feed.events[feed.events.length - 1];
  let events: Event[];
  if (!last || last.seq < event.seq) {
    events = [...feed.events, event];
  } else {
    if (feed.events.some((e) => e.seq === event.seq)) return s;
    events = [...feed.events, event].sort((a, b) => (a.seq < b.seq ? -1 : 1));
  }
  let sending = s.sending;
  if (event.body.kind === "user_message") {
    const text = event.body.text;
    const list = s.sending[threadId];
    if (list?.some((m) => m.text === text)) {
      let removed = false;
      const rest = list.filter((m) => {
        if (!removed && m.text === text) {
          removed = true;
          return false;
        }
        return true;
      });
      sending = { ...s.sending, [threadId]: rest };
    }
  }
  return { ...s, sending, feeds: { ...s.feeds, [threadId]: { ...feed, events } } };
}

/** Shown when the host says it isn't ok but gives no line of its own. */
export const PAUSED_FALLBACK = "Your Weilo computer isn't ready. It will be back in a moment.";

export function setHealth(s: AppState, ok: boolean, message: string | null): AppState {
  const paused = ok ? null : message?.trim() || PAUSED_FALLBACK;
  return s.paused === paused ? s : { ...s, paused };
}

export function setCheck(s: AppState, check: EngineCheck): AppState {
  return { ...s, checks: { ...s.checks, [check.engine]: check } };
}

/** The last thing the person said in a thread (for Try again). */
export function lastUserMessage(events: Event[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const b = events[i]!.body;
    if (b.kind === "user_message" && b.text.trim()) return b.text;
  }
  return null;
}

/** The engine a thread runs on: a session's own, else its agent's. */
export function engineOfThread(s: AppState, threadId: string, agentId?: string | null): string | null {
  const t = findThread(s, threadId);
  if (t?.engine) return t.engine;
  const agent =
    findAgent(s, t?.agent_id ?? agentId) ?? s.snapshot?.agents.find((a) => a.main_thread_id === threadId);
  return agent?.engine ?? null;
}

export function setStreaming(s: AppState, threadId: string, text: string | null): AppState {
  const feed = s.feeds[threadId] ?? EMPTY_FEED;
  if (feed.streaming === text) return s;
  return { ...s, feeds: { ...s.feeds, [threadId]: { ...feed, streaming: text } } };
}

export function addQueued(s: AppState, threadId: string, item: Queued): AppState {
  return { ...s, queued: { ...s.queued, [threadId]: [...(s.queued[threadId] ?? []), item] } };
}

export function removeQueued(s: AppState, threadId: string, id: string): AppState {
  const list = s.queued[threadId];
  if (!list) return s;
  return { ...s, queued: { ...s.queued, [threadId]: list.filter((q) => q.id !== id) } };
}

export function addSending(s: AppState, threadId: string, item: Sending): AppState {
  return { ...s, sending: { ...s.sending, [threadId]: [...(s.sending[threadId] ?? []), item] } };
}

export function removeSending(s: AppState, threadId: string, id: string): AppState {
  const list = s.sending[threadId];
  if (!list || !list.some((m) => m.id === id)) return s;
  return { ...s, sending: { ...s.sending, [threadId]: list.filter((m) => m.id !== id) } };
}

export function setDraft(s: AppState, threadId: string, text: string): AppState {
  return { ...s, drafts: { ...s.drafts, [threadId]: text } };
}

/**
 * Undoes decideLocally after the host said no: puts back only that item, and only if
 * nothing newer (a refresh from the host) has changed it since.
 */
export function undecideLocally(s: AppState, approvalId: string, allowed: boolean): AppState {
  if (!s.snapshot) return s;
  const mark = allowed ? "allowed" : "denied";
  if (!s.snapshot.needs_you.some((n) => n.approval_id === approvalId && n.state === mark)) return s;
  const needs_you = s.snapshot.needs_you.map((n) =>
    n.approval_id === approvalId && n.state === mark ? { ...n, state: "pending" as const } : n,
  );
  return patchSnapshot(s, { needs_you });
}

/**
 * After a failed save, puts back only the section settings this save changed, and only
 * where they still hold what this save wrote (a newer change wins).
 */
export function revertPrefs(current: UiPrefs, before: UiPrefs, attempted: UiPrefs): UiPrefs {
  let next = current;
  for (const key of Object.keys(attempted) as Array<keyof UiPrefs>) {
    for (const field of ["shown", "open"] as const) {
      const was = before[key]?.[field];
      const tried = attempted[key]?.[field];
      if (was === undefined || tried === undefined || was === tried) continue;
      if (next[key]?.[field] !== tried) continue;
      next = { ...next, [key]: { ...next[key], [field]: was } };
    }
  }
  return next;
}

/** Marks a Needs you item decided before the host confirms. */
export function decideLocally(s: AppState, approvalId: string, allowed: boolean): AppState {
  if (!s.snapshot) return s;
  const needs_you = s.snapshot.needs_you.map((n) =>
    n.approval_id === approvalId && n.state === "pending"
      ? { ...n, state: allowed ? ("allowed" as const) : ("denied" as const) }
      : n,
  );
  return patchSnapshot(s, { needs_you });
}

// ---------------------------------------------------------------------------
// Selectors (pure)
// ---------------------------------------------------------------------------

/** A thread's work state: the newest State event, else the summary. */
export function threadState(summary: ThreadSummary | undefined, feed: Feed | undefined): WorkState {
  if (feed) {
    for (let i = feed.events.length - 1; i >= 0; i--) {
      const b = feed.events[i]!.body;
      if (b.kind === "state") {
        if (!summary || feed.events[i]!.seq >= summary.last_seq) return b.state;
        break;
      }
    }
  }
  return summary?.state ?? "idle";
}

export function findAgent(s: AppState, id: string | null | undefined): AgentSummary | undefined {
  if (!id || !s.snapshot) return undefined;
  return s.snapshot.agents.find((a) => a.id === id);
}

export function findThread(s: AppState, id: string | null | undefined): ThreadSummary | undefined {
  if (!id || !s.snapshot) return undefined;
  return s.snapshot.threads.find((t) => t.id === id);
}

/** The main agent: the first one (Ava). */
export function mainAgent(s: AppState): AgentSummary | undefined {
  return s.snapshot?.agents[0];
}

export function pendingNeedsYou(s: AppState): NeedsYouItem[] {
  return s.snapshot?.needs_you.filter((n) => n.state === "pending" && n.card.kind !== "heads_up") ?? [];
}

// ---------------------------------------------------------------------------
// The app's store
// ---------------------------------------------------------------------------

export const store = createStore<AppState>({ ...initialState, queued: loadQueued() });

/**
 * Reads a slice of the store. Derived arrays and objects are compared shallowly,
 * so a component re-renders only when what it shows changed.
 */
export function useApp<T>(select: (s: AppState) => T): T {
  const cache = useRef<{ state: AppState; select: (s: AppState) => T; value: T } | null>(null);
  const get = (): T => {
    const state = store.get();
    const c = cache.current;
    if (c && c.state === state && c.select === select) return c.value;
    const value = select(state);
    if (c && shallowEqual(c.value, value)) {
      cache.current = { state, select, value: c.value };
      return c.value;
    }
    cache.current = { state, select, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, get, get);
}

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}
