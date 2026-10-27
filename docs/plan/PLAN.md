# Weilo 1.0: design and architecture plan

**Status:** draft v2. Nothing here is built yet.

This version folds in four independent reviews: architecture and performance, security, layman UX and developer experience, and feasibility. §19 lists what each review changed. The UI mock is the [Weilo 1.0 UI mock](https://claude.ai/artifact/5P63PzD8BABXgWRzTxwAkP) design canvas (private to the owner): desktop agent chat, desktop session, phone home, phone call and first run; per CLAUDE.md, no UI is built until the mock is approved.

There is **no backward compatibility**. This is a clean design. We keep the *ideas* that work today: the token gateway, sandboxed agents, approvals, Instant actions, pins, memory and the curator, the browser live view, and "Show how" teaching.

---

## 1. What we are building

An always-on employee powered by a frontier model:

- It has its own computer and can use yours.
- It files everything it does into channels.
- It runs on your computer or on a server.
- You control it from your phone, the web, the desktop, and by talking to it.

Goals, in order of weight:

1. **Layman first.** A first-time user has a working agent in two taps. Three words to learn, all in plain language.
2. **Safe by default.** Anything that sends, pays, posts, deletes or signs shows a card and waits for a yes. Content from outside cannot widen what an agent may do.
3. **Fast.** Budgets are in §7.6.
4. **Simple for developers.** We build on standards (ACP, MCP, MCP Apps, Standard Webhooks). Every plugin is "an MCP server plus one file". The UI can be built without Rust.
5. **Future-proof.** New engines, models, tools and devices plug in without touching the core.

### Requirements traced to this plan

| Ask | Where |
|---|---|
| Frontier model that never delegates to worse | §6.5 |
| Cloud and local sessions | §4, §5.2 |
| Real-time voice with tool use (Dots-level) | §8 |
| Codex-level computer use on local machines | §9 |
| Decks, docs and designs at Artifacts quality | §10.2 |
| Mobile UI like Duet | §11.4 |
| Inline mini apps in chat, email, Slack and more | §10 |
| Webhooks | §12 |
| Built-in social media | §13 |
| Plugins | §14 |
| Channels that organize themselves | §5.3 |
| Agents *and* sessions (as in monocode) | §5 |
| Connect to any harness | §6 |
| Run locally or on a VM | §4, §7 |
| VM browser stops getting blocked | §15 |
| Rust where it pays | §7.1 |
| openbot.run-style UI | §11 |
| No backward compatibility; best design | Throughout |

## 2. What we learned

- **openbot.run.** Built on Electron and SolidJS, not Rust. Layout: a page rail; a sidebar with Needs you, agents, channels and archived; a chat with parallel threads as tabs; a composer with a queue you can steer; and one side panel with tabs (Browser, Files, Tasks, Settings, Voice). It runs Codex app-server and the Claude Agent SDK natively, and any ACP agent. Routines run on a schedule or from a signed webhook. Weak spots: full access with no prompts by default, a heavy app, and concepts that keep changing. **We take its layout, not its churn.**
- **monocode** (Tauri and Rust). Sessions are tabs, each a chat with a CLI agent in a project, using worktrees. Persistent agents ("Monos") have memory and schedules. **pandacode** (Tauri 2, Rust, SQLite) puts every engine behind one Rust interface, and ACP engines share one module.
- **ACP v1** (Agent Client Protocol) is stable. About 40 engines speak it natively or through an adapter. It has no remote transport, no multiple viewers and no auth. The host must provide those.
- **Happy Coder.** A local supervisor, an outbound-only connection, and an end-to-end encrypted relay. Phones control computers that sit behind home routers.
- **Duet** (Claude). One ongoing conversation. The agent writes first, notifies only when needed, and shows an approval card before it sends, pays, signs or deletes.
- **Dots** (OpenAI). Always-on agents with their own cloud computer that you can call.
- **Grok Bot.** Draft cards (Send / Discard), secure forms, connector cards, its own email address, and webhooks on routines.
- **Browser blocks** come mainly from datacenter IPs, the `Runtime.enable` leak that automation tools add, mismatched fingerprints (software GPU, fonts, timezone versus IP), robotic input, and fresh profiles with no history.

## 3. Words

The words people learn come in three tiers.

| Tier | Words | Where they appear |
|---|---|---|
| **Everyone** (3 words + 1 inbox) | **Agents**, **Channels**, **Sessions**, plus **Needs you**. Sessions appear in the sidebar after the first one is started (by you or an agent), or with developer mode on. | Sidebar, home, mobile tabs |
| **Settings** | **Computers** (where work runs), **Connections** (Gmail, Slack, X, Notion…), **Routines** (work that starts by itself) | An agent's page and Settings |
| **Developers** | Engine (Claude Code, Codex, Gemini CLI…), worktree, MCP, ACP | A session's header, advanced settings, docs |

- **Agent:** a teammate who stays. It has a name, a face, instructions, memory, connections, routines, and the computers it may use.
- **Session:** one piece of work in a folder, done by a coding engine, for example "Fix the checkout bug in shop". A person starts one, or an agent starts one for them ("Ava is working on *Fix checkout* · Open"). Sessions end and can be resumed.
- **Channel:** a topic where related work lands (*Shop launch*, *Taxes 2026*). Channels are filed automatically (§5.3). They show with a plain icon; developers can turn on `#names`.
- Display words: queue → "**1 waiting**". Steer → "**Say now**". Browser and Computer → "**Screen**". Tasks → "**To-do**".

## 4. Where things run

```
 Phone (PWA → native) ─┐                                  ┌─ Agent's computer: a cloud VM, always on
 Web ──────────────────┼─► Relay + mailbox ◄──────────────┤    weilo-host (home) · agent desktop · browser
 Desktop (Tauri) ──────┘   E2E for live traffic           └─ Your laptop / PC: a worker
 Voice ── WebRTC ──────────► Voice service on home            weilo-host · sessions · computer use · Chrome extension
                           Bridges: Slack · email · Telegram · webhooks
```

- **`weilo-host`** is one install, the same on a laptop, a VM or a home server. **One install** means the Rust core, the bundled Node sidecar (§7.1) and Google Chrome, fetched at setup. The engine CLIs are added when first used. `weilo up` detects its environment: native, Docker or a headless VM.
- **Home and workers.** One host is **home**. It holds agents, memory, channels, routines, the scheduler and the mailbox. Other hosts are **workers**: they run sessions and computer use when home asks. The recommended home is a small always-on VM, where the agent's own computer lives. With no VM, home is the laptop (see Home offline below).
- **Clients talk only to home,** over the relay, or directly on the same network or Tailscale. They never talk to an engine.
- **Relay and mailbox.** Live traffic between devices and hosts is end-to-end encrypted, and the relay forwards ciphertext. The relay also stores some things, and we say so plainly:
  - push tokens;
  - webhook requests held while home is asleep (signature checked as they arrive, encrypted to home's key, kept for 24 h);
  - shared doc and deck links (encrypted; the key is in the link's `#fragment`, so the relay never sees the text);
  - **what it sees in transit:** webhook signing secrets and request bodies (it checks signatures as requests arrive), and bridge traffic (Slack, Telegram and email reach the relay in plain text before it encrypts them to home).

  So the relay is trusted for webhooks and bridges, and is end-to-end only for traffic between devices and hosts. A user who wants none of that runs webhooks and bridges directly on home, or self-hosts the relay. A self-hosted relay must provide all three. The hosted relay has an uptime target (99.9%).

### Home offline

- Clients keep a read-only copy of what they have seen (IndexedDB). They say "**Home is asleep since 14:02**" and still show history.
- Routines that were due during sleep follow a per-routine setting: **Run once when awake** (default) or **Skip**.
- Workers keep running the sessions they own. They log locally and sync on reconnect (§7.3).
- Approvals expire after **24 hours** by default; a routine or tool can set a shorter time. The agent is told "not approved (expired)".
- **Move home** (laptop to VM, or VM to VM) is one command, `weilo move`, or one button: export, import, re-pair.

### 24/7 on your laptop

The agent's **own VM does the always-on work**. The laptop is used when it is awake:

- Laptop jobs wait in a queue ("Will run when your Mac is awake").
- An optional **Allow at night while plugged in** keeps the laptop awake (macOS `caffeinate`/`pmset`, Windows wake timers). Wake-on-LAN works through another always-on device.
- The setup screen says it plainly: a Mac needs the Accessibility and Screen Recording permissions, which macOS can reset after an update. A locked or just-rebooted Mac with FileVault cannot be used until you log in.

## 5. Agents, sessions, channels

### 5.1 Agents

An agent has:

- a profile and instructions;
- memory;
- skills;
- connections;
- routines;
- a daily limit (default **$5 a day**, changed in one tap) and a cost forecast;
- approvals with Always allow;
- an **isolated** mode (sandbox only, no keys);
- a **Where it works** setting: *In the cloud* or *On this computer*. The laptop is a separate, per-app permission (§9).

Its conversations:

- One **main conversation**, Duet-style.
- **Threads** for separate jobs, shown as tabs, each filed to a channel.

It also:

- **Speaks first:** a morning brief, re-checks a few times a day, and a notification only when something needs you.
- **Starts and watches sessions** ("have Claude Code fix this"), as monocode's `/operator` does.
- **Works in shared channels:** several agents in a channel with one lead, delegating through `ask_agent`.

### 5.2 Sessions

- **Starting.** **New → Session**: folder or repo, computer and engine are prefilled; type the task. An agent can also start one.
- **Worktrees.** A **git worktree** per session when the folder is a repo, so sessions run side by side safely.
- **On screen.**
  - A session is a tab. On desktop you can split tabs into panes.
  - The side panel adds **Changes** (diff), **Terminal** and **Preview**.
  - The tab title is written by the agent in plain words.
- **Ending and resuming.** A session ends when idle. You resume it with ACP `session/resume`. Its log stays.
- **Hand-off.** You can open a session in the engine's own terminal app and come back. While it is there, the app's rules don't apply, and the app says so (§16).

### 5.3 Channels that file themselves

1. New work goes to **General**.
2. When two or more threads share a subject, the classifier makes a channel and says so in one line: "*Filed in Taxes 2026 · Move*".
3. A thread in a repo goes to the repo's channel.

Limits:

- At most one new channel a day is made automatically.
- Merges are suggested, never done silently.
- A move by you is kept as an example the classifier learns from.

A channel shows a self-updating digest (what was done), what is open (Needs you, Working, Waiting), its threads, sessions, files and pinned cards.

**Needs you** collects every approval, question, failed run and expired item across all channels.

## 6. Engines (harnesses)

### 6.1 ACP v1 is the only protocol inside

Every engine speaks ACP v1 to the host:

- `initialize`
- `session/new|load|resume|prompt|cancel`
- `session/update`
- `request_permission`
- `fs/*`
- `terminal/*`
- elicitation

Our extras (fork, worktree, cost, cards) go in `_meta` and a few `weilo/*` methods.

| Engine | Driver | Approvals bound? |
|---|---|---|
| Any ACP agent (Gemini, Cursor, OpenCode, Goose, Copilot, Droid, Kiro, Qwen…) | Generic ACP, from the ACP Registry | Per engine: see `bindsApprovals` |
| Claude Code | `claude-agent-acp` plus the Agent SDK's `canUseTool` routed to our cards, running in the Node sidecar (§7.1) | Yes |
| Codex | `codex app-server` mapped to ACP (keeps fork and approvals) | Yes, with `approval_policy=on-request` |
| pi | `pi-acp` / `pi --mode rpc` | Yes, through our tools |

- **Adding an engine** takes one engine manifest (`kind: "engine"`, §14) plus `weilo engine test <cmd>`, a conformance suite for ACP. The guide is "Add an engine in 10 minutes".
- **Testing without keys.** A built-in **echo engine** and a **replay engine** let the UI and tests run with no keys and no network.

### 6.2 One set of powers for every engine

The host serves its tools over MCP:

- through the ACP connection itself where the engine supports it;
- otherwise through **one shared local MCP endpoint**, with a token for each session.

The tools: `ask`, `show` (cards and mini apps), `memory`, `fetch_knowledge`, `browser`, `computer`, `routine`, `pin`, `key`, `ask_agent`, `notify` and `file_to_channel`.

### 6.3 Binding engines to our rules

What an engine says about its own permissions is advisory. The host enforces the limits:

- **Launch settings are pinned.**
  - Claude Code: bypass mode refused, every tool through `canUseTool`.
  - Codex: `on-request`, `workspace-write`, network off unless allowed.
  - Gemini: "yolo" refused.
- **Every engine runs in an OS sandbox**, with all outbound traffic through the host's proxy and its allowlist:
  - Linux: a container or gVisor;
  - macOS: Seatbelt;
  - Windows: AppContainer.

  A `curl` from an engine's shell meets the same rules as a tool.
- **Engines that cannot be bound** (`bindsApprovals: false`) get the sandbox only. They get no laptop, no `sends` tools and no Chrome extension.

### 6.4 Credentials

**No engine ever holds a real token.**

| Kind | How |
|---|---|
| API key (default) | Engine gets a stand-in. The host's gateway swaps in the real key per request (as today), through a base URL or `apiKeyHelper`. |
| Subscription plan (Claude, ChatGPT) | Only where the provider's terms allow third-party use. Each provider needs legal sign-off before release. Then it runs through the same gateway, which uses the official sign-in and keeps the token on home. If the engine insists on its own login file, it runs as unbound (§6.3). |
| Local models (Ollama, LM Studio) | Through the gateway; no secret. |

A worker without credentials reports "not signed in" through the engine's detect step.

### 6.5 Model policy: never delegates to worse

- **Task work** always runs on the agent's chosen model. The default is the best on the plan, for example Opus 5.5.
- **Sub-agents and helper calls inside engines are set to the same model:**
  - Claude Code's `ANTHROPIC_SMALL_FAST_MODEL` and sub-agent model;
  - Codex `model`.
  - For third-party ACP engines this is *best effort*: the session shows a warning when an engine uses another model.
- **Housekeeping may use a small model,** only where no judgment about the task is made:
  - channel classification;
  - titles;
  - speech-to-text, text-to-speech and the voice "mouth" (§8).

  Summaries and the curator use the agent's model unless you choose cheaper.
- **Fallback asks first.** It says if the data would go to another company: "Opus is busy. Use GPT-6 for this reply? (Sends this chat to OpenAI.)" You can also set a standing rule instead.

## 7. Inside `weilo-host`

### 7.1 Languages and processes

| Part | Language | Notes |
|---|---|---|
| Core: supervisor, event log, auth and pairing, relay link, ACP client, MCP hub, gateway (models, plugins, outbound proxy), scheduler, webhooks, memory search, file server, audit | **Rust** (tokio, axum, rusqlite, `agent-client-protocol` 2.x pinned, `rmcp`) | Always on. Low memory, no pauses. The core is one binary per platform; the full install is in §4. |
| Computer use (accessibility tree, input, screen) | **Rust**, macOS first, then Windows, then Linux (AX, UIA, AT-SPI; `xcap`, `enigo`) | Native APIs |
| **`weilo-node` sidecar** (bundled Node runtime, installed for you) | TypeScript | Hosts the Claude Agent SDK driver, the Patchright browser driver, and TS plugins. Node is a real dependency; we say so. |
| Plugins, built-in ones included (social, bridges, docs and decks, routines' Instant scripts) | Any language | **Every plugin is an out-of-process MCP server plus a manifest** (§14), run as its own OS user or in a sandbox |
| UI | **React 19 + Tailwind + TanStack Router/Query** | One codebase for web, desktop and PWA |
| Desktop | **Tauri 2**, embedding `weilo-host` and its updater | Small download |
| Mobile | **PWA first**, then **Expo / React Native** | Native push actions, Live Activities, CallKit voice and widgets. Shares the generated protocol TS. |

### 7.2 Event log

- SQLite in WAL mode: `events(thread_id, seq, at, kind, source, body)`, append-only. Bodies are ACP `session/update` payloads plus `weilo/*` events.
- **Projections** (thread list, channel digests, Needs you, usage, search) update **in the same transaction** as the append, and can be rebuilt from the log.
- Search uses FTS5. Trigram indexing covers only message text, not tool output, to keep the index small.
- **Two sources of truth, each for one thing:**
  - The engine's transcript decides **what the engine remembers**.
  - Our log decides **what people see**: display, search and channels.
  - After a hand-off or a fork outside the app, the host imports the difference with `session/load` (tagged `source: engine`) and marks any gaps.
  - A fork makes a new thread with a `parent_seq`.

### 7.3 Several hosts

- **The host that owns a thread is its only writer** and assigns its `seq`.
- Home keeps a replica, pulled with the same `subscribe(thread, after_seq)` that clients use.
- Clients subscribe only at home.

One mechanism serves clients and hosts alike.

### 7.4 Client protocol

One WebSocket per device:

- `hello{version}`
- `sub` / `unsub` (thread, after_seq) → `ev`
- `call{call_id, method, params}` → `ret` (idempotent by `call_id`)
- `presence`

**Answering approvals.** "First device to answer wins" is a compare-and-set on home. The approval shows "answered on iPhone" everywhere else.

**`proto/` is one source.** The protocol is defined as Rust types. JSON Schema and TS are generated from them (`schemars`, `specta`). Generated code is committed, so UI contributors need no Rust.

### 7.5 Upgrades

- Engines run under a small supervisor process that outlives a host restart, or are reattached with `session/resume`. An upgrade never kills a running session.
- Home and workers stay compatible one version apart (N and N−1). `hello` carries the version.
- Desktop updates through Tauri's updater; servers through `weilo update`.

### 7.6 Speed budget (p50 / p95)

| Path | Budget |
|---|---|
| App open (warm) / cold on a phone | 300 ms / 1 s. Last state cached on the device. |
| Sent message shows | 50 ms (shown before the host confirms) |
| Host event to screen | 100 ms on the same network / 250 ms over the relay |
| Approval round trip (host → phone tap → engine) | 500 ms plus your tap |
| Session start (spawn to first token) | 2 s / 4 s |
| Voice: first audio / first *meaningful* words | 400 ms / 1.5 s (§8) |
| 1,000 threads in the sidebar | 60 fps (virtualized lists, projections ready) |
| Idle host | Under 60 MB for the core. The sidecar and browser are stopped when idle. |

## 8. Real-time voice

Voice has two jobs: a fast **mouth** for speaking and a frontier **brain** for thinking. Only the brain thinks.

```
mic ─► WebRTC ─► Voice service (home host, LiveKit Agents)
   ├─ MOUTH: realtime speech model, used only to talk:
   │    turn-taking, "mm-hm", barge-in, reading the brain's words aloud
   │    one tool: brain(utterance). Rule: no answers, decisions or tool calls of its own
   ├─ BRAIN: the agent's own model (Opus 5.5), streaming, voice profile:
   │    short spoken style, trimmed prompt, cache kept warm during a call
   │    tools as usual; long work → "On it, I'll message you when it's done"
   └─ STRICT MODE (setting): plain cascade, no mouth model
        streaming STT → brain → streaming TTS
```

**Latency.** A cascade with Opus as the only model reaches first words in about 1.5–3 s, which does not feel "Dots-level". The mouth answers in about 300 ms and then speaks the brain's first sentence as it streams. We measure two numbers:

- time to first audio: p50 under 400 ms;
- time to first *meaningful* word, meaning Opus's words: p50 under 1.5 s.

**Barge-in.**
- Speaking over the agent stops it.
- The transcript is cut to what you actually heard.
- Tools keep running.

**Approvals by voice.**
- The agent reads the details back: "Email Mark: 'Running late, 10 min.' Say *send it* or *change it*."
- A spoken yes approves only reversible, low-risk actions.
- Sends and posts need a tap, or the one-time code shown on screen ("say *send 47*").
- Pay, delete and sign always need a tap.
- **Tools never run from a partial transcript.** They run only after your turn ends.

**The call bar.**
- *Mute · Stop talking · End*.
- Live captions.
- Each agent has its own voice.
- No wake word in 1.0.
- The mic light is always visible.

**What the mouth may do.**
- It speaks canned fillers ("mm-hm", "let me check") and the brain's text **word for word**. It never rewords, answers or calls tools.
- Your turn ends when the **voice service's own end-of-speech detector** says so, not when the mouth model decides.
- Its provider is named and agreed to at the first call ("Voice runs through OpenAI Realtime. Your audio goes to OpenAI."). In strict mode, only your own STT and TTS run.

**Providers.** STT, TTS and the mouth model are plug-ins. A future native Claude voice API slots in as the mouth.

**Phone number (later).** You can call in through SIP. An inbound call gets no approvals and no `sends` tools, because caller ID can be faked.

## 9. Computer use

| Where | How |
|---|---|
| **Agent's computer** (VM) | A Linux desktop with Chrome and any app. Driven by Claude's computer-use loop, plus the AT-SPI tree. Live view in the **Screen** tab. |
| **Your laptop** | The Rust module in `weilo-host` reads the **accessibility tree first**, takes screenshots second, and prefers an app's connection or API when there is one. macOS ships first, Windows next. |

**Laptop access per agent:** **Off** (default), **Ask for each app**, or **Allowed apps**. There is never "full access".

**The laptop enforces its own policy.** Home can't widen it:

- Each app is approved once, with Always allow.
- Approvals for laptop actions are signed by one of your devices and checked on the laptop.
- Terminals, password managers, System Settings and admin prompts are never allowed.
- **Before clicking Send, Pay, Post, Submit or Delete** (found from the accessibility role and label), the agent shows a card. So an allowed Mail app still can't send without a yes.
- A visible "**Ava is using your computer · Stop**" bar.
- Screenshots are cropped to the target window, and notifications are hidden.

## 10. Mini apps, documents, bridges

### 10.1 Cards and mini apps

- **Built-in cards** (one schema in `proto/`):
  - Draft (email, post or message, with Send / Edit / Discard)
  - Approval
  - Form (with secure fields)
  - Choice
  - Table
  - Chart
  - Tracker (today's pins)
  - File
  - Diff
  - Calendar slot
- **Mini apps** follow the **MCP Apps** standard (`ui://` resources). Plugins bring them, and agents make them on the fly.
- **Isolation.**
  - A mini app is served from a separate origin, without `allow-same-origin`, popups or network.
  - A tool call from a mini app goes through the same cards as one from the model.
  - **Approval and Draft cards are drawn only by the host,** outside any iframe, so a mini app can't fake one.

### 10.2 Docs, decks and designs at Artifacts quality

- **Source of truth:** HTML and CSS, with one curated design system.
- **The model:** the frontier model writes.
- **The check loop:** render, screenshot, then a critique by the same model. Explicit checks: overflow, contrast, density, alignment.
- **Exports:**
  - PDF and HTML first;
  - PPTX (PptxGenJS) and DOCX (docx.js) later, because their fidelity is the hard part.
- **Release gate:** an eval set of 30 reference prompts, scored side by side against Claude Artifacts.
- **Sharing:** links that are private by default, expire, can be revoked, and can require sign-in. The content is encrypted, with the key in the link's fragment.

### 10.3 Cards on other surfaces

| Surface | How |
|---|---|
| App (web, desktop, mobile) | Full card or mini app |
| Slack / Teams | Block Kit / Adaptive Cards from the same schema. A button works only when **the owner** clicks it. |
| Email | Summary plus links. **A link only opens a confirmation page and never acts when merely opened** (link scanners open every link). The action is a POST from that page, bound to a paired device or a passkey. Pay, delete, sign and post are never offered from email; they get "Open in app". |
| Telegram / Discord | Buttons for Approval and Choice (owner-checked); everything else as a link |
| Voice | Spoken summary; the card on screen if one is open |
| iOS lock screen | Live Activity for a running job; actionable notification for Approval |

### 10.4 Bridges

An agent is reachable from Slack, email (an address of its own) and Telegram; Discord and WhatsApp come later. A message there joins the same thread, and the reply goes back. **Bridge messages count as outside content (tainted, §16)** unless they come from your verified account.

## 11. UI

### 11.1 First run: two taps

1. **"Where should your agent work?"**
   - **On this computer** (the default in release 1). *No server cost. Pauses when this computer sleeps.*
   - **In your own cloud account.** *Works even when this computer is off. About 5 minutes, guided.* This becomes one tap if we host computers (§18.1).
2. **"Connect your AI."** Plan buttons (**Continue with Claude**, **Continue with ChatGPT**) appear only for providers whose terms legal review has cleared (§18.3). Otherwise the screen leads with a guided **Get an API key**, opened in the provider's own page, with the key pasted back. If a usable key or login is already on the computer: "**We found your Claude key. Use it?**"

That is two taps when a key is found, and one paste otherwise. Then:

**Done.** Ava is made and writes first: "*Hi, I'm Ava. What should I take off your plate this week?*" She offers three suggestions: *Plan my week* · *Tidy my inbox* · *Watch a website* (Gmail, Google Calendar and web connections ship in release 1).

Her name and face can be changed later. Connections are asked for only when needed ("To read your email, connect Gmail. [Connect]").

### 11.2 Desktop and web

```
┌────┬────────────────┬──────────────────────────────────────────┬──────────────┐
│Home│ Needs you  2   │ Shop launch › Fix checkout   [tab][tab][+]│ Screen│Files │
│    │ ───────────    │                                          │ To-do        │
│Rout│ Agents         │  messages · cards · mini apps            │ (session:    │
│    │  ● Ava  2 jobs │                                          │  Changes     │
│Conn│  ○ Ravi        │                                          │  Terminal    │
│    │ Channels       │                                          │  Preview)    │
│    │  General       │  ┌────────────────────────────────────┐  │              │
│Set │  Shop launch   │  │ Message Ava…        🎤  Send  1 waiting│              │
│    │ Sessions       │  └────────────────────────────────────┘  │              │
└────┴────────────────┴──────────────────────────────────────────┴──────────────┘
```

- **Rail (4):** Home · Routines · Connections · Settings. Usage and Computers are in Settings.
- **Sidebar:** Needs you · Agents (each with a live line, such as "2 jobs running") · Channels · Sessions (running first) · Archived.
- **Main:** threads and sessions as tabs; panes on desktop; **Say now** / **Send when done** (Enter / Alt+Enter).
- **Side panel**, closed by default:
  - for an agent: **Screen** (browser or computer, live), **Files**, **To-do** (routines and pins);
  - for a session: **Changes**, **Terminal**, **Preview** and **Files**.
- **Voice:** the mic in the composer starts a call. A call bar stays on top while you move around.
- **⌘K** opens a command palette for everything.
- **Style:** today's (Geist, Tailwind tokens, light and dark). We take openbot's layout, not its colors.

### 11.3 Empty and error states

Plain words, one line, and a button. Examples:

- "**Connect your AI account to start chatting.** [Connect]"
- "**Home is asleep since 14:02.** [Wake it]"

### 11.4 Mobile, Duet style

- **Home is the chat with your main agent.** "**2 need you**" sits on top as a stack of cards you can swipe.
- **Bottom bar:** **Chat · Channels · ● Talk · Agents · You**. Talk is the raised centre button: tap for a call, hold for a voice message.
- **Approval cards** have big buttons. They can be answered from a notification, with Face ID for sends.
- **Setup on iPhone** includes "**Add to Home Screen**". iOS sends web push only to installed web apps.
- **Notifications** have one setting with three choices: *Only when needed* (default) · *Also when done* · *Everything*.
- **Morning brief:** one notification that opens one card.
- **On iOS:** Live Activities and Dynamic Island for running jobs, and widgets for Needs you. These come with the native app.

## 12. Routines and webhooks

A routine is a **trigger** + **what to do** + **who and where**:

- **Triggers:** a time, a webhook, a connection event (email arrives, PR opened), a pin change.
- **What to do:** a prompt, or an Instant script that runs with no model and no tokens.
- **Who and where:** an agent and a channel.

Routines are written as sentences: "*Every weekday at 8:00 · Send me a brief*".

**Incoming webhooks:**

- One URL per routine, on the relay or directly on home.
- **Standard Webhooks:** HMAC-SHA256 with `webhook-id`, `webhook-timestamp` and `webhook-signature`, checked **at the relay as the request arrives** (5-minute window). Duplicates are dropped by `webhook-id`.
- Bearer mode is offered with a warning, for senders that can't sign.
- At most 1 MiB. The reply is `202 {run_id}`, sent right away.
- A request log with replay, **Send test event**, and a curl example.
- Filters on JSON paths decide which requests start a run.
- A webhook starts only its own routine, and the run is **tainted** (§16).

**Outgoing:** any routine can POST its result, signed the same way.

## 13. Social media

The real situation in 2026: APIs, costs and platform reviews decide what is possible. The app shows each platform's status plainly on a **Social** page.

| Platform | Release 1 | Notes |
|---|---|---|
| Bluesky, Mastodon | Yes | Open APIs |
| X | Yes, with your own developer key | Pay per use. A post costs about $0.015, and about $0.20 with a link. **The Draft card shows the cost**, and each agent has a cap. |
| LinkedIn (personal posts) | Yes | Company pages need review |
| Instagram, Facebook, Threads | After Meta app review | Business verification. Instagram needs a business or creator account. Reviews start in week 1. |
| TikTok | Upload-to-inbox drafts | Direct posting needs an audit of unknown length |
| YouTube | Yes (uploads, comments) | Quotas |
| Reddit | **Not available** | API access for AI use needs a contract. No browser workaround either. |

- **Posting is always a Draft card first.** The "auto-post my scheduled drafts" rule is per platform, rate-limited, and switched off for tainted threads.
- AI-content labels are added where a platform or the law requires them (EU AI Act, Art. 50).
- There is **no browser fallback** where a platform's terms forbid automation.
- A **Social inbox** mini app gathers mentions and DMs.
- Social connections run behind the plugin manifest, so an aggregator API (Ayrshare-style) can replace them.

## 14. Plugins: an MCP server plus one file

```jsonc
// weilo.json
{
  "apiVersion": 1,
  "kind": "connection",                       // or "engine", "bridge"
  "name": "linear",
  "title": "Linear",
  "description": "Issues and projects.",      // one line, ≤ 60 chars (linted)
  "mcp": { "url": "https://mcp.linear.app/sse" },   // or { "command": "npx", "args": [...] }
  "signIn": "oauth",
  "ui": ["ui://linear/issue-card"],
  "cards": ["issue"],
  "triggers": [{ "id": "issue.created", "webhook": true }],
  "permissions": { "network": ["api.linear.app"] }
}
```

- **One sentence for developers:** every plugin is an MCP server plus this file, in any language.
- **Runtime:**
  - Local plugins run out of process, as their own OS user or in a sandbox.
  - `network` is **enforced** by the host's proxy.
  - Remote plugins can't be enforced, and the install screen says so.
- **The host decides what counts as a send.**
  - Tools marked read-only by MCP annotations run without a card.
  - **A tool without that annotation counts as a send and gets a card.**
  - A plugin can't opt out.
  - **Curated annotations.** Weilo ships read and send annotations for built-in and marketplace connections, so most tools are classified correctly from day one.
  - **One card for a batch.** One card can approve a batch of related actions in a job ("Archive these 37 newsletters"). It lists the batch, so the person isn't approving blindly.
- **Supply chain:**
  - Plugins are pinned by hash, with Sigstore provenance in the marketplace.
  - **A change in a plugin's tools or descriptions asks again,** which blocks "rug pulls".
  - Engine plugins have a separate, louder approval.
- **Developer tools:**
  - `npx create-weilo-plugin`, and `--from-mcp <url>` to wrap an existing server;
  - a permission sheet generated in plain words.

## 15. A browser that doesn't get blocked

Layers in priority order. Each one ships on its own and is measured.

| # | Layer | Effort | Default |
|---|---|---|---|
| 1 | **Measure.** Classify every page load as ok, challenged or blocked, by the vendor's cookies, scripts and block pages. Settings shows the block rate by site and vendor. A nightly benchmark covers 40 real sites plus CreepJS, Sannysoft and Pixelscan. | 2–4 days | On |
| 2 | **Real Chrome, cleanly driven.** Google Chrome stable, installed on the machine at setup (it can't be shipped inside our image), on x86-64. Driven by **Patchright** in the sidecar, which removes the `Runtime.enable` and webdriver traces. Stays headful (it already is). | 2–4 days | On |
| 3 | **Your own Chrome.** A Chrome extension makes your real browser drivable, with your real IP, GPU, cookies and history. Used for signed-in and high-value sites, per site. **Read-only per site by default; submitting a form needs a card.** | 3–4 weeks | Offered at setup |
| 4 | **A consistent machine.** Timezone, locale and `Accept-Language` follow the exit IP. A 1920×1080 screen at real DPI, matching fonts, an audio device, a real GPU on GPU VMs. WebRTC forced through the proxy (`disable_non_proxied_udp`). DNS through the proxy. IPv6 off when the proxy is IPv4-only. | 1–2 weeks | On |
| 5 | **Persistent profiles** per agent, and per site if needed, outside the container. A profile's IP and fingerprint never rotate. | 1 week | On |
| 6 | **Your own proxy, sticky per site**, matched to the profile's country. Used after a block or for a list of strict sites. **Bring your own only.** We don't resell IPs. | 1 week | Off; opt-in |
| 7 | **Hand-off to you** for a CAPTCHA, 2FA or "press and hold": a notification, one tap opens Screen, you solve it, the agent goes on. **No CAPTCHA-solving services.** | 3 days | On |
| 8 | **Human-like input:** curved mouse paths, typing rhythm, scrolling before clicking. | 3–5 days | Off; opt-in per site |
| 9 | **Web Bot Auth:** requests signed per RFC 9421, and an application to Cloudflare's signed agents. The honest long-term route. Chosen per site, because signing and stealth are opposites. | 2 weeks | On where the site accepts it |

**Routing:**

1. Sites where you're signed in on your own Chrome go there.
2. Everything else uses the VM's Chrome with layers 2, 4 and 5.
3. On a block: your proxy (6), if set, then hand-off (7).

**Honesty line.** Layers 1–5, 7 and 9 make the agent's browser a consistent, real browser acting for you. Layers 6 and 8 exist to look less like automation. They are **off by default**, opt-in per site, carry a terms-of-service notice, and need legal review before release.

## 16. Security model

What we keep from today:

- device pairing;
- the token gateway (agents never see keys);
- sandboxed and isolated agents;
- approvals with Always allow;
- secure fields;
- the audit log.

What changes:

- **Taint tracking, scoped to a job.** Outside content (email, webhooks, web pages, social media, bridge messages, a tainted agent's answer) is read in a **child job**. Only the job's summary returns to the main conversation, marked as quoted data. The **job** is tainted, not the conversation, and taint ends when the job ends. A turn in the main conversation that read outside content directly is tainted until your next message. Taint passes through `ask_agent` and shared channels. A tainted job or turn loses:
  - laptop computer use and the Chrome extension;
  - Always allow rules and auto-post rules;
  - memory and skill writes without a card.

  The curator never files tainted content into memory without a card. A run started by a webhook or an email routine is a tainted job, so it can still read, sort, summarize and draft. What it can't do is send, post or act on the laptop without a card. A replay stays tainted.
- **Engines are bound** (§6.3) and hold no real tokens (§6.4). Hand-off to an engine's own terminal app leaves our rules, and the app says so.
- **The laptop trusts no host.** It has its own policy, approvals signed by your devices, short-lived tokens scoped to one session, and no brain secrets on workers.
- **Devices.**
  - In release 1 (the PWA), approvals are signed with **WebAuthn passkeys**, which use Face ID or a fingerprint. The native apps keep keys in the Secure Enclave or Keystore.
  - Pairing shows a safety number.
  - You can revoke any device from another device or from the host, and a recovery code is printed at setup.
  - Push notifications carry only an encrypted reference.
- **Relay.** It is honest about what it stores and sees (§4).
- **One table for approval strength.** Every section points here.

| Action class | App tap | Voice | Slack / Telegram | Email page | Laptop |
|---|---|---|---|---|---|
| Read / look | No card | No card | No card | — | Per-app permission |
| Reversible (save a draft, move a file, add an event) | One tap | Spoken "yes" after read-back | Owner's click | Confirm page + passkey | Card on a device |
| Send / post / submit | Tap + device key (passkey in release 1, Face ID in the native app) | One-time code shown on screen | Owner's click + open in app to confirm | Not offered ("Open in app") | Card signed by a device |
| Pay / delete / sign | Tap + device key, always | Not offered | Not offered | Not offered | Card signed by a device |

- **Approvals from anywhere** go through one CAS on home and record the device, the channel (tap, voice code, Slack, email page) and the time.
- **Audit:** hash-chained, and copied to a second host. It records engine tool calls, computer-use steps and who approved each action, from which device.
- **Money:** moving money always needs a tap plus Face ID, and can be switched off entirely.

## 17. Phases

**Realistic total:** 12–18 months for 1–3 developers working with AI. The first release comes much sooner.

### Release 1, "Always on" (about 12 weeks)

| Weeks | Ships |
|---|---|
| 1–2 | Monorepo (`crates/`, `apps/`, `plugins/`, `proto/`). `just dev` and a devcontainer. Generated code committed; echo and replay engines; CI with tests. Browser measurement (§15, layer 1). **Start platform reviews:** Meta, TikTok, LinkedIn, Cloudflare signed agents, legal on subscription plans. |
| 3–6 | `weilo-host`: event log, pairing, **the relay with E2E**, one WebSocket, the gateway, the sidecar. Engines: ACP, Claude, Codex, pi. Sessions with worktrees; Changes, Terminal and Preview. MCP hub. **Week 6: checkpoint** on parity with today's app; decide whether to continue or fix course. |
| 7–10 | Agents, memory, routines, auto-filed channels, Needs you, cards. New desktop and web layout and ⌘K. **Gmail, Google Calendar and web connections.** A curated design system for cards. Browser layers 2, 4, 5 and 7. Taint tracking. |
| 11–12 | Push and the mailbox. First run (§11.1). **Mobile PWA** with home chat, Needs you cards, push, passkey approvals and a voice-message button. Incoming webhooks. Installs on Linux and macOS (signed and notarized), plus a cloud VM. **Bring-your-own cloud computer**: a Hetzner, DigitalOcean or Fly token, or SSH; set up with cloud-init; **x86-64 machine types only**, because of Chrome. |

### After release 1

| Phase | Weeks | Ships |
|---|---|---|
| Talk | 5 | Live voice: mouth and brain, call bar, voice approvals. PWA and desktop. |
| Native mobile | 6–8 | Expo apps: push actions, Live Activities, CallKit voice, widgets |
| Your computer | 6 | macOS computer use; Chrome extension (browser layer 3); laptop policy. Windows after. |
| Reach | 6 | Slack bridge with Draft and Approval cards, email address per agent, Telegram; social (Bluesky, Mastodon, X, LinkedIn, YouTube), then Meta and TikTok as reviews pass |
| Make | 6 | Docs and decks with renderers, PDF and HTML exports and the eval gate; then PPTX and DOCX |
| Grow | 4 | Marketplace and plugin SDK; browser layers 6, 8 and 9; Tauri desktop builds for Windows |
| Hosted cloud | — | One-tap hosted computers. Only if decided (§18). |

**Cost controls in release 1:** a cost forecast per agent, a hard daily cap, and the VM and proxy costs shown in Usage.

## 18. Decisions for you

1. **Cloud computers.** Release 1 is bring-your-own (a provider token or SSH). Hosting them ourselves gives the best first run ("In the cloud", one tap) but means billing, abuse handling and support. *Recommendation: bring-your-own now; decide hosting after release 1.*
2. **Mobile.** PWA in release 1, then **Expo** for native. *Recommended over Tauri mobile, which is weak for background audio, Live Activities and push actions.*
3. **Subscription plans.** Using Claude or ChatGPT plans in an always-on third-party app depends on each provider's terms. *Recommendation: API keys by default; plans only where legal review confirms they are allowed.*
4. **Stealth layers 6 and 8.** *Recommendation: off by default, opt-in per site, after legal review.*
5. **License.** Open source (which license?) or source-available?

## 19. What the reviews changed

| Review | Changes |
|---|---|
| Final consistency pass | First run made honest: "On this computer" first, bring-your-own cloud, an API key unless plans are cleared. Taint scoped to a job, not the whole conversation. The relay's view of webhooks and bridges stated. The mouth speaks only fillers and the brain's words. One table for approval strength. Passkeys in the PWA. Curated annotations and batch cards. Relay moved to weeks 3–6 and the Slack bridge after release 1. "One install" defined. Defaults: $5 a day, 24 h approval expiry. |
| Architecture | The Claude SDK and Patchright need Node, so a `weilo-node` sidecar was added. Every plugin is an out-of-process MCP server. Home offline and Move home. Single writer per thread, replicated to home. Two sources of truth (engine transcript versus our log). Upgrades without killing sessions. `proto` defined in Rust with generated TS. One MCP endpoint, not one per session. Relay renamed "relay and mailbox" and made honest. CAS and `call_id` for approvals. Cut: StreamJson engines, MessagePack, Rust plugins in the host. |
| Security | Engines bound by the host (pinned modes, an OS sandbox, a proxy allowlist, `bindsApprovals`). No real tokens in engines. Taint tracking. A card before Send, Pay and Post clicks in computer use. The laptop trusts no host. Email links never act when opened. Owner-only bridge buttons. Voice approval codes, and no tools from partial transcripts. Hardened mini app iframes, with approval cards drawn only by the host. Unannotated tools count as sends. Plugins pinned by hash and asked again when their tools change. Hash-chained audit. Stealth off by default. |
| UX and developer experience | Three tiers of words. First run in two taps. Channels start in General and are made sparingly. Plain display words (Say now, 1 waiting, Screen, To-do). Rail of 4. Side panel closed by default. Mobile home is the chat with "2 need you". Notification setting. Voice read-back. Manifest v1 with `kind`. `just dev`, echo engine, `weilo engine test`, no Rust needed for UI work. |
| Feasibility | Release 1 in 12 weeks, with voice and native mobile after. Realistic 12–18 months in total. Week-6 checkpoint. Voice split into mouth and brain, with honest latency numbers. Social page based on real 2026 access (Reddit unavailable, X costs shown, reviews started in week 1). The laptop is opportunistic; the VM is always on. Browser: Chrome installed at setup on x86-64, WebRTC, DNS and IPv6 leaks closed, own Chrome moved up. Docs: HTML first, an eval gate, PPTX later. Cost caps. |
