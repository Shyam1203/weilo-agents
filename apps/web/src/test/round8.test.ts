import { describe, expect, it } from "vitest";
import { initialState, unqueueToDraft } from "../lib/store";
import { deviceLine } from "../lib/settings";
import type { DeviceInfo } from "../proto/DeviceInfo";

describe("Stop clears what was lined up", () => {
  it("moves lined-up messages back into the message box", () => {
    const s = { ...initialState, queued: { t1: [{ id: "a", text: "first" }, { id: "b", text: "second" }] }, drafts: { t1: "typing " } };
    const after = unqueueToDraft(s, "t1");
    expect(after.queued.t1).toEqual([]);
    expect(after.drafts.t1).toBe("typing\n\nfirst\n\nsecond");
  });
  it("changes nothing when nothing is lined up", () => {
    const s = initialState;
    expect(unqueueToDraft(s, "t1")).toBe(s);
  });
});

describe("device lines", () => {
  it("says today, not the date, for a device paired today", () => {
    const now = new Date(2026, 10, 1, 15, 0);
    const d = { name: "Safari on iPad", this_device: false, paired_at: new Date(2026, 10, 1, 14, 27).toISOString(), last_seen_at: new Date(2026, 10, 1, 14, 27).toISOString() } as unknown as DeviceInfo;
    expect(deviceLine(d, now, true)).toBe("Last used today at 2:27 · paired today at 2:27");
  });
});

describe("typed words survive a reload", () => {
  it("keeps per-chat text and forgets empty text", async () => {
    const { loadTyped, saveTyped, resetTyped, flushTyped } = await import("../lib/typed");
    const mem = new Map<string, string>();
    const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
    resetTyped();
    saveTyped("t1", "half a thought");
    saveTyped("t2", "   ");
    flushTyped();
    resetTyped();
    expect(loadTyped("t1")).toBe("half a thought");
    expect(loadTyped("t2")).toBe("");
    saveTyped("t1", "");
    flushTyped();
    resetTyped();
    expect(loadTyped("t1")).toBe("");
  });
});

describe("a saved Stop", () => {
  it("draws one Stopped. line from history, with or without this device's own stop", async () => {
    const { buildBlocks } = await import("../lib/timeline");
    const ev = (seq: number, body: object) => ({ seq: BigInt(seq), at: "2026-11-01T10:00:00Z", source: "host", body }) as never;
    const events = [
      ev(1, { kind: "user_message", text: "hi", when: "now" }),
      ev(2, { kind: "step", step_id: "s1", title: "Read it", status: "running" }),
      ev(3, { kind: "step", step_id: "stopped-x", title: "Stopped.", status: "done" }),
      ev(4, { kind: "state", state: "idle", line: null }),
    ];
    const notes = (b: ReturnType<typeof buildBlocks>) => b.flatMap((x) => (x.type === "agent" ? x.items.filter((i) => i.type === "note") : []));
    expect(notes(buildBlocks(events)).length).toBe(1);
    expect(notes(buildBlocks(events, null, 1n)).length).toBe(1);
    const steps = buildBlocks(events).flatMap((x) => (x.type === "agent" ? x.items.filter((i) => i.type === "steps") : []));
    expect(JSON.stringify(steps)).not.toContain("stopped-x");
  });
});

describe("typed words for gone chats", () => {
  it("are forgotten, drafts of new chats stay", async () => {
    const { loadTyped, saveTyped, resetTyped, flushTyped, forgetTypedExcept } = await import("../lib/typed");
    resetTyped();
    saveTyped("gone", "old words");
    saveTyped("here", "keep me");
    saveTyped("new:agent-ava", "draft");
    forgetTypedExcept(["here"]);
    flushTyped();
    resetTyped();
    expect(loadTyped("gone")).toBe("");
    expect(loadTyped("here")).toBe("keep me");
    expect(loadTyped("new:agent-ava")).toBe("draft");
  });
});

describe("an approval shows once", () => {
  it("hides the step that has the same name as the card", async () => {
    const { buildBlocks } = await import("../lib/timeline");
    const ev = (seq: number, body: object) => ({ seq: BigInt(seq), at: "2026-11-01T10:00:00Z", source: "engine", body }) as never;
    const card = { kind: "approval", approval_id: "ap1", title: "Run the shop's checks", body: null, details: null, risk: "local", risk_line: "", actions: [], fallback_text: "" };
    const blocks = buildBlocks([
      ev(1, { kind: "user_message", text: "go", when: "now" }),
      ev(2, { kind: "step", step_id: "t1", title: "Run the shop's checks", status: "running" }),
      ev(3, { kind: "card", card }),
      ev(4, { kind: "step", step_id: "t2", title: "Read the notes", status: "done" }),
    ]);
    const titles = blocks.flatMap((b) => (b.type === "agent" ? b.items.flatMap((i) => (i.type === "steps" ? i.steps.map((s) => s.title) : [])) : []));
    expect(titles).toEqual(["Read the notes"]);
  });
});
