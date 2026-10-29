import { describe, expect, it } from "vitest";
import { parseDiff } from "../lib/changes";
import { canPick, foundEngine, keyCompanies, loadSetupEngine, saveSetupEngine, setupEngineHolds } from "../lib/engines";
import { jumpItems, searchJump } from "../lib/jump";
import { failedLine, showSteps } from "../lib/steps";
import { agentStatus, hostAway, initialState, problemTitle } from "../lib/store";
import { buildBlocks, type AgentItem } from "../lib/timeline";
import { overviewOrder, waitingSessions } from "../features/thread/ChannelView";
import type { EngineInfo } from "../proto/EngineInfo";
import type { Event } from "../proto/Event";
import type { EventBody } from "../proto/EventBody";
import { agent, snapshot, thread } from "./fixtures";

const ev = (seq: number, body: EventBody): Event => ({ seq: BigInt(seq), at: "2026-10-28T09:41:00Z", source: "host", tainted: false, body });

describe("parseDiff", () => {
  const diff = [
    "diff --git a/src/pay.ts b/src/pay.ts",
    "index 1234567..89abcde 100644",
    "--- a/src/pay.ts",
    "+++ b/src/pay.ts",
    "@@ -14,4 +14,5 @@ export async function pay() {",
    "   const order = await currentOrder();",
    "-  return charge(card.id);",
    "+  const id = String(card.id);",
    "+  return charge(id);",
    " }",
    "@@ -40,2 +41,2 @@",
    "-old",
    "+new",
    "diff --git a/src/pay.test.ts b/src/pay.test.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/pay.test.ts",
    "@@ -0,0 +1,2 @@",
    "+test(\"pays\");",
    "+",
    "\\ No newline at end of file",
  ].join("\n");

  it("gives each file its name and +N −M, without the machine headers", () => {
    const files = parseDiff(diff);
    expect(files.map((f) => [f.path, f.added, f.removed])).toEqual([
      ["src/pay.ts", 3, 2],
      ["src/pay.test.ts", 2, 0],
    ]);
    const texts = files.flatMap((f) => f.hunks.flatMap((h) => h.lines.map((l) => l.text)));
    expect(texts.some((t) => /^(diff|index|---|\+\+\+|@@)/.test(t))).toBe(false);
  });

  it("numbers lines: new lines by the new file, removed ones by the old", () => {
    const [pay] = parseDiff(diff);
    expect(pay!.hunks).toHaveLength(2);
    expect(pay!.hunks[0]!.lines).toEqual([
      { kind: "context", no: 14, text: "  const order = await currentOrder();" },
      { kind: "remove", no: 15, text: "  return charge(card.id);" },
      { kind: "add", no: 15, text: "  const id = String(card.id);" },
      { kind: "add", no: 16, text: "  return charge(id);" },
      { kind: "context", no: 17, text: "}" },
    ]);
    expect(pay!.hunks[1]!.lines.map((l) => [l.kind, l.no])).toEqual([
      ["remove", 40],
      ["add", 41],
    ]);
  });

  it("keeps a removed line that looks like a header as a line", () => {
    const files = parseDiff(["--- a/notes.md", "+++ b/notes.md", "@@ -1,2 +1,1 @@", "--- old rule", " kept"].join("\n"));
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("notes.md");
    expect(files[0]!.hunks[0]!.lines.map((l) => [l.kind, l.text])).toEqual([
      ["remove", "-- old rule"],
      ["context", "kept"],
    ]);
  });

  it("names deleted, renamed and binary files, and reads nothing from no diff", () => {
    const files = parseDiff(
      [
        "diff --git a/old.ts b/old.ts",
        "deleted file mode 100644",
        "--- a/old.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-gone",
        "diff --git a/a.ts b/b.ts",
        "similarity index 100%",
        "rename from a.ts",
        "rename to b.ts",
        "diff --git a/logo.png b/logo.png",
        "Binary files a/logo.png and b/logo.png differ",
      ].join("\n"),
    );
    expect(files.map((f) => [f.path, f.removed, f.binary])).toEqual([
      ["old.ts", 1, false],
      ["b.ts", 0, false],
      ["logo.png", 0, true],
    ]);
    expect(parseDiff(null)).toEqual([]);
    expect(parseDiff("")).toEqual([]);
  });

  it("survives a hunk shorter than its header says (a cut-off diff)", () => {
    const files = parseDiff(["--- a/x", "+++ b/x", "@@ -1,9 +1,9 @@", " a", "-b", "+c"].join("\n"));
    expect(files[0]!.hunks[0]!.lines).toHaveLength(3);
  });
});

describe("one agent status everywhere", () => {
  it("shows an open problem, in the warning colour, while the agent is idle", () => {
    const mia = agent({ id: "mia", name: "Mia · Social", live_line: "Next post at 6 pm", main_thread_id: "tm" });
    expect(agentStatus(mia, { tm: "Needs an API key" })).toEqual({ line: "Needs an API key", tone: "warn", problem: true });
    expect(agentStatus(mia, {})).toEqual({ line: "Next post at 6 pm", tone: "quiet", problem: false });
    // Working again: what it's doing wins.
    expect(agentStatus({ ...mia, state: "working" }, { tm: "Needs an API key" })).toMatchObject({ line: "Next post at 6 pm", tone: "ok" });
    expect(agentStatus({ ...mia, live_line: "" }, {}).line).toBeNull();
  });

  it("names who a problem is about", () => {
    expect(problemTitle("Mia", { action: "Add a key", message: "Weilo's built-in AI needs an API key to work." })).toBe("Mia needs an API key");
    expect(problemTitle("Fix checkout", { action: "Choose another folder", message: "…" })).toBe("Fix checkout can't open its folder");
    // Nothing better to say: the problem's own words.
    expect(problemTitle("Ava", { action: "Try again", message: "Codex stopped responding." })).toBe("Ava's AI stopped responding.");
    expect(problemTitle(null, { action: "Add a key", message: "Needs a key." })).toBe("Needs a key.");
  });
});

describe("problems dealt with", () => {
  it("lose their button once a message is sent again or the agent replies", () => {
    const problemsOf = (events: Event[]) =>
      buildBlocks(events).flatMap((b) => (b.type === "agent" ? b.items : [])).filter((i): i is Extract<AgentItem, { type: "problem" }> => i.type === "problem");
    const failed = ev(2, { kind: "problem", message: "Codex stopped responding.", action: "Try again" });
    const said: EventBody = { kind: "user_message", text: "again", when: "now" };
    expect(problemsOf([ev(1, said), failed])[0]!.resolved).toBe(false);
    expect(problemsOf([ev(1, said), failed, ev(3, said)])[0]!.resolved).toBe(true);
    expect(problemsOf([ev(1, said), failed, ev(3, { kind: "agent_message", text: "Done", agent_id: null })])[0]!.resolved).toBe(true);
  });

  it("hides Stop while the computer is away", () => {
    expect(hostAway({ ...initialState, conn: "online" })).toBe(false);
    expect(hostAway({ ...initialState, conn: "reconnecting" })).toBe(true);
    expect(hostAway({ ...initialState, conn: "online", paused: "Restarting." })).toBe(true);
  });
});

describe("folded step failures say what failed", () => {
  it("in plain words", () => {
    expect(failedLine([])).toBeNull();
    expect(failedLine(["Read a file"])).toBe("1 file couldn't be read");
    expect(failedLine(["Read a file", "Read a file"])).toBe("2 files couldn't be read");
    expect(failedLine(["Opened a web page"])).toBe("1 web page couldn't be opened");
    expect(failedLine(["Read a file", "Searched the web"])).toBe("2 steps didn't work");
  });

  it("and the fold carries it", () => {
    const out = showSteps([
      { id: "a", title: "Read ~/.claude/memory/MEMORY.md", status: "failed", at: "" },
      { id: "b", title: "Read src/theme.css", status: "done", at: "" },
    ]);
    expect(out.shown.map((s) => s.label)).toEqual(["Read theme.css"]);
    expect(out.failedLine).toBe("1 file couldn't be read");
  });
});

describe("Ctrl+K jumps and does", () => {
  const snap = snapshot({
    agents: [agent(), agent({ id: "mia", name: "Mia · Social", main_thread_id: "tm" })],
    threads: [thread(), thread({ id: "s1", kind: "session", title: "Fix checkout", channel_id: null, started_by: "ava" })],
    prefs: { ...snapshot().prefs, sessions: { shown: false, open: true } },
  });
  const items = jumpItems(snap);

  it("finds agents, channels and sessions, even in a hidden section", () => {
    expect(searchJump(items, "mia").map((i) => i.label)).toContain("Mia · Social");
    expect(searchJump(items, "#shop").map((i) => i.label)).toEqual(["shop-launch"]);
    expect(searchJump(items, "fix")[0]).toMatchObject({ label: "Fix checkout", kind: "session" });
  });

  it("offers actions: hide or show a section, settings, new session", () => {
    expect(searchJump(items, "hide").map((i) => i.label)).toEqual(["Hide Agents", "Hide Channels", "Hide Archived"]);
    expect(searchJump(items, "hide sessions")).toHaveLength(0);
    expect(searchJump(items, "show")[0]).toMatchObject({ label: "Show Sessions", action: { type: "section", key: "sessions", shown: true } });
    expect(searchJump(items, "sett")[0]).toMatchObject({ label: "Settings", action: { type: "go", href: "/settings" } });
    expect(searchJump(items, "new s")[0]).toMatchObject({ label: "New session", action: { type: "new", what: "session" } });
  });

  it("puts names that start with what was typed first, and finds nothing for nothing", () => {
    expect(searchJump(items, "")).toEqual([]);
    expect(searchJump(items, "se")[0]!.label).toBe("Settings");
  });
});

describe("channels", () => {
  it("sort the Overview: needs you, then working, then most recent", () => {
    const list = overviewOrder([
      thread({ id: "old", updated_at: "2026-10-28T08:00:00Z" }),
      thread({ id: "new", updated_at: "2026-10-28T10:00:00Z" }),
      thread({ id: "work", state: "working", updated_at: "2026-10-28T07:00:00Z" }),
      thread({ id: "needs", state: "needs_you", updated_at: "2026-10-28T06:00:00Z" }),
    ]);
    expect(list.map((t) => t.id)).toEqual(["needs", "work", "new", "old"]);
  });

  it("show a chat the sessions its agent started here that need you", () => {
    const threads = [
      thread({ id: "s1", kind: "session", channel_id: "c1", started_by: "ava", state: "needs_you" }),
      thread({ id: "s2", kind: "session", channel_id: "c1", started_by: "ava", state: "working" }),
      thread({ id: "s3", kind: "session", channel_id: "c2", started_by: "ava", state: "needs_you" }),
      thread({ id: "s4", kind: "session", channel_id: "c1", started_by: "mia", state: "needs_you" }),
    ];
    expect(waitingSessions("c1", "ava", threads).map((t) => t.id)).toEqual(["s1"]);
    expect(waitingSessions("c1", null, threads)).toEqual([]);
  });
});

describe("setup wording and progress", () => {
  const eng = (over: Partial<EngineInfo>): EngineInfo =>
    ({ id: "x", title: "X", description: "", installed: true, default: false, binds_approvals: true, ...over }) as EngineInfo;
  const list = [
    eng({ id: "claude-code", title: "Claude Code", installed: false, ready: false, status: "Not on this computer." }),
    eng({ id: "codex", title: "Codex", installed: false, ready: false, needs: "sign_in" }),
    eng({ id: "gemini", title: "Gemini CLI", installed: true, ready: false, needs: "sign_in" }),
    eng({
      id: "pi",
      title: "Weilo's built-in AI",
      installed: false,
      ready: false,
      needs: "key",
      key_providers: [
        { id: "anthropic", title: "Anthropic", has_key: false },
        { id: "openai", title: "OpenAI", has_key: false },
        { id: "google", title: "Google", has_key: false },
      ],
    }),
  ];
  it("says 'found' only for an AI app that's on this computer, never the built-in AI", () => {
    expect(foundEngine(["pi", "claude-code"], list)).toBeNull();
    expect(foundEngine(["claude-code", "gemini"], list)?.id).toBe("gemini");
    expect(foundEngine(["gemini"], null)).toBeNull();
  });
  it("never offers Use for an app that isn't on this computer", () => {
    expect(canPick(list[0]!)).toBe(false);
    expect(canPick(list[1]!)).toBe(false);
    expect(canPick(eng({ id: "codex", installed: false, needs: "key" }))).toBe(false);
    expect(canPick(list[3]!)).toBe(true);
  });
  it("names the key companies in plain words", () => {
    expect(keyCompanies(list[3])).toBe("Anthropic, OpenAI or Google");
    expect(keyCompanies(undefined)).toBeNull();
  });
  it("remembers the step-1 choice and drops it when that AI stops working", () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    expect(loadSetupEngine(st)).toBeNull();
    saveSetupEngine("codex", st);
    expect(loadSetupEngine(st)).toBe("codex");
    saveSetupEngine(null, st);
    expect(loadSetupEngine(st)).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    expect(loadSetupEngine(broken)).toBeNull();
    expect(() => saveSetupEngine("x", broken)).not.toThrow();
    expect(setupEngineHolds("gemini", null)).toBeNull();
    expect(setupEngineHolds("gemini", list)).toBe(false);
    expect(setupEngineHolds("codex", [eng({ id: "codex", ready: true })])).toBe(true);
    expect(setupEngineHolds("gone", list)).toBe(false);
  });
});
