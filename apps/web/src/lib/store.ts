import { useRef, useSyncExternalStore } from "react";
import type { AgentSummary } from "../proto/AgentSummary";
import type { AllowRuleInfo } from "../proto/AllowRuleInfo";
import type { DeviceInfo } from "../proto/DeviceInfo";
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
  /** The newest seq known in the thread when it was sent: its echo comes after this. */
  afterSeq?: bigint;
}

export interface UndoState {
  id: number;
  /** "Draft discarded" — the toast says this, with Undo. */
  text: string;
  /** A no that waits: the item shows as answered until then. */
  approvalId?: string;
  /** A Stop that waits: its Stop button is gone until then. */
  stopThreadId?: string;
  /** A removed "Always allow" that waits: hidden until then. */
  ruleId?: string;
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
  /** First run stays open until its last step is done, even after setup is saved. */
  firstRunOpen: boolean;
  error: string | null;
  /** A calm line that something worked (said politely, not as an alert). */
  notice: string | null;
  /** Paired devices and "Always allow" rules, for Settings: null until Settings asks. */
  devices: DeviceInfo[] | null;
  allowRules: AllowRuleInfo[] | null;
  /** Threads stopped from this device, with the newest seq at the time (for the "Stopped." line). */
  stopped: Record<string, bigint>;
  /** Approvals closed here by Stop, before the host says so. */
  stoppedCards: Record<string, true>;
  /** Every agent name seen, kept after an agent is removed, so its old replies keep its name. */
  agentNames: Record<string, string>;
  /** An action shown as done with an Undo, sent to the host only when the Undo runs out. */
  undo: UndoState | null;
  /** A thread's side panel is open (desktop): mid-width windows fold the sidebar to make room. */
  panelOpen: boolean;
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
  notice: null,
  devices: null,
  allowRules: null,
  stopped: {},
  stoppedCards: {},
  agentNames: {},
  undo: null,
  panelOpen: false,
};

export const EMPTY_FEED: Feed = { events: [], streaming: null };

// ---------------------------------------------------------------------------
// Reducers (pure)
// ---------------------------------------------------------------------------

export function applySnapshot(s: AppState, snapshot: Snapshot): AppState {
  const fresh = snapshot.agents.filter((a) => s.agentNames[a.id] !== a.name);
  const next: AppState = {
    ...s,
    snapshot,
    agentNames: fresh.length ? { ...s.agentNames, ...Object.fromEntries(fresh.map((a) => [a.id, a.name])) } : s.agentNames,
    firstRunOpen: s.firstRunOpen || !snapshot.setup.done,
  };
  return holdUndo(next);
}

export function patchSnapshot(s: AppState, patch: Partial<Snapshot>): AppState {
  if (!s.snapshot) return s;
  return { ...s, snapshot: { ...s.snapshot, ...patch } };
}

export function setNeedsYou(s: AppState, items: NeedsYouItem[]): AppState {
  return holdUndo(patchSnapshot(s, { needs_you: items }));
}

/** A fresh list from the host still shows a no that is waiting on its Undo as answered. */
export function holdUndo(s: AppState): AppState {
  return s.undo?.approvalId ? decideLocally(s, s.undo.approvalId, false) : s;
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
    // The host's echo of a message on its way. Send carries no id of ours, so match by
    // order: the oldest one sent before this event (the same text if there is one, since
    // the host may trim or reword it).
    const list = s.sending[threadId];
    const waiting = list?.filter((m) => m.afterSeq === undefined || event.seq > m.afterSeq) ?? [];
    const text = event.body.text.trim();
    const echo = waiting.find((m) => m.text.trim() === text) ?? waiting[0];
    if (list && echo) sending = { ...s.sending, [threadId]: list.filter((m) => m !== echo) };
  }
  return { ...s, sending, feeds: { ...s.feeds, [threadId]: { ...feed, events } } };
}

/** Shown when the host says it isn't ok but gives no line of its own. */
export const PAUSED_FALLBACK = "Your Weilo computer isn't ready. It will be back in a moment.";

/**
 * The host's "not ready" line in plain words. A restart reads "Back in a few seconds."; a
 * trailing aside in brackets, like "(a few seconds)", is never shown raw.
 */
export function pausedLine(message: string | null | undefined): string {
  const m = message?.trim() ?? "";
  if (!m) return PAUSED_FALLBACK;
  if (/\brestart/i.test(m)) return "Your Weilo computer is restarting. Back in a few seconds.";
  const plain = m.replace(/\s*\([^)]*\)\s*\.?$/, "").trim();
  if (!plain) return PAUSED_FALLBACK;
  return /[.!?]$/.test(plain) ? plain : `${plain}.`;
}

export function setHealth(s: AppState, ok: boolean, message: string | null): AppState {
  const paused = ok ? null : pausedLine(message);
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

/** The newest seq known for a thread: its loaded events, else its summary. */
export function lastSeqOf(s: AppState, threadId: string): bigint {
  const events = s.feeds[threadId]?.events ?? [];
  const fromFeed = events[events.length - 1]?.seq ?? 0n;
  const fromSummary = findThread(s, threadId)?.last_seq ?? 0n;
  return fromFeed > fromSummary ? fromFeed : fromSummary;
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

/**
 * Stop, before the host confirms: the thread gets its "Stopped." line, and its open
 * approvals close (the host closes them too, as "stopped").
 */
export function stopLocally(s: AppState, threadId: string): AppState {
  let next: AppState = { ...s, stopped: { ...s.stopped, [threadId]: lastSeqOf(s, threadId) } };
  if (!s.snapshot) return next;
  const closed = s.snapshot.needs_you.filter((n) => n.thread_id === threadId && n.state === "pending" && n.card.kind !== "heads_up");
  if (closed.length === 0) return next;
  const ids = new Set(closed.map((n) => n.approval_id));
  next = { ...next, stoppedCards: { ...s.stoppedCards, ...Object.fromEntries([...ids].map((id) => [id, true as const])) } };
  return patchSnapshot(next, {
    needs_you: s.snapshot.needs_you.map((n) => (ids.has(n.approval_id) ? { ...n, state: "denied" as const } : n)),
  });
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

/**
 * Who wrote a reply, for its "Name · 9:41" line: the agent, else the name it had before it
 * was removed, else "Removed agent". A session's own work, with no agent, is "This session".
 */
export function authorName(s: AppState, agentId: string | null | undefined): string {
  if (!agentId) return "This session";
  return findAgent(s, agentId)?.name ?? s.agentNames[agentId] ?? "Removed agent";
}

export function findThread(s: AppState, id: string | null | undefined): ThreadSummary | undefined {
  if (!id || !s.snapshot) return undefined;
  return s.snapshot.threads.find((t) => t.id === id);
}

/** The main agent: the first one (Ava). */
export function mainAgent(s: AppState): AgentSummary | undefined {
  return s.snapshot?.agents[0];
}

/** The Weilo computer can't be reached or isn't ready: Stop can't do anything, so it isn't offered. */
export function hostAway(s: AppState): boolean {
  return s.conn === "reconnecting" || s.paused !== null;
}

/** Why answering has to wait: the computer can't be reached, or its own line while it isn't ready. */
export function awayLine(s: AppState): string | null {
  if (s.conn === "reconnecting") return "Can't reach your Weilo computer.";
  return s.paused;
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

// ---------------------------------------------------------------------------
// Problems that ended a reply (Needs you → Didn't work)
// ---------------------------------------------------------------------------

export interface OpenProblem {
  seq: bigint;
  at: string;
  message: string;
  action: string | null;
}

/**
 * The newest problem in a chat that nothing has fixed yet: a later reply from the agent
 * or a message sent again clears it. (The host sends problems only as chat events, so Needs you derives these.)
 */
export function openProblem(events: Event[]): OpenProblem | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    const b = e.body;
    // A reply since, or a message sent again (Try again), means it was dealt with.
    if (b.kind === "agent_message" || b.kind === "user_message") return null;
    if (b.kind === "problem") return { seq: e.seq, at: e.at, message: b.message, action: b.action };
  }
  return null;
}

const problemCache = new WeakMap<Event[], OpenProblem | null>();
function cachedProblem(events: Event[]): OpenProblem | null {
  if (!problemCache.has(events)) problemCache.set(events, openProblem(events));
  return problemCache.get(events)!;
}

/** What a chat's sidebar line says while a problem is open. */
export function problemLine(p: Pick<OpenProblem, "action" | "message">): string {
  switch (p.action?.trim().toLowerCase()) {
    case "add a key":
      return "Needs an API key";
    case "sign in":
      return "Needs you to sign in";
    case "install":
      return "Needs an app installed";
    case "choose another folder":
      return "Can't open its folder";
    default:
      return /api key/i.test(p.message) ? "Needs an API key" : "Didn't work";
  }
}

export type StatusTone = "ok" | "warn" | "quiet";

/**
 * An agent's one status line, the same everywhere (sidebar, Agents page, its own header):
 * an open problem while it is idle ("Needs an API key", in the warning colour), else what
 * it is doing.
 */
export function agentStatus(
  a: Pick<AgentSummary, "state" | "live_line" | "main_thread_id">,
  problems: Record<string, string>,
): { line: string | null; tone: StatusTone; problem: boolean } {
  const problem = a.state === "idle" ? problems[a.main_thread_id] : undefined;
  if (problem) return { line: problem, tone: "warn", problem: true };
  const tone: StatusTone = a.state === "needs_you" ? "warn" : a.state === "working" ? "ok" : "quiet";
  return { line: a.live_line || null, tone, problem: false };
}

/** The text colour for a status tone. */
export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  ok: "text-success",
  warn: "text-warning",
  quiet: "text-text-tertiary",
};

/**
 * A problem as a Needs you title that names who it's about: "Mia needs an API key",
 * "Fix checkout can't open its folder". An unknown problem keeps its own words.
 */
export function problemTitle(
  who: string | null,
  p: Pick<OpenProblem, "action" | "message">,
  owner: string | null = who,
  titles: string[] = [],
): string {
  const line = problemLine(p);
  if (!who || line === "Didn't work") return plainProblem(p.message, owner, titles).line;
  return `${who} ${line[0]!.toLowerCase()}${line.slice(1)}`;
}

// AI apps' names as the host may write them, for messages from before the engines list loads.
const KNOWN_ENGINE_TITLES = ["Claude Code", "Codex", "Gemini CLI", "Gemini", "Weilo's built-in AI", "pi", "Echo"];

/**
 * A problem said about the agent, not the AI app behind it (§11.0): "Codex stopped
 * responding…" reads "Ava's AI stopped responding…". `named` is true when the app's
 * name was taken out, so the original can go under Details.
 */
export function plainProblem(message: string, owner: string | null, titles: string[] = []): { line: string; named: boolean } {
  const all = [...new Set([...titles, ...KNOWN_ENGINE_TITLES])].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const t of all) {
    if (message.startsWith(`${t} `) || message.startsWith(`${t}'s `) || message.startsWith(`${t},`)) {
      return { line: `${owner ? `${owner}'s` : "Your"} AI${message.slice(t.length)}`, named: true };
    }
  }
  return { line: message, named: false };
}

/** Whose AI a thread uses, by the agent's short name: a session's is the agent that started it. */
export function aiOwner(snap: Snapshot | null, threadId: string, agentId?: string | null): string | null {
  if (!snap) return null;
  const t = snap.threads.find((x) => x.id === threadId);
  const agent =
    snap.agents.find((a) => a.id === (agentId ?? t?.agent_id)) ??
    snap.agents.find((a) => a.main_thread_id === threadId) ??
    snap.agents.find((a) => !!t?.started_by && (a.id === t.started_by || a.name === t.started_by));
  return agent ? agent.name.split(" · ")[0]!.trim() : null;
}

export function engineTitles(s: Pick<AppState, "engines">): string[] {
  return (s.engines ?? []).map((e) => e.title);
}

/** Open problems by thread: the sidebar's line for each. */
export function problemLines(s: AppState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [threadId, feed] of Object.entries(s.feeds)) {
    const p = cachedProblem(feed.events);
    if (p) out[threadId] = problemLine(p);
  }
  return out;
}

const itemCache = new WeakMap<Event[], NeedsYouItem>();

/** Open problems as Needs you items (under "Didn't work"), unless the host already lists one for that chat. */
export function problemNeedsYou(s: AppState): NeedsYouItem[] {
  const snap = s.snapshot;
  if (!snap) return [];
  const out: NeedsYouItem[] = [];
  for (const t of snap.threads) {
    const feed = s.feeds[t.id];
    if (!feed) continue;
    const p = cachedProblem(feed.events);
    if (!p) continue;
    if (snap.needs_you.some((n) => n.thread_id === t.id && (n.card.kind === "failed" || n.card.kind === "problem"))) continue;
    let item = itemCache.get(feed.events);
    if (!item || item.thread_id !== t.id) {
      item = {
        approval_id: `problem:${t.id}:${p.seq}`,
        thread_id: t.id,
        source: sourceOf(snap, t),
        card: {
          kind: "problem",
          approval_id: null,
          title: problemTitle(whoOf(snap, t), p, aiOwner(snap, t.id), engineTitles(s)),
          body: p.message,
          details: null,
          risk: "read",
          risk_line: "",
          // The problem's own button (Add a key, Try again…), as in the chat.
          actions: p.action ? [{ id: "problem", label: p.action, primary: true, decision: null }] : [],
          fallback_text: p.message,
        },
        created_at: p.at,
        expires_at: p.at,
        state: "pending",
      };
      itemCache.set(feed.events, item);
    }
    out.push(item);
  }
  return out;
}

/** Who a chat's problem is about: its agent, or the session by name. */
function whoOf(snap: Snapshot, t: ThreadSummary): string | null {
  if (t.kind === "session") return t.title;
  const agent = snap.agents.find((a) => a.id === t.agent_id) ?? snap.agents.find((a) => a.main_thread_id === t.id);
  return agent ? agent.name.split(" · ")[0]!.trim() : null;
}

function sourceOf(snap: Snapshot, t: ThreadSummary): string {
  const agent = snap.agents.find((a) => a.id === t.agent_id);
  const name = agent ? agent.name.split(" · ")[0]!.trim() : null;
  if (t.kind === "session") return `${t.title} · session`;
  const channel = snap.channels.find((c) => c.id === t.channel_id);
  if (channel) return name ? `#${channel.slug} · ${name}` : `#${channel.slug}`;
  return name ?? t.title;
}
