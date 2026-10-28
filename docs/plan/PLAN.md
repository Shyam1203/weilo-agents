# Weilo 1.0: design and architecture plan

**Status:** v10 (local first, bring your own engine). Approved at 9.5. The first build is in progress; see *Build 1* below for what it has and how it differs.

**Reviews behind it:** ten rounds of independent review.

- Round 1: architecture, security, UX, feasibility and consistency.
- Round 2: the owner's review and two UI critics.
- Rounds 3 to 10: the same four system judges (data, architecture, security, product) and two UI judges, re-scoring each version until every score reached 9.5.

§20 lists what each round changed.

**UI mock:** the [Weilo 1.0 UI mock](https://claude.ai/artifact/5P63PzD8BABXgWRzTxwAkP) design canvas (private to the owner). Per CLAUDE.md, no UI is built until the mock is approved.

**Build 1 (Oct 28): the first slice of release 1.**

- **In it:**
  - the Rust host with its own Postgres, the event log, approvals and Needs you;
  - engines over ACP: Claude Code, Codex, Gemini and pi;
  - #channels, chats and coding sessions;
  - pairing;
  - the desktop and phone web app;
  - binary releases and an install script.
- **Next, in order:**
  1. Phone access from outside the computer: same Wi-Fi first, then the relay.
  2. Talk v1 (§8).
  3. The engine sandbox (§6.3) and the gateway with stand-in keys (§6.4).
  4. MCP, the agent's browser, routines and connections.
- **Where it differs from this plan, for now:**
  - Claude Code and Codex use the person's own sign-in and config, not a Weilo-managed folder (§6.4).
  - API keys for pi are passed to the engine directly, because the gateway isn't built yet.
  - SECURITY.md says plainly that there is no sandbox yet.
  - On screen, "thread" reads **chat**.

**Owner decisions (Oct 28):**

- **Local first.** Release 1 runs on your own computer. A hosted cloud computer is a later phase (*Cloud*).
- **Bring your own engine.** Weilo drives the coding agent you already use (Claude Code, Codex, any ACP agent) with your own sign-in. **pi is the built-in default** when you have none.

**Compatibility:** none is kept; this is a clean design. We keep the *ideas* that work today: the token gateway, sandboxed agents, approvals, Instant actions, pins, memory and the curator, the browser live view, and "Show how" teaching.

---

## 1. What we are building

An always-on employee powered by a frontier model:

- It has its own computer and can use yours.
- It files everything it does into channels.
- It runs on your computer or on a server.
- You control it from your phone, the web, the desktop, and above all by talking to it.

**The wedge.** One always-on employee that:

- you can **call**;
- **safely** uses your computer and its own;
- files everything into **#channels**;
- runs **any coding engine**;
- keeps **your data in your own Postgres**.

No competitor has all five. Dots and Duet are closed and cloud-only. openbot and Buzz have no safety model and no real phone app.

**What release 1 delivers of the wedge:**

- the call;
- #channels;
- any engine;
- your own Postgres;
- the agent's own browser, on your computer.

Using your desktop apps arrives in the *Your computer* track, about 6 weeks later. A cloud computer that stays on when yours sleeps arrives in *Cloud* (§18).

Goals, in order of weight:

1. **Calm and layman-first.** A first-time user has a working agent in two taps. The screen shows only what they need to get what they want (§11.0). Three words to learn.
2. **Safe by default.** Anything that sends, pays, posts, deletes or signs shows a card and waits for a yes. Outside content cannot widen what an agent may do.
3. **Fast.** Budgets are in §7.8.
4. **Simple for developers.** We build on standards: ACP, MCP, MCP Apps, Standard Webhooks. The host runs only two kinds of child process: engines (ACP) and plugins (MCP). Every extension is "a process plus one file". The UI can be built without Rust.
5. **Future-proof.** New engines, models, voices, tools, surfaces and devices plug in through a manifest, not core changes.

### 1.1 Who it is for, and how we'll know it works

**Release 1 target:** a non-technical solo operator or founder who runs a small business or project from a laptop and a phone. The beta is 50 invited users.

**North star:** weekly active users who approve at least 3 agent actions a week.

**Release 1 targets:**

| Measure | Target |
|---|---|
| First approved action on day 1 | ≥ 60% |
| Still active in week 4 | ≥ 40% |
| Calls per active user per week | ≥ 2 |
| Approvals later overturned, plus "Did this send?" cases | < 1% |
| Share of approvals made on a phone | ≥ 50% (proves the phone matters) |

**Kill or pivot signal:** at the week-4 beta review the owner decides. If fewer than 20% are still active, release 1 is re-scoped around the single most-used flow.

### Requirements, and when each lands

| Ask | Where | Release |
|---|---|---|
| Frontier model that never delegates to worse | §6.5 | 1 |
| Coding sessions on your computer | §5.2 | 1; on a second computer at the same time in *Your computer*; in the cloud in *Cloud* |
| Real-time voice with tool use (Dots-level) | §8 | **1** (Talk v1); voice codes and phone calls in *Talk+* |
| Codex-level computer use on your computer | §9 | *Your computer* (eval-gated) |
| Its own computer | §4, §9 | 1: its own browser and Screen on your computer; its own cloud computer in *Cloud* |
| Always on | §4 | 1 while your computer is awake (with *Keep awake while plugged in*); around the clock in *Cloud* |
| Decks, docs and designs at Artifacts quality | §10.2 | *Make* (eval-gated) |
| Mobile UI like Duet | §11.4 | 1 (PWA); native in *Native* |
| Inline mini apps in chat, email, Slack and more | §10 | 1 (cards and MCP Apps in the app); Slack and email in *Reach* |
| Webhooks | §12 | 1 |
| Built-in social media | §13 | *Reach* (Bluesky, Mastodon, X, LinkedIn, YouTube); Meta and TikTok after review |
| Plugins | §14 | 1 (manifest); marketplace in *Grow* |
| Channels that organize themselves | §5.3 | 1 (interview + rules); classifier in *Make* |
| Agents *and* sessions (monocode) | §5 | 1 |
| Connect to any harness | §6 | 1: pi (default), Claude Code, Codex and any ACP agent, each with your own sign-in |
| Run locally or on a VM | §4, §7 | 1 locally (macOS, Linux); your own server with the same install (advanced); hosted in *Cloud*; Windows in *Grow* |
| Agent browser stops getting blocked | §15 | 1 (layers 1, 2, 7). Running locally gives the browser your home IP, which removes the main cause of blocks; more layers per §15 |
| Postgres as the source of truth | §7.3 | 1 |
| Rust where it pays | §7.1 | 1 |
| openbot-style UI, Buzz and Rakazo ideas | §2, §11 | 1 |

## 2. What we learned

- **openbot.run** (Electron and SolidJS). Layout: a page rail, a sidebar (Needs you, agents, channels, archived), a chat with thread tabs, a steerable queue, and one side panel with tabs. Multi-harness. Routines start on a schedule or from a signed webhook. Weak spots: full access by default, a dense and heavy app, and concepts that keep changing.
- **monocode and pandacode** (Tauri and Rust). Sessions are tabs, each a CLI agent in a project with worktrees. Persistent agents have memory and schedules. One Rust interface covers every engine.
- **ACP v1** is stable, and about 40 engines speak it. It has no remote transport and no support for several viewers; the host provides both.
- **Happy Coder.** A local supervisor, an outbound-only connection, and an E2E relay so phones reach computers behind home routers.
- **Duet** (Claude). One ongoing conversation. The agent writes first, notifies only when needed, and shows approval cards. **Dots** (OpenAI): always-on agents with a cloud computer that you can call. **Grok Bot:** draft cards, secure forms, its own email address, webhooks.
- **Rakazo.** Postgres is the only store, with:
  - an `events(thread_id, seq)` log;
  - NOTIFY as a doorbell;
  - a job queue (Graphile Worker);
  - row-level security per space.

  Its desktop app needs Docker, which we avoid.
- **Buzz** (Block). People and agents are equal members of channels. Every event is signed and stored in Postgres. Setup is an interview that makes channels. Agents have a Stop button and seen-marks. Weak spots: crypto keys in setup, no mobile, slow, and agent chatter that feels like noise.
- **GPUI** (Zed). Fast, but pre-1.0. No web or mobile target, weak webview embedding (macOS and Windows only, drawn over the window), and unproven with screen readers. Our product is mostly web content, so **we keep one React codebase**.
- **Browser blocks** come mainly from datacenter IPs, the `Runtime.enable` leak, mismatched fingerprints, robotic input and fresh profiles.

## 3. Words

| Tier | Words | Where they appear |
|---|---|---|
| **Everyone** | **Agents**, **Channels**, **Sessions**, and the inbox **Needs you**. Sessions appear after the first one is started, or with developer mode on. | Sidebar, home, phone tabs |
| **Settings** | **Computers** (where work runs: "This computer", "Your MacBook"; "Ava's cloud computer" from *Cloud*), **Connections**, **Routines** | An agent's page, Settings |
| **Developers** | engine, worktree, MCP, ACP, home host | A session's header chip, advanced settings, docs |

- **Agent:** a teammate who stays. The word is always "agent", never "assistant".
- **Session:** one piece of work in a folder, done by a coding engine. A person starts one, or an agent does ("I started a session to fix the checkout bug").
- **Channel:** always `#name`, in lowercase with one or two words joined by hyphens: `#general`, `#shop-launch`, `#trip`.
- **Icons:** a face means an agent, `#` means a place, and a square code icon means a session.
- **"Your Weilo computer"** is the plain-words name for the home host ("Your Weilo computer is asleep"). The rail page is still **Home**.
- **Display words** (the same on every screen):
  - **Next up**: the queued message.
  - **Tell now** / **After this job**: the split send button while an agent works, and **Send** when it is free.
  - **Needs you** is also the status word for anything waiting on you (a session, a card). Never "waiting for your OK" or "waiting for you".
  - **Always allow in this folder / for this agent / for this site**: always name the scope, never "here".
  - An agent's live line says what it is doing ("Checking the shop page"), never a count of jobs.
  - **Talk to Ava**: a call. The mic in the message box records a voice message. On phones, tap Talk for a call and hold it for a voice message.
  - **Screen**: the live view, with **Let me drive** and **Teach Ava this**.
  - **To-do**: pins and routines.
  - **Stop Ava**: interrupts while she speaks.
  - Buttons use the real verb (**Schedule**, **Move**, **Allow**, **Post**); keyboard hints say "approve".
- **Risk line on every card**, in one place and one style:
  - "Changes nothing"
  - "Can undo"
  - "Can't unsend after Fri 9:00"
  - "Costs about $0.20 · $1.10 of $5 used today"
  - Risk and cost may share one line, risk first: "Changes nothing · about $0.05".

## 4. Where things run

```
 Phone (PWA → native) ─┐                                   ┌─ Your Weilo computer (home): this computer (cloud in *Cloud*)
 Web ──────────────────┼─► Relay: forwarder, TURN, push, ◄──┤    weilo-host · Postgres · engines · plugins · Chrome
 Desktop (Tauri) ──────┘   24 h encrypted mailbox           └─ (later) workers: other laptops for sessions and computer use
 Voice ── WebRTC (TURN via relay) ──► voice orchestrator on home
```

- **`weilo-host`** is one install, the same on a laptop, a VM or a home server. One install means:
  - the Rust core;
  - an embedded Postgres;
  - Google Chrome, fetched at setup.

  Engine CLIs and plugin runtimes are added the first time they are used. `weilo up` detects the environment: native, Docker or a headless VM.
- **Release 1 runs a single host.** Workers (sessions and computer use on another machine) come in *Your computer* (§7.4).
- **Clients talk only to home,** through the relay or directly on the same network or Tailscale.
- **The web app is served from a per-home subdomain** (`<id>.home.weilo.app`).
  - Its TLS certificate is held only by home (ACME on home).
  - Certificates come from ACME **DNS-01**: home writes a TXT record through a relay API scoped to its own name and signed with its host key.
  - A **CAA record with `accounturi`** (RFC 8657) pins issuance to home's own ACME account.
  - Home **watches Certificate Transparency logs** for its name. Any certificate it didn't request lands in Needs you on every device.
  - The relay passes TLS through by SNI and never holds a certificate for it, so it can't serve its own code.
  - Link-only confirmation pages (§10.3) are served the same way.
  - Desktop and native apps carry a signed, pinned bundle.
- **Where it runs.** In release 1, home is **your own computer**. People who want it always on can run the same install on their own server (advanced, documented, not one-click). A hosted, always-on computer comes in *Cloud*.
- **On the same Wi-Fi**, devices talk to home directly.
  - The app uses `<id>.lan.home.weilo.app`. Home publishes that name with its LAN IP through the scoped DNS API, under the same certificate.
  - If the direct connection fails within 1 s, the app uses the relay.
  - First run handles the browser's local-network prompt.
  - Routers that block private-IP DNS answers simply fall back to the relay.

### The relay, honestly

- Live traffic between devices and home is end to end encrypted (Noise IK). The relay forwards ciphertext.
- It also provides **TURN** for voice and for home behind NAT, **push** (only an encrypted reference), and a **24 h mailbox**.
- **What it sees:**
  - webhook requests and bridge traffic (Slack, Telegram, email) arrive in plain text;
  - **the relay never holds signing secrets**, so it can't forge a webhook or an owner's click;
  - it checks only size and rate, stamps each request with a **signed receive time**, and forwards the original bytes;
  - bridge messages are tainted even when they claim to be from the owner;
  - Settings has "Run webhooks and bridges directly on your Weilo computer" for people who want no relay in that path.
- A self-hosted relay must provide all of the above.
- **Health:**
  - The relay has `/health` and records home's last heartbeat.
  - Clients show "**Can't reach Weilo right now**" when the relay is down.
  - They show "**Your Weilo computer is asleep since 14:02**" only when the relay is up and home is silent.

### When home is offline

- Clients keep a read-only copy of what they have seen (IndexedDB) and show history.
- Routines due during sleep follow a per-routine setting: **Run once when awake** (default) or **Skip**. Each scheduled slot fires once, at most (§7.3).
- Approvals expire after **24 h** by default. The agent is told "not approved (expired)", and Needs you shows it under **Expired** with **Ask again**.
- **Move to another computer** (between your computers; to a hosted one from *Cloud*) is one button, or `weilo move`. It exports, imports, re-pairs, and **fences the old home** (§7.4), so two homes never write.

### 24/7 on your laptop

In release 1, home is your computer, and it pauses when the computer sleeps. The first run says so plainly.

- **Keep awake while plugged in** is offered at setup and is on by default for desktops (`caffeinate`/`pmset`, systemd inhibit).
- Phones still show history, and webhooks wait in the relay's mailbox for up to 24 h.
- From *Cloud*, a hosted computer can take over while yours sleeps. Laptop jobs then wait in a queue ("Will run when your Mac is awake").
- Setup says plainly that macOS Accessibility and Screen Recording permissions can reset after updates, and that a locked or just-rebooted Mac with FileVault can't be used until you log in.

## 5. Agents, sessions, channels

### 5.1 Agents

An agent has:

- profile and instructions;
- memory;
- skills;
- connections;
- routines;
- a **daily limit** (default $5, changed in one tap) and a cost forecast;
- approvals with Always allow;
- an isolated mode;
- **Where it works**: this computer (its own browser there) and, if you allow it, your desktop apps, per app (§9). Its own cloud computer comes in *Cloud*.

Its conversations:

- One **main conversation**, Duet-style.
- **Threads** as tabs, each in a channel.

What it does:

- It **speaks first:** a morning brief, re-checks, and a notification only when something needs you.
- It **starts and watches sessions.**
- It **works in shared channels** with one lead.
- **Stop** is on every working agent: in the sidebar row's ⋯, and as **Stop Ava** in the message box's hint while she works.
- A seen-mark shows it picked up your message.

**First run** makes **Ava only**. A Researcher and a Writer are offered as one-tap suggestions, not created for you.

### 5.2 Sessions

- **Starting.** **New → Session**: folder or repo, computer and engine are prefilled. Or an agent starts one.
- **Worktrees.** One git worktree per session, beside the repo in `<repo>/../.weilo-worktrees/` (never inside `~/.weilo-agents/`, which sandboxes can't read).
- **Panels.** **Changes**, **Terminal** and **Preview**. Preview comes after release 1.
- **Header.**
  - The session name, then a subtitle: "Started by Ava in #shop-launch · Your MacBook".
  - On the right, the status ("**Needs you**" or "Working"), **Ask Ava** and **Stop**.
  - The branch and engine appear in the Changes panel, not the header.
- **Keys.** ⌘. stops the session.
- **Cost.** Shown in dollars, not tokens.
- **Every session start is an alert in Needs you** ("Ava started a session: Fix checkout"), even when Sessions is hidden.
- **Ending and resuming.** A session ends when idle and resumes with ACP `session/resume`. Its log stays.
- **Hand-off.** "Open in terminal" warns: "*Weilo's safety rules pause while the session is open in a terminal.*" On a computer that holds home's database, it needs a confirm card (§16).

### 5.3 Channels that file themselves

1. **At setup**, Ava interviews you in a few questions and makes one channel per project you name (from Buzz).
2. New work that matches no channel goes to **#general**.
3. A thread in a repo goes to the repo's channel.
4. **In release 1** a simple rule files work: the project names from the interview, matched in the title and first message. A move you make teaches the rule. From *Make*, a classifier also proposes new channels when two or more threads share a subject ("*Filed in #taxes-2026 · Move*"), at most one a day. Merges are suggested, never done silently.

A channel's **Overview** tab shows:

- the digest of what was done;
- what is open (Needs you, Working, Waiting);
- threads, sessions, files and pins.

## 6. Engines (harnesses)

### 6.1 ACP v1 inside

Every engine speaks ACP v1 to the host. Our extras go in `_meta` and a few `weilo/*` methods.

| Engine | Driver | Release |
|---|---|---|
| Any ACP agent (Gemini, Cursor, OpenCode, Goose, Copilot, Droid, Kiro, Qwen…) | Generic ACP, from the ACP Registry | 1 |
| Claude Code | `claude-agent-acp`, a Node process like any other engine. Permissions arrive as ACP `request_permission`. | 1 |
| Codex | `codex app-server` mapped to ACP, keeping fork and approvals | 1 |
| **pi (default)** | `pi-acp`, bundled. Used when you have no other engine. | 1 |

**An engine is "a process plus one file":**

```jsonc
{ "apiVersion": 1, "kind": "engine", "name": "claude-code", "title": "Claude Code",
  "install": { "npm": "@zed-industries/claude-agent-acp", "lockfile": "engines/claude-code/package-lock.json" },
  "command": ["{install}/node_modules/.bin/claude-agent-acp"],
  "launch": { "deny": ["--dangerously-skip-permissions"], "env": { "CLAUDE_CODE_DISABLE_BYPASS": "1" } },
  "model":  { "env": { "ANTHROPIC_MODEL": "{model}", "ANTHROPIC_SMALL_FAST_MODEL": "{model}" } },
  "gateway":{ "env": { "ANTHROPIC_BASE_URL": "{gateway}", "ANTHROPIC_API_KEY": "{standin}" } },
  "sandbox":{ "profile": "engine-default" },
  "bindsApprovals": true }
```

Adding an engine means writing that file and passing `weilo engine test`, the ACP conformance suite. The guide is "Add an engine in 10 minutes".

**Testing without keys.** The **echo** and **replay** engines run the UI and tests with no keys and no network.

### 6.2 One set of powers for every engine

The host serves its tools over MCP, through the ACP connection where the engine supports it, otherwise through one local MCP endpoint with a token per session. The tools:

- `ask`
- `show` (cards and MCP Apps)
- `memory`
- `fetch_knowledge`
- `browser`
- `computer`
- `routine`
- `pin`
- `key`
- `ask_agent`
- `notify`
- `file_to_channel`

### 6.3 Binding engines to our rules

What an engine says about its own permissions is advisory; the host enforces.

- **Pinned launch settings** from the manifest.
- **An OS sandbox for every engine:**
  - Linux: a container or gVisor;
  - macOS: Seatbelt;
  - Windows: AppContainer.

  macOS `sandbox-exec` is deprecated by Apple. We track this risk; the fallback is a per-engine macOS user plus an Endpoint Security check.

  The sandbox **denies reading and writing `~/.weilo-agents/`** (§16), and all outbound traffic goes through the host's proxy allowlist.
- **Engine web access.** An engine's own web and fetch tools go through the host proxy; outside content they fetch **taints the session from then on**. A clean session needs a new engine context (§16).
- **Protected files.** The sandbox denies writes to `.git/hooks`, `.git/config`, `.envrc`, `.vscode/`, `.claude/`, `.husky/`, package-manager script hooks and `.github/workflows` unless a card allows it. Before "Open in terminal", changes to those files are listed.
- **Unbound engines** (`bindsApprovals: false`) get the sandbox only: no laptop, no `sends` tools, no Chrome extension.

### 6.4 Credentials: bring your own

You bring the engine and its sign-in. Weilo never resells model access and never sees your bill.

| How you connect | How it works |
|---|---|
| **Weilo's built-in AI (pi)** with an API key, or a plan sign-in **only for providers whose terms allow third-party apps** (cleared by legal review per provider in weeks 1–2) | The gateway keeps the real token and swaps it into each request, as the app does today. pi only ever holds a stand-in. A Claude plan runs through Claude Code, Anthropic's own client; pi with Claude uses an API key unless review clears more. |
| **Claude Code or Codex** with your own sign-in | **A Weilo-managed config folder** (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). You sign in once **inside that folder** (Weilo opens the engine's own login), so Weilo has its own sign-in and never copies or refreshes yours. If the provider allows only one sign-in, Weilo reads your current token at session start and never refreshes it. Your own settings, hooks and MCP servers are **never loaded** (`--strict-mcp-config`; Weilo's MCP only), and neither are a repo's project settings (`--setting-sources` limited to Weilo's). Commands the engine runs (shell, scripts, tests) run in a **child sandbox that can't read the sign-in**. The proxy blocks any request carrying the token to a host other than the provider's. The session is labelled "Uses your Claude sign-in". |
| Any engine with an API key | Stand-in plus gateway swap, as for pi |
| Local models (Ollama, LM Studio) | Through the gateway; no secret |

- Each provider's terms apply to you, as when you use the tool directly. Weilo runs the engine in its documented programmatic mode, on your own computer.
- **Limits:** for API keys, the daily cap is in dollars. For plan sign-ins, Usage shows the plan's own limit window ("68% of this 5-hour window").

**One exception: the browser's signed-in profiles.** Their cookies stay inside the browser plugin's sandbox, are encrypted at rest, and are never shown to engines.

### 6.5 Model policy: never delegates to worse

- **Task work** always runs on the agent's model: by default the best one your engine and sign-in offer (Opus 5.5 on a Claude plan).
- **Sub-agents and helper calls inside engines are pinned to the same model** through the manifest's `model.env`. For third-party engines this is best effort; a warning shows when an engine uses another model.
- **Housekeeping may use a small model,** only where no judgment about the task is made: titles, speech-to-text, text-to-speech, the voice "mouth" (§8) and, from *Make*, channel suggestions.
- **Fallback asks first,** only to another sign-in you already have, and says when data would go to another company. With none, the agent waits.
- **Model providers are manifests** too: `kind: "model"` with `baseUrl`, `api` (`anthropic` or `openai`) and `prices`.

## 7. Inside `weilo-host`

### 7.1 Processes and languages

| Part | Language | Notes |
|---|---|---|
| **Core:** supervisor, event log, auth and pairing, relay link, ACP client, MCP hub, gateway (models, plugins, outbound proxy), scheduler and job runner, webhooks, search, file store, audit, voice orchestrator (WebRTC), stream relay for Screen and Terminal frames, secrets | **Rust** (tokio, axum, `sqlx`, `agent-client-protocol` 2.x pinned, `rmcp`) | One binary per platform |
| **Database** | Embedded Postgres 18, run by the core (§7.3) | The only store |
| **Children, two kinds only** | *Engines* (ACP) and *plugins* (MCP), in any language, each sandboxed | Claude Code is an engine. The browser is a built-in plugin (Patchright + Chrome); its Screen frames go from the CDP screencast to the core over a local socket the core opens for it. Social, bridges, docs and decks are plugins. **There is no sidecar.** |
| Computer use on your computer | Rust module: AX, then UIA, then AT-SPI | *Your computer* |
| UI | **React 19 + Tailwind + TanStack Router/Query**, one codebase for web, desktop and PWA | Speed pass: virtual lists, a markdown and highlight worker, `content-visibility`, lazy mini-app iframes, xterm.js with WebGL. **Not GPUI** (§2); revisit in 2027 for one native panel only if profiling demands it. |
| Desktop | Tauri 2, embedding `weilo-host` and its updater | macOS and Linux in release 1; Windows in *Grow* |
| Mobile | PWA in release 1, **Expo / React Native** in *Native* | Push actions, Live Activities, CallKit, widgets |

**Manifest kinds:**

- `engine` is an ACP process;
- `connection` and `bridge` are MCP processes;
- `model` and `voice` are endpoints.

Each is one of those plus one file (§14).

### 7.2 Events and streaming

- **Token deltas are never stored.** They go to clients over the socket with a temporary sub-sequence number.
- **A durable event** is written per finished message, tool call, approval or state change, plus a checkpoint at most once a second for long outputs.
- **An in-process broadcast** fires after commit. A subscriber that falls behind is dropped and resubscribes with `after_seq`. Clients throw away deltas at or before the last durable `seq`. NOTIFY is used only when writers live outside the process (bring-your-own Postgres). Every subscriber reconnects by `after_seq`.
- **Projections** (thread list, inbox, digests, usage) are updated by a **projector job** keyed on `(thread_id, seq)`, not in the append transaction. They can be rebuilt from the events.
- **Large payloads** (tool output over 8 KB, webhook bodies, files) live in a content-addressed file store, with a time limit where they are temporary. Events point to them.
- **Two sources of truth, each for one thing.**
  - The engine's transcript decides what the engine **remembers**.
  - Our events decide what people **see**.
  - After a hand-off or an outside fork, the host imports the difference with `session/load` (tagged `source: engine`) and marks any gaps.
  - A fork is a new thread with `parent_seq`.

### 7.3 Data: Postgres is the source of truth

**What lives where.** Everything durable is in Postgres on home: events, agents, channels, routines, jobs, approvals, audit, memory and usage. Logs are rotating files, not rows. Files are content-addressed in `~/.weilo-agents/files/`.

**How it runs**

- **Version:** one pinned major per app release (PG 18).
- **Data:** `~/.weilo-agents/db/`.
- **Binaries:** **built, signed and notarized by us**, reproducibly, with pgvector included. They are hash-pinned in the app and **never downloaded at runtime**.
- **Connection:**
  - a **Unix socket** (on Windows, a **named pipe**);
  - only the core connects, with **peer or SID authentication**;
  - engines and plugins never get credentials.
- **Settings:** `shared_buffers=32MB`, `max_connections=20`, `work_mem=4MB`, `default_toast_compression=lz4`, data checksums on, and `wal_sync_method=fsync_writethrough` on macOS.
- **Roles:** `weilo_owner` runs migrations. `weilo_app` (NOSUPERUSER, NOBYPASSRLS, not the owner) runs everything else.
- **Space and actor columns:** every **space-owned** row has `space_id` from day one. `actor_id` is on events, audit, approvals and effects. `devices`, `push_targets`, `ui_prefs` and `plugins` belong to a user or host; RLS covers them by `user_id` or host. RLS policies (`FORCE ROW LEVEL SECURITY`, `SET LOCAL app.user_id`) are turned on when shared workspaces arrive. A CI test proves cross-space reads return nothing.
- **Bring your own Postgres** on a server: PG 18 with pgvector, a role that may create roles, TLS with `sslmode=verify-full`, and **no transaction pooling** in front of it.

**Core schema** (ids are `uuidv7()`):

```sql
spaces(id, name) · members(space_id, user_id, role)
devices(id, user_id, pubkey, kind, paired_at, revoked_at) · hosts(id, space_id, name, pubkey, epoch, last_seen)
agents(id, space_id, profile jsonb) · channels(id, space_id, slug, title, archived_at)
threads(id, space_id, channel_id, kind, owner_host, owner_epoch, last_seq, title, parent_id, parent_seq) with (fillfactor=70)
events(thread_id, seq, space_id, actor_id, origin_host, origin_at, created_at, kind, source, tainted,
       body jsonb, body_hash, text, tsv tsvector generated, primary key(thread_id, seq))
sessions(id, space_id, thread_id, engine, engine_session_id, worktree, host_id, state)
call_results(space_id, device_id, call_id, result, at)       -- idempotent client calls; kept 7 d
jobs(id, space_id, queue, job_key unique, run_at, attempts, max_attempts, locked_by, locked_until, payload, last_error)  -- done kept 30 d
effects(idempotency_key pk, space_id, job_id, kind, state: intent|done|unknown|failed, provider_ref, at)
routines(id, space_id, agent_id, channel_id, trigger, action, tz text not null, on_missed)
routine_fires(space_id, routine_id, scheduled_for, run_id, skipped, pk(routine_id, scheduled_for))
webhook_requests(space_id, routine_id, webhook_id, relay_received_at, body_file, pk(routine_id, webhook_id))  -- kept 7 d
projector_cursors(projection, thread_id, seq, pk(projection, thread_id))
approvals(id, space_id, thread_id, seq, class, payload_hash, state, expires_at, decided_by_device, decided_via, signature, decided_at)
allow_rules(id, space_id, agent_id, tool, scope, created_by_device, revoked_at)
secrets(id, space_id, kind, ciphertext, key_id, rotated_at) · connections(id, space_id, plugin_id, account, secret_id, scopes, status)
plugins(id, kind, name, version, manifest_hash, tools_hash, approved_at)
files(sha256, space_id, size, mime, created_at, expires_at)  -- swept nightly · usage_events(id, space_id, agent_id, thread_id, model, tokens_in, tokens_out, cost_micros, at)
budgets(space_id, agent_id, daily_cap_micros) · push_targets(device_id, provider, token_ciphertext) · notifications(id, space_id, user_id, ref, state, at)
ui_prefs(user_id, device_id, prefs jsonb)                   -- sidebar sections, collapsed state
read_marks(space_id, user_id, thread_id, seq) · memory_chunks(id, space_id, agent_id, text, tsv, embedding halfvec(1024) null, source, tainted)
audit_head(space_id, seq, hash) · audit(space_id, seq, at, actor, device_id, action, detail, prev_hash, hash)
```

**Correctness rules**

- **Appending:**
  1. `UPDATE threads SET last_seq = last_seq + 1 WHERE id = $1 AND owner_host = $me AND owner_epoch = $epoch RETURNING last_seq`;
  2. insert the event;
  3. commit.

  The result is gap-free and fenced.
- **Projector:** `projector_cursors(projection, thread_id, seq)`. The projector reads events with `seq > cursor` in order, and updates the projection and its cursor in one transaction. A projection row is tainted if any of its source events is (`bool_or`).
- **Jobs are at least once.** Every outside effect (send, post, pay) first writes an `effects` row (`intent`) in its own transaction, then calls the provider with the idempotency key where one exists. If the outcome is unknown, there is **no retry**: the state becomes `unknown` and Needs you asks "**Did this send?**". The queue follows Graphile Worker's proven design rather than our own.

Retries:
- On retry, an effect still in `intent` is sent again with the same key only if the provider honours idempotency keys. Otherwise it becomes `unknown`.
- "No, try again" writes a new effect with a new key.
- An effect write checks the job's lease (`locked_by`, `locked_until`), so a worker whose lease expired can't record `done`.
- **Schedules** fire through `UNIQUE(routine_id, scheduled_for)`: one run per slot, across daylight-saving changes. After waking, **only the latest missed slot fires**. Earlier ones are inserted with `skipped = true` and never run.
- **Webhooks** are deduplicated on home by `(routine_id, webhook_id)`, because the mailbox can replay. The `webhook_requests` insert and the job enqueue share one transaction. Rows are kept 7 days, longer than the mailbox plus the sender's retry window.
- **Approvals:**
  - Approve with `UPDATE … WHERE state = 'pending' AND expires_at > now() RETURNING`.
  - The decision event is written in the same transaction.
  - **What the device signs:** canonical JSON (RFC 8785) of `{approval_id, thread_id, seq, class, tool, args_hash, recipients, amount, expires_at, nonce}`.
  - The card is drawn from that same payload, and the passkey challenge is its hash.
  - Before running, home checks the signature and that the stored action's hash still matches.
- **Audit:** each append locks `audit_head FOR UPDATE` and hashes canonical JSON (RFC 8785). `weilo_app` may only INSERT. A signed head checkpoint goes to your devices every hour.

**Search and memory**

- In release 1, search is `tsvector` (the `simple` configuration, a GIN index on the lifted `text` column).
- Embeddings (`halfvec`, HNSW past about 50k chunks) come in *Make*, with a named provider and consent, because Anthropic has no embeddings API.

**Operations on a laptop** (all automatic, all in plain words):

| Situation | What the host does | What you see |
|---|---|---|
| Disk getting full | A 1 GB ballast file is kept. Below 2 GB free, non-critical writes pause; the ballast is deleted to recover. | "Your Weilo computer's disk is almost full. [Free space]" |
| Crash or hard power-off | Supervised start. A stale `postmaster.pid` whose process is gone is cleared. Checksums are checked. | Nothing, or "Recovered after a restart" |
| Sleep and wake | Connections are health-checked on wake. Subscribers catch up. | Nothing |
| Corruption | A **repair from the last good backup** button. | "Something is wrong with your data. [Repair from Tuesday's backup]" |
| Major upgrade | Check free space and extensions first. Then `pg_upgrade --clone` (APFS, btrfs, XFS), or `--copy`, or a dump and restore under 2 GB. The old cluster is kept until 3 clean starts. | "Updating your data… (1 min)" |

**Backups**

- **Method:**
  - The database is backed up first (`pg_basebackup`, ending at a known WAL position).
  - Then every file the snapshot references is copied. Files are immutable and content-addressed.
  - The nightly file sweep deletes nothing while a backup runs, and keeps expired files 48 h past `expires_at`.
  - WAL is compressed (zstd) before it is encrypted.
  - **When a backup target is set (on any home), each new file is copied before the WAL segment that first references it is archived** (a file-then-WAL barrier in the archiver). A point-in-time restore checks every referenced file and marks any missing one as a gap in the thread.
- **Retention:** 7 daily and 4 weekly backups.
- **How much you can lose:** up to 5 min while the computer is awake and the target is reachable (WAL is archived every 5 min); otherwise, back to the last archived WAL.
- A backup runs whenever the newest one is over 24 h old, at the next idle moment.
- Backups are **encrypted** (age) to a key in the OS keychain plus your recovery code.
- **Signed and ordered.**
  - Each backup is signed by home's key, carries an increasing number, and records the previous backup's hash.
  - A restore checks the signature against a paired device or the recovery code, and warns if the backup isn't the newest one known. The relay stores the latest backup number next to `home_epoch`.
  - WAL segments are listed in the signed manifest chain too, so no single segment can be swapped or rolled back.
  - A restore verified with the recovery code alone alerts every paired device, as a recovery-code device add does.
- **The recovery code** is 128-bit random (never chosen by you). The key wrapped to it uses a memory-hard KDF (Argon2id).
- **Safe on synced folders and USB drives.**
  - Each backup is written under a temporary name, then renamed; its manifest of hashes is written last.
  - The weekly drill reads **from the target**, not a local cache. It downloads iCloud or Drive placeholders.
  - If the target is missing (USB unplugged, sync paused) or the newest backup is over 3 days old, Needs you says "**Your backups have stopped.** [Fix]".
- They are **copied off the machine**, to a place the user picks at setup:
  - a synced folder (iCloud Drive, Google Drive, Dropbox), which is the default suggestion;
  - a USB drive;
  - S3 or B2;
  - from *Cloud*, Weilo backup storage with 30-day retention.

  Backups are encrypted before they leave, so the folder's provider can't read them. The 24 h mailbox is never a backup target.
- Every week the host restores into a scratch cluster, checks it, and **decrypts one secret** to prove keys restore too.
- **Repair from backup** says what will be lost ("changes after Tue 02:14"). It first saves the readable tables, so newer events can be recovered.
- Settings shows "**Last good backup: Tue 02:14**": the last one that passed the drill.
- **Export everything** is encrypted and leaves out secrets by default (connections sign in again on import).

**Phase 0 gate:** embedded Postgres on macOS and Linux laptops; Windows waits for *Grow*.

| Measure | Target |
|---|---|
| Idle memory | < 120 MB |
| Cold start | < 2 s |
| Forced major upgrade | Survives |
| Disk-full drill | Recovers |
| Restore drill | Succeeds |
| Sleep and wake ×100 | Survives |

### 7.4 Several hosts (from *Your computer*)

- A thread has `owner_host` and `owner_epoch`. **Only the owner appends.** Home never appends to a worker's thread: it sends a command, and the owner records it.
- Workers ship **JSONL segments** of their events to home over the WebSocket.
- Home accepts events only for threads that worker owns, at the current epoch, with `seq = last_seq + 1`.
  - A gap asks "resend from N".
  - A same-seq mismatch (by `body_hash`) **raises an alarm and is never dropped**.
- Order is by `seq`. Both `origin_at` and `created_at` are kept; neither decides order.
- `weilo move` and reassignment raise the epoch, which fences the old owner.
- **Restore on a new computer** is a move without the freeze, for a lost or broken home.
  - The relay raises `home_epoch` when the restored home first connects, and rebinds `home_pubkey` **only with a signature from a paired device or the recovery code**, so a backup alone can't take over a home.
  - Import rewrites `threads.owner_host` and `owner_epoch` to the new host.
  - Effects still in `intent` become `unknown` (Needs you: "Did this send?").
- **Home fencing lives outside the database.**
  - The relay stores `(space_id, home_pubkey, home_epoch)`.
  - `weilo move` runs in this order:
    1. **freeze** the old home: the scheduler and webhooks stop and the host goes read-only;
    2. export;
    3. the new home imports, and the relay raises `home_epoch`.
  - The relay and paired devices refuse a home with a lower epoch.
  - An old home that reconnects learns it is fenced and stays read-only.

### 7.5 Client protocol

One WebSocket per device:

- `hello{version}`
- `sub` / `unsub` (thread, after_seq) → `ev`, plus temporary `delta` frames
- `call{call_id, method, params}` → `ret`, idempotent through `call_results`
- `presence`
- `stream{id}` → binary `frame` messages (Screen, Terminal); never stored, dropped under backpressure, newest frame wins

**`proto/`** is defined in Rust types. JSON Schema and TS are generated from it (`schemars`, `specta`), and the generated code is committed, so UI contributors need no Rust.

### 7.6 Upgrades

- **Migrations are expand-only** within a release; columns are dropped one release later. Because migrations are expand-only, release N−1 runs on the new schema. A backup is taken before every migration and is restored only if the migration fails. On bring-your-own Postgres, index builds use `CONCURRENTLY`, outside the migration transaction. `weilo_owner` runs migrations in one transaction, under an advisory lock.
- Updates wait until no session is running, or ask.
- Engines reattach with `session/resume`.
- Desktop updates through Tauri's updater; servers through `weilo update`.
- Home and workers stay compatible one version apart (N and N−1).

### 7.7 When things break

| Failure | Detector | Automatic action | What you see |
|---|---|---|---|
| Relay down | Client can't connect; `/health` fails | Retry with backoff; webhook senders retry (Standard Webhooks) | "Can't reach Weilo right now. Retrying." |
| Home asleep or off | Relay up, no heartbeat | Mailbox holds webhooks for 24 h | "Your Weilo computer is asleep since 14:02. [Wake it]" (Wake-on-LAN where set up) |
| Engine hangs | No `session/update` for 3 min with no tool running | Cancel, then offer restart | "Claude Code stopped responding. [Restart] [Stop]" |
| Engine crashes | Process exit | Resume once with `session/resume` | "The session restarted and picked up where it was." |
| Chrome or the browser plugin dies | Process exit | Restart once with the same profile | "Screen restarted; Ava is retrying." |
| Plugin dies | Process exit or an MCP error | Restart with backoff; then disable | "Gmail stopped working. [Reconnect]" |
| Postgres down | Pool error | Supervised restart. Running turns pause at the next ACP boundary. Durable events wait in a bounded memory queue (≤ 1,000 or 30 s), then the turn fails as "interrupted". Reads come from the core's in-memory cache of open threads; anything else comes from the client's IndexedDB copy (§4). | "Your Weilo computer is restarting its data. (a few seconds)" |
| Disk full | Free-space watch | See §7.3 | "Disk almost full. [Free space]" |
| Model provider error | 5xx or 429 | Back off; offer fallback only to another sign-in you already have, else wait (§6.5) | "Claude is busy. [Wait] [Use your ChatGPT sign-in]" |
| Effect outcome unknown | Timeout after the call | Never retried | Needs you: "Did this send? [Yes, it sent] [No, try again]" |
| Voice provider (mouth) down | Connect error, or no audio within 2 s | Switch the call to strict mode | "Voice is slower right now." |
| TURN unreachable | ICE failure | Retry over TCP/443 | "Can't start the call. [Try again] [Send a voice message]" |
| Migration fails on update | Migration error | Restore the pre-migration backup, keep the old binary | "The update didn't finish; nothing was lost." |
| Projector behind | Lag over 5 s | Needs you reads straight from `approvals` | Nothing |

### 7.8 Speed budget (p50 / p95)

| Path | Budget |
|---|---|
| App open, warm / cold on a phone | 300 ms / 1 s |
| Sent message shows | 50 ms (shown before the host confirms) |
| Host event to screen | 100 ms on the same network / 250 ms over the relay |
| Approval round trip | 500 ms plus your tap; Face ID is counted separately |
| Session start | 2 s / 4 s warm; 6 s cold. One sandbox per engine is pre-warmed only while a client is connected. |
| Voice: first audio after you stop speaking | 400 ms |
| Voice: first meaningful word after you stop speaking | **≤ 2.0 s** (stretch 1.5 s) |
| 1,000 threads in the sidebar | 60 fps |
| Idle host total (core + Postgres), no client connected | ≤ 200 MB; Chrome and engines are stopped |
| On-device speech | Models load only during a call (≤ 1.5 GB). The latency gate is measured on an M1 with 8 GB and an 8-core x86 with 16 GB. Below that, first run suggests a key for the realtime mouth. |

## 8. Real-time voice (Talk v1 in release 1)

Voice has two jobs: a fast **mouth** for speaking and a frontier **brain** for thinking. Only the brain thinks.

```
mic ─► WebRTC (TURN via the relay) ─► voice orchestrator in the Rust core (webrtc-rs; voice activity and turn detection in-process)
   ├─ end-of-speech detector (in-process VAD in strict mode; the provider's own with a mouth); decides when your turn ends
   ├─ MOUTH (a voice endpoint): fillers and the brain's text read word for word; one tool: brain(utterance)
   ├─ BRAIN: the agent's own model (Opus 5.5), voice profile, cache kept warm, tools as usual
   └─ STRICT MODE (the default): no mouth model; on-device STT → brain → on-device TTS
```

- **Latency.** Measured from when you stop speaking:
  - first audio: p50 under 400 ms;
  - first meaningful word (Opus's): p50 at most 2.0 s, stretch 1.5 s.
  - **Release gate:** both are measured on phones over mobile networks.
- **Barge-in.** Speaking over the agent stops it. The transcript is cut to what you heard. Tools keep running.
- **Tools never run from a partial transcript.**
- **Approvals by voice:**
  - The agent reads the details back.
  - **Talk v1 (release 1):** approvals happen on screen, never by voice. Sends need a tap plus a passkey, as in the app.
  - **Talk+:** a spoken one-time code that matches the verb ("say *move 47*") for reversible actions only. Sends still need a tap plus a passkey. Pay, delete and sign are never approved by voice; they need a tap plus a passkey on a paired device.
- **Bring your own voice, like the engine.**
  - Release 1 works with no voice account: **on-device** speech-to-text (whisper.cpp) and text-to-speech (Kokoro-class), with fillers recorded ahead of time for the first 400 ms.
  - Adding an OpenAI or Gemini key turns on the realtime mouth for lower latency.
- **The mouth.** It speaks fillers and the brain's words exactly. It never answers, rewords or calls tools. Its provider is named at the first call: "*Voice runs through OpenAI Realtime. Your audio goes to OpenAI. [OK] [Use strict mode]*".
- **The call bar** (desktop and phone):
  - **Mute · Stop Ava · End**;
  - live captions;
  - a "Back to chat" chevron;
  - the mic light always visible.
- **Voice providers are manifests:** `kind: "voice"`. Each is an **endpoint** (a realtime WebSocket, or streaming STT and TTS over HTTP) called by the core, like `model`. There is no voice child process and no media server to run.
- **iPhone limit in release 1.** On iOS, a PWA's microphone and audio stop when the screen locks or you switch apps. In release 1, **calls stay live while the app is open**. Calls with the screen locked come with CallKit in *Native*. The latency gate is measured on iOS Safari as well as Android Chrome.
- **Phone number** comes in *Talk+*. An inbound call gets no approvals and no `sends` tools.

## 9. Computer use (*Your computer* phase; eval-gated)

| Where | How |
|---|---|
| **Agent's cloud computer** (*Cloud*) | A full Linux desktop beyond the browser, driven by Claude's computer-use loop plus AT-SPI. Live in **Screen**. |
| **Your computer** | A Rust module: accessibility tree first, screenshots second, an app's API when there is one. macOS first, then Windows. |

- **Access per agent:** **Off** (default) · **Ask for each app** · **Allowed apps**. There is never full access.
- **The laptop enforces its own policy:**
  - approvals signed by your devices;
  - terminals, password managers, System Settings and admin prompts are never allowed;
  - **a card before clicking Send, Pay, Post, Submit or Delete**;
  - a visible "**Ava is using your computer · Stop**" bar;
  - screenshots cropped to the target window, with notifications hidden.
- **Release gate:**
  - a success rate no more than 5 points below Codex on the same 50 OSWorld-style tasks;
  - **zero** unapproved Send, Pay or Delete actions.

## 10. Cards, mini apps, documents, bridges

### 10.1 Cards and mini apps

- **Built-in cards** (`proto/`): Draft, Approval, Form (secure fields), Choice, Table, Chart, Tracker (pins), File, Diff and Calendar slot. **Every card carries `fallback {text, url}`.** A surface renders the types it knows and falls back otherwise, so adding a card type touches one place.
- **Plugin UI is MCP Apps only** (`ui://`), rendered in release 1 inside the app:
  - a separate origin;
  - no `allow-same-origin`, popups or network;
  - tool calls go through the same cards as the model's.
- **Approval and Draft cards are drawn only by the host,** outside any iframe.
- **An irreversible bulk primary** ("Schedule for 1,204 people") always opens one confirm step: "*Schedule for 1,204 people? Can't unsend after Fri 9:00.* [Back] [Schedule]".
- **Batch cards:**
  - One batch is one action class, one tool and one kind of recipient.
  - A stronger item (a send among archives, an outside recipient) is split into its own card.
  - The card counts anything unusual ("2 aren't newsletters").
  - In a tainted job, the first item and every unusual item are expanded.

### 10.2 Docs, decks and designs (*Make*; eval-gated)

- **Source:** HTML and CSS, with one curated design system.
- **The loop:** the frontier model writes, then a render, screenshot and self-critique loop (overflow, contrast, density, alignment).
- **Exports:** PDF and HTML first, then PPTX and DOCX.
- **Gate:** in 30 blind side-by-side comparisons against Claude Artifacts, ours is preferred or rated a tie at least 50% of the time.
- **Sharing:** encrypted links, with the key in the fragment, expiry and revocation.

### 10.3 Cards on other surfaces (*Reach*)

Approval rights depend on what a surface can prove, not on its name:

| Surface capability | Examples | Allowed |
|---|---|---|
| Paired device with a passkey or device key | App, PWA, native | Every class (§16) |
| Owner-verified buttons (signed interaction checked on home) | Slack, Telegram | Reversible only; sends say "Open in app" |
| Link only | Email, Discord, WhatsApp | Opens a confirmation page; never acts on GET; reversible only, after a passkey |
| Voice | Calls | §8 |

A bridge declares its capability in its manifest.

## 11. UI

### 11.0 Calm by default

The screen shows **what the person needs to get what they want, and nothing else.** Every element must earn its place by answering one of three questions:

- What needs me?
- What is my agent doing?
- How do I ask for something?

The rules:

1. **One focus per screen.** The conversation is the page. Everything else is quiet.
2. **One primary button per card.** It is the accent colour. The message box's send button is the only other accent on screen. Header actions (Talk to Ava, Ask Ava, Stop) are secondary.
3. **Progressive disclosure.**
   - Details (commands, branches, engine names, tokens, model names) are one click away, never on the surface.
   - "Show the command", "Details" and hover reveal them.
4. **Panels appear when there is something to show.**
   - The side panel is closed by default.
   - It opens by itself only while the agent is using a screen or a session has changes, and closes again when that ends.
5. **Alerts collect in one place.** Approvals, questions and failures go to **Needs you**, not banners. Banners are only for "can't reach" and "asleep".
6. **No counts that don't ask for action.** A badge means "needs you". Unread is a dot. Nothing else is counted.
7. **The sidebar is the user's.** Sections collapse and hide (§11.2). Hidden sections still send alerts to Needs you.
8. **Sentences, not settings.** Routines, risk lines and empty states are short sentences with one button.
9. **No more than 7 interactive elements** in any header, card or row. Anything beyond goes behind ⋯.

### 11.1 First run

**On the computer** (the install):

1. **"Connect your AI."** Weilo looks for AI apps you already use.
   - Found: "**We found Claude Code, signed in. Use it?**" One tap.
   - None found: "**Use Weilo's built-in AI**" (pi, named only in Details). Paste an API key with a guided "Get a key" link, or sign in with a plan where §6.4 allows it.
   - *Other AI apps* opens the list (Codex, Gemini CLI, OpenCode…).
2. **"Keep your agent working while this computer is plugged in?"** *It stays awake while charging.* [Yes] [Not now]
3. **"Get Ava on your phone."** Shows a QR code and a short typed code. [Skip]. Later: Settings → Devices → Add a phone.

That is two taps when an AI app is found, plus the optional phone step.

**On a phone:**

1. "**Scan the code on your computer.**" A camera frame, with "Type the code instead" below.
2. Both screens show the same **4 words**: [They match] [They don't]. *They don't* cancels pairing. Then the phone opens Ava's chat.
3. A link, "*No Weilo on your computer yet? Send me the link*", is for people who start on the phone.

**Then:**

- Ava is made. She interviews you in a few questions and makes your channels, then writes first.
- She offers *Plan my week* · *Tidy my inbox* · *Watch a website*.
- Gmail and Calendar are in release 1, with Google verification started in week 1.
- If Gmail is not verified by week 14, the beta runs as a **published but unverified** app (100-user cap, which fits the 50-user beta; never testing mode, whose sign-ins expire weekly). At sign-in the app says first: "*Google will warn that Weilo isn't verified yet. Choose Advanced, then Go to Weilo.*" For everyone else, *Tidy my inbox* is replaced by *Watch a website*.
- The setup checks for disk encryption and warns if it is off.

### 11.2 Desktop and web

```
┌────────┬──────────────────┬──────────────────────────────────────────┬──────────────┐
│ W      │ [Search  ⌘K]     │ # shop-launch  [A]Launch email  [M]Teaser │ Screen Files │
│ Home   │ Needs you    2   │                  (A)(M) [Talk to Ava]  ▯  │ To-do        │
│Routines│ ▾ Agents       + │  messages · cards with one risk line      │ (opens only  │
│Connect-│   (A) Ava        │                                           │  while Ava   │
│  ions  │ ▾ Channels     + │                                           │  uses a      │
│        │   # general      │  ┌──────────────────────────────────────┐ │  screen)     │
│        │   # shop-launch  │  │ Message #shop-launch…  + 🎤 [Tell now▾]│ │              │
│Settings│ ▸ Sessions 2 · 1 │  └──────────────────────────────────────┘ │              │
│        │ Customize sidebar│                                           │              │
└────────┴──────────────────┴──────────────────────────────────────────┴──────────────┘
```

- **Rail** (80 wide): Home · Routines · Connections · Settings.
- **Sidebar:** Needs you, Agents, Channels, Sessions, Archived.
  - **Every section collapses.** A chevron toggles it. A collapsed section shows only its most urgent state ("1 working", "1 new", "1 needs you"), or nothing.
  - **Every section can be hidden** through Customize sidebar (its own icon, a **Done** button), ⋯ → Hide section, or ⌘K.
  - If **Agents** is hidden, a **Chat with Ava** row stays under Needs you.
  - If everything is hidden, the sidebar shows "**Your sidebar is empty.** [Show all]".
  - A hidden section with live work puts a dot on Customize sidebar, and its alerts still reach Needs you.
  - The "+" on a section shows on hover and on keyboard focus.
  - State is saved in `ui_prefs` per person and device.
- **Who you're talking to:**
  - The channel header shows the members' faces, with the lead first.
  - The button reads **Talk to Ava**.
  - The message box reads "*Message #shop-launch. Ava answers; type @ to ask someone else.*"
  - Thread tabs carry their owner's face.
  - An agent's own chat has its name and no `#`.
- **Agent chatter** is folded into one line by default ("Ava and Mia talked · 6 messages"). **A fold that holds outside content shows a "from outside" badge and never folds by itself.**
- **Needs you page:**
  - Groups: **Waiting on a yes · Questions · Didn't work · Expired · Done today**. Empty groups are hidden. Only *Waiting on a yes* shows a count.
  - **Heads-ups** ("Ava started a session: Fix checkout") go under Done today, with no badge and with a **Stop** button, so they reach people who have hidden Sessions.
  - Keys: J/K to move · Enter to open · A to approve small items. **A on a bulk or irreversible item opens it instead.** The **Open** button is primary on those rows.
  - A hidden section adds the line "**Sessions are hidden in your sidebar.** [Show]".

### 11.3 Empty and error states

Plain words, one line, and a button:

- "**Nothing needs you.** Ava will ping you if that changes."
- "**No channels yet.** Ava files work here as it comes in."
- "**Ava hit today's $5 limit.** [Raise to $10] [Wait till tomorrow]"
- "**Gmail disconnected.** [Reconnect]"
- The rest are in §7.7.

### 11.4 Mobile, Duet style

- **Home** is the chat with your main agent. "**Needs you · 1 of 2**" sits on top as cards you can swipe. **For a bulk send, Look first is the primary button.**
- **Bottom bar:** **Chat · Channels · ● Talk · Agents · You**. Talk is the raised centre button: tap for a call, hold for a voice message. The Chat badge shows "need you" items only while another tab is active.
- **Notifications** have one setting with three choices: *Only when needed* (default) · *Also when done* · *Everything*.
- **Setup on iPhone** includes "Add to Home Screen". Approvals use passkeys with Face ID.
- **Native (*Native* phase):** Live Activities, Dynamic Island, widgets, CallKit, actionable notifications.

### 11.5 Design system

Every screen uses these tokens. Lint fails on stray values. A Storybook (or Ladle) holds each component in light and dark, with contrast and accessibility checks in CI.

**Spacing** (4 px grid): 2 · 4 · 6 (icon to label) · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48.
- Card padding 16.
- Column gutter 24.
- Phone side margin 16.

**Type** (Geist; Geist Mono for code):

| Token | Size / line height | Weight |
|---|---|---|
| caption | 12/16 | 400 (meta: times, sources, hints) |
| caption-strong | 12/16 | 500 (section labels, risk lines, tab-bar labels) |
| body-sm | 13/20 | 400; 500 when interactive (rows, buttons, tabs) |
| body | 14/20 desktop, 16/24 phone | 400; phone buttons 16/24 at 500 |
| title-sm | 15/20 | 600 (card titles, page titles, Needs you items) |
| title | 20/28 | 600 (phone screen titles, the call avatar letter) |
| transcript | 20/28 | 400 (call captions only) |
| display | 28/34 | 600 (first run only) |

Weight 500 means interactive; 600 means a heading. Avatar letters are 12/16 at 600. Selection is shown by colour and fill, never by weight.

**Color** (light / dark):

| Token | Light | Dark |
|---|---|---|
| bg | #FAFAF9 | #0C0A09 |
| surface | #FFFFFF | #1C1917 |
| surface-muted | #F5F5F4 | #292524 |
| border | #E7E5E4 | #2E2A27 |
| border-strong / control outline | #A8A29E | #57534E |
| text | #1C1917 | #FAFAF9 |
| text-secondary | #57534E | #A8A29E |
| text-tertiary | #78716C (bg and surface only) | **#8A837E** |
| accent | #5B4BC4 | #8B7CF0 |
| accent-hover | #4A3BAF | #A79BF0 |
| accent-subtle | #EEEBFB | #2A2350 |
| accent-text | #43369A | #C4BAFF |
| on-accent-divider | rgba(255,255,255,.24) | rgba(0,0,0,.24) |

- **Status** (light / dark):
  - success #15803D on #F0FDF4 / #4ADE80 on #052E16;
  - warning #B45309 on #FFF7ED / #FBBF24 on #3A2506;
  - danger #DC2626 on #FEF2F2 / #F87171 on #3B0D0D.
- **Avatars:** four pairs:
  - violet #EEEBFB / #43369A;
  - sky #E0F2FE / #075985;
  - rose #FCE7F3 / #9D174D;
  - teal #CCFBF1 / #115E59.
- **Contrast rule.** Text on surface-muted or accent-subtle uses text-secondary, never text-tertiary, so every pair passes 4.5:1. Control outlines (inputs, radios, switches) use border-strong, for 3:1.
- **Focus ring:** 2 px accent with a 2 px offset, on every control (`:focus-visible`, and `:focus-within` on wrapped inputs).

**Radius:** 6 (chips, code, small buttons) · 8 (buttons, rows, inputs) · 12 (cards, panels) · 16 (phone cards) · full (avatars, pills, bars).

**Elevation:**
- e1 `0 1px 2px` at 6% (cards, knobs).
- e2 `0 8px 24px` at 12% (popovers, the floating Talk button).
- e3 `0 16px 48px` at 18% (dialogs).
- No coloured shadows.

**Sizes:**
- Buttons 28 / **32** / 40 / **48** on phones. Icon buttons 24 / 28 / 32, with a **44 tap area** on phones.
- Inputs 32 (44 on phones). The message box is at least 56.
- Sidebar rows 32 / 44, avatars 24. The side panel is 400.
- **Top bars are 56 in every column**, with the bottom line drawn as an inset shadow (`inset 0 -1px 0 border`) so content sits on whole pixels.
- Icons 16, 20 or 24, with a 1.75 stroke.
- Chips and buttons never wrap (`white-space: nowrap`).

**Buttons:**
- Primary is accent, one per card (plus the send button), never black.
- Secondary is surface with a border.
- Tertiary is text only.
- Danger is red text on secondary.
- **Tabs everywhere:** a selected tab is a surface-muted fill, never a ring.
- **Selected rows** (including Needs you) use accent-subtle with accent-text.
- **Warning tint** (#FFF7ED) is only for something that can't be undone. A safe action's card is plain surface.
- **Flex rules:** fixed controls in a header never shrink (`flex-shrink: 0`). Tab lists and search fields shrink (`min-width: 0`) and clip.
- **The message box** is a textarea on its own row that grows from 1 to 6 lines. Attach, mic and send sit on a toolbar row beneath it, so the text gets the full width.
- **Status pills** ("Needs you", "Working") use accent-subtle or surface-muted. **Red** appears only on the confirm step of a destructive action, never on a header button, a row or a hint.
- **Labels that can be cut** (tabs, rows) end with an ellipsis, never a hard clip.
- **Messages:** the person's own messages are right-aligned on surface-muted; agents' are left-aligned with a face. The same on phones.

## 12. Routines and webhooks

- **A routine** is a trigger (a time, a webhook, a connection event, a pin change), plus what to do (a prompt, or an Instant script with no model), plus who and where. Routines are written as sentences: "*Every weekday at 8:00 · Send me a brief*".
- **Incoming webhooks:**
  - One URL per routine.
  - **Standard Webhooks** HMAC is checked **on home**, on the original bytes. The 5-minute window is measured against the relay's signed receive time, so a request held in the mailbox still verifies. Signing secrets never leave home. Home also rejects a request whose own signed timestamp is more than 25 h older than home's clock, so the 7-day dedupe covers every possible replay.
  - Duplicates are dropped on home by `(routine_id, webhook_id)`.
  - At most 1 MiB, answered at once with `202 {run_id}`, or `202 {queued: webhook_id}` from the relay while home is offline.
  - A request log with replay (a replay stays tainted), **Send test event**, a curl example, and JSON-path filters.
  - Bearer mode is offered with a warning.
  - A webhook starts only its own routine, as a tainted job.
- **Outgoing:** a routine can POST its result, signed the same way.

## 13. Social media (*Reach*)

| Platform | Access | Notes |
|---|---|---|
| Bluesky, Mastodon | Yes | Open APIs |
| X | Your own developer key | About $0.015 a post, about $0.20 with a link. The Draft card shows the cost, and each agent has a cap. |
| LinkedIn (personal) | Yes | Company pages need review |
| YouTube | Yes | Quotas |
| Instagram, Facebook, Threads | After Meta app review | Review starts in week 1 |
| TikTok | Upload-to-inbox drafts | Direct posting needs an audit |
| Reddit | **Not available** | No browser workaround |

- Posting is always a Draft card first.
- Auto-post rules are per platform, rate-limited and off in tainted jobs.
- AI-content labels are added where required.
- There is no browser fallback where a platform's terms forbid automation.
- Social connections are plugins, so an aggregator API can replace them.

## 14. Plugins and manifests

```jsonc
// weilo.json
{ "apiVersion": 1, "kind": "connection",            // engine | connection | bridge | model | voice
  "name": "linear", "title": "Linear", "description": "Issues and projects.",   // ≤ 60 chars (linted)
  "mcp": { "url": "https://mcp.linear.app/sse" },    // or { "command": [...] }
  "signIn": "oauth", "ui": ["ui://linear/issue-card"],
  "triggers": [{ "id": "issue.created", "webhook": true }],
  "permissions": { "network": ["api.linear.app"] } }
```

- **For developers in one sentence:** every extension is a process (MCP for connections and bridges; ACP for engines) or an endpoint (models and voice), plus this file.
- **Runtime:**
  - Local plugins run out of process, sandboxed, with `network` enforced by the proxy.
  - Remote plugins can't be enforced, and the install screen says so.
- **What counts as a send.** The host decides.
  - Read-only annotations run without a card **only when Weilo has curated them** (built-in and marketplace connections).
  - For any other plugin, every tool counts as a send, whatever the plugin declares.
- **Always allow has limits.**
  - It never covers pay, delete or sign.
  - A send rule names its recipients or domains and expires after 30 days.
  - Every rule is listed in Settings with Revoke.
  - A rule proposed because of the card budget needs a passkey.
- **Approval fatigue.** Each agent has a daily card budget. Past it, cards are grouped and the agent proposes an **Always allow rule** for you to read once (never in a tainted job). Approvals on send-class cards that come in under 1 s trigger a short pause ("Take a look first").
- **Supply chain:**
  - Engine CLIs and plugin runtimes install only from **lockfiles with integrity hashes** and Sigstore checks, into a host-managed folder. Never `npx -y` or `latest`. Installs run with `--ignore-scripts` (or the same for other runtimes), inside the sandbox.
  - Update signing keys (Tauri, `weilo update`) are kept offline, with a documented rotation plan.
  - Plugins are pinned by hash, with Sigstore provenance.
  - A change in tools or descriptions asks again.
  - Engine plugins have a louder approval.
- **Tools:** `npx create-weilo-plugin`, `--from-mcp <url>`, and a permission sheet in plain words.

## 15. A browser that doesn't get blocked

| # | Layer | Release | Default |
|---|---|---|---|
| 1 | **Measure:** every page load is classified as ok, challenged or blocked. The block rate shows in Settings. A nightly benchmark runs on 40 sites plus CreepJS, Sannysoft and Pixelscan. | 1 | On |
| 2 | **Real Chrome** (installed at setup, x86-64), driven by **Patchright** in the built-in browser plugin. Headful. | 1 | On |
| 3 | **Your own Chrome** via an extension. Read-only per site by default; submitting a form needs a card. | *Your computer* | Offered |
| 4 | **A consistent machine:** timezone, locale and `Accept-Language` follow the IP; 1920×1080; fonts; audio; GPU where available; WebRTC, DNS and IPv6 leaks closed. | *Reach* | On |
| 5 | **Persistent profiles** per agent and per site; IP and fingerprint never rotate. | *Reach* | On |
| 6 | **Your own proxy**, sticky per site. Bring your own only. | *Grow* | Off; opt-in |
| 7 | **Hand-off to you** for a CAPTCHA, 2FA or press-and-hold. No solver services. | 1 | On |
| 8 | **Human-like input.** | *Grow* | Off; opt-in per site |
| 9 | **Web Bot Auth** (RFC 9421) and Cloudflare signed agents | *Grow* | On where accepted |

**Signed-in profiles.**

- On a signed-in profile, form submits and any request other than GET count as sends.
- A tainted job browses only in a fresh, signed-out profile unless a card allows otherwise.

**Routing:** your own Chrome for signed-in sites; otherwise the agent's own Chrome on home; on a block, your proxy (if set), then hand-off.

**Honesty line.** Layers 6 and 8 exist to look less like automation. They are off by default, opt-in per site, carry a terms-of-service notice, and need legal review.

## 16. Security model

What we keep:

- device pairing;
- the token gateway;
- sandboxed and isolated agents;
- approvals with Always allow;
- secure fields;
- the audit log.

What changes:

**Secrets and data at rest**

- `~/.weilo-agents/` is mode 0700 and is on **every sandbox profile's deny list**, for reads and writes.
- Secrets use **envelope encryption.** The master key lives in the OS keychain (Keychain, DPAPI, libsecret; on a VM a key file or KMS). The `secrets` table holds only ciphertext. The master key is **also wrapped to the recovery code** and stored in each backup, so a restore on a new machine can read secrets.
- Only the core connects to Postgres (socket or named pipe, peer authentication).
- Backups and exports are encrypted (§7.3).
- Setup checks for disk encryption.
- **Lost this computer**, from any other device: it revokes the pairing and every OAuth grant at its provider.

**Taint follows the data**

- Outside content (email, webhooks, web, social, bridges, a tainted agent's answer) is read in a **child job**. The job is tainted.
- **Summaries, digests, projections and memory written from tainted content inherit the label.**
- Memory from outside is stored as "**heard from outside**". It is never recalled as instructions, and is shown with its source.
- The curator reads the taint of each piece of data's origin.
- A tainted job or turn loses:
  - laptop computer use and the Chrome extension;
  - Always allow and auto-post rules;
  - memory and skill writes without a card.
- **No quiet exfiltration.** In a tainted job, any outbound request that could carry data counts as a send and needs a card. That means:
  - any request other than GET;
  - any GET except one to a URL that appears **exactly** in the job's inputs (no added or changed path or query) or to a domain on the agent's allowlist.
  - The allowlist never includes hosts that serve user content or open redirects (paste sites, URL shorteners, form services). In a tainted job, a GET with a query string to an allowlisted domain still counts as a send.
- Clients never load remote images or media in agent output (CSP `img-src 'self' data:`), and links show their full domain.

**Engines and plugins**

- Bound (§6.3) and holding no tokens or database access, except an engine's own sign-in, handled as §6.4 says.
- Hand-off to an engine's own terminal app on a computer that holds home's database needs a confirm card.

**The laptop trusts no host:**

- its own policy;
- approvals signed by your devices;
- short-lived tokens scoped to one session.

**Devices**

- Passkeys in the PWA; the Secure Enclave or Keystore in native apps.
- At pairing, both screens show the same 4 words, and the person confirms they match.
- Revoking, adding a device, Lost this computer and changing recovery all need a passkey or Face ID, and every device is told. A new device, including one added with only the recovery code, can't approve sends for 24 h unless an existing device confirms it, and every device is alerted.
- Pairing endpoints on the relay are rate-limited.
- A recovery code.
- Push carries only an encrypted reference.

**Approval strength, by surface capability** (§10.3):

| Action class | Paired device | Owner-verified buttons | Link only | Voice | Laptop |
|---|---|---|---|---|---|
| Read / look | No card | No card | — | No card | Per-app permission |
| Reversible | Tap | Owner's click (signed) | Confirm page + passkey | Talk+: code; v1: tap | Device-signed card |
| Send / post / submit | Tap + passkey or Face ID | "Open in app" | Not offered | Tap + passkey on the paired device (v1 and Talk+) | Device-signed card |
| Pay / delete / sign | Tap + passkey or Face ID, always | Not offered | Not offered | Not offered | Device-signed card |

**Audit:** hash-chained (§7.3), INSERT-only for the app role, with signed hourly checkpoints sent to your devices. It records engine tool calls, computer-use steps, and which device and surface approved each action.

**Money:** moving money always needs a tap plus a passkey, and can be switched off entirely.

## 17. How we build it

- **Monorepo:**
  - `crates/` (host);
  - `apps/` (web, desktop, mobile);
  - `plugins/` (built-in plugins: browser, Gmail, Calendar…);
  - `proto/`.
- **`just dev`** and a devcontainer.
- **Generated code committed,** so the UI needs no Rust.
- **The echo and replay engines** let tests run with no keys.
- **CI:**
  - type checks, tests, accessibility and contrast, token lint;
  - `weilo engine test` for each bundled engine;
  - a Postgres restore drill;
  - a smoke test of the release image.
- **A security suite in CI:**
  - sandbox escape attempts;
  - taint spreading through summaries, digests and memory;
  - forged webhooks and approvals;
  - replayed relay messages;
  - exfiltration from tainted jobs.
- **An outside penetration test** before the beta, in weeks 14–16.

## 18. Phases

**Release 1, "On your computer, and you can call it": about 16 weeks** for 2–3 developers working with AI. The full scope takes 12–18 months in total.

| Weeks | Ships |
|---|---|
| 1–2 | Monorepo, `proto/`, tokens and component library, echo and replay engines, CI. **Embedded Postgres gate** (macOS, Linux). Browser measurement. **Owner approves the UI mock** (first run, desktop, phone, call bar, Needs you); weeks 7–10 build only what is approved. **Start reviews:** Google OAuth verification and the CASA Tier 2 assessment Gmail's restricted scopes require (8–16 weeks, paid), Meta, TikTok, LinkedIn, Cloudflare signed agents, **legal review of plan sign-ins per provider** (§6.4). |
| 3–6 | `weilo-host`: Postgres, events, projector, jobs and effects, secrets in the keychain, pairing, **the relay with E2E, TURN and health**, **the per-home subdomain and its certificate (§4)**, one WebSocket, the gateway. Engines: **pi (default)**, generic ACP, Claude Code, Codex, each with your own sign-in. Sessions with worktrees; Changes and Terminal. MCP hub. **Week 6 checkpoint** (below). |
| 7–10 | Agents, memory (search), routines, Needs you, cards and MCP Apps, the interview that makes channels, rule-based filing. New layout, the customizable sidebar, ⌘K. **Gmail, Google Calendar, web.** Browser layers 2 and 7. Taint, the effects ledger, the failure table. |
| 11–13 | **Talk v1:** on-device speech (strict mode) plus an optional realtime mouth with your own key; call bar, captions, tap approvals, latency gate. PWA with passkeys and push. First run. |
| 14–16 | Incoming webhooks. Off-machine encrypted backups and restore drills. macOS and Linux installers (signed and notarized), *Keep awake while plugged in*, a documented server install for advanced users. Beta hardening. |

**Week 6 checkpoint.**

Pass criteria:
- an echo session, a Claude Code session and a **pi session with an API key** each run end to end through the relay on a phone, **in its browser (no install)**;
- the event-to-screen and session-start budgets (§7.8) are met;
- the Postgres gate passes.

Cut order, fixed in advance, if a criterion fails or the schedule slips:
1. Codex engine → *Reach*;
2. Gmail → **published but unverified** (100-user cap, with Google's warning screen); **never testing mode**, whose sign-ins expire every 7 days;
3. Talk v1 → strict mode only (no realtime mouth). Strict mode is the default already, so this only drops the optional mouth.
4. A plan sign-in for a provider that review hasn't cleared → API key only for that provider.

Release 1 ships when the remaining scope passes its gates.

**After release 1**, two tracks run in parallel (one developer each), because both of the founder's headline gaps matter: your computer, and calls with the screen locked.

*Cloud* then starts as track C, once tracks A and B ship (about 8 weeks after release 1). It is the only feature that keeps an agent on around the clock and Weilo's first paid product, so it comes before the rest.

The phases, in order:

| Phase | Weeks | Ships |
|---|---|---|
| *Your computer* (track A, starts right after release 1) | 6 | Workers (§7.4); macOS computer use; Chrome extension (layer 3); OSWorld-style gate |
| *Native* (track B, in parallel with track A) | 6–8 | Expo apps: push actions, Live Activities, CallKit, widgets |
| *Cloud* (track C, after tracks A and B) | 6 | A hosted, always-on computer per user: the same `weilo-host` on a VM we run, the full Linux desktop for the agent, takeover while your computer sleeps, `weilo move` both ways, KMS-held keys, and a first-run notice: "*On a computer we host, we could technically reach your data. Keys are held in a cloud key service and every access is logged.*" |
| *Talk+* | 3 | Voice codes, phone number (SIP), a voice per agent |
| *Make* | 6 | Docs and decks (eval gate), embeddings, the channel classifier, Preview panel |
| *Reach* | 6 | Slack, email address and Telegram bridges; social; browser layers 4 and 5 |
| *Grow* | 6 | Windows (desktop, embedded Postgres, computer use); marketplace and SDK; browser layers 6, 8, 9; shared workspaces (RLS on) |

**Cost controls in release 1:** for API keys, a forecast per agent and a hard daily cap; for plan sign-ins, the plan's own limit window. Voice minutes on your own key are shown in Usage.

## 19. Decisions

**Decided by the owner (Oct 28):**

1. **Local first.** The hosted cloud computer is the *Cloud* phase, after the release-1 tracks.
2. **Bring your own engine,** with pi as the built-in default (§6.4). Weilo sells no model access.

**Recommended, waiting for the owner:**

3. **Pricing.** Weilo's own cost per user is small, so release 1 can be free.

   | Who pays for what | Cost |
   |---|---|
   | Model use | **The user**, on their own plan or key. Never Weilo. |
   | Voice | Free on-device by default; the user's own key for the realtime mouth |
   | The relay (phone access from outside, push, TURN for calls) | **Weilo**: about $0.20–0.50 per active user per month. Most traffic goes direct on the home Wi-Fi. |

   - **Release 1: free.** The app, the relay and updates. No account needed beyond pairing.
   - **Later, paid:**
     - *Weilo Cloud*: an always-on computer for your agent, about $15–25 a month (the VM's cost plus margin).
     - *Teams*: shared workspaces, admin and audit export, per seat.
   - The relay stays free for personal use. Self-hosting it stays possible.
4. **License.**
   - **AGPL-3.0** for the app and host.
   - **Apache-2.0** for `proto/`, the plugin and engine SDKs, manifests and templates, so anyone can write plugins under any license.
   - Contributions under the DCO (sign-off), no CLA.

   | Option | For | Against |
   |---|---|---|
   | **AGPL-3.0 + Apache-2.0 SDK** (recommended) | Truly open source, so self-hosters and contributors trust it. A company can't run a closed, hosted fork against *Weilo Cloud*. | Some companies avoid AGPL inside their own products; the Apache SDK covers the case that matters (plugins). |
   | Apache-2.0 for everything | The widest adoption, the simplest | Anyone can host a closed copy as a competing cloud |
   | FSL-1.1 (each release turns Apache after 2 years) | Protects the business while young | Not open source by the OSI definition; contributors trust it less |
   | PolyForm Noncommercial (openbot) | — | Blocks businesses, our target users; avoid |

5. **Mobile.** PWA in release 1, then Expo. *Recommended over Tauri mobile.*
6. **Stealth browser layers 6 and 8:** off by default, opt-in per site, after legal review.
7. **Relay operator.** Weilo runs the hosted relay (TURN, push keys for APNs and FCM, a 99.9% uptime target); self-hosting stays possible. *Recommendation: we run it.*

## 20. What the reviews changed

### Round 9: owner decisions (local first, bring your own engine)

The same six judges re-checked v8. Changes made:

- LAN-direct naming.
- Plan sign-ins only where provider terms allow, with legal review in weeks 1–2.
- A Weilo-managed config folder for engines using your own sign-in.
- Signed, ordered backups that are safe on synced folders.
- 5-minute recovery on any home.
- A hardware floor for on-device voice.
- Fallback only to sign-ins you already have.
- An "Add a phone" step and checking that the 4 words match.
- Plain first-run words ("AI apps", "Weilo's built-in AI").
- *Cloud* as track C.
- Leftover cloud wording removed.

### Rounds 4 to 8: the same judges, re-scored until every score reached 9.5

| Judge | Score by round | Changes |
|---|---|---|
| Product | 6.5 → 8.0 → 9.3 → **9.5** | §1.1 users and metrics; what release 1 delivers of the wedge; week-6 pass criteria and cut order; hosting decided by week 2; pricing; relay operator; iPhone voice limit; parallel tracks; numeric eval gates; Gmail as published but unverified (never testing mode); cap math fixed. |
| Architecture | 6 → 7.5 → 8.8 → **9.5** | Voice in the Rust core, voice providers as endpoints; single-host fixes; no backups to the mailbox; frame streams; pre-warm only with a client connected; more failure rows; per-home subdomain built in weeks 3–6; DNS-01 with CAA; a Postgres-down read path. |
| Data | 5.5 → 8.0 → 9.0 → 9.3 → **9.5** | Fencing through the relay; restore on a new computer; signed receive time; secrets restorable; backup order (database, then files), retention and RPO; expand-only migrations; projector cursors; effect retry rules; only the latest missed slot fires; `space_id` scope made exact. |
| Security | 6 → 7.5 → 8.5 → **9.5** | Per-home TLS (CAA `accounturi`, CT watch); the relay holds no secrets; 25 h replay bound; canonical signed approvals; exact-URL egress rule; engine taint per session; protected files; lockfiles with `--ignore-scripts`; curated-only read annotations; voice sends need a passkey; Always allow limits; device holds; a pen test. |
| UI visual | 7.5 → 8.4 → 9.1 → 9.4 → **9.5** | Type tokens aligned (caption 400, caption-strong, transcript); inset top-bar lines; flex rules; no warning tint on safe cards; selected rows on accent-subtle; header and search overflow fixed; textarea message box. |
| UX | 7.5 → 8.6 → 9.4 → **9.5** | One status word ("Needs you"); counts only where they ask for action; heads-up rows with Stop; Stop Ava in the message box; live lines instead of job counts; a risk line on voice cards; a confirm step for irreversible bulk sends; scoped "Always allow in this folder". |

### Round 3: four system judges, two UI critics

| Review | Score | Changes |
|---|---|---|
| Data layer | 5.5 | Token deltas never stored. Async projector. `usage_events`. Owner epochs and fencing; gap and conflict alarms, never silent drops. An effects ledger and "Did this send?". Graphile-style jobs. One fire per schedule slot. Real roles (RLS bypass closed). Secrets encrypted. Audit head lock with canonical JSON. Disk-full ballast. `fsync_writethrough` on macOS. `pg_upgrade --clone` or `--copy`. Backups when stale, with restore drills. pgvector built by us. Full schema. `uuidv7`. |
| Architecture | 6 | No sidecar: two kinds of child only. No engine supervisor. A single host in release 1. Relay health tells "can't reach" apart from "asleep". Web app served by home, not the relay. Failure table (§7.7). Off-machine backups. Manifest kinds for model and voice. Card fallbacks. Approvals keyed by surface capability. TURN. Embeddings deferred. "Your Weilo computer". Voice budget made honest (≤ 2.0 s). |
| Security | 6 | `~/.weilo-agents` denied to every sandbox. Keychain envelope encryption. Socket or pipe with peer auth only. Encrypted backups and exports. Disk-encryption check. Lost-computer revocation. Taint follows data into summaries and memory. Folds with outside content never fold by themselves. Batch rules. Card budget and anti-fatigue. Session starts are alerts. Relay forwards signed bytes and home re-checks. Signed PG binaries. |
| Product | 6.5 | **Talk v1 in release 1.** Ava only at first. Cloud home as the default with a hosted pilot. Google verification in week 1. Eval gates for computer use and voice. Phases reordered (Your computer, Native, then Make). A Release column and a wedge statement in §1. |
| UI visual | 7.5 | Dark text-tertiary #8A837E; contrast rule; control outlines on border-strong. Avatar tokens. One tab style. Side panel at 400. Session header made calm (details moved to panels). Session icon restored. Keyboard-reachable "+". 44 tap areas. Phone body at 16/24. Off-token colors removed. |
| UX | 7.5 | Bulk approvals need two steps (A opens). The voice code matches the verb. Talk to Ava. Needs you groups. Sidebar edge cases (empty, Agents hidden, Archived). ⌘. to stop. Changes nothing. Dollars, not tokens. One word: agent. **Owner: "don't clutter" became §11.0, Calm by default.** |

### Round 2: owner review

- Postgres as the source of truth, with Rakazo's patterns.
- GPUI researched and rejected for now.
- Buzz ideas (interview, Stop, seen-marks, folded chatter).
- `#` channels and a collapsible, hideable sidebar.
- Design tokens.
- Who-you're-talking-to rule, risk lines, and a Needs you page.

### Round 1: architecture, security, UX, feasibility, consistency

- Engines bound by the host; no real tokens in engines.
- Taint.
- Approval strength.
- Home and workers.
- Mouth and brain voice.
- Honest social and browser plans.
- Three tiers of words.
- First run in two taps.
- Release 1 scoped.
