# Changelog

Versions follow [SemVer](https://semver.org). While the version starts with 0, a minor version may change how things work.

## Unreleased

- Isolated agents: an agent can have only its own folder (Edit agent > Access > Isolated). It cannot open your workspace, the other agents' folders or chats, the shared memory, the skill library or the settings, and starts without the browser (its sign-ins are every agent's). It keeps its notes as files in its folder, and asks you for a skill, plugin or extension (the browser too) when it needs one. Your other agents can still read and change its folder and search its chat: what it does is part of what they know. The agent list and the chat say "Isolated".
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
