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
