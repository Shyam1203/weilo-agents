import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelLine } from "../features/shell/Pages";
import { jumpItems, searchJump, startJump } from "../lib/jump";
import { plainProblem, problemTitle, awayLine, initialState, applySnapshot, setNeedsYou, store, type AppState } from "../lib/store";
import { doLater, flushUndo, hasPending, undoPending } from "../lib/undo";
import { agent, item, snapshot, thread } from "./fixtures";

describe("Undo for one-click actions", () => {
  let saved: AppState;
  beforeEach(() => {
    saved = store.get();
    vi.useFakeTimers();
    store.set(() => applySnapshot(initialState, snapshot({ needs_you: [item({ approval_id: "a1" })] })));
  });
  afterEach(() => {
    flushUndo();
    vi.useRealTimers();
    store.set(() => saved);
  });

  it("shows a no at once, and sends it only when the Undo runs out", () => {
    const send = vi.fn();
    doLater({ text: "Draft discarded", approvalId: "a1" }, send);
    expect(store.get().undo?.text).toBe("Draft discarded");
    expect(store.get().snapshot!.needs_you[0]!.state).toBe("denied");
    // A fresh list from the host still shows it answered.
    store.set((s) => setNeedsYou(s, [item({ approval_id: "a1" })]));
    expect(store.get().snapshot!.needs_you[0]!.state).toBe("denied");
    vi.advanceTimersByTime(5900);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.get().undo).toBeNull();
  });

  it("Undo sends nothing and puts the item back", () => {
    const send = vi.fn();
    doLater({ text: "Draft discarded", approvalId: "a1" }, send);
    undoPending();
    vi.advanceTimersByTime(10_000);
    expect(send).not.toHaveBeenCalled();
    expect(store.get().undo).toBeNull();
    expect(store.get().snapshot!.needs_you[0]!.state).toBe("pending");
  });

  it("a second action sends the first right away; dismissing sends now", () => {
    const first = vi.fn();
    const second = vi.fn();
    doLater({ text: "Stopped Fix checkout", stopThreadId: "s1" }, first);
    doLater({ text: "Removed", ruleId: "r1" }, second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(hasPending()).toBe(true);
    flushUndo();
    expect(second).toHaveBeenCalledTimes(1);
    expect(hasPending()).toBe(false);
  });
});

describe("answers wait while the computer is away", () => {
  it("says why in one line", () => {
    expect(awayLine({ ...initialState, conn: "online" })).toBeNull();
    expect(awayLine({ ...initialState, conn: "reconnecting" })).toBe("Can't reach your Weilo computer.");
    expect(awayLine({ ...initialState, conn: "online", paused: "Your Weilo computer is restarting." })).toBe("Your Weilo computer is restarting.");
  });
});

describe("problems name the agent, not the AI app", () => {
  it("rewrites a leading app name", () => {
    expect(plainProblem("Codex stopped responding, so this reply stopped.", "Ava")).toEqual({
      line: "Ava's AI stopped responding, so this reply stopped.",
      named: true,
    });
    expect(plainProblem("Echo stopped responding.", null, ["Echo"]).line).toBe("Your AI stopped responding.");
    expect(plainProblem("The folder is gone.", "Ava")).toEqual({ line: "The folder is gone.", named: false });
    expect(problemTitle("Fix checkout", { action: "Try again", message: "Claude Code stopped responding." }, "Ava")).toBe(
      "Ava's AI stopped responding.",
    );
  });
});

describe("Ctrl+K before typing", () => {
  const snap = snapshot({
    agents: [agent(), agent({ id: "mia", name: "Mia · Social", main_thread_id: "tm" })],
    threads: [thread(), thread({ id: "s1", kind: "session", title: "Fix checkout", channel_id: null, started_by: "ava" })],
  });
  const items = jumpItems(snap, {});
  it("lists recent places, then the common things to do", () => {
    const out = startJump(items, ["/s/s1", "/nowhere"]);
    expect(out[0]).toMatchObject({ group: "Recent", label: "Fix checkout" });
    expect(out.filter((i) => i.group === "Do").map((i) => i.label)).toEqual(["New session", "New agent", "New channel"]);
  });
  it("falls back to your agents with no history", () => {
    expect(startJump(items, []).filter((i) => i.group === "Recent").map((i) => i.kind)).toEqual(["agent", "agent"]);
  });
  it("doesn't match status words", () => {
    const withStatus = items.map((i) => (i.kind === "agent" ? { ...i, sub: "working on the shop" } : i));
    expect(searchJump(withStatus, "working")).toEqual([]);
  });
});

describe("Channels page lines", () => {
  const now = new Date("2026-10-28T12:00:00");
  it("needs you first, then who is working, then last active", () => {
    const agents = [agent()];
    expect(channelLine("c1", { agents, threads: [thread({ channel_id: "c1", state: "needs_you" })] }, now)).toEqual({ text: "Needs you", tone: "warn" });
    expect(channelLine("c1", { agents, threads: [thread({ channel_id: "c1", state: "working", agent_id: agents[0]!.id })] }, now).text).toBe("Ava is working");
    expect(channelLine("c1", { agents, threads: [thread({ channel_id: "c1", state: "idle", updated_at: "2026-10-28T09:42:00" })] }, now).text).toMatch(/^Last active today at/);
    expect(channelLine("c1", { agents, threads: [] }, now)).toEqual({ text: "Nothing here yet", tone: "quiet" });
  });
});
