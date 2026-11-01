import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doneOutcome } from "../features/needs-you/NeedsYouPage";
import { overviewLine } from "../features/thread/ChannelView";
import { isDraftThread, takeComposerFocus, focusComposerSoon } from "../features/thread/useThread";
import { jumpItems, searchJump } from "../lib/jump";
import { addThreadLocally, agentStatus, applySnapshot, keyFixedFor, markKeyFixed, problemLine, problemLines, problemNeedsYou, setCheck, decideLocally, initialState, store, undecideLocally, type AppState } from "../lib/store";
import { closedWords, continuesGroup, type Block } from "../lib/timeline";
import { problemKind } from "../lib/engines";
import { lowerFirst } from "../lib/format";
import { deviceLine, repeatedNames, sortDevices } from "../lib/settings";
import type { DeviceInfo } from "../proto/DeviceInfo";
import { doLater, flushUndo, undoPending } from "../lib/undo";
import { agent, item, snapshot, thread } from "./fixtures";

const T = (hm: string) => new Date(`2026-10-28T${hm}:00`).toISOString();

describe("decision times", () => {
  it("records when you answered, and when an Undo ran out", () => {
    const s0 = applySnapshot(initialState, snapshot({ needs_you: [item({ approval_id: "a1" })] }));
    const s1 = decideLocally(s0, "a1", false, "you", T("09:50"));
    expect(s1.snapshot!.needs_you[0]).toMatchObject({ state: "denied", decided_at: T("09:50"), decided_via: "you" });
    // The answer is sent when the Undo runs out: the time moves to then.
    const s2 = decideLocally(s1, "a1", false, "you", T("09:51"));
    expect(s2.snapshot!.needs_you[0]!.decided_at).toBe(T("09:51"));
    const s3 = undecideLocally(s2, "a1", false);
    expect(s3.snapshot!.needs_you[0]).toMatchObject({ state: "pending", decided_at: undefined, decided_via: undefined });
  });

  it("every finished row has a time", () => {
    const always = { id: "always", label: "Always allow in this folder", primary: false, decision: { kind: "allow_always" as const, scope: "folder" } };
    const allowedAlways = item({ state: "allowed", decided_at: T("09:45"), decided_via: "always", card: { actions: [always] } });
    expect(doneOutcome(allowedAlways, []).text).toMatch(/^You always allow this in this folder · \d{1,2}:\d\d$/);
    const expired = item({ state: "expired", decided_at: T("18:00"), decided_via: "expired" });
    expect(doneOutcome(expired, []).text).toMatch(/^No answer in time · \d{1,2}:\d\d$/);
    const said = item({ state: "denied", decided_at: T("09:47"), decided_via: "you" });
    expect(doneOutcome(said, []).text).toMatch(/^You said no · \d{1,2}:\d\d$/);
  });
});

describe("Always allow waits for its Undo too", () => {
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

  it("shows it allowed for good at once; Undo puts it back", () => {
    const send = vi.fn();
    doLater({ text: "Always allowed. The agent won't ask next time", approvalId: "a1", allowed: true, via: "always" }, send);
    expect(store.get().snapshot!.needs_you[0]).toMatchObject({ state: "allowed", decided_via: "always" });
    undoPending();
    vi.advanceTimersByTime(10_000);
    expect(send).not.toHaveBeenCalled();
    expect(store.get().snapshot!.needs_you[0]!.state).toBe("pending");
  });
});

describe("messages close together group", () => {
  const user = (at: string): Block => ({ type: "user", key: at, text: "hi", at: T(at), when: "now" });
  const said = (at: string, agentId = "ava", hasText = true): Block => ({ type: "agent", key: at, agentId, at: T(at), hasText, items: [] });

  it("groups the same author within five minutes", () => {
    expect(continuesGroup(user("09:40"), user("09:44"))).toBe(true);
    expect(continuesGroup(user("09:40"), user("09:46"))).toBe(false);
    expect(continuesGroup(said("09:40"), said("09:41"))).toBe(true);
    expect(continuesGroup(said("09:40"), said("09:41", "mia"))).toBe(false);
    expect(continuesGroup(user("09:40"), said("09:41"))).toBe(false);
    expect(continuesGroup(undefined, user("09:40"))).toBe(false);
  });
});

describe("Ctrl+K kind words", () => {
  const snap = snapshot({
    threads: [thread(), thread({ id: "s1", kind: "session", title: "Fix checkout", channel_id: "c1", started_by: "ava" })],
  });
  it("'sess' and 'session' list sessions", () => {
    for (const q of ["sess", "session", "sessions"]) expect(searchJump(jumpItems(snap), q).some((i) => i.kind === "session")).toBe(true);
  });
  it("'channel' lists channels; 'agent' lists agents", () => {
    expect(searchJump(jumpItems(snap), "channel").some((i) => i.kind === "channel")).toBe(true);
    expect(searchJump(jumpItems(snap), "agents").some((i) => i.kind === "agent")).toBe(true);
  });
});

describe("Overview rows always have a second line", () => {
  const now = new Date("2026-10-28T12:00:00");
  it("says who and when when nothing is going on", () => {
    const agents = [agent({ id: "mia", name: "Mia · Social" })];
    expect(overviewLine(thread({ agent_id: "mia", live_line: "", updated_at: T("09:30") }), agents, now)).toMatch(/^Mia · last active today at \d{1,2}:\d\d$/);
    expect(overviewLine(thread({ live_line: "Writing the post" }), agents, now)).toBe("Writing the post");
  });
});

describe("a new chat is a draft until its first message", () => {
  it("knows a draft id", () => {
    expect(isDraftThread("new:ava")).toBe(true);
    expect(isDraftThread("t1")).toBe(false);
  });
  it("focus waits for the named chat's message box", () => {
    focusComposerSoon("t9");
    expect(takeComposerFocus("t1")).toBe(false);
    expect(takeComposerFocus("t9")).toBe(true);
    expect(takeComposerFocus("t9")).toBe(false);
  });
  it("shows the new chat before the next snapshot", () => {
    const s0 = applySnapshot(initialState, snapshot({ threads: [] }));
    const s1 = addThreadLocally(s0, thread({ id: "t9" }));
    expect(s1.snapshot!.threads.map((t) => t.id)).toEqual(["t9"]);
    expect(addThreadLocally(s1, thread({ id: "t9" }))).toBe(s1);
  });
});

describe("how an approval closed, in plain words", () => {
  it("maps every way the host closes one", () => {
    expect(closedWords("stopped")).toBe("Closed when you pressed Stop");
    expect(closedWords("restarted")).toBe("Closed when Weilo restarted");
    expect(closedWords("engine_stopped", "Ava")).toBe("Closed when Ava's AI stopped");
    expect(closedWords("engine_stopped")).toBe("Closed when the AI stopped");
    expect(closedWords("interrupted")).toBe("Closed");
    expect(closedWords("expired")).toBe("No answer in time");
    for (const v of ["you", "app", "always", undefined, null]) expect(closedWords(v)).toBeNull();
  });
  it("Done today rows use them, with the time", () => {
    const row = (via: string) => doneOutcome(item({ state: "denied", decided_at: T("09:50"), decided_via: via }), [], "Ava");
    expect(row("engine_stopped").text).toMatch(/^Closed when Ava's AI stopped · \d{1,2}:\d\d$/);
    expect(row("restarted").text).toMatch(/^Closed when Weilo restarted · /);
    expect(row("interrupted").text).toMatch(/^Closed · /);
    expect(row("engine_stopped").yes).toBe(false);
  });
});

describe("the database not answering", () => {
  it("is a Didn't work problem with Try again", () => {
    const p = { code: "database_away", message: "Weilo's database didn't answer, so this message didn't start.", action: "Try again" };
    expect(problemLine(p)).toBe("Didn't work");
    expect(problemKind(p.action)).toBe("retry");
  });
  it("its waiting line shows as a plain status", () => {
    const s = agentStatus(agent({ state: "working", live_line: "Waiting for the database…" }), {});
    expect(s.line).toBe("Waiting for the database…");
    expect(s.problem).toBe(false);
  });
});

describe("a key saved since a key problem clears it", () => {
  const problemEvent = (at: string) =>
    ({
      seq: 5n,
      at,
      actor: "host",
      body: { kind: "problem", message: "Your Anthropic key didn't work.", action: "Change key", code: "key_rejected", engine: "pi" },
    }) as unknown as import("../proto/Event").Event;
  const base = () => {
    const s = applySnapshot(initialState, snapshot());
    return { ...s, engines: [{ id: "pi", title: "Pi", description: "", installed: true, default: true, binds_approvals: false, ready: true }], feeds: { t1: { events: [problemEvent(T("09:00"))], streaming: null } } };
  };
  it("warns until a working key is saved after it", () => {
    const s = base();
    expect(problemLines(s)).toEqual({ t1: "Needs a new API key" });
    const fixed = markKeyFixed(s, "pi");
    expect(problemLines(fixed)).toEqual({});
    expect(problemNeedsYou(fixed)).toEqual([]);
    expect(keyFixedFor(fixed, "t1", { seq: 5n })).toBe(true);
    // A new problem after the fix warns again.
    expect(keyFixedFor(fixed, "t1", { seq: 9n })).toBe(false);
  });
  it("a key for another AI doesn't fix it", () => {
    expect(problemLines(markKeyFixed(base(), "claude-code"))).toEqual({ t1: "Needs a new API key" });
  });
  it("a check that still fails keeps it open", () => {
    const fixed = markKeyFixed(base(), "pi");
    const failed = setCheck(fixed, { engine: "pi", ready: false, needs: null, message: "Key rejected", action: null, auth_methods: [] });
    expect(problemLines(failed)).toEqual({ t1: "Needs a new API key" });
  });
  it("other problems aren't fixed by a key", () => {
    const s = base();
    const other = { ...s, feeds: { t1: { events: [{ ...s.feeds.t1.events[0]!, body: { kind: "problem", message: "It stopped.", action: "Try again", code: "not_responding", engine: "pi" } }] as typeof s.feeds.t1.events, streaming: null } } };
    expect(problemLines(markKeyFixed(other, "pi"))).toEqual({ t1: "Didn't work" });
  });
  it("Problem lines keep API in capitals in the sidebar", () => {
    expect(lowerFirst("Needs a new API key")).toBe("needs a new API key");
  });
});

describe("devices", () => {
  const dev = (o: Partial<DeviceInfo>): DeviceInfo => ({ id: "d", name: "Browser", paired_at: T("09:00"), last_seen_at: null, this_device: false, ...o });
  it("this device first, then the most recently used", () => {
    const list = [dev({ id: "a", last_seen_at: T("10:00") }), dev({ id: "b", this_device: true }), dev({ id: "c", last_seen_at: T("11:00") })];
    expect(sortDevices(list).map((d) => d.id)).toEqual(["b", "c", "a"]);
  });
  it("devices with the same name say when they paired", () => {
    const list = [dev({ id: "a", this_device: true }), dev({ id: "b", name: "Browser" }), dev({ id: "c", name: "iPhone" })];
    expect([...repeatedNames(list)]).toEqual(["Browser"]);
    expect(deviceLine(list[0]!, new Date(T("12:00")), true)).toMatch(/^This device · paired \S/);
    expect(deviceLine(list[0]!, new Date(T("12:00")))).toBe("This device");
  });
});
