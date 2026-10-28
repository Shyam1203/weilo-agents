/**
 * Fixture mode (`?fixture=1`, dev only, or VITE_FIXTURE=1 at build time): the app runs on
 * static data that matches the approved mock, so screens can be reviewed without a host.
 * Add `&setup=0` to see first run, and `&down=1` to see the host say it isn't ready.
 */
import type { AgentSummary } from "../proto/AgentSummary";
import type { AllowRuleInfo } from "../proto/AllowRuleInfo";
import type { Call } from "../proto/Call";
import type { CallValue } from "../proto/CallValue";
import type { Card } from "../proto/Card";
import type { ChannelSummary } from "../proto/ChannelSummary";
import type { DeviceInfo } from "../proto/DeviceInfo";
import type { EngineCheck } from "../proto/EngineCheck";
import type { EngineInfo } from "../proto/EngineInfo";
import type { Event } from "../proto/Event";
import type { EventBody } from "../proto/EventBody";
import type { NeedsYouItem } from "../proto/NeedsYouItem";
import type { Snapshot } from "../proto/Snapshot";
import type { ThreadSummary } from "../proto/ThreadSummary";
import type { WorkState } from "../proto/WorkState";
import { HostError, type HostApi, type HostListener } from "./host";

function at(h: number, m: number, dayOffset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export const ID = {
  ava: "agent-ava",
  mia: "agent-mia",
  avaMain: "thread-ava",
  miaMain: "thread-mia",
  general: "ch-general",
  shop: "ch-shop-launch",
  taxes: "ch-taxes-2026",
  trip: "ch-trip",
  holiday: "ch-holiday-sale",
  launch: "thread-launch-email",
  teaser: "thread-teaser",
  fix: "thread-fix-checkout",
  dark: "thread-dark-mode",
} as const;

const emailCard: Card = {
  kind: "draft",
  approval_id: "appr-email",
  title: "Email draft · To customers (1,204) · Fri 9:00",
  body: "Our spring collection is here\nHi {first name}, after six months of work the spring range is live. Early buyers get free shipping until Sunday…",
  details: "From: shop@example.com\nTo: customers (1,204 people)\nSend: Friday 9:00",
  risk: "send",
  risk_line: "Can't unsend after Fri 9:00",
  actions: [
    { id: "discard", label: "Discard", primary: false, decision: { kind: "deny" } },
    { id: "edit", label: "Edit", primary: false, decision: null },
    { id: "schedule", label: "Schedule for 1,204 people", primary: true, decision: { kind: "allow" } },
  ],
  fallback_text: "Ava drafted the launch email to 1,204 customers for Fri 9:00.",
};

const checksCard: Card = {
  kind: "approval",
  approval_id: "appr-checks",
  title: "Run the shop's checks on your MacBook?",
  body: null,
  details: "npm test -- checkout",
  risk: "read",
  risk_line: "Changes nothing · about $0.05",
  actions: [
    { id: "no", label: "Not now", primary: false, decision: { kind: "deny" } },
    { id: "always", label: "Always allow in this folder", primary: false, decision: { kind: "allow_always", scope: "folder" } },
    { id: "allow", label: "Allow", primary: true, decision: { kind: "allow" } },
  ],
  fallback_text: "Run the shop's checks?",
};

function plainCard(kind: string, title: string, risk: Card["risk"] = "reversible", riskLine = "Can undo"): Card {
  return { kind, approval_id: null, title, body: null, details: null, risk, risk_line: riskLine, actions: [], fallback_text: title };
}

interface ThreadSeed {
  summary: ThreadSummary;
  events: Array<[string, string, EventBody]>; // at, source, body
}

function seedThreads(): ThreadSeed[] {
  const thread = (
    id: string,
    kind: ThreadSummary["kind"],
    title: string,
    o: Partial<ThreadSummary> = {},
  ): ThreadSummary => ({
    id,
    kind,
    channel_id: null,
    agent_id: ID.ava,
    title,
    state: "idle",
    live_line: "",
    last_seq: 0n,
    engine: null,
    folder: null,
    started_by: null,
    updated_at: at(9, 40),
    ...o,
  });
  return [
    {
      summary: thread(ID.avaMain, "agent", "Ava", { state: "working", live_line: "Checking the shop page" }),
      events: [
        [at(8, 0), "agent", { kind: "agent_message", agent_id: ID.ava, text: "Good morning. Your rival dropped the jacket to $45, Mark moved lunch to 1 pm, and two customers say saved cards fail at checkout." }],
        [at(8, 4), "user", { kind: "user_message", when: "now", text: "Match the price on the jacket" }],
        [at(8, 4), "agent", { kind: "agent_message", agent_id: ID.ava, text: "On it. Here's the plan:\n\n1. Check **our price** and the rival's on the [shop page](https://shop.example/jacket).\n2. Set the jacket to `$45` until Sunday.\n\nI'll tell you when it's live." }],
        [at(8, 5), "agent", { kind: "state", state: "working", live_line: "Checking the shop page" }],
      ],
    },
    {
      summary: thread(ID.miaMain, "agent", "Mia", { agent_id: ID.mia, live_line: "Next post at 6 pm" }),
      events: [
        [at(7, 30), "agent", { kind: "agent_message", agent_id: ID.mia, text: "Today's post is ready. It goes out at 6 pm." }],
        [at(7, 40), "user", { kind: "user_message", when: "now", text: "Make a version for Instagram too." }],
        [at(7, 40), "host", { kind: "problem", message: "Weilo's built-in AI needs an API key to work.", action: "Add a key" }],
      ],
    },
    {
      summary: thread(ID.launch, "chat", "Launch email", { channel_id: ID.shop, state: "working", live_line: "Writing the launch email", updated_at: at(9, 42) }),
      events: [
        [at(9, 41), "user", { kind: "user_message", when: "now", text: "Draft the launch email for Friday, and ask Mia for a teaser on X and Bluesky." }],
        [at(9, 42), "agent", { kind: "agent_message", agent_id: ID.ava, text: "Here is the email. Mia is writing the teaser in her thread, and I started a session to fix the checkout bug before Friday." }],
        [at(9, 42), "agent", { kind: "card", card: emailCard }],
        [at(9, 42), "host", { kind: "filed", channel_id: ID.shop }],
        [at(9, 43), "agent", { kind: "state", state: "working", live_line: "Writing the launch email" }],
      ],
    },
    {
      summary: thread(ID.teaser, "chat", "Teaser", { channel_id: ID.shop, agent_id: ID.mia, updated_at: at(9, 44) }),
      events: [
        [at(9, 44), "agent", { kind: "agent_message", agent_id: ID.mia, text: "Two teasers are ready: one for X and one for Bluesky. The Bluesky one is posted." }],
      ],
    },
    {
      summary: thread(ID.fix, "session", "Fix checkout", {
        channel_id: ID.shop,
        state: "needs_you",
        live_line: "Waiting to run the checks",
        engine: "claude-code",
        folder: "~/code/shop",
        started_by: ID.ava,
        updated_at: at(9, 51),
        worktree: "~/code/.weilo-worktrees/shop-fix-checkout",
        branch: "weilo/fix-checkout",
      }),
      events: [
        [at(9, 43), "agent", { kind: "agent_message", agent_id: ID.ava, text: "Customers can't pay with a saved card. Find out why and fix it." }],
        [at(9, 45), "engine", { kind: "step", step_id: "s1", title: "Read the checkout code", status: "done" }],
        [at(9, 47), "engine", { kind: "step", step_id: "s2", title: "Found the cause: the saved card's ID was sent in the wrong format", status: "done" }],
        [at(9, 50), "engine", { kind: "step", step_id: "s3", title: "Fixed it and added a check for saved cards", status: "done" }],
        [at(9, 51), "engine", { kind: "card", card: checksCard }],
        [at(9, 51), "host", { kind: "usage", tokens_in: 120000n, tokens_out: 9000n, cost_micros: 380000n }],
        [at(9, 51), "engine", { kind: "state", state: "needs_you", live_line: "Waiting to run the checks" }],
      ],
    },
    {
      summary: thread(ID.dark, "session", "Dark mode for the store", {
        state: "working",
        live_line: "Changing the colours",
        engine: "codex",
        folder: "~/code/shop",
        started_by: null,
        updated_at: at(9, 30),
      }),
      events: [
        [at(9, 20), "user", { kind: "user_message", when: "now", text: "Add a dark mode to the store." }],
        [at(9, 21), "engine", { kind: "step", step_id: "d0", title: "ToolSearch", status: "done" }],
        [at(9, 21), "engine", { kind: "step", step_id: "d0b", title: "Read ~/.claude/memory/MEMORY.md", status: "failed" }],
        [at(9, 22), "engine", { kind: "step", step_id: "d1", title: "Read src/theme.css", status: "done" }],
        [at(9, 24), "engine", { kind: "step", step_id: "d1b", title: "`npm run build`", status: "done" }],
        [at(9, 26), "engine", { kind: "step", step_id: "d1c", title: "Edit src/theme.css", status: "running" }],
        // Codex went quiet; the reply ended there. Try again sent the message again, and work goes on.
        [at(9, 27), "host", { kind: "problem", message: "Codex stopped responding, so this reply stopped.", action: "Try again" }],
        [at(9, 27), "host", { kind: "state", state: "idle", live_line: "" }],
        [at(9, 28), "user", { kind: "user_message", when: "now", text: "Add a dark mode to the store." }],
        [at(9, 28), "host", { kind: "state", state: "working", live_line: "Changing the colours" }],
        [at(9, 30), "engine", { kind: "step", step_id: "d2", title: "Changing the colours", status: "running" }],
      ],
    },
  ];
}

function seedNeedsYou(): NeedsYouItem[] {
  return [
    {
      approval_id: "appr-email",
      thread_id: ID.launch,
      source: "#shop-launch · Ava",
      card: { ...emailCard, title: "Schedule the launch email to 1,204 customers" },
      created_at: at(9, 42),
      expires_at: at(9, 0, 3),
      state: "pending",
    },
    {
      approval_id: "appr-checks",
      thread_id: ID.fix,
      source: "Fix checkout · session started by Ava",
      card: { ...checksCard, title: "Run the shop's checks on your MacBook", risk_line: "Changes nothing" },
      created_at: at(9, 51),
      expires_at: at(9, 51, 1),
      state: "pending",
    },
    {
      approval_id: "appr-mark",
      thread_id: ID.avaMain,
      source: "#general · Ava",
      card: plainCard("draft", "Ava's email to Mark wasn't approved in time", "send", "Can't unsend"),
      created_at: at(16, 0, -1),
      expires_at: at(18, 0, -1),
      state: "expired",
    },
    {
      approval_id: "heads-fix",
      thread_id: ID.fix,
      source: "Fix checkout · session started by Ava",
      card: plainCard("heads_up", "Ava started a session: Fix checkout"),
      created_at: at(9, 43),
      expires_at: at(9, 43, 1),
      state: "pending",
    },
    {
      approval_id: "appr-bluesky",
      thread_id: ID.teaser,
      source: "#shop-launch · Mia",
      card: plainCard("approval", "Mia posted the teaser on Bluesky", "send", "Posted"),
      created_at: at(9, 30),
      expires_at: at(9, 30, 1),
      state: "allowed",
    },
  ];
}

const AGENTS: AgentSummary[] = [
  { id: ID.ava, name: "Ava", color: "violet", engine: "claude-code", model: null, state: "working", live_line: "Checking the shop page", main_thread_id: ID.avaMain },
  { id: ID.mia, name: "Mia · Social", color: "rose", engine: "pi", model: null, state: "idle", live_line: "Next post at 6 pm", main_thread_id: ID.miaMain },
];

const CHANNELS: ChannelSummary[] = [
  { id: ID.general, slug: "general", title: "General", archived: false, unread: false },
  { id: ID.shop, slug: "shop-launch", title: "Shop launch", archived: false, unread: false },
  { id: ID.taxes, slug: "taxes-2026", title: "Taxes 2026", archived: false, unread: true },
  { id: ID.trip, slug: "trip", title: "Trip", archived: false, unread: false },
  { id: ID.holiday, slug: "holiday-sale", title: "Holiday sale", archived: true, unread: false },
];

function seedEngines(): EngineInfo[] {
  return [
    {
      id: "claude-code", title: "Claude Code", description: "Anthropic's coding agent, with your own sign-in.", installed: true, default: false, binds_approvals: true,
      ready: true, status: "Signed in on this computer.",
    },
    {
      id: "codex", title: "Codex", description: "OpenAI's coding agent, with your own sign-in.", installed: true, default: false, binds_approvals: true,
      ready: false, needs: "sign_in", status: "Needs you to sign in.", how: "Open Terminal, run `codex` and sign in.",
    },
    {
      id: "gemini", title: "Gemini CLI", description: "Google's coding agent.", installed: false, default: false, binds_approvals: false,
      ready: false, needs: "node", status: "Not on this computer.", how: "Get Node.js from nodejs.org, then check again.",
    },
    {
      id: "pi", title: "Weilo's built-in AI", description: "Works with an API key from Anthropic, OpenAI or Google.", installed: true, default: true, binds_approvals: true,
      ready: false, needs: "key", status: "Needs an API key.",
      key_providers: [
        { id: "anthropic", title: "Anthropic", has_key: false },
        { id: "openai", title: "OpenAI", has_key: false },
        { id: "google", title: "Google", has_key: false },
      ],
    },
  ];
}

function checkOf(e: EngineInfo): EngineCheck {
  if (e.ready) return { engine: e.id, ready: true, needs: null, message: `${e.title} is ready.`, action: null, auth_methods: [] };
  const needs = e.needs ?? "error";
  const action = needs === "sign_in" ? "Sign in" : needs === "key" ? "Add a key" : needs === "error" ? "Try again" : "Install";
  const message =
    needs === "sign_in" ? `${e.title} isn't signed in. ${e.how ?? ""}`.trim()
    : needs === "key" ? `${e.title} needs an API key to work.`
    : needs === "node" ? `Weilo needs Node.js to download ${e.title}. Get it from nodejs.org.`
    : `${e.title} isn't on this computer.`;
  const auth_methods = needs === "sign_in" ? [{ id: "chatgpt", name: "Sign in with ChatGPT", description: "Use your ChatGPT plan." }, { id: "apikey", name: "Use an API key", description: null }] : [];
  return { engine: e.id, ready: false, needs, message, action, auth_methods };
}

export class FixtureHost implements HostApi {
  private snap: Snapshot;
  private feeds = new Map<string, Event[]>();
  private subs = new Set<string>();
  private timers: Array<ReturnType<typeof setTimeout>> = [];
  private n = 0;
  private devices: DeviceInfo[] = [
    { id: "dev-browser", name: "Chrome on this Mac", paired_at: at(8, 0), last_seen_at: at(9, 51), this_device: true },
    { id: "dev-laptop", name: "Safari on the shop laptop", paired_at: "2026-10-20T10:00:00Z", last_seen_at: "2026-10-27T17:12:00Z", this_device: false },
  ];
  private rules: AllowRuleInfo[] = [
    { id: "rule-test", agent_id: ID.ava, description: "Ava may always run `npm test` in shop", created_at: "2026-10-26T15:30:00Z" },
    { id: "rule-search", agent_id: ID.mia, description: "Mia may always search the web", created_at: at(7, 20) },
  ];

  private engines = seedEngines();
  private readonly down: boolean;

  constructor(
    private readonly listener: HostListener,
    opts: { setupDone?: boolean; down?: boolean; noEngines?: boolean } = {},
  ) {
    this.down = !!opts.down;
    const seeds = seedThreads();
    for (const s of seeds) {
      const events = s.events.map(([when, source, body], i) => ({ seq: BigInt(i + 1), at: when, source, tainted: false, body }));
      this.feeds.set(s.summary.id, events);
      s.summary.last_seq = BigInt(events.length);
    }
    const done = opts.setupDone ?? true;
    this.snap = {
      agents: done ? AGENTS.map((a) => ({ ...a })) : [],
      channels: done ? CHANNELS.map((c) => ({ ...c })) : [],
      threads: done ? seeds.map((s) => s.summary) : [],
      needs_you: done ? seedNeedsYou() : [],
      prefs: {
        agents: { shown: true, open: true },
        channels: { shown: true, open: true },
        sessions: { shown: true, open: true },
        archived: { shown: true, open: false },
      },
      setup: { done, found_engines: opts.noEngines ? [] : ["claude-code"], keep_awake: false },
    };
  }

  start(): void {
    this.later(() => {
      this.listener.status?.("online");
      this.listener.welcome?.({ hostName: "Your MacBook", deviceId: "fixture" });
      if (this.down) this.listener.health?.(false, "Your Weilo computer is restarting its data. (a few seconds)");
    }, 0);
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  subscribe(threadId: string, afterSeq = 0n): void {
    this.subs.add(threadId);
    const events = this.feeds.get(threadId) ?? [];
    this.later(() => {
      for (const e of events) if (e.seq > afterSeq) this.listener.event?.(threadId, e);
    }, 0);
  }

  unsubscribe(threadId: string): void {
    this.subs.delete(threadId);
  }

  presence(): void {}

  async call(c: Call): Promise<CallValue> {
    await new Promise((r) => setTimeout(r, 60));
    return this.answer(c);
  }

  private answer(c: Call): CallValue {
    const none: CallValue = { type: "none" };
    switch (c.method) {
      case "snapshot":
        return { type: "snapshot", data: structuredClone(this.snap) };
      case "list_engines":
        return { type: "engines", data: structuredClone(this.engines) };
      case "check_engine": {
        const e = this.engines.find((x) => x.id === c.params.engine);
        if (!e) throw new HostError("invalid", "That engine isn't available.");
        return { type: "engine_check", data: checkOf(e) };
      }
      case "set_engine_key": {
        const e = this.engines.find((x) => x.id === c.params.engine);
        const p = e?.key_providers?.find((x) => x.id === c.params.provider);
        if (!e || !p) throw new HostError("invalid", "That engine doesn't take that key.");
        p.has_key = c.params.key.trim().length > 0;
        const any = e.key_providers!.some((x) => x.has_key);
        e.ready = any;
        e.needs = any ? undefined : "key";
        e.status = any ? "Ready with your API key." : "Needs an API key.";
        this.changed("engines");
        return { type: "engines", data: structuredClone(this.engines) };
      }
      case "update_agent": {
        const a = this.snap.agents.find((x) => x.id === c.params.agent_id);
        if (!a) throw new HostError("not_found", "That agent isn't here anymore.");
        if (c.params.engine) a.engine = c.params.engine;
        this.changed("agents");
        return { type: "agent", data: { ...a } };
      }
      case "archive_agent":
        this.snap.agents = this.snap.agents.filter((x) => x.id !== c.params.agent_id);
        this.changed("agents");
        return none;
      case "merge_session": {
        const t = this.snap.threads.find((x) => x.id === c.params.thread_id);
        if (!t?.worktree) throw new HostError("conflict", "This session works in the folder itself, so there's nothing to bring back.");
        return { type: "message", data: `Brought 2 changed files back into ${t.folder ?? "your project"}.` };
      }
      case "session_changes": {
        if (c.params.thread_id !== ID.fix) return { type: "session_changes", data: { files: [], diff: null, truncated: false } };
        return { type: "session_changes", data: FIX_CHANGES };
      }
      case "list_devices":
        return { type: "devices", data: this.devices };
      case "revoke_device":
        if (this.devices.length <= 1) throw new HostError("conflict", "This is your only paired device. Pair another one before removing it.");
        this.devices = this.devices.filter((d) => d.id !== c.params.device_id);
        this.changed("devices");
        return none;
      case "list_allow_rules":
        return { type: "allow_rules", data: this.rules };
      case "revoke_allow_rule":
        this.rules = this.rules.filter((r) => r.id !== c.params.rule_id);
        this.changed("allow_rules");
        return none;
      case "needs_you":
        return { type: "needs_you", data: structuredClone(this.snap.needs_you) };
      case "setup_status":
        return { type: "setup", data: this.snap.setup };
      case "set_prefs":
        this.snap.prefs = c.params.prefs;
        return none;
      case "finish_setup": {
        this.snap = new FixtureHost(this.listener, { setupDone: true }).snap;
        this.snap.setup.keep_awake = c.params.keep_awake;
        return none;
      }
      case "send":
        this.onSend(c.params.thread_id, c.params.text);
        return none;
      case "stop":
        this.onStop(c.params.thread_id);
        return none;
      case "stop_agent": {
        const a = this.snap.agents.find((x) => x.id === c.params.agent_id);
        if (a) this.onStop(a.main_thread_id);
        return none;
      }
      case "decide":
        this.onDecide(c.params.approval_id, c.params.decision.kind !== "deny", c.params.decision);
        return none;
      case "create_channel": {
        const slug = c.params.title.toLowerCase().split(/\s+/).slice(0, 2).join("-");
        const ch: ChannelSummary = { id: `ch-${++this.n}`, slug, title: c.params.title, archived: false, unread: false };
        this.snap.channels.push(ch);
        this.changed("channels");
        return { type: "channel", data: ch };
      }
      case "archive_channel": {
        const ch = this.snap.channels.find((x) => x.id === c.params.channel_id);
        if (ch) ch.archived = c.params.archived;
        this.changed("channels");
        return none;
      }
      case "create_agent": {
        const id = `agent-${++this.n}`;
        const main = this.newThread({ kind: "agent", title: c.params.name, agent_id: id });
        const a: AgentSummary = { id, name: c.params.name, color: ["sky", "teal", "rose"][this.n % 3]!, engine: c.params.engine, model: null, state: "idle", live_line: "", main_thread_id: main.id };
        this.snap.agents.push(a);
        this.changed("agents");
        return { type: "agent", data: a };
      }
      case "create_thread": {
        const t = this.newThread({ kind: "chat", title: c.params.title ?? "New thread", channel_id: c.params.channel_id, agent_id: c.params.agent_id });
        this.changed("threads");
        return { type: "thread", data: t };
      }
      case "start_session": {
        const t = this.newThread({
          kind: "session",
          // Like the host: named from the first line of what it should do.
          title: c.params.title ?? c.params.task?.split("\n")[0]?.trim() ?? c.params.folder.split("/").filter(Boolean).pop() ?? "New session",
          folder: c.params.folder,
          engine: c.params.engine,
          channel_id: c.params.channel_id,
          agent_id: c.params.agent_id,
        });
        this.changed("threads");
        if (c.params.task?.trim()) this.push(t.id, "user", { kind: "user_message", text: c.params.task.trim(), when: "now" });
        return { type: "thread", data: t };
      }
      case "move_thread": {
        const t = this.snap.threads.find((x) => x.id === c.params.thread_id);
        if (t) {
          t.channel_id = c.params.channel_id;
          this.push(t.id, "host", { kind: "filed", channel_id: c.params.channel_id });
        }
        this.changed("threads");
        return none;
      }
      case "rename_channel":
        return none;
    }
    throw new HostError("invalid", "That isn't something this preview can do.");
  }

  private newThread(o: Partial<ThreadSummary> & Pick<ThreadSummary, "kind" | "title">): ThreadSummary {
    const t: ThreadSummary = {
      id: `thread-${++this.n}`,
      channel_id: null,
      agent_id: null,
      state: "idle",
      live_line: "",
      last_seq: 0n,
      engine: null,
      folder: null,
      started_by: null,
      updated_at: new Date().toISOString(),
      ...o,
    };
    this.snap.threads.push(t);
    this.feeds.set(t.id, []);
    return t;
  }

  private push(threadId: string, source: string, body: EventBody): void {
    const feed = this.feeds.get(threadId) ?? [];
    const e: Event = { seq: BigInt(feed.length + 1), at: new Date().toISOString(), source, tainted: false, body };
    feed.push(e);
    this.feeds.set(threadId, feed);
    const t = this.snap.threads.find((x) => x.id === threadId);
    if (t) t.last_seq = e.seq;
    if (this.subs.has(threadId)) this.listener.event?.(threadId, e);
  }

  private setState(threadId: string, state: WorkState, live: string): void {
    const t = this.snap.threads.find((x) => x.id === threadId);
    if (t) {
      t.state = state;
      t.live_line = live;
    }
    const a = this.snap.agents.find((x) => x.main_thread_id === threadId);
    if (a) {
      a.state = state;
      a.live_line = live;
    }
    this.push(threadId, "host", { kind: "state", state, live_line: live });
    this.changed("threads");
  }

  private onSend(threadId: string, text: string): void {
    this.push(threadId, "user", { kind: "user_message", text, when: "now" });
    const t = this.snap.threads.find((x) => x.id === threadId);
    const agentId = t?.agent_id ?? null;
    if (!agentId) return;
    const reply = "On it. I'll tell you when it's done.";
    this.later(() => this.setState(threadId, "working", "Thinking it through"), 300);
    const words = reply.split(" ");
    words.forEach((_, i) => {
      this.later(() => {
        if (!this.subs.has(threadId)) return;
        this.listener.streaming?.(threadId, words.slice(0, i + 1).join(" "));
      }, 500 + i * 90);
    });
    this.later(() => {
      this.listener.streaming?.(threadId, null);
      this.push(threadId, "agent", { kind: "agent_message", text: reply, agent_id: agentId });
      this.setState(threadId, "idle", "");
    }, 600 + words.length * 90);
  }

  /** Like the host: open approvals close as "stopped", then the thread goes idle. */
  private onStop(threadId: string): void {
    for (const item of this.snap.needs_you) {
      if (item.thread_id !== threadId || item.state !== "pending" || item.card.kind === "heads_up") continue;
      item.state = "denied";
      this.push(threadId, "host", { kind: "approval_decided", approval_id: item.approval_id, decision: { kind: "deny" }, via: "stopped" });
    }
    this.setState(threadId, "idle", "");
    this.changed("needs_you");
  }

  private onDecide(approvalId: string, allowed: boolean, decision: Extract<Call, { method: "decide" }>["params"]["decision"]): void {
    const item = this.snap.needs_you.find((n) => n.approval_id === approvalId);
    if (item) {
      item.state = allowed ? "allowed" : "denied";
      this.push(item.thread_id, "host", { kind: "approval_decided", approval_id: approvalId, decision, via: "web" });
      if (item.thread_id === ID.fix) this.setState(ID.fix, "working", "Running the checks");
    }
    this.changed("needs_you");
  }

  private changed(what: Parameters<NonNullable<HostListener["changed"]>>[0]): void {
    this.later(() => this.listener.changed?.(what), 0);
  }

  private later(fn: () => void, ms: number): void {
    this.timers.push(setTimeout(fn, ms));
  }
}

/** What the Fix checkout session changed, as the host's session_changes answers. */
const FIX_CHANGES = {
  files: [
    { path: "src/checkout/saved-card.ts", status: "modified" as const, added: 3, removed: 1 },
    { path: "src/checkout/saved-card.test.ts", status: "added" as const, added: 12, removed: 0 },
  ],
  diff: [
    "diff --git a/src/checkout/saved-card.ts b/src/checkout/saved-card.ts",
    "--- a/src/checkout/saved-card.ts",
    "+++ b/src/checkout/saved-card.ts",
    "@@ -14,7 +14,9 @@ export async function payWithSavedCard(card: SavedCard) {",
    "   const order = await currentOrder();",
    "-  return charge({ card: card.id, amount: order.total });",
    "+  // The payment service wants the card's ID as text, not a number.",
    "+  const cardId = String(card.id);",
    "+  return charge({ card: cardId, amount: order.total });",
    " }",
    "diff --git a/src/checkout/saved-card.test.ts b/src/checkout/saved-card.test.ts",
    "--- /dev/null",
    "+++ b/src/checkout/saved-card.test.ts",
    "@@ -0,0 +1,12 @@",
    '+import { payWithSavedCard } from "./saved-card";',
    "+",
    '+test("a saved card pays", async () => {',
    "+  const result = await payWithSavedCard({ id: 4242 });",
    '+  expect(result.ok).toBe(true);',
    "+});",
  ].join("\n"),
  truncated: false,
};
