# Weilo Agents

A private AI assistant that runs on your own computer. Chat with agents. The agents work in
Docker containers and use the pi coding agent (`@earendil-works/pi-coding-agent`). Your data stays
in one folder, `~/.weilo-agents`.

Regular agents share your workspace and what they learn about you. Isolated agents run in a sandbox
container, each with only its own folder, its own processes and no keys; your regular agents can
read (not change) what they do and learn from it. See [SECURITY.md](SECURITY.md).

## Run

You need Docker.

Download `weilo-agents-<version>.zip` from the [releases](https://github.com/Shyam1203/weilo-agents/releases), unzip it,
and run `start.cmd` (Windows) or `./start.sh` (macOS, Linux). The script pulls the released image for the version in
`VERSION`, starts the app, then opens it in your browser with a link that pairs that browser: only paired phones and computers can use the app (add more in Settings > Devices). In Settings, sign in to a provider (Claude Pro or Max, ChatGPT Plus or Pro, GitHub Copilot, OpenRouter) or add its API key; either way the token or key stays with the app and agents never see it. Then create an agent. Settings > Usage shows each agent's tokens and estimated cost over the last 14 days.

To update, run `update.cmd` (Windows) or `./update.sh` in the same folder: it downloads the newest release, replaces the scripts, and starts it. (A folder from before 0.1.2 has no update script: download the newest zip once and unzip it over the folder.) With a checkout, `git pull` and run the start script. Your data stays in `~/.weilo-agents`. (On Linux its files belong to the app's own users, one per agent, in the group 2000: to browse the workspace, add yourself to that group, or use `sudo`.)
The version is shown in Settings > General. Changes are listed in [CHANGELOG.md](CHANGELOG.md).

To build the image from a checkout instead: `docker compose up -d --build`.

## What leaves your computer

Besides your provider's API (the model you pick), the app asks GitHub now and then whether a newer release exists (turn it off in Settings > General), and sends a message only when you use Contact us (your name, email, message and the app version, to api.weilo.xyz). If you turn on notifications (Settings > General), each one goes through your browser's push service (Google, Apple, Mozilla or Microsoft), encrypted so that only your device can read it: the agent's name and the start of what it said. A plugin you sign in to, or a site you save a key for, gets the requests your agents make to it. Your chats and files stay on your computer.

## Develop

```sh
npm install && npm run check
cd ui && npm install
npm run dev     # UI on http://localhost:5173, uses the API of the container on :3210
npm run build   # type-check and build
```

After you change the daemon or the UI, build the containers again: `docker compose up -d --build`. CI runs the checks and both builds on every pull request.

## Documentation

Start at [docs/index.html](docs/index.html) (open it in a browser from a checkout or the source zip): architecture, security model, agents, memory, data and permissions, the UI, operating and development, with diagrams. Dense reference tables: [DESIGN.md](docs/DESIGN.md). How a release is made: [RELEASING.md](docs/RELEASING.md).
