# Weilo Agents

A private AI assistant that runs on your own computer. Chat with agents. The agents work in an
isolated Docker container and use the pi coding agent (`@earendil-works/pi-coding-agent`). Your
data stays in one folder, `~/.weilo-agents`.

## Run

You need Docker.

Download `weilo-agents-<version>.zip` from the [releases](https://github.com/Shyam1203/weilo-agents/releases), unzip it,
and run `start.cmd` (Windows) or `./start.sh` (macOS, Linux). The script pulls the released image for the version in
`VERSION`, starts the app, then opens http://localhost:3210. In Settings, sign in to a provider (Claude Pro or Max, ChatGPT Plus or Pro, GitHub Copilot, OpenRouter) or add its API key. Then create an agent.

To update, run `update.cmd` (Windows) or `./update.sh` in the same folder: it downloads the newest release, replaces the scripts, and starts it. (A folder from before 0.1.2 has no update script: download the newest zip once and unzip it over the folder.) With a checkout, `git pull` and run the start script. Your data stays in `~/.weilo-agents`.
The version is shown in Settings > About. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

To build the image from a checkout instead: `docker compose up -d --build`.

## What leaves your computer

Besides your provider's API (the model you pick), the app asks GitHub now and then whether a newer release exists (turn it off in Settings > About), and sends a message only when you use Contact us (your name, email, message and the app version, to api.weilo.xyz). If you turn on notifications (Settings > Notifications), each one goes through your browser's push service (Google, Apple, Mozilla or Microsoft), encrypted so that only your device can read it: the agent's name and the start of what it said. Your chats and files stay on your computer.

## Develop

```sh
cd ui && npm install
npm run dev     # UI on http://localhost:5173, uses the API of the container on :3210
npm run build   # type-check and build
```

After you change the daemon or the UI, build the container again: `docker compose up -d --build`.

How it works and the design decisions: [DESIGN.md](docs/DESIGN.md). How a release is made: [RELEASING.md](docs/RELEASING.md).
