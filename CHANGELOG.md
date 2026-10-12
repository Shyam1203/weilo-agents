# Changelog

Versions follow [SemVer](https://semver.org). While the version starts with 0, a minor version may change how things work.

## Unreleased

- A long chat keeps its old messages: when pi summarizes a conversation, a line marks the spot and the messages before it load as you scroll up (they used to disappear). Search results from before the summary open at the message too.
- Sign in to a provider with your account instead of an API key: Claude Pro or Max, ChatGPT Plus or Pro, GitHub Copilot and OpenRouter (Settings > Providers > Sign in). It works from a phone too.
- The app is drawn 10% larger on a computer.
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
