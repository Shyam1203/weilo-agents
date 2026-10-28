import { describe, expect, it } from "vitest";
import {
  addQueued,
  addSending,
  appendEvent,
  applySnapshot,
  decideLocally,
  initialState,
  pendingNeedsYou,
  removeQueued,
  setPrefs,
  setStreaming,
  shallowEqual,
  threadState,
  type AppState,
} from "../lib/store";
import type { Event } from "../proto/Event";
import type { Snapshot } from "../proto/Snapshot";
import type { ThreadSummary } from "../proto/ThreadSummary";
import { snapshot, item } from "./fixtures";

const ev = (seq: number, body: Event["body"]): Event => ({ seq: BigInt(seq), at: "2026-10-28T09:00:00Z", source: "agent", tainted: false, body });
const msg = (seq: number, text = "hi") => ev(seq, { kind: "user_message", text, when: "now" });

describe("store reducers", () => {
  it("appends events in seq order and drops repeats", () => {
    let s: AppState = initialState;
    s = appendEvent(s, "t", msg(1));
    s = appendEvent(s, "t", msg(3));
    s = appendEvent(s, "t", msg(2));
    const again = appendEvent(s, "t", msg(2));
    expect(again).toBe(s);
    expect(s.feeds.t!.events.map((e) => e.seq)).toEqual([1n, 2n, 3n]);
  });

  it("drops a sending placeholder when the host echoes it", () => {
    let s = addSending(initialState, "t", { id: "a", text: "Hello" });
    s = addSending(s, "t", { id: "b", text: "Hello" });
    s = appendEvent(s, "t", msg(1, "Hello"));
    expect(s.sending.t).toEqual([{ id: "b", text: "Hello" }]);
  });

  it("keeps streaming text per thread", () => {
    const s = setStreaming(initialState, "t", "Hel");
    expect(s.feeds.t!.streaming).toBe("Hel");
    expect(setStreaming(s, "t", "Hel")).toBe(s);
    expect(setStreaming(s, "t", null).feeds.t!.streaming).toBeNull();
  });

  it("queues and removes Next up items", () => {
    let s = addQueued(initialState, "t", { id: "1", text: "Also Instagram" });
    s = addQueued(s, "t", { id: "2", text: "And TikTok" });
    s = removeQueued(s, "t", "1");
    expect(s.queued.t).toEqual([{ id: "2", text: "And TikTok" }]);
  });

  it("opens first run while setup isn't done and keeps it open", () => {
    const notDone: Snapshot = { ...snapshot(), setup: { done: false, found_engines: [], keep_awake: false } };
    let s = applySnapshot(initialState, notDone);
    expect(s.firstRunOpen).toBe(true);
    s = applySnapshot(s, snapshot());
    expect(s.firstRunOpen).toBe(true);
  });

  it("changes prefs and decides locally", () => {
    let s = applySnapshot(initialState, snapshot());
    const prefs = { ...s.snapshot!.prefs, sessions: { shown: false, open: true } };
    s = setPrefs(s, prefs);
    expect(s.snapshot!.prefs.sessions.shown).toBe(false);
    s = applySnapshot(s, { ...s.snapshot!, needs_you: [item({ approval_id: "x" })] });
    expect(pendingNeedsYou(s)).toHaveLength(1);
    s = decideLocally(s, "x", true);
    expect(s.snapshot!.needs_you[0]!.state).toBe("allowed");
    expect(pendingNeedsYou(s)).toHaveLength(0);
  });

  it("reads a thread's state from its newest State event, else the summary", () => {
    const summary = { state: "idle", last_seq: 1n } as ThreadSummary;
    expect(threadState(summary, undefined)).toBe("idle");
    const feed = { events: [msg(1), ev(2, { kind: "state", state: "working", live_line: "" })], streaming: null };
    expect(threadState(summary, feed)).toBe("working");
    expect(threadState({ ...summary, last_seq: 5n, state: "needs_you" }, feed)).toBe("needs_you");
  });

  it("compares shallowly", () => {
    const a = { x: 1 };
    expect(shallowEqual([a, 2], [a, 2])).toBe(true);
    expect(shallowEqual([a], [{ x: 1 }])).toBe(false);
    expect(shallowEqual({ k: a }, { k: a })).toBe(true);
  });
});
