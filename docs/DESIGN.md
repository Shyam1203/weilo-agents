# weilo-agents: design

A chat app for the pi coding agent. Pi runs in a Docker container; a small daemon in that
container serves the UI and runs pi. All user data is one host folder, `~/.weilo-agents`.

## Decisions

| Topic | Decision |
|---|---|
| Runtime | Docker only (host mode later; the daemon has no Docker code). |
| Daemon | Inside the container, as its main process. No Docker socket. |
| Data | `~/.weilo-agents` mounted at `/home/node/.pi`. Copy it to move machines. |
| Providers | No setup page. No provider yet: composer disabled, "Add a provider" opens Settings. Keys only. The agent form picks the first connected provider, but the model is always yours to choose. A connected provider has Models and Edit key (the same field replaces the key). |
| Agents | Lean profiles: a folder with one file, `agent.json`, which holds the instructions too. Shared pi config. Each agent is one continuous conversation (messenger style): no chat list, no titles. |
| Network | No token. Port on `127.0.0.1` only, plus `Host`, `Origin` and `Sec-Fetch-Site` checks; no other site may frame the app. |
| User | Non-root `node` (uid 1000). Agent installs (`npm -g`, `pip --user`) persist in volume `tools`. `start.sh` makes `~/.weilo-agents` first, so Docker does not make it as root. |
| Names | Stack `weilo-agents`, container `weilo-core`, image `ghcr.io/shyam1203/weilo-agents:<version>`. |
| Versions | One `VERSION` file (SemVer). The image build takes `VERSION` and `COMMIT` as build arguments and keeps them as `WEILO_VERSION`, `WEILO_COMMIT` and `WEILO_PI` (`daemon/version.mjs`, `GET /api/version`, Settings > About) and as OCI labels. A `v*` tag runs `.github/workflows/release.yml`: it builds amd64 and arm64, pushes the image and publishes a release with a zip (`compose.yaml`, start scripts, `VERSION`). The start scripts set `WEILO_VERSION` from `VERSION`, pull that image, and build only if the pull fails. The data folder has `weilo.json` `{dataVersion, version}` (`daemon/migrate.mjs`): older data is brought up by ordered steps at start, newer data stops the start with a message. See `docs/RELEASING.md`. |
| Hardening | `cap_drop` NET_RAW and NET_ADMIN, `no-new-privileges`. |
| Attachments | Images go to pi as image blocks. Other files are saved to `workspace/uploads/` and named in the message. |
| Thinking | Optional per agent (`off` to `max`); empty means pi's default. |
| Launch | `start.cmd` (Windows) and `start.sh` (macOS, Linux) run `docker compose up -d --build`, wait up to 90 seconds for the app, and open the browser. |
| Models | Settings lists each provider's models; the ones switched on are pi's `enabledModels` (`settings.json`) and are all an agent's form offers. None switched on means all. |
| Skills | Pi's own `agent/skills/`, added by uploading a `.zip` (no links inside) or `SKILL.md`. An agent's profile lists the ones it uses; pi starts with `--no-skills --skill <path>` for each. |
| Shortcuts | Typing "/" in the message box lists the agent's skills (pi's `get_commands`, source `skill`) and plugins. A skill inserts `/skill:name`, which pi expands; a plugin inserts a starter sentence. Chats and the agent list show the typed `/name`, not the expansion. Pi's own terminal commands, prompt templates and extension commands are not offered. |
| Plugins | MCP servers in pi's `agent/mcp.json`, added in the UI as a command or a web address (no OAuth sign-in yet). A profile lists the ones an agent uses; pi gets them in its `--tools` allowlist, and `--no-mcp` when there are none. Secrets stay in `mcp.json`. |
| Extensions | Everything an agent can do beyond chat is a pi extension: a folder with a `weilo.json` (`apiVersion` 1, `name`, `description`, `entry`, `tools`; optional `title`). Pi loads each with `-e <entry>` and the daemon adds its `tools` to `--tools` (pi hides a tool the allowlist does not name). Two kinds, listed together by `GET /api/extensions` (`builtin` tells them apart). **Bundled** ones are the `extension/` folder of `browser/` and `routines/` in the daemon (in the image under `/app`): an agent has them unless its profile's `disabled` list names them (Edit agent: Built-in extensions, a switch each), and they cannot be deleted. Each calls only the daemon's HTTP API (through the shared `tool.mjs`), so another extension can replace it: add one that declares the same tool, and turn the bundled one off for that agent. With both on, saving the agent is refused (two extensions add one tool). **Added** ones are uploaded as a `.zip` (at its top, or in the one folder that wraps it), unpacked with the skills' checks (no links, size limit) into `agent/extensions/<name>/`; a tool name pi, the chat or memory uses (`show`, `ask`, `memory`, `fetch_knowledge`) is refused (and left out if an older one declares it), so is an entry outside the folder or a name a bundled one has. Adding asks first: the code runs with the agent's rights and can read the keys. An agent's profile lists the added ones it uses (`extensions`). Nothing else in `agent/extensions/` loads (`-ne`). Memory is not switchable: every agent has its tools, notes and a place in the curator's reading (`memory/extension.mjs`, loaded with `weilo.mjs`), because any agent can search every chat and read the memory files anyway. An agent's instructions say whether it should use memory. Not changed by a switch: routines already set keep running, and other agents' `fetch_knowledge` still searches this agent's chat. The UI's browser and routines panels show "turned off" for an agent that has the extension off. Not done: pages or blocks drawn by an extension in the chat. |
| Access | Every agent has the same pi tools (`read`, `bash`, `edit`, `write`) and may use anything inside the container, including the keys. There is no read-only mode: it only hid the file tools and still let an agent read `auth.json`, so it was not a boundary. |
| Show | `daemon/weilo.mjs` is a pi extension (`-e`) that gives every agent the chat's own tools, `show` and `ask`. `show` is: a list of blocks (text, table, metrics, cards, chart, buttons, file, page). The UI draws them from the tool call in the saved conversation (`blockData.ts`/`ShowBlocks.tsx`); no AG-UI layer, pi's events are enough. Cards and buttons send a message as the user's reply; the chosen one stays marked. Unknown or malformed blocks are dropped. |
| Files | `GET /api/files/<path>` serves a real file inside `workspace/` (symlinks resolved). Pictures show inline; everything else downloads, with `Content-Security-Policy: sandbox`. With `?view=1` (the chat's preview) a text file is sent as plain text and a PDF inline (a PDF is not sandboxed: the browser's viewer does not run in one). The chat previews (`features/files/`) pictures, PDFs, Markdown, CSV/TSV (a table), JSON, HTML (the same sandboxed frame as a `page` block) and text or code; other files only download. A file block has Preview and Download; an agent's text that names a file as inline code with its workspace path (`/home/node/.pi/workspace/…`) becomes a button that opens the preview. |
| App | `GET /api/version`; `GET`/`PUT /api/update` (`update.mjs`: the newest GitHub release, asked at most every 6 hours, only if `checkUpdates` in `weilo.json` is not false and not for a `dev` build; the sidebar and Settings > About say when one exists, and the user runs the start script again); `POST /api/contact` (`contact.mjs`: Contact us, from the mail button beside Settings, forwards name, email and message with the app version to weilo-api's `POST /public/contact`; nothing from the chats). |
| Pages | A `page` block is agent-written HTML in an iframe with `sandbox="allow-scripts"` (empty origin: no access to the app, API or storage), a content policy that allows https only, and the app's own `frame-src about:` so the frame can't navigate. It talks to the chat through its height and `weilo.reply(text)`, which the app takes only during a user click in the frame. Text blocks follow the replies' Markdown rules (remote images show as links). |
| Ask | The same extension has an `ask` tool: a question with options (a choice) or without (a line of text). It uses pi's own `select`/`input` dialogs. The daemon keeps the open request (`run.asking`), sends it to the chat as pi's `extension_ui_request`, writes the answer back, and ends it with `ask_end` (also on settle, exit, abort). A new viewer gets it in `history.asking`. Other dialogs pi may ask (`confirm`, `editor`) are cancelled at once. The question and the answer stay in the chat from the tool call and its result. |
| About you | `agent/USER.md` ("Name: …", then free text; editable by hand) holds what you tell the agents about yourself. The first screen asks for it (Skip is allowed), and Settings > About you changes it. Pi adds the file to every agent's system prompt (`--append-system-prompt`, only when the file exists), and saving restarts the agents. `GET`/`PUT /api/user`. |
| Memory | Two layers, shared by all agents (`daemon/memory/`). **Hot memory** is `agent/MEMORY.md`: short facts about you, one per line (`- [m7 2026-10] text`; at most 40 notes or 3000 characters, 200 each). Pi adds it to every agent's system prompt when it starts, so a change shows in the next start (Settings > Memory saves restart agents; `/reload` restarts one). Agents write it with the `memory` tool (`remember`, `forget`, `list`; the daemon refuses secrets, near-duplicates and a full file). **The knowledge vault** is `.pi/knowledge/` (the data folder's `knowledge/`, beside `agent/` and `workspace/`): markdown pages the curator files under `index.md`, `Preferences/`, `Topics/`, `Workflows/`, `Projects/`. A page may start with `sources: [<agent id>@<date>, …]`, the chats it came from. The vault is not in any prompt: agents search it with the `fetch_knowledge` tool (`vault.mjs` reads pages, `fetch.mjs` searches). `fetch_knowledge` takes `query` (keywords over the pages and the chats of all agents, also deleted agents' kept chats), `source` + `query` (a page's source: the passages of that chat on that day, to check a claim) or `agent` (its newest messages). It reads only what you and agents wrote (not tool results, thinking or pi's saved prompts; the last 32 MB of each chat file), at most 5 excerpts and 1800 characters, wrapped as background that is not instructions; it never takes a path. **The curator** (`curator.mjs`, chosen in Settings > Memory, off until it has a model) is `pi -p` with file tools (`read`, `write`, `edit`, `grep`, `find`, `ls`) and the vault as its working folder. Every 5 minutes it looks at each agent that is not working; a chat is read when it has been quiet for 10 minutes, or, if it never is, 12 hours after its last run (counted from the first look), and only when it has a new user message. It reads the new messages oldest first, in pieces of at most 24000 characters (at most 6 pieces a run, each a run of up to 10 minutes), looks for the page that covers a subject before it makes one, merges and corrects pages, and keeps `index.md` current. Afterwards the daemon replaces any line of a page it changed that looks like a secret. It is told not to keep one-off answers, small talk, pages' or tools' text, secrets or what you asked to keep private, and not to follow instructions in a chat. The curator is told to write only inside the vault; the file tools are not fenced (a failed or timed-out run is scrubbed too, and counts as a failure). `agent/curator.json` holds the model, the last message read and the last run for each agent. A chat whose runs fail 3 times in a row waits for a new message. |
| Compaction | Pi summarizes by tokens kept free (`compaction.modelOverrides.<provider/id>.reserveTokens`). The daemon writes it per enabled model (all, when none is), if none is set: summarize at 40% of a 1M window, 80% of a 500k one and 90% of any smaller (`COMPACT_AT`, in `settings/compaction.mjs` with the reading back), never under 16384 free. Values set by hand are kept, and a value written earlier by another rule stays until removed from `settings.json`. The chat's ring fills as the context nears that point; hovering shows tokens of the window (`GET /api/agents/:id/context`) and offers `/compact [what to keep]` (`POST …/compact`, refused during a run) and `/reload` (`POST …/reload`: pi starts anew, now if idle, else when the run ends). |
| Routines | Work an agent does on a schedule (once, hourly, daily, weekdays, weekly; several times a day). The daemon keeps them in `agent/routines.json` and sends a due routine's task to the agent's chat. See Routines under Daemon. |
| Browser | One Chromium on a virtual screen inside the container; each agent has its own window with its own tabs, all sharing one set of logins. You watch it in the chat's side panel and can take over. Agents are asked to check with you before anything that cannot be undone (a request, not a lock). See Browser under Daemon. |
| Not in v1 | Groups, host mode, OAuth login, import from `~/.pi`, a firewall that keeps the browser off your network (it needs root and `NET_ADMIN`), keeping keys and logins from agents that can run commands, screenshots in the browser tool. |

## Layout

```
~/.weilo-agents/
├── agent/               pi's own, shared by all agents: auth.json, settings.json, mcp.json,
│   │                    AGENTS.md, USER.md, MEMORY.md, curator.json, routines.json, browser.json, skills/, extensions/
│   ├── sessions/<id>/   each agent's conversation
│   └── profiles/<id>/   Weilo agent profiles
│       └── agent.json   { "name", "model", "thinking", "skills", "plugins", "extensions", "disabled", "instructions", "avatar" }
├── knowledge/           the vault the curator keeps (markdown pages)
└── workspace/           the shared computer's files
```

Two Docker volumes sit beside it: `tools` (`~/.local`: what agents install with npm and pip) and `browser` (Chromium's profile: logins and cookies).

Repo: `compose.yaml`, `image/Dockerfile`, `daemon/`, `ui/`. The daemon runs in the container as
its main process on port 3210 (published on `127.0.0.1` only) and serves the built UI.

## Architecture

```
browser ─► 127.0.0.1:PORT ─► weilo-core container
                              └─ daemon (Node, no dependencies)
                                  ├─ static UI
                                  ├─ JSON API + SSE
                                  ├─ one `pi --mode rpc` per open agent
                                  └─ Xvnc + openbox + Chromium (the browser)
```

The host launcher is `docker compose up -d` plus opening the browser.

## Daemon

**Job:** serve the UI, manage agent files, write provider keys, run pi, relay its events.

**Open an agent** (cwd `workspace/`, so sessions line up across reinstalls):
```
pi --mode rpc [--model <m>] [--thinking <level>] \
   --append-system-prompt agent/profiles/<id>/agent.json \
   [--append-system-prompt agent/USER.md] [--append-system-prompt agent/MEMORY.md] \
   -ne -e builtin:mcp -e builtin:codemode -e builtin:tool-search -e builtin:llama.cpp \
   -e /app/weilo.mjs -e /app/memory/extension.mjs [-e /app/<feature>/extension/<entry> …] [-e agent/extensions/<name>/<entry> …] \
   --no-skills [--skill agent/skills/<skill> …] \
   --tools read,bash,edit,write,show,ask,memory,fetch_knowledge[,browser][,routine][,<extension tools> …][,codemode,mcp__<plugin>__* …]   (--no-mcp when it has no plugin) \
   --session-dir agent/sessions/<id> --session-id <id>
```
The session id is the agent id, so opening an agent always resumes its one conversation
(pi compacts long history itself). Pi has no profiles; this command is the profile. Checked on pi 1.1.0: a model that does not exist exits with
an error; a missing instructions file does not (pi starts without it).
An agent's pi loads only pi's built-in extensions (`PI_BUILTINS` in `config.mjs`) ours, and its extensions (above): `-ne` turns off discovery, so an extension left in `agent/extensions/` or named in `settings.json` never runs in an agent. `-ne` also drops the built-ins, so each is named again; one left out is lost (`mcp` is plugins, `codemode` and `tool-search` come with them, `llama.cpp` is the `/llama` provider). Checked on pi 1.1.0 with a probe extension and an MCP plugin: the tools and commands match the old command line. A project's `.pi/extensions/` was already not loaded (pi's project trust).

**API** (JSON):

| Route | Does |
|---|---|
| `GET /api/version` | `{version, commit, pi}` of this build (`dev` / `unknown` when built from a checkout) |
| `GET /api/providers` | `[{id, name, keyUrl, connected}]` |
| `PUT /api/providers/:id` `{key}` | merge into `agent/auth.json` (mode 0600); never returned |
| `DELETE /api/providers/:id` | remove the key |
| `GET /api/models` · `PUT /api/models` `{enabled}` | models the keys can use (`get_available_models`) · set pi's `enabledModels` |
| `GET /api/user` · `PUT /api/user` `{name, about}` | what agents know about you (`USER.md`) |
| `GET /api/memory` · `PUT /api/memory` `{text}` · `PUT /api/memory/curator` `{model}` | `{text, model}`: the `MEMORY.md` file and the curator's model ("" is off) · save the file (kept lines become notes) · choose the model |
| `POST /api/agents/:id/memory` · `…/fetch_knowledge` | `{text}` from a step of the `memory` and `fetch_knowledge` tools |
| `GET /api/skills` · `POST /api/skills` `{name, data}` · `DELETE /api/skills/:id` | list · add a `.zip` or `SKILL.md` (base64) · remove |
| `GET /api/extensions` · `POST /api/extensions` `{name, data}` · `DELETE /api/extensions/:id` | `[{id, name, description, tools, builtin}]` · add a `.zip` (base64) · remove |
| `GET /api/plugins` · `GET /api/plugins/status` | `[{name, detail}]` · whether each connects (`pi mcp list`) |
| `POST /api/plugins` `{name, command, env}` or `{name, url, token}` · `DELETE /api/plugins/:name` | add to `mcp.json` · remove |
| `GET /api/agents` · `POST /api/agents` | list · create (daemon makes the id, writes both files) |
| `PUT /api/agents/:id` · `DELETE /api/agents/:id` `{keepChat}` | edit · stop pi and delete the folder, and its sessions unless `keepChat` (they stay in `agent/sessions/<id>`, out of sight) |
| `GET /api/agents/:id/events` | SSE: history (`get_messages`), then live events; starts pi if needed |
| `POST /api/agents/:id/message` `{text, images, files}` | `prompt` (`steer` if a run is active). Images (data URLs) go to the model; files are saved in `workspace/uploads/` and named in the message |
| `POST /api/agents/:id/abort` | `abort` |
| `POST /api/agents/:id/answer` `{request, value}` | the answer to the agent's open question (`extension_ui_response`); no `value` skips it |
| `GET /api/agents/:id/commands` | the agent's skills as `/commands` (`get_commands`) |
| `GET /api/agents/:id/routines` · `POST /api/agents/:id/routines` `{title, task, every, times, day?, date?, in_minutes?}` | the agent's routines, next to run first · add one (its time zone is the `X-Timezone` header) |
| `PUT /api/agents/:id/routines/:rid` · `DELETE /api/agents/:id/routines/:rid` | change (send only what changes) · remove |
| `POST /api/agents/:id/browser` `{action, …}` | a step in the agent's browser window; returns `{text}` (the `browser` tool calls this) |
| `GET /api/agents/:id/browser` · `POST …/browser/show` · `…/take-over` · `…/give-back` | `{taken, hasWindow}` · bring its window to the front · stop its run and let you use the window · let it carry on |
| `GET /api/browser/rule` · `PUT /api/browser/rule` `{ask, rule}` | when agents must ask first, and for what |
| `WS /api/browser/view` | the screen (noVNC), with the same checks as the API |
| `GET /api/files/<path>` | a file in `workspace/` (see Files under Decisions) |

**Routines:** work an agent does on a schedule. `routines/routines.mjs` keeps them in `agent/routines.json` and checks every 30 seconds; `routines/schedule.mjs` has the time math. A due routine goes to the agent's chat as a message that starts with `⏰ Routine: <title>`, then a line telling the agent to do the task and reply with the result only (`steer` if a run is active; pi starts if it is not running). `every` is once, hour, day, weekday or week. `times` are one or more "HH:MM" (twice a day is two times; hour and once take one); `date` is for once (`YYYY-MM-DD`, `today` or `tomorrow`; or give `in_minutes` instead of date and time). Times are wall-clock times in the routine's time zone: the browser's (it sends `X-Timezone` with every request; the routines routes read it, and the zone of the browser that last opened the routines is kept for routines an agent adds). A time that a clock change repeats runs once, at the earlier time; one it skips runs at the later time (checked for zones on both sides of UTC). A routine whose agent does not take the task within a minute is marked failed, so one stuck agent does not hold up the others. A routine moves to its next time, and that is saved, before its task is sent: a crash skips a run and never repeats one. A routine missed by more than an hour (the computer was off) waits for its next time. A one-time routine that ran is removed; one that was missed or failed stays in the list with its error. A one-time routine in the past is refused. Agents add and change their own with the `routine` tool (`routines/extension/`), which calls these routes (`WEILO_API` and `WEILO_AGENT` tell it where and who). Its result carries `details` (`{action, title}`), from which the chat shows a short line ("Routine added: …"); a routine run shows as "Routine: <title>" and the message's text is hidden. The chat's right-hand panel (the globe button in the top bar shows or hides it; on a narrow screen it opens over the chat) holds the browser screen and, below it, the agent's routines in groups by when they run next (Today, Tomorrow, This week, Next week, Later), each with a countdown ("in 5 min") when it runs within a day.

**Browser:** one Chromium and a virtual screen in the container. `browser/screen.mjs` starts them and starts them again if they stop: Xvnc (1280x800, on a unix socket only), openbox (no window frames, windows maximized), and Chromium (profile in the `browser` volume, so logins stay; remote debugging on 127.0.0.1:9222). The live view is a WebSocket at `/api/browser/view`: after the same checks as the API, the daemon turns it into plain VNC on the socket itself, so no other port exists for a web page in Chromium to reach. Pages cannot reach the app (port 3210) or the debugging port (9222) either: a Chromium policy (`image/chromium-policy.json`) blocks those addresses, and the `browser` tool refuses them with a message. `browser/browser.mjs` drives Chromium with `playwright-core` (installed globally in the image and found through `NODE_PATH`; the daemon has no npm packages) over the debugging port. All agents share the browser and its logins, and **each agent has its own window with as many tabs as it needs**: the browser's window id tells them apart, so a tab that a page opens joins its agent's window, and an agent only sees and uses the tabs of its own window. An agent reads a page as text (Playwright's accessibility snapshot, where each element has a ref such as `e13`) and acts with `click`, `type`, `press`, `scroll`, `back`, `open` and tab actions; each step returns the page again. An agent's steps run one after another. A window that you closed opens again at the agent's next step, and one that you minimized comes back (the screen has no taskbar). Deleting an agent removes its profile and routines first (so nothing starts its pi again), then stops it, waits for a running browser step, closes its window and removes its chat. The `browser` tool (`browser/extension/`) calls `POST /api/agents/:id/browser`.

**Take over:** the panel at the top of the chat's right-hand side shows the screen with the agent's window in front. Take over stops the agent's run (`abort`), waits for a step that was running, opens its window if there is none, and lets you use it; the agent's browser steps are refused until you give it back. Give back sends the agent a message to read the page again and carry on (only if its run was stopped). The agent list shows "You have the browser" for an agent you took over, also when you open another chat. A window that another agent opens does not cover the one you took over.

**Ask first:** `browser/rule.mjs` keeps `agent/browser.json` `{ask, rule}`, set in Settings > Browser. The rule goes to every agent in its browser tool's description (`WEILO_ASK_BEFORE`), and the agent uses `ask` before it does what the rule names. It is a request to the agent, not a lock: an agent that can run commands, or only read files, can still read `auth.json`, `mcp.json` and the files in `agent/` (the Read only choice says so), and one that can run commands can reach the daemon's API. Keeping keys and logins from such agents is later work.

**Events:** relay pi's own events unchanged (`message_update` text/thinking/tool-call
deltas, `tool_execution_*`, `agent_settled`). They already are a typed streaming protocol,
so there is no AG-UI translation layer; the UI renders pi's events. (AG-UI stays an option
if other frontends appear.)

**Stream:** SSE, one JSON event per message. First `{type:"history", messages, busy}`, then pi's
events, and `{type:"exit", code, error}` when pi ends (`error` is pi's last stderr line, e.g.
"Model … not found"; exit code 0 is a normal restart).

**Process rules:** one pi per open agent, started on first use. It stops after 10 idle
minutes with no viewer and no run, on delete, on SIGTERM, and when its agent, a skill or a
plugin changes (so the change applies: at once if idle, else when the run ends; viewers
reconnect to the new pi). A message during a run is queued into it (`steer`). Split RPC lines
on LF only (not Node `readline`).

**Access:** no login. The port is published on `127.0.0.1` only, and the daemon rejects
requests with an unexpected `Host` or `Origin`, and anything another site loads from it
(`Sec-Fetch-Site`; a plain link still opens the app). This blocks other websites and DNS rebinding.
Other programs running as the same user are not blocked; add a token if that ever matters.
**Remote use:** the host may also be a Tailscale name (`*.ts.net`), and an `https://` origin of the same host is accepted. On the host, `tailscale serve --bg 3210` forwards the tailnet's HTTPS address to the published port, so the port itself stays on `127.0.0.1`. Anyone on the tailnet can then use the app; there is still no login.

**Files** (`daemon/`, copied to `/app` in the image; Node built-ins only, plain relative imports):

```
server.mjs          entry: the API's routes, the server, the background jobs
config.mjs          the values to tune (port, timeouts, limits, intervals), grouped by feature
common.mjs          data paths, errors, private JSON and text files
weilo.mjs           the pi extension (`-e /app/weilo.mjs`): show, ask
tool.mjs            what the bundled extensions share: the API call and the tool helper
version.mjs         what this build is (version, commit, pi), from the image's environment
migrate.mjs         brings the data folder to this app's data version at start (weilo.json)
http/               request.mjs (Host/Origin checks, JSON body and reply), static.mjs (the UI),
                    events.mjs (SSE), files.mjs (workspace files)
agents/             agents.mjs (profiles), runner.mjs (pi processes), pi.mjs (spawn and RPC framing),
                    sessions.mjs (chat files and their messages, newest message for the list), uploads.mjs (attachments)
memory/             memory.mjs (the MEMORY.md notes), vault.mjs (the vault's pages), fetch.mjs (search), curator.mjs (the curator)
routines/           routines.mjs (store and runs), schedule.mjs (time math)
browser/            screen.mjs (Xvnc, openbox, Chromium; the live view), browser.mjs (the browser tool, take over),
                    rule.mjs (ask first)
settings/           providers.mjs (keys, models), compaction.mjs (when pi summarizes), plugins.mjs, skills.mjs, extensions.mjs, zip.mjs (the unzip checks they share), user.mjs (About you)
```

Each of `browser/` and `routines/` has an `extension/` folder (`weilo.json`, `index.js`): the bundled extension that gives agents its tool (memory's is `memory/extension.mjs`, loaded for every agent). They run inside pi,
not the daemon, and only call the daemon's HTTP API (`tool.mjs` has the shared call); it may import plain constants (`config.mjs`, `routines/schedule.mjs`), so the limits and
schedule words in its tool descriptions are the daemon's own.

The UI repeats a few of `config.mjs`'s limits in `ui/src/lib/limits.ts`. Keys are not verified
when saved: a bad key shows up as pi's provider error in the conversation.

## Frontend

React 19, Vite, Tailwind 4, TypeScript; `react-markdown` + `remark-gfm`, `lucide-react` (icons)
Geist (two fonts) and noVNC (the browser's screen, loaded on first use) are the only other dependencies. The look (tokens, UI kit in
`components/ui`, avatars, bubbles) is ported from the earlier weilo-agents app; the brand (logo,
favicon, Lucide icons, Geist, the Weilo Theme's ember colours) is weilo-brainweave's. The data
layer is ours. Built in a Docker build stage, so the image holds static files only. No router or
data library. Dark and light by system setting; Settings > Appearance picks Light, Dark, or the
Weilo Theme (`data-theme` on `<html>`, which overrides the colour tokens).

- Sidebar: the name "Weilo Agents" as plain text, then agents (avatar, name, newest message), + New agent, Skills, Plugins, Settings. On a
  phone, list and chat are separate screens. Edit agent opens from the chat's title, and Delete (with its choice to keep the chat) is in that form; it has
  avatar, name, instructions, then cards of rows: Model (provider, model, thinking), Built-in extensions (a switch each) and Add-ons (skills, plugins, extensions: each row says what is on and opens a list of switches, or "Add" when there are none).
- Chat state is one reducer over pi's events (`features/chat/useChat.ts`): history, then live
  text, thinking and tool-call deltas. `conversation.ts` holds the reducer and maps pi's messages to bubbles.
  Thinking and tool calls are not shown (except `show`, a question the agent asks, and a line for what it did with a routine), and an agent's text appears when its message is complete, so text that comes with a tool call never flashes; a pill above the composer says "Working" (or "Waiting for you") and folds when clicked. The composer floats over the chat. While the agent waits for your answer, a message you type in the box is the answer.
- Composer: text, attachments (files and photos, camera, paste, drop) and voice typing; disabled
  with "Add a provider" until a key exists. Stop appears while a run is going. A failed start
  closes the stream and shows pi's message with Try again; a clean restart reconnects by itself.
- Settings, Skills and Plugins are one page in place of the chat (`features/settings/SettingsView.tsx`; the chat stays mounted behind it, so a draft survives; opening it reads the lists again): a menu on the left (Providers, About you, Memory, Browser, Appearance, About, then Add-ons: Skills, Plugins, Extensions; on a phone, the list of pages first, then the page with a back arrow) and a page on the right made of rows (`components/ui/Row.tsx`: title and description on the left, the control on the right). The sidebar's Skills, Plugins and Settings buttons open it at their page.
- Settings > Providers: a key field per provider, Connected tag, Models (which ones agents can
  pick), Remove. Keys go to the daemon only.
- Model is two dropdowns: a provider, then one of its enabled models (all of them when none is).
- Dev: `npm run dev` in `ui/` (proxies `/api` to the container).

## Later

Saved pages in a side panel. Host mode
(same daemon, direct launch). Import from
an existing `~/.pi`. Pi Durable if crash recovery is needed.

## Also decided

One shared `workspace/` for all agents. "Start over" (pi `new_session`) is later. No open questions.

## References

- [thesysdev/open-intelligent-ui](https://github.com/thesysdev/open-intelligent-ui): a demo
  of ChatGPT-style "Intelligent UI" on OpenUI (Next.js, Zod, MapLibre). Generative UI works
  through a component catalog: each component has a Zod schema, the catalog spec goes into
  the system prompt, and the model streams UI that is validated against it. This is the
  model for `show` (fixed components, plus sandboxed custom HTML). License not stated on the page.
- [CopilotKit/openbot](https://github.com/CopilotKit/openbot): MIT, alpha, a large multi-tenant
  platform (27 UI dependencies, Postgres, auth, its own runtime). Not copied; ideas only
  (components in answers).
- [openclaw/openclaw](https://github.com/openclaw/openclaw): how another project runs an
  agent in Docker (Dockerfile, compose, state mount).
