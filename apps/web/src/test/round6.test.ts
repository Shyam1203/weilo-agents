import { describe, expect, it } from "vitest";
import { failingProvider, firstProvider } from "../features/engines/KeyDialog";
import { doneLine, doneOutcome } from "../features/needs-you/NeedsYouPage";
import { showSteps } from "../lib/steps";
import { jumpItems, searchJump } from "../lib/jump";
import { buildRows, collapsedLabel } from "../lib/sidebar";
import { decidedAt, outcomeWords } from "../lib/timeline";
import type { Event } from "../proto/Event";
import { agent, item, snapshot, thread } from "./fixtures";

describe("folded sidebar sections say the most urgent thing", () => {
  it("counts a session filed in a channel toward the channel", () => {
    const snap = snapshot({
      threads: [
        thread({ id: "t1", state: "working" }),
        thread({ id: "s1", kind: "session", title: "Fix checkout", state: "needs_you", started_by: "ava" }),
      ],
    });
    const rows = buildRows(snap);
    expect(rows.channels[0]!.state).toBe("needs_you");
    expect(collapsedLabel(rows.channels)).toBe("1 needs you");
  });

  it("counts an agent with a problem as needing you", () => {
    const snap = snapshot({
      agents: [agent({ state: "working" }), agent({ id: "mia", name: "Mia · Social", main_thread_id: "tm" })],
      threads: [thread(), thread({ id: "tm", kind: "agent", channel_id: null, agent_id: "mia", title: "Mia" })],
    });
    const rows = buildRows(snap, { tm: "Needs an API key" });
    expect(collapsedLabel(rows.agents)).toBe("1 needs you");
    // Without the problem, Ava working is the news.
    expect(collapsedLabel(buildRows(snap).agents)).toBe("1 working");
  });

  it("counts a channel chat with a problem as needing you", () => {
    const snap = snapshot({ threads: [thread({ id: "t1" }), thread({ id: "t2", state: "working" })] });
    expect(collapsedLabel(buildRows(snap, { t1: "Didn't work" }).channels)).toBe("1 needs you");
  });
});

describe("decisions read the same everywhere", () => {
  const ev = (seq: bigint, at: string, body: Record<string, unknown>) => ({ seq, at, thread_id: "t1", source: "host", body }) as unknown as Event;

  it("says You allowed it / You said no, with drafts in their own words", () => {
    expect(outcomeWords({ kind: "allow" }, "approval")).toBe("You allowed it");
    expect(outcomeWords({ kind: "deny" }, "approval")).toBe("You said no");
    expect(outcomeWords({ kind: "allow" }, "draft")).toBe("You approved it");
    expect(outcomeWords({ kind: "deny" }, "draft")).toBe("You discarded it");
  });

  it("stamps Needs you with when it was answered, not when it was asked", () => {
    const asked = item({ approval_id: "a1", state: "allowed", created_at: "2026-10-28T09:42:00" });
    const events = [ev(5n, "2026-10-28T09:51:00", { kind: "approval_decided", approval_id: "a1", decision: { kind: "allow" }, via: "web" })];
    expect(decidedAt(events, "a1")?.at).toBe("2026-10-28T09:51:00");
    expect(doneLine(asked, events)).toBe("You allowed it · 9:51");
    // Not known here: no time, rather than the time it was asked.
    expect(doneLine(asked, undefined)).toBe("You allowed it");
    expect(doneLine({ ...asked, state: "denied" }, undefined)).toBe("You said no");
    // The host's own time wins once it sends one.
    expect(doneLine({ ...asked, decided_at: "2026-10-28T10:05:00" } as typeof asked, events)).toBe("You allowed it · 10:05");
  });
});

describe("Ctrl+K matches the start of words", () => {
  const snap = snapshot({
    channels: [
      { id: "c1", slug: "shop-launch", title: "Shop launch", archived: false, unread: false },
      { id: "c2", slug: "general", title: "General", archived: false, unread: false },
    ],
  });
  const items = jumpItems(snap);

  it("finds #general for ge, not New agent or Hide Agents", () => {
    expect(searchJump(items, "ge").map((i) => i.label)).toEqual(["general"]);
  });

  it("still finds something inside a word when nothing starts with it", () => {
    expect(searchJump(items, "aunch").map((i) => i.label)).toContain("shop-launch");
  });
});

describe("Change key opens on the key that didn't work", () => {
  const providers = [
    { id: "openai", title: "OpenAI", has_key: false },
    { id: "anthropic", title: "Anthropic", has_key: true },
  ];

  it("reads the provider from the problem", () => {
    expect(failingProvider("Ava didn't answer: your Anthropic key didn't work.", providers)).toBe("anthropic");
    expect(failingProvider("Codex stopped responding.", providers)).toBeNull();
  });

  it("starts on it, else on the saved key when changing, else on one without a key", () => {
    expect(firstProvider(providers, "anthropic", true)).toBe("anthropic");
    expect(firstProvider(providers, null, true)).toBe("anthropic");
    expect(firstProvider(providers)).toBe("openai");
  });
});

describe("Done today says how each item ended", () => {
  const ev = (via: string, decision: Record<string, unknown> = { kind: "deny" }) =>
    [{ seq: 1n, at: "2026-10-28T08:02:00", thread_id: "t1", source: "host", body: { kind: "approval_decided", approval_id: "a1", decision, via } }] as unknown as Event[];
  const closed = item({ approval_id: "a1", state: "denied" });

  it("tells a no apart from a stop, a restart and no answer", () => {
    expect(doneOutcome(closed, ev("app"))).toEqual({ text: "You said no · 8:02", yes: false });
    expect(doneOutcome(closed, ev("stopped")).text).toBe("Stopped · 8:02");
    expect(doneOutcome(closed, ev("interrupted")).text).toBe("Closed when Weilo restarted · 8:02");
    expect(doneOutcome({ ...closed, state: "expired" }, undefined).text).toBe("No answer in time");
    expect(doneOutcome({ ...closed, state: "allowed" }, ev("app", { kind: "allow_always", scope: "folder" }))).toEqual({
      text: "You always allow this in this folder · 8:02",
      yes: true,
    });
  });
});

describe("failed steps say what didn't happen", () => {
  const step = (title: string, status: "done" | "failed") => ({ id: title, title, status, at: "" });

  it("says Couldn't change the file", () => {
    const out = showSteps([step("Edit src/app.ts", "failed")]);
    expect(out.shown[0]).toMatchObject({ label: "Couldn't change app.ts", saysFailed: true });
  });

  it("offers Details only when they add a file, command or address", () => {
    expect(showSteps([step("ToolSearch", "done"), step("Read the checkout code", "done")]).details).toEqual([]);
    expect(showSteps([step("Read src/theme.css", "done")]).details).toHaveLength(1);
  });
});
