import { describe, expect, it } from "vitest";
import { channelLabel, dollars, slugPreview, slugText, startedByName, timeOf, whenLabel } from "../lib/format";
import { approveKey, groupNeedsYou, isSmall } from "../lib/needsYou";
import { parseRoute, threadPath } from "../lib/router";
import { allHidden, buildRows, buildSections, collapsedLabel, hiddenHasLiveWork, showAll, withSection, type SidebarRow } from "../lib/sidebar";
import { buildBlocks, outcomeWords, totalCost } from "../lib/timeline";
import type { Event } from "../proto/Event";
import { agent, item, NOW, snapshot, thread } from "./fixtures";

describe("slugs", () => {
  it("shows channels as lowercase #slug", () => {
    expect(slugText("#Shop-Launch")).toBe("shop-launch");
    expect(channelLabel("taxes-2026")).toBe("#taxes-2026");
    expect(channelLabel("##trip")).toBe("#trip");
  });
  it("previews a new channel as one or two words", () => {
    expect(slugPreview("Shop launch")).toBe("shop-launch");
    expect(slugPreview("  Taxes 2026 for the family ")).toBe("taxes-2026");
    expect(slugPreview("Café!")).toBe("cafe");
    expect(slugPreview("!!!")).toBe("");
  });
});

describe("words", () => {
  it("names who started a session", () => {
    const agents = [agent()];
    expect(startedByName(null, agents)).toBe("you");
    expect(startedByName("user", agents)).toBe("you");
    expect(startedByName("ava", agents)).toBe("Ava");
    expect(startedByName("Mia", agents)).toBe("Mia");
  });
  it("shows times without AM/PM and costs in dollars", () => {
    expect(timeOf(new Date("2026-10-28T09:41:00").toISOString())).toMatch(/^9:41$|^09:41$/);
    expect(whenLabel(new Date("2026-10-27T16:00:00").toISOString(), NOW)).toBe("Yesterday");
    expect(dollars(380000n)).toBe("about $0.38");
  });
});

describe("Needs you", () => {
  const items = [
    item({ approval_id: "send", card: { risk: "send", kind: "draft" } }),
    item({ approval_id: "read" }),
    item({ approval_id: "q", card: { kind: "question" } }),
    item({ approval_id: "old", state: "expired" }),
    item({ approval_id: "done", state: "allowed" }),
    item({ approval_id: "done-long-ago", state: "denied", created_at: new Date("2026-10-20T09:00:00").toISOString() }),
    item({ approval_id: "heads", card: { kind: "heads_up", actions: [] } }),
    item({ approval_id: "fail", card: { kind: "failed" } }),
  ];

  it("groups in order, hides empty groups, and counts only Waiting on a yes", () => {
    const groups = groupNeedsYou(items, NOW);
    expect(groups.map((g) => [g.title, g.count, g.items.map((i) => i.approval_id)])).toEqual([
      ["Waiting on a yes", 2, ["send", "read"]],
      ["Questions", null, ["q"]],
      ["Didn't work", null, ["fail"]],
      ["Expired", null, ["old"]],
      ["Done today", null, ["done", "heads"]],
    ]);
    expect(groupNeedsYou([item({ card: { kind: "question" } })], NOW).map((g) => g.count)).toEqual([null]);
    expect(groupNeedsYou([], NOW)).toEqual([]);
  });

  it("A approves only small items; everything else opens", () => {
    expect(isSmall("read") && isSmall("reversible")).toBe(true);
    expect(isSmall("send") || isSmall("destructive")).toBe(false);
    const small = approveKey(item({ card: { risk: "reversible" } }));
    expect(small.kind === "decide" && small.action.decision).toEqual({ kind: "allow" });
    expect(approveKey(item({ card: { risk: "send" } }))).toEqual({ kind: "open" });
    expect(approveKey(item({ card: { risk: "destructive" } }))).toEqual({ kind: "open" });
    expect(approveKey(item({ state: "expired" }))).toEqual({ kind: "open" });
    expect(approveKey(item({ card: { kind: "heads_up" } }))).toEqual({ kind: "open" });
    expect(approveKey(item({ card: { actions: [] } }))).toEqual({ kind: "open" });
  });
});

describe("sidebar", () => {
  const row = (o: Partial<SidebarRow>): SidebarRow => ({
    id: "r",
    kind: "channel",
    name: "x",
    sub: null,
    tone: "quiet",
    href: "/",
    state: "idle",
    unread: false,
    ...o,
  });

  it("a folded section shows only its most urgent state", () => {
    expect(collapsedLabel([])).toBe("");
    expect(collapsedLabel([row({}), row({ unread: true })])).toBe("1 new");
    expect(collapsedLabel([row({ state: "working" }), row({ unread: true })])).toBe("1 working");
    expect(collapsedLabel([row({ state: "working" }), row({ state: "needs_you" }), row({ state: "needs_you" })])).toBe("2 needs you");
  });

  it("always shows Sessions (empty, with a Start button, before the first), and filters by search", () => {
    const snap = snapshot();
    const empty = buildSections(snap);
    expect(empty.map((s) => s.key)).toEqual(["agents", "channels", "sessions"]);
    expect(empty[2]!.rows).toEqual([]);
    const withSession = snapshot({ threads: [thread(), thread({ id: "s1", kind: "session", title: "Fix checkout", state: "needs_you", started_by: "ava" })] });
    const sections = buildSections(withSession);
    expect(sections.map((s) => s.key)).toEqual(["agents", "channels", "sessions"]);
    expect(sections[2]!.rows[0]!.sub).toBe("Started by Ava · needs you");
    expect(buildSections(withSession, "#shop").find((s) => s.key === "channels")!.rows).toHaveLength(1);
    expect(buildSections(withSession, "nothing").every((s) => s.rows.length === 0)).toBe(true);
    expect(buildRows(withSession).channels[0]!.state).toBe("idle");
  });

  it("puts a dot on Customize only when a hidden section has live work", () => {
    const base = snapshot({ threads: [thread({ id: "s1", kind: "session", state: "working" })] });
    expect(hiddenHasLiveWork(base)).toBe(false);
    const hidden = { ...base, prefs: withSection(base.prefs, "sessions", { shown: false }) };
    expect(hiddenHasLiveWork(hidden)).toBe(true);
    expect(hiddenHasLiveWork({ ...hidden, threads: [thread({ id: "s1", kind: "session" })] })).toBe(false);
  });

  it("knows when everything is hidden, and Show all brings it back", () => {
    const p = snapshot().prefs;
    const none = { agents: { ...p.agents, shown: false }, channels: { ...p.channels, shown: false }, sessions: { ...p.sessions, shown: false }, archived: { ...p.archived, shown: false } };
    expect(allHidden(none)).toBe(true);
    expect(allHidden(showAll(none))).toBe(false);
    expect(showAll(none).archived.open).toBe(false);
  });
});

describe("routes", () => {
  it("parses and builds paths", () => {
    expect(parseRoute("/")).toEqual({ name: "home" });
    expect(parseRoute("/c/c1")).toEqual({ name: "channel", channelId: "c1", threadId: null });
    expect(parseRoute("/c/c1/t1")).toEqual({ name: "channel", channelId: "c1", threadId: "t1" });
    expect(parseRoute("/a/ava")).toEqual({ name: "agent", agentId: "ava" });
    expect(parseRoute("/s/t9")).toEqual({ name: "session", threadId: "t9" });
    expect(parseRoute("/pair", "?code=ABC")).toEqual({ name: "pair", code: "ABC" });
    expect(parseRoute("/nope")).toEqual({ name: "missing" });
    expect(threadPath(thread({ kind: "session", id: "s" }))).toBe("/s/s");
    expect(threadPath(thread())).toBe("/c/c1/t1");
    expect(threadPath(thread({ kind: "agent", channel_id: null }))).toBe("/a/ava");
  });
});

describe("timeline", () => {
  const e = (seq: number, body: Event["body"], source = "agent"): Event => ({ seq: BigInt(seq), at: "2026-10-28T09:00:00Z", source, tainted: false, body });

  it("groups an agent's text, steps and cards into one turn and updates steps in place", () => {
    const events = [
      e(1, { kind: "user_message", text: "Fix it", when: "now" }, "user"),
      e(2, { kind: "agent_message", text: "On it.", agent_id: "ava" }),
      e(3, { kind: "step", step_id: "s", title: "Reading", status: "running" }, "engine"),
      e(4, { kind: "step", step_id: "s", title: "Read the code", status: "done" }, "engine"),
      e(5, { kind: "card", card: { kind: "approval", approval_id: "a", title: "Run?", body: null, details: null, risk: "read", risk_line: "", actions: [], fallback_text: "" } }),
      e(6, { kind: "approval_decided", approval_id: "a", decision: { kind: "allow" }, via: "web" }, "host"),
      e(7, { kind: "state", state: "idle", live_line: "" }, "host"),
      e(8, { kind: "usage", tokens_in: 1n, tokens_out: 1n, cost_micros: 50000n }, "host"),
    ];
    const blocks = buildBlocks(events, "ava");
    expect(blocks.map((b) => b.type)).toEqual(["user", "agent"]);
    const turn = blocks[1]!;
    if (turn.type !== "agent") throw new Error();
    expect(turn.items.map((i) => i.type)).toEqual(["text", "steps", "card"]);
    const steps = turn.items[1]!;
    expect(steps.type === "steps" && steps.steps).toEqual([{ id: "s", title: "Read the code", status: "done", at: "2026-10-28T09:00:00Z" }]);
    const c = turn.items[2]!;
    expect(c.type === "card" && c.decided?.decision).toEqual({ kind: "allow" });
    expect(totalCost(events)).toBe(50000n);
  });

  it("says decisions in plain words, naming the scope", () => {
    expect(outcomeWords({ kind: "allow_always", scope: "folder" }, "approval")).toBe("Always allowed in this folder");
    expect(outcomeWords({ kind: "deny" }, "draft")).toBe("Discarded");
  });
});
