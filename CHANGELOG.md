# Changelog

Versions follow [SemVer](https://semver.org). While the version starts with 0, a minor version may change how things work.

## Unreleased

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
