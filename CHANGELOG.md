# Changelog

Versions follow [SemVer](https://semver.org). While the version starts with 0, a minor version may change how things work.

## Unreleased

- The home screen icon on iPhone and iPad no longer shows white corners when the app opens or closes: the icon is now square and opaque, and iOS rounds it. Remove the app from the home screen and add it again to get the new icon.
- Much lighter chats: the app is sent only what it draws. A reply no longer arrives three or four times (as each step ends, as the turn ends and again as the run ends) with every file the agent read and every command's output, and its thinking and its text as it is written no longer stream to the app, which shows them only when they are done. A file an agent writes is no longer sent to the app either: a step shows its path. While a reply is written, only the newest message is drawn again, not the whole chat.
- The browser rests: an agent's window closes when it has not used it for 10 minutes and is not working, and the browser stops after 20 minutes with nothing using it (it starts again with the next step, signed in as before). Tabs left open no longer use the computer's CPU and memory for good.
- The agent list and the browser panel are told what changed instead of asking: an agent's working state and its browser come straight from the app, and the list is read again at most once a second.
- Knowledge search (`fetch_knowledge`) picks the messages that match best, not the newest that hold any of the words, so an older and better answer is no longer left out.

- Lighter chats: images in a chat are sent to the app as links, not again in full each time it opens the chat, and files you attach go up as they are (not as text a third larger). The app hears when the agent list changes instead of asking every 2 to 5 seconds, and the stream of a chat stays open behind proxies such as Tailscale Serve. Agent profiles, today's usage and knowledge pages are read again only when they change, and the app's files are compressed when it is built, not when it starts. Older messages in a long chat are laid out only when they come near the screen.
- A chat left open in a browser tab no longer keeps its agent running: it stops after 10 idle minutes and starts again with the next message.
- Fixes: a one-time routine that fails after the first minute stays in the list with its error. Search shows a message that holds the words where they are not shown as text (in a link's address, say) instead of dropping it. An agent's key must match whole.

- Search is fast right after an update: the chat search index is kept in the data folder (`agent/index/`) instead of inside the container, where every image update lost it, and the app brings it up to date when it starts.
- Faster chats: "Load earlier messages" reads a long chat's earlier part once and serves the next pages from what it read, for the last 4 chats you opened. The app also loads the model runtime when it starts, so the first agent answers sooner, and Settings and the agent form load the first time you open them (the app's first load is 20 KB smaller compressed).
- Lighter when idle: the browser starts the first time an agent uses it (or you take over), not with the app, and a chat you only looked at stops its agent after 90 seconds instead of 10 minutes.
- Settings are safer from crashes and power cuts: each file is flushed to disk before it replaces the old one, and the previous version is kept as a `.bak`. If a file is damaged, the app uses that copy, keeps the damaged one as `.corrupt` (so a hand edit is not lost), and says so in its log.
- Stopping the app (`docker compose down`, a restart, an update) is clean: agents are stopped and pending saves are written first, within 12 seconds. If the app ever stops responding for 2 minutes, it restarts itself.
- Both containers have limits on processes and memory (the app 4096 and 8 GB, the sandbox 2048 and 4 GB), so a runaway program cannot take the computer down. Change them with `WEILO_CORE_PIDS`, `WEILO_CORE_MEMORY`, `WEILO_SANDBOX_PIDS` and `WEILO_SANDBOX_MEMORY`.
- Routines: a daily or weekly routine that was skipped because the app was not running now says "Missed: …", as a one-time one did, and the routines panel shows it plainly instead of as a failed run. When your time zone changes, your recurring routines move to it. A routine whose agent is slow to start is no longer marked failed after a minute (a real failure later is still shown).
- The start script works offline: if the download fails but the app is already on the computer, it starts that copy. From the release zip it no longer tries to build the app; it says to check the internet connection.
- Releases are checked before they are published: the image is started and tested as on every pull request, and the arm64 image is checked too. The build tools are pinned to exact versions.
- Security: agents get only a short list of the app's environment variables (language, time zone, proxies, certificates, version), not all of them. A download checks the file it actually opened, so a folder swapped for a link at the last moment is refused. A link put among an agent's chat files is skipped, not read. The app's pages tell other sites nothing about where a link came from, and the pairing request takes at most 1 KB.
- The knowledge curator reads only as many new messages as it can file in one run, so a very long chat no longer loads whole.

- Security: each plugin that runs as a program has a Linux user of its own, so one plugin can no longer read another's secrets. Settings > Plugins checks each plugin on its own, as that plugin's user.
- Security: the app no longer follows a link an agent put in place of a folder when it hands a folder to an agent, moves one (to or from isolated) or saves an approved skill; it leaves the link alone or refuses. An agent can no longer rename or delete another agent's folder in the workspace, or a skill it does not own.
- Saving or removing a provider key while a signed-in account's token is being renewed no longer loses the new key or brings back the removed one.
- A connection dropped at the wrong moment no longer stops the app.
- What you approve is what happens: changes to an agent apply one at a time, and a change you approved is refused, not applied over a newer one, if the agent or the settings changed while you were deciding. A skill an agent saves no longer undoes a change made to its skills meanwhile.
- Faster chats: a long chat opens with less to load (no thinking or tool details it does not show), each reply's text is formatted once instead of on every streamed word (a long chat no longer freezes while the agent writes), and very large messages and browser frames are handled in a fraction of the time. The browser and routines panels stop checking while the app is in the background.
- Faster first load: the app's files are sent compressed and only when they changed.
- Agents never see your account sign-ins any more. An agent on a provider you signed in to with an account (Claude Pro or Max, ChatGPT, GitHub Copilot) gets a stand-in made from its own key, and the app swaps in the real token, kept fresh, as each request passes through it. Adding or removing a key, or signing in, restarts the agents as their replies end, so they pick it up. Isolated agents can use those providers safely now, and Settings no longer warns about them.
- Settings > Usage: tokens today and over the last 14 days with their estimated cost, a chart of each day's tokens by agent, and a row per agent with today's tokens, its daily limit, 14 days' tokens and cost. The cost is an estimate at the provider's API prices; a sign-in plan bills differently.
- Settings is grouped: You (About you, Memory), Models (Providers, Usage), What agents can use (Skills, Plugins, Extensions, Browser) and App. Security & devices has the paired devices, the checks and the activity on one page; General has the appearance, notifications and About.
- Memory notes have a kind (preference, fact, goal, person, project or decision), and the memory file groups them under a heading for each. A note not confirmed for 12 months is marked as maybe out of date; when it still holds, the agent saves it again and it counts as confirmed. Settings > Memory shows the notes by kind and asks for a kind when you add one; a note you edit there counts as confirmed. When memory is full, the agent is shown the 5 oldest notes to choose from.
- An agent asks you before it saves a skill: you see its name, description and all of its instructions, and whether it changes a skill you have and which other agents use it. A skill an agent saves is at most 16,000 characters. After a long or tricky task an agent offers once to save how it did it as a skill, so the next time goes faster.
- Isolated agents: an agent can have only its own folder (Edit agent > Access > Isolated). It runs in a sandbox of its own (a second container, `weilo-sandbox`, which the start script runs for you): it sees only its own folder, its own processes and its own `/tmp`, holds no key, and reaches the internet but not the app or your other agents. It cannot open your workspace, the other agents' folders or chats, the shared memory, the skill library or the settings, and starts without the browser (its sign-ins are every agent's). It keeps its notes as files in its folder, and asks you for a skill, plugin or extension (the browser too) when it needs one. Your other agents can read its folder (never change it) and search its chat: what it learns about you is yours. The agent list and the chat say "Isolated". For a kernel of its own, install gVisor and set `WEILO_SANDBOX_RUNTIME=runsc`.
- What isolated agents learn reaches your other agents, marked as theirs: an isolated agent writes what the others should know in `shared/` of its folder, and the knowledge curator files it, as it files its chat, with an `isolated:` source. Search results and answers from an isolated agent say "its own report, unchecked", because it may have read untrusted pages.
- Agents can ask each other: a regular agent can send another agent (an isolated one, say) a question with `ask_agent`. You approve each message in the chat, the other agent answers in its own chat, and the answer comes back marked as its report.
- Daily token limits: give an agent a limit in Edit agent > Model. At the limit its run stops and new messages and routines wait for the next day. Tokens read again from the cache are not counted. The form shows today's count.
- Settings > Security & devices: whether the sandbox runs, which isolated agents have the browser, devices unused for 90 days, a newer version, and the latest changes. The app now keeps a record of every change made through it, every pairing, and every question an agent asked you with your answer (`agent/audit.jsonl`).
- Memory is harder to poison: a note or a vault line that reads as an instruction ("ignore your instructions", "you are now…", a downloaded script to run) or hides text with invisible characters is refused or removed, as secrets already were. Settings > Memory > Ask before saving makes agents ask you before they save or forget a note.
- Searching chats (the sidebar and the agents' `fetch_knowledge`) uses an index, so it stays fast as chats grow, and covers whole chats instead of their last 32 MB. The agent list and the model list answer faster too.
- Security: a plugin that runs as a program never runs as an agent any more (an isolated agent could read its secrets), and never starts in an agent's folder (a file an agent put there could change what it loads); its agent's folder is in `WEILO_FOLDER`. An isolated agent's plugins run in the sandbox, with only its folder.
- Security: the app's container drops more Linux capabilities, and both containers have a health check. pi and the browser driver are installed from a lockfile with their hashes, the base image is pinned, and releases carry provenance and an SBOM. Report a vulnerability privately: see SECURITY.md.
- The daemon has a type check and tests, run on every pull request with both builds and a check that the sandbox works.
- Always allow its own changes (Edit agent > Access): an agent's changes to its own instructions, thinking or skills apply without asking you, and the chat shows a line for each. Anything else still asks.
- Agents can ask to turn models on or off, or to change when a model's conversations are summarized; you approve each change in the chat. A model an agent uses cannot be turned off.
- A request to approve shows everything it would change (long instructions were cut off), and the question scrolls. A request too long to read is refused instead.
- Agents can ask for extensions for an agent, the browser included; the question says when an agent would get the browser or an extension the asking agent does not have.
- Security: the app ran some programs by name from a folder agents can change, which let an agent run a program of its own with the app's full rights; it now runs every program by its full path. A new agent never gets the Linux user of a deleted one, so it never owns what that agent left behind. An agent could swap its folder for a link and be given the app's private folder at its next start; that is refused now.
- Agents can set up other agents for you. Ask one to make an agent, or to change one (or itself): its name, instructions, model, skills or plugins. It shows you exactly what it would make or change in the chat, says when the agent would get a provider or plugins it does not have itself, and nothing happens until you approve it. An agent cannot approve its own request.
- Fixed: agents could not save skills (the `skill` tool was left out of what they may use).
- Agents can no longer read your keys. Each agent runs as a Linux user of its own: it shares the workspace and the installed tools with the other agents, but cannot read the provider keys, the plugins' secrets, the paired devices, the knowledge vault, the browser's logins or another agent's chat. The app holds the keys and adds them to each agent's requests itself, for its own model's provider and its own plugins only. The browser is driven over a private channel instead of a debugging port any program could open, and only the app can type into it. Each agent also has a home of its own (`homes/<folder>`), so its tools' sign-ins (git, for example) stay its own.
- Only your paired phones and computers can open the app. Being on this computer or your tailnet was enough before, and agents could reach the app that way too and change anything. The start script pairs the browser it opens; add a phone in Settings > Devices with a code. Agents' tools now call the app with a key of their own, and can only do what those tools do, for that agent.
- Each agent has a folder of its own in the workspace, named after it (`coder/`, `trip-planner/`), and works there: its files stay together, and what you attach goes to its `uploads/`. It can still read and use the rest of the workspace. Existing files stay where they are, shared. Deleting an agent asks whether to delete its folder too (off by default). The agent's settings show its folder.
- A file preview for a file that was moved or deleted says so plainly, without Open in a new tab and Download buttons that could not work.
- The chat list keeps a heading or a list line apart from the next in its preview ("Draft ready · Here is a first draft", not "Draft ready Here is").
- Settings says each title once: no "Settings" heading over the first group, and on a phone no page heading under the bar that already names the page.
- Settings > About has one row for updates, with the switch and what the last check found, instead of two rows that said the same.
- On a computer, the provider, model and thinking pickers (and the memory curator's) are wide enough for a model's name ("DeepSeek V4.1 Fla…" was cut).

- New routine: How often is a row of short buttons (three and two on a phone, not five tall cards), and the time field shows the whole time on a phone ("08:00 AM" was cut off).
- On a phone, the browser and routines panel lines up with its title, so the browser view is wider. A routine's name shows on two lines instead of being cut short.
- Tables in replies have a shaded header read left to right, and each cell starts at the top of its row, so a short cell no longer floats beside a long one.
- New agent: the avatar shapes and colors sit in even rows, each color under a shape. The grey example text in Name and Instructions starts with "For example:", so it does not look filled in.
- On a phone, the chat list ends with Settings alone, as on a computer. Skills and Plugins are still in Settings.
- Dropdowns (model and provider pickers) close when you tap outside them on a phone, as menus already do.
- Smoother motion, after transitions.dev: menus grow from their button and fade back when closed; dialogs scale in on a computer and slide up as a sheet on a phone, and animate out when closed; the send, stop and voice button grows its new icon in; the working chip changes its text softly. Less motion when the system asks for it.
- Runs on pi 1.2.0. With an OpenRouter key, the model list shows only the models that key can use, with their real context sizes, and an "upstream provider" error is retried. Memory keeps what it filed when the model's answer is cut off at its output limit, instead of reading the same chat again.

- The browser: a pop-up window (Sign in with Google, say) and a dialog have a frame with a close button. They had none, so a pop-up could not be closed.
- Routines no longer stop to wait for you: you are away when one runs, so the agent does what the task covers, leaves any step that needs you (an approval, a sign-in, a code, a choice the task does not settle) for the end, and reports what it did and what waits for you.
- The + in the message box has Files and photos, Camera, and Skills and commands. The two list buttons are gone: typing "- " or "1. " starts a list.
- A file an agent names by its path in the workspace ("notes/plan.md") opens the preview, like a full path did. A long path outside it shows its file name; tap it for all of it.
- A quote in an agent's reply (a draft to paste somewhere) has Copy text under it.
- Settings > Memory shows the notes about you one by one: tap one to change it, × to forget it, or add one. Edit as text shows the file as before. The curator's model menu takes the full width on a phone.
- Settings > Skills: each skill's description is two lines, says which agents use it, and Turn on adds it to another agent. Delete asks for a second tap.
- On a phone, the Settings list says what each page holds ("1 connected", "Off", "2 skills").
- The empty message box stays one line on a phone when the agent's name is long.
- A chat shows grey message shapes while it loads, instead of "Loading…".
- On a computer, Skills and Plugins are no longer twice in the agent list's footer and in Settings.
- The browser: when you take over, a click lands where the pointer is (it landed to the right, more so toward the right edge), and the whole screen shows (its right edge was cut off). The app's larger drawing threw both off.
- Edit agent on a phone: Save stays at the bottom while you scroll, and the provider and model menus use the full width, so model names show whole. A model's maker is no longer said twice ("DeepSeek V4.1 Flash", not "DeepSeek: DeepSeek V4.1 Flash"), here and in the chat header.
- The context ring next to the send button is now a number and a small bar ("13%"): the ring looked like a loading spinner.
- The + menu in the message box: the open button turns grey with an × instead of red (red means recording), and Skills and commands lists what typing "/" offers.
- Settings > Providers lists the providers in use first, with a green Connected and how many of their models are on, then the others under Add another. Each provider has its letter instead of the same plug icon.
- The chat's side panel button has a panel icon and says it shows the browser and routines.
- A page an agent shows no longer has a title bar above its own heading.
- When an agent ends a reply by offering next steps, it shows them as buttons to tap.
- On a phone, voice typing no longer gets stuck: tapping the microphone again stops it and keeps every word heard (iPhone often left the last words out). The context ring next to the send button opens when tapped, and menus close when you tap outside them.
- A long chat keeps its old messages: when pi summarizes a conversation, a line marks the spot and the messages before it load as you scroll up (they used to disappear). Search results from before the summary open at the message too.
- Cards an agent shows read better: their text is formatted (bold, lists) and a card can have a picture (a product photo, say). Pictures in an agent's page and in cards no longer tell the shop which site asked, so shops that refuse other sites' pages show them.
- A smaller working indicator above the message box, which says what the agent is doing ("Using the browser…") instead of "Working".
- Agents keep the workspace tidy: every agent has house rules for the shared workspace (a folder per task, clear file names, no leftover copies, never touching others' files) and a scratch folder of its own outside it for downloaded pages, one-off scripts and raw data, emptied when it goes idle.
- Sign in to a provider with your account instead of an API key: Claude Pro or Max, ChatGPT Plus or Pro, GitHub Copilot and OpenRouter (Settings > Providers > Sign in). It works from a phone too.
- The app is drawn larger: 10% on a computer, and 15% on a phone or tablet, where text was hard to read and buttons hard to tap.
- A provider's model list opens on the enabled models (Enabled, then All).
- On iPhone, Notifications no longer asks to add the app to the Home Screen when it was opened from there.
- Notifications (Settings > Notifications): when an agent replies, asks you something or runs into a problem while the app is not on screen. Per device, with a switch per agent. On iPhone, from the app added to the Home Screen.
- Search from the agent list: agents by name, and every chat's messages; a message opens the chat at that message. Find in a chat from its header (search button).
- What an agent did between its words shows as one line ("Read 2 files · Ran a command"); tap it for each step.
- A button to jump back to the newest message when you scroll up, which says when new messages came.
- Unread agents: a dot at the end of the row and the time in colour, instead of a dot on the avatar.
- On a phone, the back button or gesture returns from a chat to the list (and a swipe from the left edge, in the app added to the Home Screen).
- Drag agents to reorder the list (on a phone, hold one, then drag; Alt + arrow keys also move it). The order is saved, so phone and PC match.
- The agent list previews show plain text, without Markdown symbols.
- Tables in chat scroll sideways instead of breaking words, and replies use the full width on a phone.
- A Copy button on code blocks, and Copy, Share (where the device has it) and Send again under replies.
- `update.cmd` and `update.sh` in the release zip: run one to download the newest release and start it. The About page points to them.
- The agent list's working avatar follows the open chat (same scene, same moment) and no longer flickers between tools.
- The + button in the agent list opens New agent from Settings (it stayed in Settings).

## 0.1.1

- Settings is a page, not a popup. Contact us (mail button beside Settings), and an update check (Settings > About).
- Preview files an agent made in the app: pictures, PDFs, Markdown, CSV, JSON, HTML and text.
- The message box continues lists (bullets and numbers) and can start one from the + menu.
- A working agent acts out what it does: reading, searching, typing at a laptop.
- Queued messages show in the chat; `/compact` and `/reload` say what they did; a typed answer to a question shows with it.
- The agent waits for your choice after showing cards or buttons.
- Providers: Edit key. The agent form no longer picks a model for you.
- Phones: the page no longer scrolls under the message box, the message box respects the screen edges, and fields no longer zoom the page. The app can be installed to the home screen.
- Pasting into the agent's browser (Ctrl+V or the Paste button) types the text in, for passwords.
- A new `skill` tool: an agent saves a skill in the skill library (it shows in Settings and is switched on for that agent) instead of writing files where the app does not look.
- `/reload` sent with Enter from the command list works. The working avatar's scenes (reading, searching, typing) follow the live chat and stay up at least 1.5 s, and the message box's avatar is larger.
- Fixes from review: Ctrl+V into the agent's browser no longer types shortcuts; the chat keeps its place when Settings closes and follows new content reliably; Add provider and add-on links no longer discard a new agent's draft; the installed app respects the status bar and notch; a reload sent during a run reports when it happens.
- The start scripts show progress (download, start, waiting) and say so when `compose.yaml` is missing, for example when run from inside the zip.

## 0.1.0

First numbered version.

- Agents with their own profile and one continuous conversation each, running pi in an isolated container.
- Skills, plugins and extensions; a shared browser and routines.
- Memory: notes every agent sees, and a knowledge vault that a curator fills from your chats.
- Context ring, `/compact` and `/reload`, and automatic summaries of long chats.
- Reachable over Tailscale (`tailscale serve`).
- Released as an image on `ghcr.io`; the app shows its version in Settings > About.
