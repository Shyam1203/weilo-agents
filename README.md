# Weilo Agents

A private AI assistant that runs on your own computer. Chat with agents. The agents work in an
isolated Docker container and use the pi coding agent (`@earendil-works/pi-coding-agent`). Your
data stays in one folder, `~/.weilo-agents`.

## Run

You need Docker.

Run `start.cmd` (Windows) or `./start.sh` (macOS, Linux). The script builds and starts the app,
then opens http://localhost:3210. In Settings, add a provider key. Then create an agent.

To start the app manually: `docker compose up -d --build`.

## Develop

```sh
cd ui && npm install
npm run dev     # UI on http://localhost:5173, uses the API of the container on :3210
npm run build   # type-check and build
```

After you change the daemon or the UI, build the container again: `docker compose up -d --build`.

How it works and the design decisions: [DESIGN.md](docs/DESIGN.md).
