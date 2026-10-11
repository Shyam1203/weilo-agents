# Changelog

Versions follow [SemVer](https://semver.org). While the version starts with 0, a minor version may change how things work.

## Unreleased

- The start scripts show progress (download, start, waiting) and say so when `compose.yaml` is missing, for example when run from inside the zip.

## 0.1.0

First numbered version.

- Agents with their own profile and one continuous conversation each, running pi in an isolated container.
- Skills, plugins and extensions; a shared browser and routines.
- Memory: notes every agent sees, and a knowledge vault that a curator fills from your chats.
- Context ring, `/compact` and `/reload`, and automatic summaries of long chats.
- Reachable over Tailscale (`tailscale serve`).
- Released as an image on `ghcr.io`; the app shows its version in Settings > About.
