import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connect, listener, retryLast, send, setEngineKey } from "../lib/app";
import { canPick, preferredEngine, problemKind, statusLine } from "../lib/engines";
import type { HostApi } from "../lib/host";
import { plainStep, showSteps } from "../lib/steps";
import {
  applySnapshot,
  engineOfThread,
  initialState,
  lastUserMessage,
  PAUSED_FALLBACK,
  setHealth,
  store,
  type AppState,
} from "../lib/store";
import type { Call } from "../proto/Call";
import type { CallValue } from "../proto/CallValue";
import type { EngineInfo } from "../proto/EngineInfo";
import type { Event } from "../proto/Event";
import type { EventBody } from "../proto/EventBody";
import { Markdown } from "../ui/Markdown";
import { KeyDialog, providerLabel } from "../features/engines/KeyDialog";
import { askAgainText, pingLine, agentOf } from "../features/needs-you/NeedsYouPage";
import { agent, item, snapshot, thread } from "./fixtures";

const ev = (seq: number, body: EventBody): Event => ({ seq: BigInt(seq), at: "2026-10-28T09:41:00Z", source: "user", tainted: false, body });

/** A host that records calls and answers from a table. */
class FakeHost implements HostApi {
  calls: Call[] = [];
  constructor(private readonly answer: (c: Call) => CallValue = () => ({ type: "none" })) {}
  start() {}
  stop() {}
  subscribe() {}
  unsubscribe() {}
  presence() {}
  async call(c: Call) {
    this.calls.push(c);
    return this.answer(c);
  }
}

const pi = (o: Partial<EngineInfo> = {}): EngineInfo => ({
  id: "pi",
  title: "Weilo's built-in AI",
  description: "Works with an API key.",
  installed: true,
  default: true,
  binds_approvals: true,
  ready: false,
  needs: "key",
  status: "Needs an API key.",
  key_providers: [
    { id: "anthropic", title: "Anthropic", has_key: true },
    { id: "openai", title: "OpenAI", has_key: false },
  ],
  ...o,
});

let saved: AppState;
beforeEach(() => {
  saved = store.get();
});
afterEach(() => {
  store.set(() => saved);
});

describe("status banner", () => {
  it("pauses with the host's line while it isn't ok, and clears when it is", () => {
    let s = setHealth(initialState, false, "Your Weilo computer is restarting its data.");
    expect(s.paused).toBe("Your Weilo computer is restarting its data.");
    expect(setHealth(s, false, null).paused).toBe(PAUSED_FALLBACK);
    s = setHealth(s, true, "ignored");
    expect(s.paused).toBeNull();
    expect(setHealth(s, true, null)).toBe(s);
  });

  it("doesn't send while paused, and keeps the text in the message box", async () => {
    const host = new FakeHost();
    connect(host);
    listener.health?.(false, "Your Weilo computer is restarting its data.");
    expect(await send("t1", "hello")).toBe(false);
    expect(host.calls).toEqual([]);
    expect(store.get().drafts["t1"]).toBe("hello");
    listener.health?.(true, null);
    expect(await send("t1", "hello")).toBe(true);
    expect(host.calls).toHaveLength(1);
  });
});

describe("problem actions", () => {
  it("knows every button the host can send, and nothing else", () => {
    expect(problemKind("Try again")).toBe("retry");
    expect(problemKind("Sign in")).toBe("sign_in");
    expect(problemKind("Add a key")).toBe("key");
    expect(problemKind("Install")).toBe("install");
    expect(problemKind("Choose another folder")).toBe("folder");
    expect(problemKind("Reboot the moon")).toBeNull();
    expect(problemKind(null)).toBeNull();
  });

  it("Try again sends the last thing the person said in that chat", async () => {
    const events = [
      ev(1, { kind: "user_message", text: "first", when: "now" }),
      ev(2, { kind: "agent_message", text: "ok", agent_id: null }),
      ev(3, { kind: "user_message", text: "hang on, do the second", when: "now" }),
      ev(4, { kind: "problem", message: "Echo stopped responding.", action: "Try again" }),
    ];
    expect(lastUserMessage(events)).toBe("hang on, do the second");
    const host = new FakeHost();
    connect(host);
    store.set((s) => ({ ...s, paused: null, feeds: { ...s.feeds, t9: { events, streaming: null } } }));
    await retryLast("t9");
    expect(host.calls).toEqual([{ method: "send", params: { thread_id: "t9", text: "hang on, do the second", when: "now" } }]);
  });

  it("Try again with nothing to resend says so instead of sending", async () => {
    const host = new FakeHost();
    connect(host);
    store.set((s) => ({ ...s, paused: null, feeds: {} }));
    await retryLast("empty");
    expect(host.calls).toEqual([]);
    expect(store.get().error).toMatch(/no message to send again/);
  });

  it("finds the engine behind a problem: the session's, else the agent's", () => {
    const s = applySnapshot(
      initialState,
      snapshot({
        agents: [agent({ id: "ava", engine: "claude-code", main_thread_id: "ta" }), agent({ id: "mia", engine: "pi", main_thread_id: "tm" })],
        threads: [thread({ id: "s1", kind: "session", engine: "codex", agent_id: "ava" }), thread({ id: "c1", agent_id: "mia" })],
      }),
    );
    expect(engineOfThread(s, "s1")).toBe("codex");
    expect(engineOfThread(s, "c1")).toBe("pi");
    expect(engineOfThread(s, "ta")).toBe("claude-code");
    expect(engineOfThread(s, "nowhere", "mia")).toBe("pi");
  });
});

describe("engines", () => {
  it("lets ready engines and ones that need a sign-in or key be picked, not missing ones", () => {
    expect(canPick(pi({ ready: true, needs: undefined }))).toBe(true);
    expect(canPick(pi())).toBe(true);
    expect(canPick(pi({ needs: "sign_in" }))).toBe(true);
    expect(canPick(pi({ needs: "install", installed: false }))).toBe(false);
    expect(canPick(pi({ needs: "node" }))).toBe(false);
    // Older hosts: installed decides.
    expect(canPick(pi({ ready: undefined, needs: undefined, installed: false }))).toBe(false);
    expect(statusLine(pi({ status: undefined, installed: false }))).toBe("Not on this computer.");
  });
  it("preselects the current engine, else a ready default", () => {
    const list = [pi(), pi({ id: "claude-code", default: false, ready: true, needs: undefined }), pi({ id: "gemini", needs: "node" })];
    expect(preferredEngine(list)).toBe("claude-code");
    expect(preferredEngine(list, "pi")).toBe("pi");
    expect(preferredEngine(list, "gemini")).toBe("claude-code");
  });
});

describe("key dialog", () => {
  it("says Saved for a saved key and never shows a key", () => {
    const both = pi({
      key_providers: [
        { id: "anthropic", title: "Anthropic", has_key: true },
        { id: "openai", title: "OpenAI", has_key: true },
      ],
    });
    store.set((s) => ({ ...s, engines: [both] }));
    const html = renderToStaticMarkup(createElement(KeyDialog, { open: true, onClose: () => {}, engineId: "pi" }));
    expect(html).toContain("Anthropic · Saved");
    expect(html).toContain("OpenAI · Saved");
    expect(html).toContain("Saved.");
    expect(html).toContain("Paste a new key to replace it");
    expect(html).toContain('type="password"');
    expect(html).toMatch(/<input[^>]*value=""/);
    expect(html).toContain("console.anthropic.com");
    expect(html).toContain('rel="noopener noreferrer"');
    expect(providerLabel({ id: "openai", title: "OpenAI", has_key: false })).toBe("OpenAI");
  });

  it("sends the key to the host once and keeps no copy in the app", async () => {
    const secret = "sk-ant-THIS-IS-SECRET-123";
    const host = new FakeHost((c) => (c.method === "set_engine_key" ? { type: "engines", data: [pi()] } : { type: "none" }));
    connect(host);
    await setEngineKey("pi", "anthropic", secret);
    expect(host.calls).toEqual([{ method: "set_engine_key", params: { engine: "pi", provider: "anthropic", key: secret } }]);
    expect(JSON.stringify(store.get(), (_k, v) => (typeof v === "bigint" ? Number(v) : v))).not.toContain(secret);
  });
});

describe("markdown in agent messages", () => {
  const html = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));

  it("draws lists, emphasis and code", () => {
    const out = html("**Bold** and `code`\n\n- one\n- two\n\n```\nnpm test\n```");
    expect(out).toContain("<strong>Bold</strong>");
    expect(out).toContain("<li>one</li>");
    expect(out).toMatch(/<pre[^>]*><code[^>]*>npm test/);
  });

  it("never renders raw HTML, scripts or event handlers", () => {
    const out = html('Hi <script>alert(1)</script> there <img src="x" onerror="alert(2)"> and <b onclick="x()">b</b>\n\n<div onmouseover="y()">z</div>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("onmouseover");
    expect(out).not.toContain("<img");
  });

  it("opens links in a new tab and drops unsafe ones", () => {
    const out = html("[site](https://example.com) and [bad](javascript:alert(1)) and ![pic](https://x.test/p.png)");
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<img");
  });
});

describe("step names", () => {
  it("maps tool names to plain words, keeping the file or command", () => {
    expect(plainStep("ToolSearch")).toMatchObject({ label: "Looked for a tool", detail: null });
    expect(plainStep("Read /Users/me/shop/src/app.ts")).toMatchObject({ label: "Read a file", detail: "/Users/me/shop/src/app.ts" });
    expect(plainStep("Bash")).toMatchObject({ label: "Ran a command" });
    expect(plainStep("Execute `npm test`")).toMatchObject({ label: "Ran a command", detail: "npm test" });
    expect(plainStep("`git status`")).toMatchObject({ label: "Ran a command", detail: "git status" });
    expect(plainStep("Edit `src/theme.css`")).toMatchObject({ label: "Changed a file", detail: "src/theme.css" });
    expect(plainStep("Write src/new.ts")).toMatchObject({ label: "Changed a file", detail: "src/new.ts" });
    expect(plainStep("Fetch https://example.com/docs")).toMatchObject({ label: "Opened a web page", detail: "https://example.com/docs" });
    expect(plainStep("grep \"saved card\" src")).toMatchObject({ label: "Looked through files" });
    expect(plainStep("mcp__weilo__post")).toMatchObject({ label: "Used a connection" });
  });

  it("leaves titles that are already plain words alone", () => {
    expect(plainStep("Read the checkout code").label).toBe("Read the checkout code");
    expect(plainStep("Found the cause: the saved card's ID was sent in the wrong format").label).toMatch(/^Found the cause/);
    expect(plainStep("Installing Weilo's built-in AI").label).toBe("Installing Weilo's built-in AI");
  });

  it("folds failed look-ups into the details", () => {
    const at = "2026-10-28T09:41:00Z";
    const out = showSteps([
      { id: "a", title: "Read ~/.claude/memory/MEMORY.md", status: "failed", at },
      { id: "b", title: "Read src/theme.css", status: "done", at },
      { id: "c", title: "`npm run build`", status: "failed", at },
    ]);
    expect(out.shown.map((s) => s.label)).toEqual(["Read a file", "Ran a command"]);
    expect(out.folded).toBe(1);
    expect(out.details.map((s) => s.detail)).toEqual(["~/.claude/memory/MEMORY.md", "src/theme.css", "npm run build"]);
    expect(showSteps([{ id: "x", title: "Read the request", status: "done", at }]).details).toEqual([]);
  });
});

describe("Needs you words", () => {
  it("asks again in the person's own words", () => {
    expect(askAgainText("Run the shop's checks")).toBe("Can you ask me again about Run the shop's checks?");
    expect(askAgainText("Send the email?")).toBe("Can you ask me again about Send the email?");
  });
  it("names the right agent", () => {
    const snap = snapshot({
      agents: [agent(), agent({ id: "mia", name: "Mia · Social", main_thread_id: "tm" })],
      threads: [thread({ id: "t1", agent_id: "mia" })],
    });
    expect(agentOf(snap, item({ thread_id: "t1" }))?.name).toBe("Mia · Social");
    expect(agentOf(snap, item({ thread_id: "tm" }))?.id).toBe("mia");
    expect(pingLine(snap)).toBe("Your agents will ping you if that changes.");
    expect(pingLine(snapshot())).toBe("Ava will ping you if that changes.");
  });
});
