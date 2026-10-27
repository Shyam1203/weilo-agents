# Weilo 1.0: design and architecture plan

**Status:** draft v4. Nothing here is built yet.

**Reviews behind it:** three rounds of independent review. Round 1 covered architecture, security, UX, feasibility and consistency. Round 2 was the owner's review plus two UI critics. Round 3 was four system judges and two UI critics. §20 lists what each round changed.

**UI mock:** the [Weilo 1.0 UI mock](https://claude.ai/artifact/5P63PzD8BABXgWRzTxwAkP) design canvas (private to the owner). Per CLAUDE.md, no UI is built until the mock is approved.

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

Goals, in order of weight:

1. **Calm and layman-first.** A first-time user has a working agent in two taps. The screen shows only what they need to get what they want (§11.0). Three words to learn.
2. **Safe by default.** Anything that sends, pays, posts, deletes or signs shows a card and waits for a yes. Outside content cannot widen what an agent may do.
3. **Fast.** Budgets are in §7.8.
4. **Simple for developers.** We build on standards: ACP, MCP, MCP Apps, Standard Webhooks. The host runs only two kinds of child process: engines (ACP) and plugins (MCP). Every extension is "a process plus one file". The UI can be built without Rust.
5. **Future-proof.** New engines, models, voices, tools, surfaces and devices plug in through a manifest, not core changes.

### Requirements, and when each lands

| Ask | Where | Release |
|---|---|---|
| Frontier model that never delegates to worse | §6.5 | 1 |
| Cloud and local coding sessions | §5.2 | 1 |
| Real-time voice with tool use (Dots-level) | §8 | **1** (Talk v1); voice codes and phone calls in *Talk+* |
| Codex-level computer use on your computer | §9 | *Your computer* (eval-gated) |
| Its own computer (cloud) | §4, §9 | 1 (browser and Screen); full desktop in *Your computer* |
| Always on | §4 | 1 with a cloud home: hosted pilot or bring-your-own (§19.1) |
| Decks, docs and designs at Artifacts quality | §10.2 | *Make* (eval-gated) |
| Mobile UI like Duet | §11.4 | 1 (PWA); native in *Native* |
| Inline mini apps in chat, email, Slack and more | §10 | 1 (cards and MCP Apps in the app); Slack and email in *Reach* |
| Webhooks | §12 | 1 |
| Built-in social media | §13 | *Reach* (Bluesky, Mastodon, X, LinkedIn, YouTube); Meta and TikTok after review |
| Plugins | §14 | 1 (manifest); marketplace in *Grow* |
| Channels that organize themselves | §5.3 | 1 (interview + rules); classifier in *Make* |
| Agents *and* sessions (monocode) | §5 | 1 |
| Connect to any harness | §6 | 1 (ACP, Claude, Codex); pi in *Reach* |
| Run locally or on a VM | §4, §7 | 1 (macOS, Linux, VM); Windows in *Grow* |
| VM browser stops getting blocked | §15 | 1 (layers 1, 2, 7); more per §15 |
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
| **Settings** | **Computers** (where work runs: "Ava's cloud computer", "Your MacBook"), **Connections**, **Routines** | An agent's page, Settings |
| **Developers** | engine, worktree, MCP, ACP, home host | A session's header chip, advanced settings, docs |

- **Agent:** a teammate who stays. The word is always "agent", never "assistant".
- **Session:** one piece of work in a folder, done by a coding engine. A person starts one, or an agent does ("I started a session to fix the checkout bug").
- **Channel:** always `#name`, in lowercase with one or two words joined by hyphens: `#general`, `#shop-launch`, `#trip`.
- **Icons:** a face means an agent, `#` means a place, and a square code icon means a session.
- **"Your Weilo computer"** is the plain-words name for the home host ("Your Weilo computer is asleep"). The rail page is still **Home**.
- **Display words** (the same on every screen):
  - **Next up**: the queued message.
  - **Tell now** / **After this job**: the split send button while an agent works, and **Send** when it is free.
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

## 4. Where things run

```
 Phone (PWA → native) ─┐                                   ┌─ Your Weilo computer (home): cloud VM or this computer
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
- **The web app is served by home itself** (through the relay's encrypted tunnel), or comes as a signed, pinned bundle in the desktop and native apps. The relay never serves app code, so it cannot read plaintext.
- **Where to run it.** The recommended home is a small always-on cloud VM. A laptop home works but pauses when it sleeps, and the first run says so. §19.1 asks whether we host the VM.

### The relay, honestly

- Live traffic between devices and home is end to end encrypted (Noise IK). The relay forwards ciphertext.
- It also provides **TURN** for voice and for home behind NAT, **push** (only an encrypted reference), and a **24 h mailbox**.
- **What it sees:**
  - webhook requests and bridge traffic (Slack, Telegram, email) arrive in plain text;
  - it forwards the **original signed bytes**, and home checks signatures again;
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
- **Move to another computer** (laptop to VM or back) is one button, or `weilo move`. It exports, imports, re-pairs, and **fences the old home** (§7.4), so two homes never write.

### 24/7 on your laptop

The agent's own cloud computer does the always-on work. The laptop is used when it is awake:

- Laptop jobs wait in a queue ("Will run when your Mac is awake").
- **Allow at night while plugged in** is optional (`caffeinate`/`pmset`, Windows wake timers).
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
- **Where it works**: its cloud computer, and optionally your computer, per app (§9).

Its conversations:

- One **main conversation**, Duet-style.
- **Threads** as tabs, each in a channel.

What it does:

- It **speaks first:** a morning brief, re-checks, and a notification only when something needs you.
- It **starts and watches sessions.**
- It **works in shared channels** with one lead.
- **Stop** is on every working agent.
- A seen-mark shows it picked up your message.

**First run** makes **Ava only**. A Researcher and a Writer are offered as one-tap suggestions, not created for you.

### 5.2 Sessions

- **Starting.** **New → Session**: folder or repo, computer and engine are prefilled. Or an agent starts one.
- **Worktrees.** One git worktree per session.
- **Panels.** **Changes**, **Terminal** and **Preview**. Preview comes after release 1.
- **Header.**
  - The session name, then a subtitle: "Started by Ava in #shop-launch · Your MacBook".
  - On the right, the status ("Waiting for you"), **Ask Ava** and **Stop**.
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
| pi | `pi-acp` | *Reach* |

**An engine is "a process plus one file":**

```jsonc
{ "apiVersion": 1, "kind": "engine", "name": "claude-code", "title": "Claude Code",
  "command": ["npx", "-y", "@zed-industries/claude-agent-acp@1.4.2"],
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

  The sandbox **denies reading and writing `~/.weilo-agents/`** (§16), and all outbound traffic goes through the host's proxy allowlist.
- **Unbound engines** (`bindsApprovals: false`) get the sandbox only: no laptop, no `sends` tools, no Chrome extension.

### 6.4 Credentials

**No engine or plugin ever holds a real token or database access.**

| Kind | How |
|---|---|
| API key (default) | Engine gets a stand-in; the gateway swaps in the real key (manifest `gateway.env`) |
| Subscription plan | Only after legal review clears it for each provider. Then the same gateway is used. Otherwise refused. |
| Weilo credits (if hosted, §19.1) | Prepaid and billed by the gateway. A first-run option next to API keys. |
| Local models | Through the gateway |

### 6.5 Model policy: never delegates to worse

- **Task work** always runs on the agent's model, by default the best on the plan (Opus 5.5).
- **Sub-agents and helper calls inside engines are pinned to the same model** through the manifest's `model.env`. For third-party engines this is best effort; a warning shows when an engine uses another model.
- **Housekeeping may use a small model,** only where no judgment about the task is made: titles, speech-to-text, text-to-speech, the voice "mouth" (§8) and, from *Make*, channel suggestions.
- **Fallback asks first,** and says when data would go to another company.
- **Model providers are manifests** too: `kind: "model"` with `baseUrl`, `api` (`anthropic` or `openai`) and `prices`.

## 7. Inside `weilo-host`

### 7.1 Processes and languages

| Part | Language | Notes |
|---|---|---|
| **Core:** supervisor, event log, auth and pairing, relay link, ACP client, MCP hub, gateway (models, plugins, outbound proxy), scheduler and job runner, webhooks, search, file store, audit, voice orchestrator, secrets | **Rust** (tokio, axum, `sqlx`, `agent-client-protocol` 2.x pinned, `rmcp`) | One binary per platform |
| **Database** | Embedded Postgres 18, run by the core (§7.3) | The only store |
| **Children, two kinds only** | *Engines* (ACP) and *plugins* (MCP), in any language, each sandboxed | Claude Code is an engine. The browser is a built-in plugin (Patchright + Chrome). Social, bridges, docs and decks are plugins. **There is no sidecar.** |
| Computer use on your computer | Rust module: AX, then UIA, then AT-SPI | *Your computer* |
| UI | **React 19 + Tailwind + TanStack Router/Query**, one codebase for web, desktop and PWA | Speed pass: virtual lists, a markdown and highlight worker, `content-visibility`, lazy mini-app iframes, xterm.js with WebGL. **Not GPUI** (§2); revisit in 2027 for one native panel only if profiling demands it. |
| Desktop | Tauri 2, embedding `weilo-host` and its updater | macOS and Linux in release 1; Windows in *Grow* |
| Mobile | PWA in release 1, **Expo / React Native** in *Native* | Push actions, Live Activities, CallKit, widgets |

**Manifest kinds:** `engine`, `connection`, `bridge`, `model`, `voice`. All are a process (or an endpoint) plus one file (§14).

### 7.2 Events and streaming

- **Token deltas are never stored.** They go to clients over the socket with a temporary sub-sequence number.
- **A durable event** is written per finished message, tool call, approval or state change, plus a checkpoint at most once a second for long outputs.
- **An in-process broadcast** fires after commit. NOTIFY is used only when writers live outside the process (bring-your-own Postgres). Every subscriber reconnects by `after_seq`.
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
- **Space and actor columns:** every row has `space_id` and `actor_id` from day one. RLS policies (`FORCE ROW LEVEL SECURITY`, `SET LOCAL app.user_id`) are turned on when shared workspaces arrive. A CI test proves cross-space reads return nothing.
- **Bring your own Postgres** on a server: PG 18 with pgvector, a role that may create roles, and **no transaction pooling** in front of it.

**Core schema** (ids are `uuidv7()`):

```sql
spaces(id, name) · members(space_id, user_id, role)
devices(id, user_id, pubkey, kind, paired_at, revoked_at) · hosts(id, space_id, name, pubkey, epoch, last_seen)
agents(id, space_id, profile jsonb) · channels(id, space_id, slug, title, archived_at)
threads(id, space_id, channel_id, kind, owner_host, owner_epoch, last_seq, title, parent_id, parent_seq) with (fillfactor=70)
events(thread_id, seq, space_id, actor_id, origin_host, origin_at, created_at, kind, source, tainted,
       body jsonb, body_hash, text, tsv tsvector generated, primary key(thread_id, seq))
sessions(id, thread_id, engine, engine_session_id, worktree, host_id, state)
call_results(device_id, call_id, result, at)                 -- idempotent client calls
jobs(id, queue, job_key unique, run_at, attempts, max_attempts, locked_by, locked_until, payload, last_error)
effects(idempotency_key pk, job_id, kind, state: intent|done|unknown|failed, provider_ref, at)
routines(id, space_id, agent_id, channel_id, trigger, action, on_missed) · routine_fires(routine_id, scheduled_for, run_id, pk)
webhook_requests(routine_id, webhook_id, received_at, body_file, pk(routine_id, webhook_id))
approvals(id, thread_id, seq, class, state, expires_at, decided_by_device, decided_via, signature, decided_at)
allow_rules(id, agent_id, tool, scope, created_by_device, revoked_at)
secrets(id, space_id, kind, ciphertext, key_id, rotated_at) · connections(id, plugin_id, account, secret_id, scopes, status)
plugins(id, kind, name, version, manifest_hash, tools_hash, approved_at)
files(sha256, size, mime, created_at, expires_at) · usage_events(id, agent_id, thread_id, model, tokens_in, tokens_out, cost_micros, at)
budgets(agent_id, daily_cap_micros) · push_targets(device_id, provider, token_ciphertext) · notifications(id, user_id, ref, state, at)
ui_prefs(user_id, device_id, prefs jsonb)                   -- sidebar sections, collapsed state
read_marks(user_id, thread_id, seq) · memory_chunks(id, agent_id, text, tsv, embedding halfvec(1024) null, source, tainted)
audit_head(space_id, seq, hash) · audit(space_id, seq, at, actor, device_id, action, detail, prev_hash, hash)
```

**Correctness rules**

- **Appending:**
  1. `UPDATE threads SET last_seq = last_seq + 1 WHERE id = $1 AND owner_host = $me AND owner_epoch = $epoch RETURNING last_seq`;
  2. insert the event;
  3. commit.

  The result is gap-free and fenced.
- **Jobs are at least once.** Every outside effect (send, post, pay) first writes an `effects` row (`intent`) in its own transaction, then calls the provider with the idempotency key where one exists. If the outcome is unknown, there is **no retry**: the state becomes `unknown` and Needs you asks "**Did this send?**". The queue follows Graphile Worker's proven design rather than our own.
- **Schedules** fire through `UNIQUE(routine_id, scheduled_for)`: one run per slot, across daylight-saving changes and catch-up after waking.
- **Webhooks** are deduplicated on home by `(routine_id, webhook_id)`, because the mailbox can replay.
- **Approvals:** `UPDATE … WHERE state = 'pending' AND expires_at > now() RETURNING`. The device signature is checked first, and the decision event is written in the same transaction.
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

- A backup runs whenever the newest one is over 24 h old, at the next idle moment.
- Backups are **encrypted** (age) to a key in the OS keychain plus your recovery code.
- They are **copied off the machine**: the relay mailbox, your S3 or B2, or your other Weilo computer.
- Every week the host restores into a scratch cluster and checks it.
- Settings shows "**Last good backup: Tue 02:14**".
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

### 7.5 Client protocol

One WebSocket per device:

- `hello{version}`
- `sub` / `unsub` (thread, after_seq) → `ev`, plus temporary `delta` frames
- `call{call_id, method, params}` → `ret`, idempotent through `call_results`
- `presence`

**`proto/`** is defined in Rust types. JSON Schema and TS are generated from it (`schemars`, `specta`), and the generated code is committed, so UI contributors need no Rust.

### 7.6 Upgrades

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
| Postgres down | Pool error | Supervised restart; the host goes read-only meanwhile | "Your Weilo computer is restarting its data. (a few seconds)" |
| Disk full | Free-space watch | See §7.3 | "Disk almost full. [Free space]" |
| Model provider error | 5xx or 429 | Back off; fallback asks first (§6.5) | "Opus is busy. Use GPT-6 for this reply?" |
| Effect outcome unknown | Timeout after the call | Never retried | Needs you: "Did this send? [Yes, it sent] [No, try again]" |

### 7.8 Speed budget (p50 / p95)

| Path | Budget |
|---|---|
| App open, warm / cold on a phone | 300 ms / 1 s |
| Sent message shows | 50 ms (shown before the host confirms) |
| Host event to screen | 100 ms on the same network / 250 ms over the relay |
| Approval round trip | 500 ms plus your tap; Face ID is counted separately |
| Session start | 2 s / 4 s, with one sandbox pre-warmed per engine |
| Voice: first audio after you stop speaking | 400 ms |
| Voice: first meaningful word after you stop speaking | **≤ 2.0 s** (stretch 1.5 s) |
| 1,000 threads in the sidebar | 60 fps |
| Idle host total (core + Postgres) | ≤ 200 MB; Chrome and engines are stopped when idle |

## 8. Real-time voice (Talk v1 in release 1)

Voice has two jobs: a fast **mouth** for speaking and a frontier **brain** for thinking. Only the brain thinks.

```
mic ─► WebRTC (TURN via the relay, or LiveKit Cloud) ─► voice orchestrator on home (LiveKit Agents)
   ├─ end-of-speech detector (the service's own; decides when your turn ends)
   ├─ MOUTH (a voice plugin): fillers and the brain's text read word for word; one tool: brain(utterance)
   ├─ BRAIN: the agent's own model (Opus 5.5), voice profile, cache kept warm, tools as usual
   └─ STRICT MODE: no mouth model; streaming STT → brain → streaming TTS
```

- **Latency.** Measured from when you stop speaking:
  - first audio: p50 under 400 ms;
  - first meaningful word (Opus's): p50 at most 2.0 s, stretch 1.5 s.
  - **Release gate:** both are measured on phones over mobile networks.
- **Barge-in.** Speaking over the agent stops it. The transcript is cut to what you heard. Tools keep running.
- **Tools never run from a partial transcript.**
- **Approvals by voice:**
  - The agent reads the details back.
  - **Talk v1 (release 1):** approvals are **tap only**; the card is on screen.
  - **Talk+:** a spoken one-time code that matches the verb ("say *move 47*") for reversible actions and sends. Pay, delete and sign always need a tap.
- **The mouth.** It speaks fillers and the brain's words exactly. It never answers, rewords or calls tools. Its provider is named at the first call: "*Voice runs through OpenAI Realtime. Your audio goes to OpenAI. [OK] [Use strict mode]*".
- **The call bar** (desktop and phone):
  - **Mute · Stop Ava · End**;
  - live captions;
  - a "Back to chat" chevron;
  - the mic light always visible.
- **Voice providers are manifests:** `kind: "voice"`, a LiveKit Agents plugin.
- **Phone number** comes in *Talk+*. An inbound call gets no approvals and no `sends` tools.

## 9. Computer use (*Your computer* phase; eval-gated)

| Where | How |
|---|---|
| **Agent's cloud computer** | A full Linux desktop beyond the browser, driven by Claude's computer-use loop plus AT-SPI. Live in **Screen**. |
| **Your computer** | A Rust module: accessibility tree first, screenshots second, an app's API when there is one. macOS first, then Windows. |

- **Access per agent:** **Off** (default) · **Ask for each app** · **Allowed apps**. There is never full access.
- **The laptop enforces its own policy:**
  - approvals signed by your devices;
  - terminals, password managers, System Settings and admin prompts are never allowed;
  - **a card before clicking Send, Pay, Post, Submit or Delete**;
  - a visible "**Ava is using your computer · Stop**" bar;
  - screenshots cropped to the target window, with notifications hidden.
- **Release gate:** within an agreed margin of Codex on a 50-task OSWorld-style suite, run against our own apps list.

## 10. Cards, mini apps, documents, bridges

### 10.1 Cards and mini apps

- **Built-in cards** (`proto/`): Draft, Approval, Form (secure fields), Choice, Table, Chart, Tracker (pins), File, Diff and Calendar slot. **Every card carries `fallback {text, url}`.** A surface renders the types it knows and falls back otherwise, so adding a card type touches one place.
- **Plugin UI is MCP Apps only** (`ui://`), rendered in release 1 inside the app:
  - a separate origin;
  - no `allow-same-origin`, popups or network;
  - tool calls go through the same cards as the model's.
- **Approval and Draft cards are drawn only by the host,** outside any iframe.
- **Batch cards:**
  - One batch is one action class, one tool and one kind of recipient.
  - A stronger item (a send among archives, an outside recipient) is split into its own card.
  - The card counts anything unusual ("2 aren't newsletters").
  - In a tainted job, the first item and every unusual item are expanded.

### 10.2 Docs, decks and designs (*Make*; eval-gated)

- **Source:** HTML and CSS, with one curated design system.
- **The loop:** the frontier model writes, then a render, screenshot and self-critique loop (overflow, contrast, density, alignment).
- **Exports:** PDF and HTML first, then PPTX and DOCX.
- **Gate:** 30 reference prompts, scored side by side against Claude Artifacts.
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

**On a desktop:**

1. **"Where should your agent work?"**
   - **In the cloud.** *Always on, even with this computer off.* This is the default when hosting is available (§19.1). Otherwise it reads "In the cloud (your own account)", guided, about 5 minutes, with Hetzner or DigitalOcean **sign-in** (OAuth), not a pasted token.
   - **On this computer.** *No server cost. Pauses when it sleeps.*
2. **"Connect your AI."**
   - Weilo credits (if hosted), or a guided **Get an API key**.
   - Plan sign-in only where legal review has cleared it.
   - If a key is found: "**We found your Claude key. Use it?**"

**On a phone:**

1. *On my computer*: pair with a code from the desktop app, with the link "*No desktop app yet? Send me the link*". Or *In the cloud*.
2. Choosing a card selects it. **Continue** moves on. There is a Back link.

**Then:**

- Ava is made. She interviews you in a few questions and makes your channels, then writes first.
- She offers *Plan my week* · *Tidy my inbox* · *Watch a website*. Gmail and Calendar are in release 1, with Google verification started in week 1.
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
  - **Every section collapses.** A chevron toggles it. A collapsed section shows its total and most urgent state: "3 · 1 working", "4 · 1 new", "2 · 1 needs you".
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
  - Groups: **Waiting on a yes · Questions · Didn't work · Expired · Done today**. Empty groups are hidden.
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

- **Home** is the chat with your main agent. "**2 need you**" sits on top as cards you can swipe ("1 of 2"). **For a bulk send, Look first is the primary button.**
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
| caption | 12/16 | 500 |
| body-sm | 13/20 | — |
| body | 14/20 desktop, 16/24 phone | — |
| title-sm | 15/20 | 600 |
| title | 20/28 | 600 |
| display | 28/34 | 600 (first run only) |

Weight 500 means interactive; 600 means a heading.

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
- **Top bars are 56 in every column.**
- Icons 16, 20 or 24, with a 1.75 stroke.
- Chips and buttons never wrap (`white-space: nowrap`).

**Buttons:**
- Primary is accent, one per card (plus the send button), never black.
- Secondary is surface with a border.
- Tertiary is text only.
- Danger is red text on secondary.
- **Tabs everywhere:** a selected tab is a surface-muted fill, never a ring.
- **Messages:** the person's own messages are right-aligned on surface-muted; agents' are left-aligned with a face. The same on phones.

## 12. Routines and webhooks

- **A routine** is a trigger (a time, a webhook, a connection event, a pin change), plus what to do (a prompt, or an Instant script with no model), plus who and where. Routines are written as sentences: "*Every weekday at 8:00 · Send me a brief*".
- **Incoming webhooks:**
  - One URL per routine.
  - **Standard Webhooks** HMAC is checked at the relay *and again on home*, using the original bytes. There is a 5-minute window.
  - Duplicates are dropped on home by `(routine_id, webhook_id)`.
  - At most 1 MiB, answered at once with `202 {run_id}`.
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

- **For developers in one sentence:** every extension is a process (MCP for connections, bridges and voice; ACP for engines) or an endpoint (models), plus this file.
- **Runtime:**
  - Local plugins run out of process, sandboxed, with `network` enforced by the proxy.
  - Remote plugins can't be enforced, and the install screen says so.
- **What counts as a send.** The host decides. Read-only MCP annotations run without a card. **An unannotated tool counts as a send.** Weilo ships curated annotations for built-in and marketplace connections.
- **Approval fatigue.** Each agent has a daily card budget. Past it, cards are grouped and the agent proposes an **Always allow rule** for you to read once (never in a tainted job). Approvals on send-class cards that come in under 1 s trigger a short pause ("Take a look first").
- **Supply chain:**
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
| 9 | **Web Bot Auth** (RFC 9421) and Cloudflare signed agents. | *Grow* | On where accepted |

**Routing:** your own Chrome for signed-in sites; otherwise the VM's Chrome; on a block, your proxy (if set), then hand-off.

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
- Secrets use **envelope encryption.** The master key lives in the OS keychain (Keychain, DPAPI, libsecret; on a VM a key file or KMS). The `secrets` table holds only ciphertext.
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

**Engines and plugins**

- Bound (§6.3) and holding no tokens or database access (§6.4).
- Hand-off to an engine's own terminal app on a computer that holds home's database needs a confirm card.

**The laptop trusts no host:**

- its own policy;
- approvals signed by your devices;
- short-lived tokens scoped to one session.

**Devices**

- Passkeys in the PWA; the Secure Enclave or Keystore in native apps.
- A safety number at pairing.
- Revoke from anywhere.
- A recovery code.
- Push carries only an encrypted reference.

**Approval strength, by surface capability** (§10.3):

| Action class | Paired device | Owner-verified buttons | Link only | Voice | Laptop |
|---|---|---|---|---|---|
| Read / look | No card | No card | — | No card | Per-app permission |
| Reversible | Tap | Owner's click (signed) | Confirm page + passkey | Talk+: code; v1: tap | Device-signed card |
| Send / post / submit | Tap + passkey or Face ID | "Open in app" | Not offered | Talk+: code; v1: tap | Device-signed card |
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
- **CI:** type checks, tests, accessibility and contrast, token lint, `weilo engine test` for each bundled engine, a Postgres restore drill, and a smoke test of the release image.

## 18. Phases

**Release 1, "Always on, and you can call it": about 16 weeks** for 2–3 developers working with AI. The full scope takes 12–18 months in total.

| Weeks | Ships |
|---|---|
| 1–2 | Monorepo, `proto/`, tokens and component library, echo and replay engines, CI. **Embedded Postgres gate** (macOS, Linux). Browser measurement. **Start reviews:** Google OAuth verification (and a CASA assessment if needed), Meta, TikTok, LinkedIn, Cloudflare signed agents, legal on subscription plans. |
| 3–6 | `weilo-host`: Postgres, events, projector, jobs and effects, secrets in the keychain, pairing, **the relay with E2E, TURN and health**, one WebSocket, the gateway. Engines: generic ACP, Claude Code, Codex. Sessions with worktrees; Changes and Terminal. MCP hub. **Week 6 checkpoint:** decide whether to continue or change course. |
| 7–10 | Agents, memory (search), routines, Needs you, cards and MCP Apps, the interview that makes channels, rule-based filing. New layout, the customizable sidebar, ⌘K. **Gmail, Google Calendar, web.** Browser layers 2 and 7. Taint, the effects ledger, the failure table. |
| 11–13 | **Talk v1:** mouth and brain, call bar, captions, tap approvals, latency gate. PWA with passkeys and push. First run. |
| 14–16 | Incoming webhooks. Off-machine encrypted backups and restore drills. macOS and Linux installers (signed and notarized), the cloud VM image. **Cloud home:** the hosted pilot (if decided), or bring-your-own with Hetzner/DigitalOcean sign-in. Beta hardening. |

**After release 1**, in order:

| Phase | Weeks | Ships |
|---|---|---|
| *Your computer* | 6 | Workers (§7.4); macOS computer use; full desktop on the cloud computer; Chrome extension (layer 3); OSWorld-style gate |
| *Native* | 6–8 | Expo apps: push actions, Live Activities, CallKit, widgets |
| *Talk+* | 3 | Voice codes, phone number (SIP), a voice per agent |
| *Make* | 6 | Docs and decks (eval gate), embeddings, the channel classifier, Preview panel |
| *Reach* | 6 | Slack, email address and Telegram bridges; social; pi engine; browser layers 4 and 5 |
| *Grow* | 6 | Windows (desktop, embedded Postgres, computer use); marketplace and SDK; browser layers 6, 8, 9; shared workspaces (RLS on) |

**Cost controls in release 1:** a forecast per agent, a hard daily cap, and VM costs shown in Usage.

## 19. Decisions for you

1. **Hosted cloud computers.** The vision ("always on") and a layman first run both point to hosting a pilot in release 1: invite-only, with a hard spend cap and Weilo credits. The alternative is bring-your-own only. *Recommendation: a hosted pilot.*
2. **Mobile.** PWA in release 1, then Expo. *Recommended over Tauri mobile.*
3. **Subscription plans.** API keys (or Weilo credits) by default; plans only where legal review clears them.
4. **Stealth browser layers 6 and 8:** off by default, opt-in per site, after legal review.
5. **License.**

## 20. What the reviews changed

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
