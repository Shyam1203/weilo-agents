# weilo-agents: design

A chat app for the pi coding agent. Pi runs in a Docker container; a small daemon in that
container serves the UI and runs pi. All user data is one host folder, `~/.weilo-agents`.

## Decisions

| Topic | Decision |
|---|---|
| Runtime | Docker only (host mode later; the daemon has no Docker code). |
| Daemon | Inside the container, as its main process. No Docker socket. |
| Data | `~/.weilo-agents` mounted at `/home/node/.pi`. Copy it to move machines. |
| Providers | No setup page. No provider yet: composer disabled, "Add a provider" opens Settings. Keys only. The agent form picks the first connected provider, but the model is always yours to choose. A connected provider has Models and Edit key (the same field replaces the key). Settings lists the connected providers first (In use), then the rest (Add another). |
| Agents | Lean profiles: a folder with one file, `agent.json`, which holds the instructions too. Shared pi config. Each agent is one continuous conversation (messenger style): no chat list, no titles. Two kinds: regular (the default) and isolated (Isolated agents below); `isolated` and `trusted` are set only in the app. |
| Isolated agents | An agent with only its own folder (`isolated: true` in its profile; Edit agent > Access > Isolated, shown with an Isolated tag). Its user is in no group: it cannot open the workspace, `agent/`, another agent's folder or chat. Its folder is `isolated/<folder>/` (its user's and the `agents` group's, 2770: regular agents may read and change it, since what it does is part of what they know of your work), its chat `isolated-sessions/<id>/` (its own; the daemon still reads it for search, `fetch_knowledge` and the curator). It has no shared `USER.md` or `MEMORY.md`, no `memory`, `fetch_knowledge`, `skill` or `manage_settings` tool (not in its `--tools`, and the routes refuse it: `mayCall` in `agents.mjs`), and keeps notes as files in its folder. Its pi gets copies of its profile, skills and added extensions in its pi folder (root's, read only) and runs with `--no-context-files` (others may write its folder). The browser (shared sign-ins) is turned off when it becomes isolated, and its route is refused while off; turning it on is the user's, or a `manage_agents` request the user approves; routines stay. Its plugins that run as programs run as its own user, in its folder. Making an agent isolated, or regular again, stops its pi (no pi starts meanwhile: `holding` in `runner.mjs`), moves its folder and chat, and gives what is in its folder to its user. A file another agent makes in its folder later stays that agent's and the group's: the isolated agent reads it only if it is readable by all. |
| Network | Port on `127.0.0.1` only, plus `Host`, `Origin` and `Sec-Fetch-Site` checks; no other site may frame the app. Every API call also needs a paired device's cookie or an agent's key (Access below). |
| User | Non-root `node` (uid 1000). Agent installs (`npm -g`, `pip --user`) persist in volume `tools`. `start.sh` makes `~/.weilo-agents` first, so Docker does not make it as root. |
| Names | Stack `weilo-agents`, container `weilo-core`, image `ghcr.io/shyam1203/weilo-agents:<version>`. |
| Versions | One `VERSION` file (SemVer). The image build takes `VERSION` and `COMMIT` as build arguments and keeps them as `WEILO_VERSION`, `WEILO_COMMIT` and `WEILO_PI` (`daemon/version.mjs`, `GET /api/version`, Settings > About) and as OCI labels. A `v*` tag runs `.github/workflows/release.yml`: it builds amd64 and arm64, pushes the image and publishes a release with a zip (`compose.yaml`, start and update scripts, `VERSION`). The start scripts set `WEILO_VERSION` from `VERSION`, pull that image, and build only if the pull fails. The data folder has `weilo.json` `{dataVersion, version}` (`daemon/migrate.mjs`): older data is brought up by ordered steps at start, newer data stops the start with a message. See `docs/RELEASING.md`. |
| Hardening | `cap_drop` NET_RAW and NET_ADMIN, `no-new-privileges`. |
| Attachments | Images go to pi as image blocks. Other files are saved to `uploads/` in the agent's folder and named in the message (a path from there). |
| Thinking | Optional per agent (`off` to `max`); empty means pi's default. |
| Launch | `start.cmd` (Windows) and `start.sh` (macOS, Linux) run `docker compose up -d --build`, wait up to 90 seconds for the app, and open the browser. |
| Models | Settings lists each provider's models; the ones switched on are pi's `enabledModels` (`settings.json`) and are all an agent's form offers. None switched on means all. |
| Skills | Pi's own `agent/skills/`, added by uploading a `.zip` (no links inside) or `SKILL.md`. An agent's profile lists the ones it uses; pi starts with `--no-skills --skill <path>` for each. |
| Shortcuts | Typing "/" in the message box lists the agent's skills (pi's `get_commands`, source `skill`) and plugins. A skill inserts `/skill:name`, which pi expands; a plugin inserts a starter sentence. Chats and the agent list show the typed `/name`, not the expansion. Pi's own terminal commands, prompt templates and extension commands are not offered. |
| Plugins | MCP servers in pi's `agent/mcp.json`, added in the UI as a command or a web address (no OAuth sign-in yet). A profile lists the ones an agent uses; pi gets them in its `--tools` allowlist, and `--no-mcp` when there are none. Secrets stay in `mcp.json`. |
| Extensions | Everything an agent can do beyond chat is a pi extension: a folder with a `weilo.json` (`apiVersion` 1, `name`, `description`, `entry`, `tools`; optional `title`). Pi loads each with `-e <entry>` and the daemon adds its `tools` to `--tools` (pi hides a tool the allowlist does not name). Two kinds, listed together by `GET /api/extensions` (`builtin` tells them apart). **Bundled** ones are the `extension/` folder of `browser/` and `routines/` in the daemon (in the image under `/app`): an agent has them unless its profile's `disabled` list names them (Edit agent: Built-in extensions, a switch each), and they cannot be deleted. Each calls only the daemon's HTTP API (through the shared `tool.mjs`), so another extension can replace it: add one that declares the same tool, and turn the bundled one off for that agent. With both on, saving the agent is refused (two extensions add one tool). **Added** ones are uploaded as a `.zip` (at its top, or in the one folder that wraps it), unpacked with the skills' checks (no links, size limit) into `agent/extensions/<name>/`; a tool name pi, the chat or memory uses (`show`, `ask`, `skill`, `manage_agents`, `manage_settings`, `memory`, `fetch_knowledge`) is refused (and left out if an older one declares it), so is an entry outside the folder or a name a bundled one has. Adding asks first: the code runs with the agent's rights and can read the keys. An agent's profile lists the added ones it uses (`extensions`). Nothing else in `agent/extensions/` loads (`-ne`). Memory is not switchable: every regular agent has its tools, notes and a place in the curator's reading (`memory/extension.mjs`, loaded with `weilo.mjs`), because any agent can search every chat and read the memory files anyway. An agent's instructions say whether it should use memory. Not changed by a switch: routines already set keep running, and other agents' `fetch_knowledge` still searches this agent's chat. The UI's browser and routines panels show "turned off" for an agent that has the extension off. Not done: pages or blocks drawn by an extension in the chat. |
| Access | Every agent has the same pi tools (`read`, `bash`, `edit`, `write`), as a Linux user of its own (Users below): a regular agent shares the workspace, the installed tools and the skills with the other regular agents, and reads and changes isolated agents' folders; an isolated agent has only its own folder. No agent can read the keys, the plugins' secrets, the paired devices, the vault, the browser's profile or another agent's chat. The daemon holds the keys and adds them to the agent's requests (Keys below), and checks every tool route an agent calls (`mayCall`). |
| Users | The daemon is root and runs nothing else as root (`users.mjs`; `setpriv` drops every capability for good). Each agent is a user of its own (`uid` in its profile, from 2001; never given twice: `weilo.json` keeps the highest, `lastUid`, so a new agent never owns what a deleted one left), a regular one in the group `agents` (2000), an isolated one in none; the browser (Xvnc, openbox, Chromium) runs as `node` (1000), the curator as 1100, regular agents' plugins that run as programs as 1200 (in `agents`, so they reach the workspace). `agent/` is root's, but for what a regular agent's pi reads (its profile, `USER.md`, `MEMORY.md`, the skills, the extensions: group-readable; the skills group-writable, the extensions not). `workspace/` and each agent's folder in it are the group's (setgid, umask 007); `isolated/` is root's and the group's (0751: the group looks in, an isolated agent only passes through), each folder in it its agent's and the group's (2770); `isolated-sessions/` is root's (0711); `agent/sessions/<id>/`, `isolated-sessions/<id>/`, `homes/<folder>/` (HOME) and `/tmp/weilo/<id>/` (scratch) are the agent's own; `knowledge/` the curator's. Root sets an owner through the folder itself, never through a link an agent put in its place, and keeps a pi's folder its own until all of it is written. `secure()` sets the top of each place at every start; data version 3 (`migrate.mjs`) handed an older folder's files to their owners once; data version 4 marked every agent regular and not trusted, and set `lastUid` from the profiles and the owners of the files. **PATH:** root starts every program by its full path (`BIN` in `config.mjs`; a test checks), and everything it starts gets a PATH of root's folders only (`SYSTEM_PATH`), since the image puts `~/.local/bin`, which agents can change, first. A regular agent's pi and plugins get the shared tools after root's folders; an isolated agent's get its own (`.local` in its HOME). |
| Keys | No key of a provider or a plugin is in reach of a pi. Each pi starts with a folder of its own (`PI_CODING_AGENT_DIR` = `/var/lib/weilo/pi/<id>/`, its user's alone, made again at every start by `agents/pidir.mjs`): `settings.json`, a `models.json` with only its model's provider, and an `mcp.json` with only its plugins. A provider with a key points at `/api/model-proxy/<provider>` with the pi's own key (`http/access.mjs`); the daemon checks the provider is its model's, swaps the pi's key for the real one wherever pi put it (`Authorization`, `x-api-key`, `x-goog-api-key`, `api-key`, `?key=`) and streams the request on (`gateway/models.mjs`). pi sends all of a provider's models to one address, so the daemon picks the provider's address for the API the path names (OpenRouter has two). A provider signed in with an account needs pi to hold the token (pi shapes those requests from it): its `apiKey` is `!node /app/gateway/key.mjs <provider>`, which gets the access token (renewed when it runs out) from `GET /api/agents/:id/model-key/:provider`; the refresh token stays with the daemon. A plugin on the web points at `/api/plugin-proxy/<name>` with the pi's key, which the daemon swaps for the plugin's headers; one that runs as a program is `node /app/gateway/pipe.mjs <name>`, a pipe (an HTTP upgrade to `/api/plugin-pipe/<name>`) to the daemon, which starts the program as the plugins' user with its secrets, in the agent's folder (`gateway/plugins.mjs`); an isolated agent's runs as that agent, in its folder. Every agent, isolated or not, reaches only its own plugins. The curator's pi gets the same, for the curator's model. |
| Workspace | One folder, `workspace/`, which the user browses. Each agent has a home in it, `workspace/<folder>/` (`folder` in its profile: its name as a slug, made unique against what is in the workspace, fixed when the agent is made so a rename keeps its chat's paths), and pi runs there; the rest of the workspace and the container stay open to it, so this is order, not a fence. Each agent gets house rules (`agents/workspace.mjs`, appended to its system prompt): its work in its folder, a folder per task, clear names, no leftover copies, the rest shared but never another's files unless asked; pi also reads any `AGENTS.md` in its folder and above. Deleting an agent keeps its folder unless the user ticks the box. An isolated agent's folder is outside the workspace (`isolated/<folder>/`), and its rules say it has only that folder (keep notes there; ask with `manage_agents` for a skill, plugin or extension). Files from before agents had folders stay at the top of the workspace, shared; and a scratch folder of its own outside it, `/tmp/weilo/<agent>` (`WEILO_SCRATCH`), for downloaded pages, one-off scripts and raw data. The scratch folder is emptied when the agent goes idle, and all of them when the daemon starts. |
| Show | `daemon/weilo.mjs` is a pi extension (`-e`) that gives every agent the chat's own tools, `show` and `ask`. `show` is: a list of blocks (text, table, metrics, cards, chart, buttons, file, page). The UI draws them from the tool call in the saved conversation (`blockData.ts`/`ShowBlocks.tsx`); no AG-UI layer, pi's events are enough. Cards and buttons send a message as the user's reply; the chosen one stays marked. Unknown or malformed blocks are dropped. |
| Files | `GET /api/agents/:id/files/<path>` serves a real file (symlinks resolved), looked for from the agent's folder first and then from the top of the workspace (paths in older chats); a full path is taken as it is. A regular agent's chat shows files in `workspace/` and `isolated/`, an isolated agent's only those in its own folder (`filesOf`). Pictures show inline; everything else downloads, with `Content-Security-Policy: sandbox`. With `?view=1` (the chat's preview) a text file is sent as plain text and a PDF inline (a PDF is not sandboxed: the browser's viewer does not run in one). The chat previews (`features/files/`) pictures, PDFs, Markdown, CSV/TSV (a table), JSON, HTML (the same sandboxed frame as a `page` block) and text or code; other files only download. A file block has Preview and Download; an agent's text that names a file as inline code, with its workspace path (`/home/node/.pi/workspace/…`) or a path inside it (`notes/plan.md`: a folder, and a file kind the preview shows), becomes a button that opens the preview. Another long path (the agent's own files) shows as its file name; a tap shows all of it. |
| App | `GET /api/version`; `GET`/`PUT /api/update` (`update.mjs`: the newest GitHub release, asked at most every 6 hours, only if `checkUpdates` in `weilo.json` is not false and not for a build made without a version (`dev`); the sidebar and Settings > About say when one exists, and the user runs `update.cmd` / `update.sh`, which download the newest release zip over the folder and run the start script); `POST /api/contact` (`contact.mjs`: Contact us, from the mail button beside Settings, forwards name, email and message with the app version to weilo-api's `POST /public/contact`; nothing from the chats). |
| Pages | A `page` block is agent-written HTML in an iframe with `sandbox="allow-scripts"` (empty origin: no access to the app, API or storage), a content policy that allows https only, and the app's own `frame-src about:` so the frame can't navigate. It talks to the chat through its height and `weilo.reply(text)`, which the app takes only during a user click in the frame. Text blocks follow the replies' Markdown rules (remote images show as links). |
| Ask | The same extension has an `ask` tool: a question with options (a choice) or without (a line of text). It uses pi's own `select`/`input` dialogs. The daemon keeps the open request (`run.asking`), sends it to the chat as pi's `extension_ui_request`, writes the answer back, and ends it with `ask_end` (also on settle, exit, abort). A new viewer gets it in `history.asking`. Other dialogs pi may ask (`confirm`, `editor`) are cancelled at once. The question and the answer stay in the chat from the tool call and its result. |
| Agents' requests | An agent cannot change agents on its own (the profiles are root's, and its key may not call `/api/agents`), but it can ask: the `manage_agents` tool (`weilo.mjs`, `agents/manage.mjs`) lists the agents, the skills, the plugins and the extensions, and asks to make an agent or change one (itself too: name, instructions, model, thinking, skills, plugins, extensions; `extensions` names every one the agent should have, bundled ones too). The daemon checks the request as saving would, then asks the user itself in the asking agent's chat (`askUser` in `runner.mjs`: a `select` request of its own, `run.asking` with a `resolve`), with the whole change (`askUser` refuses one over 20000 characters, for `manage_settings` too, never cuts it) and what the agent would get that the asking one has not (another provider, plugins, extensions) or the browser. No request sets `isolated` or `trusted`, and an agent made by request is regular. An isolated agent lists only itself and what it could ask for, and asks only for its own skills, plugins and extensions; a regular agent cannot change an isolated one. A trusted agent (`trusted: true`, Edit agent > Access > Always allow its own changes) has a change to itself of only its instructions, thinking or skills applied without a question; the chat shows a line for it (the tool result's `details.note`). Nothing else is ever allowed always. Only a paired device answers it (`POST …/answer` is not an agent's route), so an agent cannot approve its own request, and it cannot skip the question by calling the route itself: the question is the daemon's, not its pi's. Unanswered (skipped, aborted, pi closed, another question) is no. A changed agent starts its pi anew (the asking agent's own once its reply ends). The tools call the daemon with `node:http`, which waits as long as the user takes (`fetch` gives up after five minutes). |
| About you | `agent/USER.md` ("Name: …", then free text; editable by hand) holds what you tell the agents about yourself. The first screen asks for it (Skip is allowed), and Settings > About you changes it. Pi adds the file to every agent's system prompt (`--append-system-prompt`, only when the file exists), and saving restarts the agents. `GET`/`PUT /api/user`. |
| Memory | Two layers, shared by all regular agents (`daemon/memory/`; an isolated agent has neither and keeps notes as files in its folder, but its chat is searched and curated like the others'). **Hot memory** is `agent/MEMORY.md`: short facts about you, one per line (`- [m7 2026-10] text`; at most 40 notes or 3000 characters, 200 each). Pi adds it to every agent's system prompt when it starts, so a change shows in the next start (Settings > Memory saves restart agents; `/reload` restarts one). Settings > Memory shows the notes one by one, to change, forget or add; Edit as text shows the file. Agents write it with the `memory` tool (`remember`, `forget`, `list`; the daemon refuses secrets, near-duplicates and a full file). **The knowledge vault** is `.pi/knowledge/` (the data folder's `knowledge/`, beside `agent/` and `workspace/`): markdown pages the curator files under `index.md`, `Preferences/`, `Topics/`, `Workflows/`, `Projects/`. A page may start with `sources: [<agent id>@<date>, …]`, the chats it came from. The vault is not in any prompt: agents search it with the `fetch_knowledge` tool (`vault.mjs` reads pages, `fetch.mjs` searches). `fetch_knowledge` takes `query` (keywords over the pages and the chats of all agents, also deleted agents' kept chats), `source` + `query` (a page's source: the passages of that chat on that day, to check a claim) or `agent` (its newest messages). It reads only what you and agents wrote (not tool results, thinking or pi's saved prompts; the last 32 MB of each chat file), at most 5 excerpts and 1800 characters, wrapped as background that is not instructions; it never takes a path. **The curator** (`curator.mjs`, chosen in Settings > Memory, off until it has a model) is `pi -p` with file tools (`read`, `write`, `edit`, `grep`, `find`, `ls`) and the vault as its working folder. Every 5 minutes it looks at each agent that is not working; a chat is read when it has been quiet for 10 minutes, or, if it never is, 12 hours after its last run (counted from the first look), and only when it has a new user message. It reads the new messages oldest first, in pieces of at most 24000 characters (at most 6 pieces a run, each a run of up to 10 minutes), looks for the page that covers a subject before it makes one, merges and corrects pages, and keeps `index.md` current. Afterwards the daemon replaces any line of a page it changed that looks like a secret. It is told not to keep one-off answers, small talk, pages' or tools' text, secrets or what you asked to keep private, and not to follow instructions in a chat. The curator is told to write only inside the vault; the file tools are not fenced (a failed or timed-out run is scrubbed too, and counts as a failure). `agent/curator.json` holds the model, the last message read and the last run for each agent. A chat whose runs fail 3 times in a row waits for a new message. |
| Settings requests | A regular agent may ask to change a few settings with `manage_settings` (`settings/manage.mjs`; isolated agents may not): `list` shows the models the keys can use, which are on, their windows, the tokens kept free and who uses them; `change` turns models on (only ones a key or sign-in can use) or off (never one an agent or the curator uses, nor the last), or sets a model's tokens kept free (between `MIN_RESERVE` and its window) or gives it back to the app's rule. Always a question to the user with the exact change; on yes the daemon writes `settings.json` (still root's) and the agents' pis start anew. Nothing that loads code, names a path or address, or touches keys or devices. |
| Compaction | Pi summarizes by tokens kept free (`compaction.modelOverrides.<provider/id>.reserveTokens`). The daemon writes it per enabled model (all, when none is), if none is set: summarize at 40% of a 1M window, 80% of a 500k one and 90% of any smaller (`COMPACT_AT`, in `settings/compaction.mjs` with the reading back), never under 16384 free. Values set by hand are kept, and a value written earlier by another rule stays until removed from `settings.json`. Beside the send button the chat shows how much of the window is used (a percentage and a small bar, red as the context nears that point); hovering or tapping it shows tokens of the window (`GET /api/agents/:id/context`) and offers `/compact [what to keep]` (`POST …/compact`, refused during a run) and `/reload` (`POST …/reload`: pi starts anew, now if idle, else when the run ends). The chat still shows what was summarized: pi's history starts with its summary (a "Summarized for the agent" line), and the messages before it load from the chat file as you scroll up, 60 at a time (`GET /api/agents/:id/earlier?skip=n`: those before the last compaction's `firstKeptEntryId`, without thinking or tools' results other than `ask` and `routine`). A search result older than what is loaded loads pages until it is there. |
| Routines | Work an agent does on a schedule (once, hourly, daily, weekdays, weekly; several times a day). The daemon keeps them in `agent/routines.json` and sends a due routine's task to the agent's chat. See Routines under Daemon. |
| Browser | One Chromium on a virtual screen inside the container; each agent has its own window with its own tabs, all sharing one set of logins. You watch it in the chat's side panel and can take over. Agents are asked to check with you before anything that cannot be undone (a request, not a lock). See Browser under Daemon. |
| Notifications | Web Push, without a library (`daemon/push.mjs`): the daemon makes its own VAPID key pair (`agent/push.json`, with the browsers that turned notifications on and the agents muted), encrypts each notification for one browser (RFC 8291, aes128gcm) and posts it to that browser's push service (only Google's, Apple's, Mozilla's or Microsoft's addresses are accepted). The runner sends one when a run ends (the answer's start, or its error; a run you stopped sends none) and when the agent asks you something. None while the app is on screen anywhere: the agent list asks `GET /api/agents?seen` every few seconds while visible, and 15 seconds after the last, notifications go out again. The service worker (`ui/public/sw.js`) shows them, one per agent, and a tap opens the app at that agent (`?agent=`, or a message to an open window). On iPhone, only from the app added to the Home Screen. |
| Search | `GET /api/search?q=` reads every agent's chat (the same tail of the chat files the memory reads) and returns the messages that hold the words (any case, in plain text), newest first, at most 50. A result opens the chat with the find bar open at that message. The find bar searches the chat on screen and marks matches with CSS highlights (`::highlight(find)`), so the messages' markup is untouched. |
| Not in v1 | Groups, host mode, OAuth login, import from `~/.pi`, a firewall that keeps the browser off your network (it needs root and `NET_ADMIN`), keeping keys and logins from agents that can run commands, screenshots in the browser tool. |

## Layout

```
~/.weilo-agents/
├── agent/               pi's own, shared by all agents: auth.json, settings.json, mcp.json,
│   │                    AGENTS.md, USER.md, MEMORY.md, curator.json, routines.json, browser.json, push.json, install.json, skills/, extensions/
│   ├── sessions/<id>/   each regular agent's conversation
│   ├── order.json       { "agents": [ids] }: the agent list order, as dragged (newer agents after)
│   └── profiles/<id>/   Weilo agent profiles
│       └── agent.json   { "name", "model", "thinking", "skills", "plugins", "extensions", "disabled", "instructions", "avatar", "isolated", "trusted", "folder", "uid" }
├── homes/<folder>/      each agent's HOME
├── isolated/<folder>/   each isolated agent's folder (the regular agents read and change it)
├── isolated-sessions/<id>/  each isolated agent's conversation
├── knowledge/           the vault the curator keeps (markdown pages)
├── weilo.json           { dataVersion, version, lastUid }
└── workspace/           the shared computer's files; workspace/<folder>/ is each regular agent's home
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

**Open an agent** (as its own user, with its own `PI_CODING_AGENT_DIR` (Keys above) and `HOME` (`homes/<folder>/`); cwd its home; the session is found by `--session-dir` and `--session-id`, not by the folder). A regular agent:
```
/usr/local/bin/pi --mode rpc [--model <m>] [--thinking <level>] \
   --append-system-prompt agent/profiles/<id>/agent.json --append-system-prompt <folder rules> \
   [--append-system-prompt agent/USER.md] [--append-system-prompt agent/MEMORY.md] \
   -ne -e builtin:mcp -e builtin:codemode -e builtin:tool-search -e builtin:llama.cpp \
   -e /app/weilo.mjs -e /app/memory/extension.mjs [-e /app/<feature>/extension/<entry> …] [-e agent/extensions/<name>/<entry> …] \
   --no-skills [--skill agent/skills/<skill> …] \
   --tools read,bash,edit,write,show,ask,manage_agents,skill,memory,fetch_knowledge,manage_settings[,browser][,routine][,<extension tools> …][,codemode,mcp__<plugin>__* …]   (--no-mcp when it has no plugin) \
   --session-dir agent/sessions/<id> --session-id <id>
```
An isolated agent (cwd `isolated/<folder>/`; `<pi dir>` is its `PI_CODING_AGENT_DIR`, with root's read-only copies):
```
/usr/local/bin/pi --mode rpc [--model <m>] [--thinking <level>] \
   --append-system-prompt <pi dir>/agent.json --append-system-prompt <isolated rules> --no-context-files \
   -ne -e builtin:… -e /app/weilo.mjs [-e /app/browser/extension/index.js] [-e /app/routines/extension/index.js] [-e <pi dir>/extensions/<name>/<entry> …] \
   --no-skills [--skill <pi dir>/skills/<skill> …] \
   --tools read,bash,edit,write,show,ask,manage_agents[,browser][,routine][,<extension tools> …][,codemode,mcp__<plugin>__* …] \
   --session-dir isolated-sessions/<id> --session-id <id>
```
The session id is the agent id, so opening an agent always resumes its one conversation
(pi compacts long history itself). Pi has no profiles; this command is the profile. Checked on pi 1.1.0: a model that does not exist exits with
an error; a missing instructions file does not (pi starts without it).
An agent's pi loads only pi's built-in extensions (`PI_BUILTINS` in `config.mjs`) ours, and its extensions (above): `-ne` turns off discovery, so an extension left in `agent/extensions/` or named in `settings.json` never runs in an agent. `-ne` also drops the built-ins, so each is named again; one left out is lost (`mcp` is plugins, `codemode` and `tool-search` come with them, `llama.cpp` is the `/llama` provider). Checked on pi 1.1.0 with a probe extension and an MCP plugin: the tools and commands match the old command line. A project's `.pi/extensions/` was already not loaded (pi's project trust).

**API** (JSON):

| Route | Does |
|---|---|
| `GET /api/version` | `{version, commit, pi}` of this build (`dev` / `unknown` when built without a version) |
| `GET /api/providers` | `[{id, name, keyUrl, signIn, connected, account}]` (`account`: signed in, not a key) |
| `PUT /api/providers/:id` `{key}` | merge into `agent/auth.json` (mode 0600); never returned |
| `DELETE /api/providers/:id` | remove the key, or sign out |
| `POST` · `GET` · `PUT` `{answer}` · `DELETE /api/providers/:id/sign-in` | sign in with an account (`settings/login.mjs`): start, where it is, answer its question, stop. Each answers `{state, url, code, ask, message}`: a page to open, a device code, or a question (a choice, text, or the code or address the provider's page ends on). pi's own login (`ModelRuntime.login`, from the installed pi) runs in the daemon and saves the tokens in `auth.json`, which pi renews. It picks the way that works from another device where a provider offers one. |
| `GET /api/models` · `PUT /api/models` `{enabled}` | models the keys can use (`get_available_models`) · set pi's `enabledModels` |
| `GET /api/user` · `PUT /api/user` `{name, about}` | what agents know about you (`USER.md`) |
| `GET /api/memory` · `PUT /api/memory` `{text}` · `PUT /api/memory/curator` `{model}` | `{text, model}`: the `MEMORY.md` file and the curator's model ("" is off) · save the file (kept lines become notes) · choose the model |
| `POST /api/agents/:id/memory` · `…/fetch_knowledge` | `{text}` from a step of the `memory` and `fetch_knowledge` tools |
| `POST /api/agents/:id/manage_agents` · `…/manage_settings` | `{text, details?}` from the `manage_agents` and `manage_settings` tools (they may wait on the user's answer) |
| `GET /api/skills` · `POST /api/skills` `{name, data}` · `DELETE /api/skills/:id` | list · add a `.zip` or `SKILL.md` (base64) · remove |
| `GET /api/extensions` · `POST /api/extensions` `{name, data}` · `DELETE /api/extensions/:id` | `[{id, name, description, tools, builtin}]` · add a `.zip` (base64) · remove |
| `GET /api/plugins` · `GET /api/plugins/status` | `[{name, detail}]` · whether each connects (`pi mcp list`) |
| `POST /api/plugins` `{name, command, env}` or `{name, url, token}` · `DELETE /api/plugins/:name` | add to `mcp.json` · remove |
| `GET /api/agents` · `POST /api/agents` | list · create (daemon makes the id, writes both files) |
| `PUT /api/agents/:id` · `DELETE /api/agents/:id` `{keepChat, keepFiles}` | edit (a change of `isolated` stops its pi and moves its folders) · stop pi and delete the profile, its sessions unless `keepChat` (they stay where they were, out of sight), and its folder unless `keepFiles` |
| `GET /api/agents/:id/events` | SSE: history (`get_messages`), then live events; starts pi if needed |
| `POST /api/agents/:id/message` `{text, images, files}` | `prompt` (`steer` if a run is active). Images (data URLs) go to the model; files are saved in `uploads/` of its folder and named in the message |
| `POST /api/agents/:id/abort` | `abort` |
| `POST /api/agents/:id/answer` `{request, value}` | the answer to the agent's open question (`extension_ui_response`); no `value` skips it |
| `GET /api/agents/:id/commands` | the agent's skills as `/commands` (`get_commands`) |
| `GET /api/agents/:id/routines` · `POST /api/agents/:id/routines` `{title, task, every, times, day?, date?, in_minutes?}` | the agent's routines, next to run first · add one (its time zone is the `X-Timezone` header) |
| `PUT /api/agents/:id/routines/:rid` · `DELETE /api/agents/:id/routines/:rid` | change (send only what changes) · remove |
| `POST /api/agents/:id/browser` `{action, …}` | a step in the agent's browser window; returns `{text}` (the `browser` tool calls this) |
| `GET /api/agents/:id/browser` · `POST …/browser/show` · `…/take-over` · `…/give-back` | `{taken, hasWindow}` · bring its window to the front · stop its run and let you use the window · let it carry on |
| `GET /api/browser/rule` · `PUT /api/browser/rule` `{ask, rule}` | when agents must ask first, and for what |
| `WS /api/browser/view` | the screen (noVNC), with the same checks as the API |
| `GET /api/agents/:id/files/<path>` | a file in `workspace/`, from the agent's folder or the top (see Files under Decisions) |

**Routines:** work an agent does on a schedule. `routines/routines.mjs` keeps them in `agent/routines.json` and checks every 30 seconds; `routines/schedule.mjs` has the time math. A due routine goes to the agent's chat as a message that starts with `⏰ Routine: <title>`, then lines telling the agent that the user is away: do what the task covers, leave a step that needs the user (an approval, a sign-in, a code, a choice the task does not settle) for the end instead of waiting, and reply with what was done and what waits (`steer` if a run is active; pi starts if it is not running). `every` is once, hour, day, weekday or week. `times` are one or more "HH:MM" (twice a day is two times; hour and once take one); `date` is for once (`YYYY-MM-DD`, `today` or `tomorrow`; or give `in_minutes` instead of date and time). Times are wall-clock times in the routine's time zone: the browser's (it sends `X-Timezone` with every request; the routines routes read it, and the zone of the browser that last opened the routines is kept for routines an agent adds). A time that a clock change repeats runs once, at the earlier time; one it skips runs at the later time (checked for zones on both sides of UTC). A routine whose agent does not take the task within a minute is marked failed, so one stuck agent does not hold up the others. A routine moves to its next time, and that is saved, before its task is sent: a crash skips a run and never repeats one. A routine missed by more than an hour (the computer was off) waits for its next time. A one-time routine that ran is removed; one that was missed or failed stays in the list with its error. A one-time routine in the past is refused. Agents add and change their own with the `routine` tool (`routines/extension/`), which calls these routes (`WEILO_API` and `WEILO_AGENT` tell it where and who). Its result carries `details` (`{action, title}`), from which the chat shows a short line ("Routine added: …"); a routine run shows as "Routine: <title>" and the message's text is hidden. The chat's right-hand panel (the globe button in the top bar shows or hides it; on a narrow screen it opens over the chat) holds the browser screen and, below it, the agent's routines in groups by when they run next (Today, Tomorrow, This week, Next week, Later), each with a countdown ("in 5 min") when it runs within a day.

**Browser:** one Chromium and a virtual screen in the container. `browser/screen.mjs` starts them and starts them again if they stop: Xvnc (1280x800, on a unix socket only), openbox (no window frames, windows maximized; a pop-up such as a Sign in with Google window, and a dialog, keep a frame with a close button), and Chromium (profile in the `browser` volume, so logins stay), all as the user `node`. Nothing else in the container reaches them: the VNC socket and the display's Xauthority cookie are in `/tmp/weilo-screen/` (`node`'s alone), Xvnc takes X clients with that cookie only (so an agent cannot type into the browser), and Chromium has no debugging port: it runs with `--remote-debugging-pipe`, and the daemon passes that pipe (NUL-ended JSON) to a WebSocket at `/api/browser-cdp/<secret>` (a secret made at each start) for its own Playwright. The live view is a WebSocket at `/api/browser/view`, for paired devices: the daemon turns it into plain VNC on the socket. Pages cannot reach the app (port 3210): a Chromium policy (`image/chromium-policy.json`) blocks it, and the `browser` tool refuses it with a message. `browser/browser.mjs` drives Chromium with `playwright-core` (installed globally in the image and found through `NODE_PATH`; the daemon has no npm packages). All agents share the browser and its logins, and **each agent has its own window with as many tabs as it needs**: the browser's window id tells them apart, so a tab that a page opens joins its agent's window, and an agent only sees and uses the tabs of its own window. An agent reads a page as text (Playwright's accessibility snapshot, where each element has a ref such as `e13`) and acts with `click`, `type`, `press`, `scroll`, `back`, `open` and tab actions; each step returns the page again. An agent's steps run one after another. A window that you closed opens again at the agent's next step, and one that you minimized comes back (the screen has no taskbar). Deleting an agent removes its profile and routines first (so nothing starts its pi again), then stops it, waits for a running browser step, closes its window and removes its chat. The `browser` tool (`browser/extension/`) calls `POST /api/agents/:id/browser`.

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

**Access:** the port is published on `127.0.0.1` only, and the daemon rejects
requests with an unexpected `Host` or `Origin`, and anything another site loads from it
(`Sec-Fetch-Site`; a plain link still opens the app). This blocks other websites and DNS rebinding.
Being on this computer is not enough, though: an agent in the container reaches the published port too (Docker passes
`host.docker.internal:3210` on to it), with any `Host` it likes. So the daemon knows who calls (`http/access.mjs`):
- **Paired devices.** A browser pairs once with an 8-character code (40 bits; 10 minutes; one use; 10 wrong codes in 10
  minutes stop pairing for 10 minutes) and gets a random key as an `HttpOnly`, `SameSite=Strict` cookie (`Secure` on a
  `.ts.net` host), kept for 400 days. `agent/devices.json` holds each device's name, dates and the key's SHA-256, never
  the key. Codes live in the daemon's memory. A paired device makes one in Settings > Devices; the first one comes from
  `pair.mjs` (`docker exec weilo-core node /app/pair.mjs`), which asks the daemon over a unix socket in a folder only the
  daemon's user can open (`/tmp/weilo-admin/`) and prints a `/?pair=<code>` link. The start scripts open that link.
  `POST /api/pair` `{code}` is the only API call without a cookie; any other gets 401 `{pair: true}`, and the UI shows
  its pairing screen. The static UI itself is public.
- **Agents.** Each pi gets a random key when it starts (`WEILO_KEY`, dropped when it stops); its tools send it as
  `Authorization: Bearer` (`tool.mjs`). With it a pi may only call the routes of its own tools (`agentRoute` in
  `server.mjs`: browser, skill, manage_agents, manage_settings, memory, fetch_knowledge, routines, its model's key), for
  itself; anything else is 403. An isolated agent is also refused what `mayCall` (`agents.mjs`) refuses it.

**Remote use:** the host may also be a Tailscale name (`*.ts.net`), and an `https://` origin of the same host is accepted. On the host, `tailscale serve --bg 3210` forwards the tailnet's HTTPS address to the published port, so the port itself stays on `127.0.0.1`. A phone on the tailnet still has to be paired.

**Files** (`daemon/`, copied to `/app` in the image; Node built-ins only, plain relative imports):

```
server.mjs          entry: the API's routes, the server, the background jobs
config.mjs          the values to tune (port, timeouts, limits, intervals), grouped by feature
common.mjs          data paths, errors, private JSON and text files
weilo.mjs           the pi extension (`-e /app/weilo.mjs`): show, ask, skill, manage_agents, manage_settings
tool.mjs            what the bundled extensions share: the API call and the tool helper
version.mjs         what this build is (version, commit, pi), from the image's environment
migrate.mjs         brings the data folder to this app's data version at start (weilo.json)
pair.mjs            prints a link that pairs a browser (asks the daemon over its admin socket)
users.mjs           who runs what (the Linux users, the PATH they get), and who may read what (owners and modes, set at start)
gateway/            models.mjs (the models' keys: the proxy, sign-in tokens), plugins.mjs (the plugins' secrets: the proxy,
                    the pipe), key.mjs and pipe.mjs (run by an agent's pi)
http/               request.mjs (Host/Origin checks, JSON body and reply), access.mjs (paired devices, agents' keys), static.mjs (the UI), websocket.mjs,
                    events.mjs (SSE), files.mjs (workspace files)
agents/             agents.mjs (profiles; every path of an agent, and what an isolated one may call), runner.mjs (pi processes), manage.mjs (agents' requests), pidir.mjs (what a pi is given), pi.mjs (spawn and RPC framing),
                    sessions.mjs (chat files and their messages, newest message for the list), uploads.mjs (attachments)
memory/             memory.mjs (the MEMORY.md notes), vault.mjs (the vault's pages), fetch.mjs (search), curator.mjs (the curator)
routines/           routines.mjs (store and runs), schedule.mjs (time math)
browser/            screen.mjs (Xvnc, openbox, Chromium; the live view), browser.mjs (the browser tool, take over),
                    rule.mjs (ask first)
settings/           providers.mjs (keys, models), compaction.mjs (when pi summarizes), manage.mjs (agents' settings requests), plugins.mjs, skills.mjs, extensions.mjs, zip.mjs (the unzip checks they share), user.mjs (About you)
```

Each of `browser/` and `routines/` has an `extension/` folder (`weilo.json`, `index.js`): the bundled extension that gives agents its tool (memory's is `memory/extension.mjs`, loaded for every agent). They run inside pi,
not the daemon, and only call the daemon's HTTP API (`tool.mjs` has the shared call); it may import plain constants (`config.mjs`, `routines/schedule.mjs`), so the limits and
schedule words in its tool descriptions are the daemon's own.

`test/` holds `node --test` checks of the rules that keep agents apart (`node --test 'test/*.test.mjs'`): no program started by a bare name, isolated agents' paths and routes, `manage_agents` and `manage_settings`.

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

- Sidebar: the name "Weilo Agents" as plain text, a search of all chats, then agents (avatar, name, newest message as plain text; an unread one has its time in the unread colour and a dot at the end), + New agent, Skills and Plugins (on a phone; a computer shows them in Settings beside its pages), Settings. Drag an agent to reorder (hold first on a phone). On a
  phone, list and chat are separate screens; the chat (or Settings) is a step in the browser's history, so the phone's back button or gesture returns to the list, and from the Home Screen on an iPhone a swipe from the left edge does. Edit agent opens from the chat's title, and Delete (with its choice to keep the chat) is in that form; it has
  avatar, name, instructions, then cards of rows: Model (provider, model, thinking), Built-in extensions (a switch each) and Add-ons (skills, plugins, extensions: each row says what is on and opens a list of switches, or "Add" when there are none).
- Chat state is one reducer over pi's events (`features/chat/useChat.ts`): history, then live
  text, thinking and tool-call deltas. `conversation.ts` holds the reducer and maps pi's messages to bubbles.
  Thinking is not shown. What the agent did between its words (its tools, and what it said while using them) is one folded line ("Read 2 files · Ran a command") that opens to each step; `show`, a question the agent asks and a line for what it did with a routine show as themselves. An agent's text appears when its message is complete, so text that comes with a tool call never flashes; a pill above the composer says "Working" (or "Waiting for you") and folds when clicked. The composer floats over the chat. While the agent waits for your answer, a message you type in the box is the answer.
- Composer: text, attachments (files and photos, camera, paste, drop) and voice typing; typing "- " or "1. " starts a list that a new line carries on. The + offers Files and photos, Camera, and Skills and commands (what typing "/" offers). Disabled
  with "Add a provider" until a key exists. Stop appears while a run is going. A failed start
  closes the stream and shows pi's message with Try again; a clean restart reconnects by itself.
- Settings, Skills and Plugins are one page in place of the chat (`features/settings/SettingsView.tsx`; the chat stays mounted behind it, so a draft survives; opening it reads the lists again): a menu on the left (Providers, About you, Memory, Browser, Appearance, About, then Add-ons: Skills, Plugins, Extensions; on a phone, the list of pages first, each with what it holds at a glance ("1 connected", "2 skills"), then the page with a back arrow) and a page on the right made of rows (`components/ui/Row.tsx`: title and description on the left, the control on the right). The sidebar's Skills, Plugins and Settings buttons open it at their page.
- Settings > Providers: a key field per provider, Connected tag, Models (which ones agents can
  pick), Remove. Keys go to the daemon only.
- Model is two dropdowns: a provider, then one of its enabled models (all of them when none is).
- Dev: `npm run dev` in `ui/` (proxies `/api` to the container).

## Later

Saved pages in a side panel. Host mode
(same daemon, direct launch). Import from
an existing `~/.pi`. Pi Durable if crash recovery is needed.

## Also decided

One shared `workspace/` for all agents, with a home folder for each. "Start over" (pi `new_session`) is later. No open questions.

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
