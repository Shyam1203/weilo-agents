import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { channelLine } from "../features/shell/Pages";
import { jumpItems, searchJump, startJump } from "../lib/jump";
import { openProblem, plainProblem, problemLine, problemLines, problemNeedsYou, problemTitle, awayLine, initialState, applySnapshot, setNeedsYou, store, type AppState } from "../lib/store";
import { allSteps, buildBlocks } from "../lib/timeline";
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

describe("problems by the host's code", () => {
  it("words the sidebar line by code, and old events by their words", () => {
    expect(problemLine({ code: "key_rejected", action: "Change key", message: "Codex didn't answer: your OpenAI key didn't work." })).toBe(
      "Needs a new API key",
    );
    expect(problemLine({ code: "not_signed_in", action: "Sign in", message: "x" })).toBe("Needs you to sign in");
    expect(problemLine({ code: "needs_key", action: null, message: "x" })).toBe("Needs an API key");
    expect(problemLine({ code: "not_installed", action: "Install", message: "x" })).toBe("Needs an app installed");
    expect(problemLine({ code: "folder_missing", action: null, message: "x" })).toBe("Can't open its folder");
    // A known failure code wins over words that look like a key problem.
    expect(problemLine({ code: "engine_error", action: "Try again", message: "Codex hit a problem: bad API key header" })).toBe("Didn't work");
    // No code (older events) or one this app doesn't know: the button and words decide.
    expect(problemLine({ action: "Add a key", message: "x" })).toBe("Needs an API key");
    expect(problemLine({ code: "something_new", action: "Sign in", message: "x" })).toBe("Needs you to sign in");
  });

  it("names the agent even when the app's name isn't known", () => {
    expect(plainProblem("Frobnicator stopped responding, so this reply stopped.", "Ava", [], "not_responding")).toEqual({
      line: "Ava's AI stopped responding, so this reply stopped.",
      named: true,
    });
    expect(plainProblem("The engine stopped unexpectedly.", "Ava", [], "stopped")).toEqual({
      line: "Ava's AI stopped unexpectedly.",
      named: false,
    });
    expect(plainProblem("Weilo restarted while this was working, so it stopped.", "Ava", [], "restarted").line).toBe(
      "Weilo restarted while this was working, so it stopped.",
    );
    expect(problemTitle("Mia", { code: "key_rejected", action: "Change key", message: "Codex didn't answer: your OpenAI key didn't work." })).toBe(
      "Mia needs a new API key",
    );
  });

  it("keeps the code and app from the event", () => {
    const p = openProblem([
      {
        seq: 3n,
        at: "2026-10-28T07:40:00Z",
        thread_id: "t",
        source: "host",
        body: { kind: "problem", message: "Codex stopped responding.", action: "Try again", code: "not_responding", engine: "codex" },
      } as never,
    ]);
    expect(p).toMatchObject({ code: "not_responding", engine: "codex" });
  });
});

describe("set-up notes aren't problems", () => {
  let n = 0n;
  const ev = (body: Record<string, unknown>) => ({ seq: ++n, at: "2026-10-28T07:40:00Z", thread_id: "s1", source: "host", body }) as never;
  const note = (code: string, message: string) => ev({ kind: "problem", message, action: null, code });

  it("shows them as a quiet line in the chat, not an open problem", () => {
    const events = [
      note("not_git", "This folder isn't a git repo, so changes go straight into it."),
      ev({ kind: "step", step_id: "a", title: "Read app.ts", status: "running" }),
      note("fresh_start", "Ava started a fresh conversation; earlier messages aren't in its memory."),
    ];
    expect(openProblem(events)).toBeNull();
    // A note doesn't end what is running.
    expect(allSteps(events)[0]!.status).toBe("running");
    const items = buildBlocks(events).flatMap((b) => (b.type === "agent" ? b.items : []));
    expect(items.filter((i) => i.type === "problem")).toHaveLength(0);
    expect(items.filter((i) => i.type === "note").map((i) => (i as { text: string }).text)).toEqual([
      "This folder isn't a git repo, so changes go straight into it.",
      "Ava started a fresh conversation; earlier messages aren't in its memory.",
    ]);
  });

  it("leaves a real problem open past a note, and keeps notes out of Needs you", () => {
    const real = ev({ kind: "problem", message: "Codex stopped responding.", action: "Try again", code: "not_responding" });
    expect(openProblem([real, note("no_copy", "Couldn't make a separate copy of the repo.")])?.code).toBe("not_responding");
    const s = applySnapshot(
      initialState,
      snapshot({ agents: [agent()], threads: [thread({ id: "s1", kind: "session", title: "Fix checkout", channel_id: null, started_by: "ava" })] }),
    );
    const withNote = { ...s, feeds: { ...s.feeds, s1: { ...(s.feeds.s1 ?? { events: [], streaming: null }), events: [note("not_git", "This folder isn't a git repo.")] } } } as AppState;
    expect(problemNeedsYou(withNote)).toEqual([]);
    expect(problemLines(withNote)).toEqual({});
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
