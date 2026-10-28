import { diffTone, fileChangeWord, filesChangedLine, lineCounts } from "../lib/changes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, loadSnapshot, showError, showNotice } from "../lib/app";
import { alreadySays, engineLine, problemKind, signInWays } from "../lib/engines";
import { lowerYour } from "../lib/format";
import { HostConnection, type HostApi, type SocketLike } from "../lib/host";
import { buildRows } from "../lib/sidebar";
import {
  addSending,
  appendEvent,
  applySnapshot,
  authorName,
  initialState,
  openProblem,
  pausedLine,
  problemLines,
  problemNeedsYou,
  setNeedsYou,
  stopLocally,
  store,
  type AppState,
} from "../lib/store";
import { allSteps, buildBlocks } from "../lib/timeline";
import { placeMenu } from "../ui/Menu";
import { stepChoice } from "../ui/ChoiceChips";
import { stopKeyApplies } from "../features/thread/SessionView";
import { nextAfterApprove } from "../features/needs-you/NeedsYouPage";
import { keyFailedLine } from "../features/engines/KeyDialog";
import type { Call } from "../proto/Call";
import type { CallValue } from "../proto/CallValue";
import type { EngineInfo } from "../proto/EngineInfo";
import type { Event } from "../proto/Event";
import type { EventBody } from "../proto/EventBody";
import { agent, item, snapshot, thread } from "./fixtures";

const ev = (seq: number, body: EventBody, at = "2026-10-28T09:41:00Z"): Event => ({ seq: BigInt(seq), at, source: "host", tainted: false, body });
const step = (id: string, status: "running" | "done" | "failed"): EventBody => ({ kind: "step", step_id: id, title: "Edit src/a.ts", status });
const idle: EventBody = { kind: "state", state: "idle", live_line: "" };
const problem = (message = "Codex stopped responding.", action: string | null = "Try again"): EventBody => ({ kind: "problem", message, action });
const reply = (text = "Done."): EventBody => ({ kind: "agent_message", text, agent_id: "ava" });
const said = (text: string): EventBody => ({ kind: "user_message", text, when: "now" });

const withFeed = (s: AppState, threadId: string, events: Event[]): AppState => ({
  ...s,
  feeds: { ...s.feeds, [threadId]: { events, streaming: null } },
});

let saved: AppState;
beforeEach(() => {
  saved = store.get();
});
afterEach(() => {
  store.set(() => saved);
  vi.useRealTimers();
});

describe("menus are placed next to their button", () => {
  const view = { width: 1000, height: 800 };
  const size = { width: 192, height: 120 };
  it("opens under the button, lined up with its end", () => {
    const p = placeMenu({ top: 100, bottom: 124, left: 300, right: 324 }, size, view);
    expect(p).toEqual({ top: 128, left: 132, side: "below" });
  });
  it("flips above when there is no room below", () => {
    const p = placeMenu({ top: 740, bottom: 764, left: 300, right: 324 }, size, view);
    expect(p.side).toBe("above");
    expect(p.top).toBe(740 - 4 - 120);
  });
  it("prefers above for the send menu, and stays inside the window", () => {
    expect(placeMenu({ top: 700, bottom: 732, left: 900, right: 990 }, size, view, { prefer: "above" }).side).toBe("above");
    expect(placeMenu({ top: 50, bottom: 74, left: 900, right: 990 }, size, view, { prefer: "above" }).side).toBe("below");
    expect(placeMenu({ top: 100, bottom: 124, left: 2, right: 26 }, size, view, { align: "end" }).left).toBe(8);
    expect(placeMenu({ top: 100, bottom: 124, left: 950, right: 974 }, size, view, { align: "start" }).left).toBe(1000 - 8 - 192);
  });
});

describe("engine messages", () => {
  it("names the ways to sign in in one sentence", () => {
    expect(signInWays([{ name: "Sign in with ChatGPT" }, { name: "Use an API key" }])).toBe("You can sign in with ChatGPT or an API key.");
    expect(signInWays([{ name: "Log in with Google" }])).toBe("You can sign in with Google.");
    expect(signInWays([])).toBeNull();
  });
  it("doesn't repeat a how-to the message already says", () => {
    expect(alreadySays("Codex isn't signed in. Open Terminal, run `codex` and sign in.", "Open Terminal, run `codex` and sign in.")).toBe(true);
    expect(alreadySays("Codex isn't signed in.", "Open Terminal, run codex and sign in")).toBe(false);
    expect(alreadySays(null, "x")).toBe(false);
  });
  it("gives an AI that can't be used yet one line on what to do", () => {
    const gemini = { id: "gemini", title: "Gemini CLI", description: "", installed: false, default: false, binds_approvals: false, ready: false, needs: "node", status: "Not on this computer.", how: "Get Node.js from nodejs.org, then check again." } as EngineInfo;
    expect(engineLine(gemini)).toBe("Get Node.js from nodejs.org, then check again.");
    expect(engineLine({ ...gemini, needs: "sign_in", installed: true })).toBe("Not on this computer.");
  });
  it("opens the key dialog for Change key, and says honestly when a key didn't work", () => {
    expect(problemKind("Change key")).toBe("key");
    expect(keyFailedLine("Anthropic says this key isn't valid.")).toBe("Anthropic says this key isn't valid.");
    expect(keyFailedLine("Weilo's built-in AI needs an API key to work.")).toBe("That key didn't work. Weilo's built-in AI needs an API key to work.");
    expect(keyFailedLine(null)).toBe("That key didn't work.");
  });
});

describe("plain lines", () => {
  it("says a restart in plain words, never a raw aside", () => {
    expect(pausedLine("Your Weilo computer is restarting its data. (a few seconds)")).toBe("Your Weilo computer is restarting. Back in a few seconds.");
    expect(pausedLine("Updating (about a minute)")).toBe("Updating.");
  });
  it("lower-cases Your mid-sentence", () => {
    expect(lowerYour("Your MacBook")).toBe("your MacBook");
    expect(lowerYour("Studio")).toBe("Studio");
    expect(lowerYour(null)).toBeNull();
  });
});

describe("replies that end early", () => {
  it("marks a reply's open steps stopped when a problem ends it", () => {
    const blocks = buildBlocks([ev(1, step("a", "done")), ev(2, step("b", "running")), ev(3, problem())], "ava");
    const agentBlock = blocks[0]!;
    if (agentBlock.type !== "agent") throw new Error("expected an agent turn");
    const steps = agentBlock.items[0]!;
    if (steps.type !== "steps") throw new Error("expected steps");
    expect(steps.steps.map((s) => s.status)).toEqual(["done", "stopped"]);
    expect(allSteps([ev(1, step("b", "running")), ev(2, idle)]).map((s) => s.status)).toEqual(["stopped"]);
    // Still working: the spinner stays.
    expect(allSteps([ev(1, step("b", "running"))]).map((s) => s.status)).toEqual(["running"]);
  });

  it("says Stopped. where a stopped reply ended", () => {
    const events = [ev(1, said("go")), ev(2, step("a", "running")), ev(3, reply("Half")), ev(4, idle)];
    const notes = (stoppedAt: bigint | null) =>
      buildBlocks(events, "ava", stoppedAt).flatMap((b) => (b.type === "agent" ? b.items.filter((i) => i.type === "note") : []));
    expect(notes(null)).toHaveLength(0);
    expect(notes(2n).map((n) => (n.type === "note" ? n.text : ""))).toEqual(["Stopped."]);
    // Pressed Stop and the host hasn't answered yet: the line shows at once.
    expect(notes(4n)).toHaveLength(1);
    // An approval the host closed because of Stop says so too, after a reload.
    const closed = [ev(1, step("a", "running")), ev(2, { kind: "approval_decided", approval_id: "x", decision: { kind: "deny" }, via: "stopped" }), ev(3, idle)];
    expect(buildBlocks(closed, "ava").flatMap((b) => (b.type === "agent" ? b.items.map((i) => i.type) : []))).toContain("note");
    // Both signs of one stop (the closed approval, then this device's mark) draw one line.
    const both = buildBlocks(closed, "ava", 3n).flatMap((b) => (b.type === "agent" ? b.items.filter((i) => i.type === "note") : []));
    expect(both).toHaveLength(1);
  });

  it("closes the thread's open approvals at once when Stop is pressed", () => {
    let s = applySnapshot(initialState, snapshot({ needs_you: [item({ approval_id: "a", thread_id: "t1" }), item({ approval_id: "b", thread_id: "t2" })] }));
    s = withFeed(s, "t1", [ev(1, said("hi")), ev(2, step("a", "running"))]);
    s = stopLocally(s, "t1");
    expect(s.stopped.t1).toBe(2n);
    expect(s.stoppedCards).toEqual({ a: true });
    expect(s.snapshot!.needs_you.map((n) => [n.approval_id, n.state])).toEqual([
      ["a", "denied"],
      ["b", "pending"],
    ]);
  });

  it("only takes Ctrl+. in the message box, not in other text fields", () => {
    const el = (match: (sel: string) => boolean, composer = false) => ({
      closest: (sel: string) => (match(sel) ? { hasAttribute: (n: string) => composer && n === "data-composer" } : null),
    });
    expect(stopKeyApplies(null)).toBe(true);
    expect(stopKeyApplies(el(() => false) as unknown as EventTarget)).toBe(true);
    expect(stopKeyApplies(el((s) => s.startsWith("input"), true) as unknown as EventTarget)).toBe(true);
    expect(stopKeyApplies(el((s) => s.startsWith("input")) as unknown as EventTarget)).toBe(false);
    expect(stopKeyApplies(el((s) => s === "dialog") as unknown as EventTarget)).toBe(false);
  });
});

describe("failures reach Needs you", () => {
  const mia = agent({ id: "mia", name: "Mia · Social", main_thread_id: "tm" });
  const base = applySnapshot(
    initialState,
    snapshot({ agents: [agent(), mia], threads: [thread(), thread({ id: "tm", kind: "agent", channel_id: null, agent_id: "mia", title: "Mia" })] }),
  );

  it("keeps the newest problem until a later reply works", () => {
    expect(openProblem([ev(1, said("hi")), ev(2, problem("Needs a key.", "Add a key"))])?.message).toBe("Needs a key.");
    expect(openProblem([ev(1, problem()), ev(2, said("again")), ev(3, reply())])).toBeNull();
    expect(openProblem([ev(1, reply()), ev(2, said("again"))])).toBeNull();
    // Sent again after the problem (Try again): no longer open, even before the reply.
    expect(openProblem([ev(1, problem()), ev(2, said("again"))])).toBeNull();
  });

  it("lists it under Didn't work, with the agent's sidebar line", () => {
    const s = withFeed(base, "tm", [ev(1, said("Post it")), ev(2, problem("Weilo's built-in AI needs an API key to work.", "Add a key"), "2026-10-28T07:40:00Z")]);
    const items = problemNeedsYou(s);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ thread_id: "tm", source: "Mia", state: "pending", card: { kind: "problem", title: "Weilo's built-in AI needs an API key to work." } });
    // The same object while nothing changed, so screens don't redraw.
    expect(problemNeedsYou(s)[0]).toBe(items[0]);
    const lines = problemLines(s);
    expect(lines).toEqual({ tm: "Needs an API key" });
    const row = buildRows(s.snapshot!, lines).agents.find((r) => r.id === "mia")!;
    expect(row).toMatchObject({ sub: "Needs an API key", tone: "warn" });
    // The host listing the failure itself wins.
    const listed = setNeedsYou(s, [item({ thread_id: "tm", card: { kind: "failed" } })]);
    expect(problemNeedsYou(listed)).toHaveLength(0);
  });
});

describe("message bookkeeping", () => {
  it("drops a sending placeholder by order when the host echoes it, even reworded", () => {
    let s = addSending(initialState, "t1", { id: "x", text: "hello  ", afterSeq: 4n });
    s = addSending(s, "t1", { id: "y", text: "second", afterSeq: 4n });
    // An older message from the history doesn't count.
    expect(appendEvent(s, "t1", ev(3, said("other"))).sending.t1!.map((m) => m.id)).toEqual(["x", "y"]);
    s = appendEvent(s, "t1", ev(5, said("Hello")));
    expect(s.sending.t1!.map((m) => m.id)).toEqual(["y"]);
    s = appendEvent(s, "t1", ev(6, said("second")));
    expect(s.sending.t1).toEqual([]);
  });

  it("keeps a removed agent's name on its replies", () => {
    let s = applySnapshot(initialState, snapshot({ agents: [agent(), agent({ id: "mia", name: "Mia" })] }));
    s = applySnapshot(s, snapshot({ agents: [agent()] }));
    expect(authorName(s, "mia")).toBe("Mia");
    expect(authorName(s, "gone")).toBe("Removed agent");
    expect(authorName(s, null)).toBe("This session");
    expect(authorName(s, "ava")).toBe("Ava");
  });

  it("applies snapshots in the order they were asked for", async () => {
    const pending: Array<(v: CallValue) => void> = [];
    const host: HostApi = {
      start() {},
      stop() {},
      subscribe() {},
      unsubscribe() {},
      presence() {},
      call: (_c: Call) => new Promise<CallValue>((r) => pending.push(r)),
    };
    connect(host);
    const first = loadSnapshot();
    const second = loadSnapshot();
    pending[1]!({ type: "snapshot", data: snapshot({ agents: [agent({ name: "Newer" })] }) });
    await second;
    pending[0]!({ type: "snapshot", data: snapshot({ agents: [agent({ name: "Older" })] }) });
    await first;
    expect(store.get().snapshot!.agents[0]!.name).toBe("Newer");
  });

  it("says success politely and errors as alerts, one at a time", () => {
    showNotice("Saved.");
    expect([store.get().notice, store.get().error]).toEqual(["Saved.", null]);
    showError(new Error("That didn't work."));
    expect([store.get().notice, store.get().error]).toEqual([null, "That didn't work."]);
  });
});

describe("a dropped connection", () => {
  it("clears replies being written", () => {
    vi.useFakeTimers();
    const sockets: Array<SocketLike & { open(): void; receive(f: unknown): void; drop(): void }> = [];
    const streaming: Array<[string, string | null]> = [];
    const host = new HostConnection({
      url: "ws://x",
      listener: { streaming: (id, t) => streaming.push([id, t]) },
      random: () => 1,
      newId: () => "c",
      socketFactory: () => {
        const s = {
          readyState: 0,
          onopen: null as ((ev: unknown) => void) | null,
          onmessage: null as ((ev: { data: unknown }) => void) | null,
          onclose: null as ((ev: { code: number }) => void) | null,
          onerror: null,
          send() {},
          close() {},
          open() {
            this.readyState = 1;
            this.onopen?.({});
          },
          receive(f: unknown) {
            this.onmessage?.({ data: JSON.stringify(f) });
          },
          drop() {
            this.readyState = 3;
            this.onclose?.({ code: 1006 });
          },
        };
        sockets.push(s);
        return s;
      },
    });
    host.start();
    const s = sockets[0]!;
    s.open();
    s.receive({ t: "welcome", version: 1, host_name: "Home", device_id: "d" });
    host.subscribe("t1");
    s.receive({ t: "delta", thread_id: "t1", after_seq: 0, sub_seq: 1, delta: { text: "Half a rep" } });
    expect(streaming.at(-1)).toEqual(["t1", "Half a rep"]);
    s.drop();
    expect(streaming.at(-1)).toEqual(["t1", null]);
    host.stop();
  });
});

describe("keyboard", () => {
  it("moves through chips with the arrow keys, wrapping round", () => {
    expect(stepChoice(0, 3, "ArrowRight")).toBe(1);
    expect(stepChoice(2, 3, "ArrowDown")).toBe(0);
    expect(stepChoice(0, 3, "ArrowLeft")).toBe(2);
    expect(stepChoice(1, 3, "End")).toBe(2);
    expect(stepChoice(1, 3, "a")).toBeNull();
  });
  it("moves the Needs you cursor on after A approves", () => {
    const order = [item({ approval_id: "a" }), item({ approval_id: "b" }), item({ approval_id: "c" })];
    expect(nextAfterApprove(order, 0)).toBe("b");
    expect(nextAfterApprove(order, 2)).toBe("b");
    expect(nextAfterApprove(order.slice(0, 1), 0)).toBeNull();
  });
});

describe("session changes", () => {
  it("says what happened to each file in plain words", () => {
    expect(fileChangeWord("added")).toBe("New");
    expect(fileChangeWord("modified")).toBe("Changed");
    expect(fileChangeWord("deleted")).toBe("Deleted");
    const f = { path: "a.ts", status: "modified" as const, added: 3, removed: 1 };
    expect(filesChangedLine([f])).toBe("1 file changed");
    expect(filesChangedLine([f, f])).toBe("2 files changed");
    expect(lineCounts(f)).toBe("+3 −1");
    expect(lineCounts({ added: 0, removed: 0 })).toBe("");
  });

  it("colours a diff's lines", () => {
    expect(["+++ b/a", "--- a/a", "@@ -1 +1 @@", "+new", "-old", " same"].map(diffTone)).toEqual(["file", "file", "hunk", "add", "remove", "plain"]);
  });
});
