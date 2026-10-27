# Weilo 1.0: design and architecture plan

Status: **draft for review** (nothing here is built yet). No backward compatibility is kept: this is a clean design. The UI mock is in [mock.html](mock.html); per CLAUDE.md, no UI is built until the mock is approved.

## 1. What we are building

An always-on employee powered by a frontier model. It has its own computer, can use yours, and files everything it does into channels. You run it on your own computer or on a VM, and you control it from mobile, web, desktop and real-time voice.

The goals in order of weight:

1. **Layman first.** A person who has never heard of a "harness" gets a working agent in two taps, and every screen reads in plain words.
2. **Fast.** The UI opens in under 300 ms. A sent message shows within 50 ms. The first spoken word in voice arrives in under 1 s.
3. **Simple for developers.** We build on standards (ACP, MCP, MCP Apps, Standard Webhooks) instead of inventing formats. One manifest describes every plugin.
4. **Future-proof.** New harnesses, models, tools and devices plug in without changes to the core.
5. **Safe by default.** Anything that sends, pays, posts, deletes or signs shows a card and waits for a yes.

### Requirements traced to this plan

| Ask | Where |
|---|---|
| Frontier model, never delegates to worse | §6.4 Model policy |
| Cloud and local sessions | §4 Computers, §6.2 |
| Real-time voice with tool use (Dots-level) | §8 |
| Computer use on local machines (Codex-level) | §9 |
| Decks, docs and designs at Artifacts quality | §10.2 |
| Mobile UI like Duet | §11.3 |
| Inline mini apps in chat, email, Slack, more | §10 |
| Webhooks | §12 |
| Built-in social media | §13 |
| Plugins | §14 |
| Channels that self-organize | §5.3 |
| Agents *and* sessions (monocode) | §5 |
| Connect to any harness | §6 |
| Run locally or on a VM | §4, §7 |
| VM browser stops getting blocked | §15 |
| Rust where it pays | §7.1 |
| openbot.run-style UI | §11 |

## 2. What we learned (research summary)

- **openbot.run** uses Electron and SolidJS, not Rust. Its layout is a left page rail, a sidebar ("Needs you", agents, channels, archived), the chat with parallel threads as tabs, a composer with a steerable queue, and one right side panel with tabs (Browser, Files, Tasks, Settings, Voice). It runs Codex app-server and the Claude Agent SDK natively and any ACP agent, with routines driven by a schedule or a signed webhook. It is weak on safety (full access with no prompts), heavy, and its concepts keep changing. **We take the layout and leave the churn.**
- **monocode** (Tauri plus Rust): *sessions* are tabs, each one chat with a CLI agent in a project, using worktrees. *Monos* are persistent agents with memory and schedules that work across projects. **pandacode** (Tauri 2, Rust, SQLite, plain TS): one `providers.rs` normalizes every harness, and ACP harnesses share `acp.rs`.
- **ACP v1** (Agent Client Protocol) is stable. The Rust and TS SDKs reached 1.0 in June 2026. About 40 harnesses speak it natively or through an adapter: Claude, Codex, Gemini, Cursor, OpenCode, Goose, Copilot, pi and others. It has no remote transport or multi-viewer support yet; the daemon supplies those.
- **Happy Coder pattern.** A local supervisor reaches an end-to-end encrypted relay over an outbound-only connection, and phones control machines behind NAT through it.
- **Duet** (Claude, Oct 2026): one ongoing conversation, the agent messages first, it notifies only when something needs you, and an approval card appears before sending, paying, signing or deleting.
- **Dots** (OpenAI): always-on agents, each with its own cloud computer, that you can call. Its voice internals are not public.
- **Grok Bot:** draft cards (Send / Discard), secure forms, interactive connector cards, its own email address, and webhooks per routine.
- **Browser blocks** come mainly from datacenter IPs, the CDP `Runtime.enable` leak, inconsistent fingerprints (SwiftShader, fonts, timezone versus IP), robotic input and cold profiles. No single fix works; layers do.

## 3. The words people see

Six nouns, used the same way everywhere. Nothing else is introduced to a layman.

| Word | What it is | Under the hood |
|---|---|---|
| **Agent** | A teammate who stays: name, face, instructions, memory, skills, apps, its own computer. | Profile plus long-lived threads. |
| **Session** | One piece of work with a coding tool in a folder: "fix the login bug in ~/shop". Starts, ends, can be resumed. | One harness process with an ACP session, often in a git worktree. |
| **Channel** | A topic where related work lands: `#shop-launch`, `#taxes-2026`. Made and filled automatically; you can rename, merge or pin. | A tag on threads, plus a summary. |
| **Computer** | Where work runs: *This computer*, *Agent's computer* (cloud), *My laptop*. | A host running `weilo-host`, registered with the relay. |
| **App** | Something agents can use: Gmail, Slack, X, Notion, GitHub. | A plugin: MCP server, OAuth, tools, mini apps, triggers. |
| **Automation** | Work that starts by itself: at a time, from a webhook, on an event. | A trigger plus a prompt plus a target thread. |

A harness is shown as the **"Engine"** only in a session's header and in advanced settings, for example "Claude Code · Opus 5.5". A layman never has to pick one; it defaults sensibly.

## 4. System topology

```
 Phone app ─┐                                         ┌─ Agent's computer (cloud VM)
 Web app ───┼──► Relay (E2E-encrypted, stateless) ◄───┤    weilo-host + agent desktop + browser
 Desktop ───┘          ▲          ▲                   └─ My laptop (local)
 Voice ───── WebRTC ───┘          │                        weilo-host + computer use + real Chrome
                                  │
                       Bridges: Slack, email, Telegram, Discord, webhooks (§10.4, §12)
```

- **`weilo-host`** is one binary, the same on a laptop, a VM or a home server. It owns sessions, agents, the event log, the harness adapters, the browser and tools on its machine.
- **One host is "home"** (the brain). It keeps agents, memory, channels and automations. The others are **workers**: they run sessions and computer use when home asks. Home is usually the always-on cloud VM. With no VM, home is the laptop, and work stops when the laptop sleeps (the app says so).
- **Clients never talk to a harness directly.** They talk to home, over the relay or directly on a LAN or Tailscale, using one protocol (§7.3).
- **The relay** sees only ciphertext. It forwards frames and wakes phones with push. Users can self-host it, or skip it on a LAN or Tailscale.

## 5. Agents, sessions and channels

### 5.1 Agents

An agent keeps what the current app has (profile, memory, skills, apps, isolated mode, daily limits, approvals) and adds:

- **Home computer.** The agent's own VM desktop and browser, and optionally permission to use *My laptop* (§9).
- **Brain.** The model and engine it thinks with. Default: the best frontier model on the user's plan, through the built-in engine (§6.3).
- **Threads.** An agent has one main conversation (Duet style, which is how the app works today) and can open **parallel threads** (openbot) for separate jobs. Each thread lands in a channel.
- **Proactive.** A morning brief, re-checks every few hours, and a message only when something needs you (§11.3).
- **Sessions.** An agent can start and watch sessions: "have Claude Code fix this", "run Codex on that repo". This is monocode's `/operator`.

### 5.2 Sessions

- Start from **New → Session**: pick a folder or repo, a computer and an engine (all prefilled), then type the task.
- Each session runs in its own **git worktree** when the folder is a repo, so sessions run in parallel safely.
- It shows as a **tab**. Tabs can split into panes on desktop. Its side panel adds **Changes** (diff), **Terminal** and **Preview**.
- It ends by itself when idle and can be **resumed** later (ACP `session/resume`). Its log stays forever.
- **Hand-off:** the same session can be opened in the harness's own terminal UI on that computer and back again. This works where the harness supports resume by ID.

### 5.3 Channels: self-organizing

- Every thread and session belongs to exactly one channel. New work is **filed automatically**: home asks a small classifier (§6.4: classification only, never task work) "which existing channel, or a new one?" using the title, the first message and the folder or repo. The user can move a thread with one tap, and the classifier learns from those moves (they are kept as examples).
- A channel shows **what was done** (a digest that updates itself), **what is open** (needs you, working, waiting), its threads, its files, and its pinned cards.
- **Needs you** sits at the top of the sidebar and gathers every approval, question and failed run from all channels.
- Channels can be **shared rooms**: several agents in `#launch` with one lead (openbot), delegating through `ask_agent`, which exists today.

## 6. Harnesses ("engines")

### 6.1 One protocol inside: ACP v1

Every engine speaks to `weilo-host` through ACP v1 (`initialize`, `session/new|load|resume|prompt|cancel`, `session/update` events, `request_permission`, `fs/*`, `terminal/*`, `elicitation`). The app's own extras (fork, worktree, cost, mini apps, voice hints) travel in `_meta` or `weilo/*` methods, kept small.

```rust
trait Engine {
    fn id(&self) -> &str;                          // "claude-code", "codex", "pi", "acp:gemini"
    async fn detect(&self, host: &Host) -> Detect; // installed? signed in? version?
    async fn start(&self, spec: SessionSpec) -> Box<dyn AcpConn>;
}
```

| Engine | How | Why |
|---|---|---|
| Any ACP agent (Gemini, Cursor, OpenCode, Goose, Copilot, Droid, Kiro, Qwen…) | `AcpEngine`, launched from the ACP Registry | About 40 engines with no code per engine |
| Claude Code | Native Agent SDK driver mapped to ACP; `claude-agent-acp` as fallback | Keeps hooks, subagents and `canUseTool` |
| Codex | `codex app-server` mapped to ACP; `codex-acp` as fallback | Keeps fork, approvals and sandbox detail |
| pi | `pi --mode rpc` mapped to ACP (or `pi-acp`) | Any provider and local models |
| Others (Amp…) | `StreamJsonEngine`: a normalizer with a small mapping file | The escape hatch |

Adding an engine means one manifest entry, and only the rare non-ACP engine needs a mapping file (§14).

### 6.2 What every engine gets from the host

- **App tools over MCP.** `weilo-host` runs one MCP server per session, passed in `session/new.mcpServers`. It offers `ask`, `show` (mini apps), `memory`, `fetch_knowledge`, `browser`, `computer`, `actions`, `pin`, `key`, `ask_agent`, `notify` and `file_to_channel`. Today these are pi extensions calling the daemon over HTTP; they become MCP tools, so **every engine has the same powers**.
- **Credentials through the gateway.** The model proxy of today (`gateway/models.mjs`) stays: engines get a stand-in key, and the host swaps in the real token. This works for any engine that accepts a base-URL override; for the ones that don't, the host hands over their own login.
- **Permissions.** ACP `request_permission` becomes an approval card on every device; the first device to answer wins.
- **Sandboxing.** The sandbox container of today becomes an option on every engine, not only pi.

### 6.3 The built-in engine

For agents (as opposed to sessions), the default engine is chosen from what the user has: **Claude Agent SDK** on a Claude plan or key, **Codex** on a ChatGPT plan, otherwise **pi** (any provider, OpenRouter, local models). All are driven through the same `Engine` trait. A user can switch an agent's brain to Claude Code or Codex to use a subscription plan. The agent's memory, tools and channels stay, because they live in the host and not in the engine.

### 6.4 Model policy: "never delegates to worse"

- **Task work** always runs on the agent's chosen model. The default is the best on the plan, for example Opus 5.5. Engine sub-agents inherit it: the host sets the subagent model (Claude's `--model` for subagents, Codex `model`) to the same model, and the session shows a warning if an engine overrides it.
- **Housekeeping** may use a small model, only where no judgment about the task is made: channel classification, titles, and speech-to-text (STT) or text-to-speech (TTS). The curator and chat summaries use the agent's own model by default, with a setting to make them cheaper.
- **Fallback.** If the model is down, the app **asks** before switching ("Opus is busy. Use GPT-6 for this reply?"), or follows a fallback rule the user set (openbot-style failover).

## 7. Inside `weilo-host`

### 7.1 Clean rewrite: Rust core, everything else is a plugin

There are no compatibility constraints, so we start fresh. We keep the *ideas* that work today (the token gateway, sandboxed agents, approvals, Instant actions, pins, memory and curator, OpenUI pages, the browser live view) and rebuild them on one clean core.

| Piece | Language | Why |
|---|---|---|
| `weilo-host` core: supervisor, event log, auth and pairing, relay link, ACP client, engine adapters, MCP hub, gateway (model and plugin token proxy), scheduler, webhooks, file server | **Rust** (tokio, axum, rusqlite, `agent-client-protocol`, `rmcp`) | Always on, many processes and streams. Needs low memory, no GC pauses, one static binary, and installs on macOS, Windows and Linux with or without Docker |
| Computer use (accessibility tree, input, screen) and browser driver | **Rust** (AX / UIA / AT-SPI, `xcap`, `enigo`, `chromiumoxide` over CDP with Patchright-style patches) | Native APIs, one process |
| **Built-in features are plugins** (memory, knowledge and curator, actions and pins, skills, social, bridges, docs and decks) | Rust where hot (memory search, scheduler), TypeScript where they change often, all through the **same plugin manifest** (§14) as third-party plugins | One extension path, tested daily by ourselves; a contributor can replace any built-in |
| UI | **React 19 + Tailwind + TanStack Router/Query**, one codebase | Fast enough with care; the largest ecosystem for mini apps (MCP Apps) |
| Desktop and mobile shells | **Tauri 2** (desktop embeds `weilo-host`; mobile is a thin client) | Small binaries and one Rust and web stack |

`weilo-host` runs in three modes from one binary: `weilo up` (local, native, no Docker), `weilo up --docker` (isolated container, as today), and `weilo up --vm` (headless, with the agent desktop and browser). Optional Docker or gVisor sandboxes per engine are a setting, not a different product.

### 7.2 Event log: one source of truth

- SQLite (WAL) per host: `events(thread_id, seq, at, kind, body)`, append-only. The bodies are ACP `session/update` payloads plus `weilo/*` events.
- **Projections** are computed from it: thread list, channel digests, Needs you, usage, search (FTS5 trigram, as `chats.mjs` does today).
- Clients **subscribe from a sequence number**: `subscribe(thread, after_seq)`. A reconnecting phone gets only what it missed. This replaces the per-agent SSE history snapshot.
- Engines keep their own transcripts (pi JSONL, Claude, Codex). The log is ours, so search, channels and replay never depend on an engine's format.

### 7.3 Client protocol

One WebSocket per device, carrying JSON frames (MessagePack later if profiling says so):

- `sub` / `unsub` (thread, after_seq) → `ev` frames
- `call` (method, params) → `ret`, for every action the UI takes, with typed methods generated from one schema
- `presence` (which device is looking, for push suppression and the "first to answer" approval rule)

The schema lives in `proto/` (JSON Schema). The TS types and Rust types are **generated** from it, so the UI and host never drift.

### 7.4 Speed budget

| Path | Budget | How |
|---|---|---|
| App shell paint | < 300 ms (warm), < 1 s (cold, phone) | Precompressed static files (today), code-splitting, a snapshot of the last state in IndexedDB |
| Send → shown | < 50 ms | Optimistic insert (today) |
| Event host → screen | < 100 ms on a LAN, < 250 ms over the relay | One socket, deltas only, only the newest message redrawn (today) |
| Voice first audio | < 1 s | §8 |
| Agent list with 1,000 threads | 60 fps | Virtualized lists, projections precomputed in SQLite |
| Idle host | < 60 MB RAM, ~0% CPU | Rust core; engines and browser stopped when idle (today) |

## 8. Real-time voice

Goal: talk to the agent hands-free on the phone, the desktop or the web. It hears you, can be interrupted, uses tools while you talk, and **thinks with the frontier model**.

```
mic ─► WebRTC ─► Voice service (on home host or a cloud voice worker)
                  ├─ VAD + semantic turn detector (local, CPU)
                  ├─ streaming STT (pluggable: Deepgram / Whisper-local / provider)
                  ├─ BRAIN = the agent's own model (Opus 5.5), streaming, prompt-cached
                  │     └─ tools run as usual; long ones go to background with "on it"
                  └─ streaming TTS (pluggable: Cartesia / ElevenLabs / local Supertonic-class)
```

- **Cascade, not speech-to-speech.** Speech-to-speech models are not the frontier model, and they finish fewer tasks (26–38% versus 85% under noise in one study). A cascade keeps Opus as the brain.
- **Latency tricks** (LiveKit-proven): a semantic turn detector with about 200 ms endpointing; preemptive generation, where the brain starts on the partial transcript and drops the result if the user keeps talking; TTS starting on the first sentence; and a prompt cache kept warm during a call. Expected first audio is about 0.8–1.2 s. A short spoken acknowledgement can be played immediately from canned audio, not from a model.
- **Barge-in:** speech cancels TTS at once, the transcript is trimmed to what was heard, and tool runs keep going.
- **Tools during voice:** the same tools. Approvals are spoken ("Send it?" "Yes") *and* shown as a card. Pay, delete and sign always need a tap.
- **Built on LiveKit Agents** (self-hostable, WebRTC, Rust and JS SDKs) or Pipecat. STT, TTS and the brain are plug-ins, so a future native Claude voice API slots in as one option.
- **On-device:** a local dictation and read-aloud fallback (openbot's Supertonic approach) for free offline use.
- **Phone call:** a later option, an inbound phone number through LiveKit SIP.

## 9. Computer use

| Where | How |
|---|---|
| **Agent's computer** (VM) | The current Xvnc + openbox + Chromium desktop, plus any Linux app. Driven by the screenshot and action loop of Claude's computer-use tool, with the AT-SPI tree where available. The live view is the noVNC we already have. |
| **My laptop** (local) | `weilo-host` computer-use module. **Accessibility tree first** (macOS AX, Windows UIA, Linux AT-SPI), screenshot second, as Codex does. Prefers an app's plugin or API when one exists. |

Safety:

- Each app must be allowed once ("Let your agent use Numbers?"), with **Always allow**.
- Terminals, password managers, system settings and admin prompts are never allowed.
- A visible "Agent is using your computer" bar with a Stop button.
- Screen captures that leave the machine are marked in the thread.

The laptop has three access levels per agent: **Off**, **Ask each app** (the default) and **Allowed apps**. There is no "full access" default.

On Windows, background use takes over the foreground, so we offer "use while I'm away" (a separate desktop session, later) and warn otherwise.

## 10. Mini apps and documents

### 10.1 Mini apps in the chat

Today the `show` tool renders OpenUI blocks and sandboxed HTML pages. We standardize on **MCP Apps** (`ui://` resources rendered in a sandboxed iframe with a postMessage bridge), so:

- Any plugin can bring its own mini app: a Figma card, a Linear issue, a flight picker.
- Agents can make one on the fly (the `show` tool emits an MCP Apps resource).
- **Built-in cards** cover the common ones: Draft (email, post or message with **Send / Edit / Discard**), Approval, Form (with secure fields), Choice, Table, Chart, Tracker (today's pins), File, Diff and Calendar slot.

### 10.2 Decks, docs and designs at "Artifacts quality"

- Typed outputs: **Doc**, **Deck**, **Design**, **Sheet** and **Page**. Each is a file in the channel with a live preview and an editor, and exports to PDF, DOCX, PPTX, PNG or HTML.
- Quality comes from **skills plus templates** (built-in design system, layout rules and the checks that render, screenshot and review before showing), not from a weaker model. The frontier model writes; the renderer is deterministic.
- Shared by link (through the relay; private by default) and editable in place by people and the agent.

### 10.3 Mini apps elsewhere

| Surface | Rendering |
|---|---|
| Web, desktop, mobile app | Full mini app |
| Slack / Teams | Block Kit / Adaptive Cards made from the same card schema (Draft, Approval, Choice and Form map 1:1) |
| Email | A short summary, plus buttons that are signed links to a hosted page (one tap, expiring, single use) |
| Telegram / Discord / WhatsApp | Inline keyboards for Approval and Choice; others as a link |
| Voice | Spoken summary, plus the card on the screen if one is open |
| Lock screen (iOS) | Live Activity for a running task; actionable notifications for Approval |

One **card schema** (in `proto/`) with renderers per surface. A plugin defines a card once.

### 10.4 Bridges

Agents are reachable from Slack, email (an address of the agent's own), Telegram, Discord and WhatsApp. A message there enters the same thread, and replies go back. Each bridge is a plugin with the `bridge` capability (§14).

## 11. UI

### 11.1 Desktop and web (openbot layout, simpler)

```
┌──┬──────────────┬───────────────────────────────────────┬──────────────┐
│R │ Needs you (2)│ #shop-launch › Fix checkout  [tabs +] │ Side panel   │
│a │ ─────────    │                                       │ Browser│Files│
│i │ Agents       │   messages, cards, mini apps          │ Changes│Term │
│l │  ● Ava       │                                       │ Computer│Voice│
│  │  ○ Ravi      │                                       │              │
│  │ Channels     │                                       │              │
│  │  # shop-...  │  ┌─────────────────────────────────┐  │              │
│  │  # taxes     │  │ Message Ava…   🎤  ⏎   queue(1) │  │              │
│  │ Sessions     │  └─────────────────────────────────┘  │              │
└──┴──────────────┴───────────────────────────────────────┴──────────────┘
```

- **Rail:** Home, Automations, Apps, Computers, Usage and Settings. That is six, and new pages go under More.
- **Sidebar:** Needs you, Agents, Channels and Sessions (running first), with Archived at the bottom.
- **Main:** threads as tabs, panes splittable on desktop, steerable queue (today's Enter versus Alt+Enter, plus Steer from openbot).
- **Side panel:** one button, tabs that depend on context. An agent thread gets Browser, Files, Actions & Pins and Computer; a session gets Changes, Terminal, Preview and Files.
- **Voice:** a mic button in the composer starts a call. A small call bar (waveform, Mute, Interrupt, End) stays on top while you navigate.
- **⌘K** opens a command palette for everything.

### 11.2 Visual style

Today's design: Geist, Tailwind tokens, light and dark. The openbot look is unverified (no screenshots), so we take its *layout*, not its colors.

### 11.3 Mobile: Duet style

- **Home is one feed:** what needs you first (cards with buttons), then what's happening, then recent channels. Tap into any channel or thread.
- **The talk button** sits at the bottom center, always. Hold to talk, or tap for a call. This is the main input.
- **Approval cards** have big buttons and a swipe to approve, and can be answered from notifications.
- **Live Activity / Dynamic Island** for running tasks, and **widgets** for Needs you.
- Push only when something needs you; the morning brief arrives as a notification.
- Bottom tabs: **Home · Channels · Agents · You**.

## 12. Webhooks and automations

- An automation is a **trigger** (schedule, webhook, app event such as a new email or a GitHub PR, or a pin change), plus **what to do** (a prompt or an Instant script, as today), plus **where** (an agent and a channel).
- **Webhook trigger:** a per-automation URL on the relay (`https://hooks.weilo…/h/<id>`) or on the host directly. It follows the **Standard Webhooks** spec: HMAC-SHA256 with `webhook-id`, `webhook-timestamp` and `webhook-signature`, and dedupe by `webhook-id`. A bearer-token mode is offered for senders that can't sign. It accepts at most 1 MiB, replies `202 {run_id}` at once, and keeps a request log with replay and a "Send test event" button that shows a curl example (openbot).
- Filters (a JSON path match) decide whether a request starts a run.
- **Outgoing webhooks:** any automation can POST its result, signed the same way.
- The relay holds requests while the home host is asleep and delivers them when it wakes, for up to 24 h.

## 13. Social media

Built-in apps through official APIs with OAuth. The tokens stay in the host (the agent never sees them, as with plugins today).

| Platform | API | Notes |
|---|---|---|
| X | X API v2 (user OAuth 2.0) | Paid tiers for volume; posting and reading the timeline |
| LinkedIn | Community Management / Share APIs | Posting needs app review |
| Instagram, Facebook, Threads | Meta Graph APIs | Business or creator accounts for Instagram |
| TikTok | Content Posting API | Audited apps only |
| YouTube | Data API v3 | Quotas |
| Reddit | Reddit API | Rate limits and terms on AI use |
| Bluesky | AT Protocol | Open |
| Mastodon | Mastodon API | Open |

- **Posting is always a Draft card** first (§10.1), unless the user allows a rule ("post my scheduled drafts").
- A **browser fallback** for platforms or actions without an API runs in **the user's own Chrome** (§15, layer 8), not the VM. This respects each platform's terms on automation, and the app warns where they forbid it.
- A **Social inbox** mini app gathers mentions and DMs across platforms.

## 14. Plugins: one manifest

```jsonc
// weilo.json — apiVersion 2
{
  "apiVersion": 2,
  "name": "linear",
  "title": "Linear",
  "description": "Issues and projects.",          // one short line
  "capabilities": {
    "mcp":      { "url": "https://mcp.linear.app/sse" },        // tools (MCP)
    "auth":     { "oauth": "mcp" },                              // sign-in handled by host
    "ui":       ["ui://linear/issue-card"],                      // mini apps (MCP Apps)
    "cards":    ["issue"],                                        // card schema for Slack/email
    "triggers": [{ "id": "issue.created", "webhook": true }],    // automations
    "bridge":   null,                                             // chat surface (Slack, Telegram…)
    "engine":   null                                              // a new harness
  },
  "permissions": { "network": ["api.linear.app"], "sends": ["comment"] }
}
```

- The **one manifest** covers tools, sign-in, mini apps, cards, triggers, bridges and engines. Built-in features use it too.
- `sends` lists actions that always show a Draft or Approval card.
- **Marketplace:** a signed index (a Git repo), installed with one tap, showing the permissions in plain words.
- **SDK:** `npx create-weilo-plugin`, with typed helpers generated from `proto/`.

## 15. Browser that doesn't get blocked

The target is to **measure first**, then cut blocks by layers. Each layer ships alone.

| # | Layer | Effort |
|---|---|---|
| 1 | **Measure:** classify every navigation as ok, challenged or blocked (by vendor cookies and scripts: `cf_clearance`, `datadome`, `_px`, `_abck`, or block pages). Settings > Browser shows the block rate. A nightly benchmark covers 40 real sites and CreepJS, Sannysoft and Pixelscan. | 2–4 days |
| 2 | **Patchright** (drop-in for playwright-core) to remove the `Runtime.enable` and webdriver leaks; **Google Chrome stable** instead of Chromium (codecs, client hints); stay headful (we are). | 1–3 days |
| 3 | **Consistent machine:** timezone and locale follow the exit IP; 1920×1080 screen; matching fonts; a PulseAudio dummy sink; drop `--disable-gpu`; and on VMs with a GPU, real WebGL, otherwise a consistent software profile. | 1–2 weeks |
| 4 | **Persistent profiles** per agent (and per site when needed), outside the container (cache already separated, #51). Never rotate a profile's IP or fingerprint. | 1 week |
| 5 | **Human-like input:** curved mouse paths, typing rhythm, scroll before click, reading pauses. | 3–5 days |
| 6 | **Residential / ISP proxy, sticky per site**, used *only* after a block or for sites on a strict list, with the country matched to the profile. Bring-your-own proxy, or a built-in option billed by GB. | 1 week |
| 7 | **Human handoff** for CAPTCHA, 2FA or a "press and hold" check: notification, then one tap opens the live view, you solve it, the agent continues. **No CAPTCHA-solver services** (terms of service and legal risk). | 3 days (live view exists) |
| 8 | **Your own Chrome:** a browser extension makes the user's real Chrome a target the agent can drive (real IP, GPU, cookies, history). Used for signed-in and high-value sites with per-site permission. Chrome 136+ ignores remote-debugging on the default profile, so it must be an extension. | 3–4 weeks |
| 9 | **Web Bot Auth:** sign requests (RFC 9421, Ed25519, key directory) and apply to Cloudflare's signed-agents list. This is the legitimate long-term path. Used per site, because signing and stealth are opposites. | 2 weeks |

**Routing rule:** a site where you're signed in on your own Chrome goes to *your Chrome*. Otherwise the agent's VM browser runs with layers 2–5. On a block it moves to layer 6, then 7.

## 16. Security model (what stays, what's new)

What stays:

- Pairing, per-device keys, the sandbox and isolated agents, the token gateway (agents never see keys), the audit log, approvals with Always allow, and secret fields.

What's new:

- **Relay:** devices pair with public keys (a QR code). Every frame is end-to-end encrypted (X25519 + XChaCha20-Poly1305; Noise IK). The relay sees only who-talks-to-whom and sizes.
- **Engines run as their own OS user** (as pi agents do today), in a worktree, with the host answering `fs/*` and `terminal/*` within the session's folders only.
- **The laptop computer-use** policy is in §9. The laptop host never accepts commands that don't come from a paired device or the home host.
- **Webhooks:** signature, timestamp window (5 min), dedupe and size limit. A webhook can only start the automation it belongs to, with the body marked as untrusted input.
- **Prompt injection:** text from webhooks, email, social and the web is wrapped as untrusted. Cards for every `sends` action. Money movement always needs a tap and a confirmation, and can be turned off entirely.

## 17. Phases

A clean rewrite in a new tree (`crates/`, `apps/`, `plugins/`, `proto/`). The current app keeps running until phase 2 reaches parity on chat, agents and the browser. Each phase ships something usable.

| Phase | Weeks | Ships |
|---|---|---|
| **0. Skeleton** | 2 | Monorepo; `proto/` schema with Rust and TS codegen; `weilo-host` with event log, pairing, one WebSocket; CI with tests from day one; block-rate measurement harness (§15, layer 1) |
| **1. Engines and sessions** | 4 | `Engine` trait: ACP, Claude, Codex, pi; sessions with worktrees; Changes, Terminal and Preview panels; MCP hub with built-in tools |
| **2. Agents and channels, new UI** | 5 | Agents (profile, memory, skills, approvals, gateway); auto-filed channels; Needs you; rail, sidebar, tabs, side panel, ⌘K; agent browser on Rust CDP with layers 2–5 and 7 |
| **3. Anywhere** | 4 | Relay plus E2E; native installs (macOS, Windows, Linux) plus Docker and VM modes; Tauri desktop; one-tap cloud computer |
| **4. Voice** | 4 | Cascade voice on web and desktop, call bar, spoken approvals |
| **5. Mobile** | 5 | iOS and Android: feed, talk button, push actions, Live Activities, widgets |
| **6. Laptop computer use** | 5 | AX / UIA / AT-SPI module; per-app permission; Chrome extension (browser layer 8) |
| **7. Automations, bridges, social** | 5 | Standard Webhooks; Slack, email, Telegram, Discord bridges with cards; social apps |
| **8. Docs, decks, designs; marketplace** | 6 | Typed outputs with renderers and exports; marketplace; plugin SDK |

## 18. Open questions for you

1. **Mobile shell:** Tauri 2 (one Rust and web codebase) or Expo/React Native (more proven for background audio, Live Activities and push actions)?
2. **Cloud computers:** should we host them (billing, support) or only bring-your-own (a provider token or SSH)?
3. **Proxies:** bring-your-own only, or a built-in residential option?
4. **License:** open source (which license?) or source-available?
