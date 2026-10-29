# Weilo

An AI teammate that runs on your own computer. Give it a job in a #channel, and it works on it
while you do something else. It asks before anything risky, and you answer when it suits you.

Weilo uses the coding agent you already have: Claude Code, Codex or Gemini. If you have none, it
uses pi.

## Install

On macOS or Linux:

```sh
curl -fsSL https://github.com/Shyam1203/weilo-agents/releases/latest/download/install.sh | sh
```

This works from version 0.2.0 on. Until 0.2.0 is released, build it from source (see Develop).

Weilo keeps its data in Postgres 16 or newer. The installer tells you how to add it if it's missing
(`brew install postgresql@16` on a Mac, `sudo apt install postgresql-16` on Debian or Ubuntu).
Weilo starts and stops its own copy, so there is nothing to set up. Weilo's built-in AI
and some AI apps also need [Node.js](https://nodejs.org).

If the GitHub CLI (`gh`) is installed and signed in, the installer also checks that the
download is the one GitHub built for Weilo.

You can also download the file for your computer from the
[releases](https://github.com/Shyam1203/weilo-agents/releases) and check it against `SHA256SUMS`.

## Start

```sh
weilo up      # starts Weilo at http://127.0.0.1:3210
weilo pair    # gives a one-time code to connect a browser
```

Open the address and type the code. Setup then asks which AI your agent should use and checks
that it works. If you have none, paste an API key for Weilo's built-in AI. Your first agent, Ava,
and a #general channel are made for you.

Your data stays in `~/.weilo-agents`. Set `WEILO_HOME` to keep it somewhere else.

## What leaves your computer

- What you send to an agent goes to that agent's model provider (Anthropic, OpenAI, Google, or the
  one you set up for pi), signed in the way you set that agent up.
- The first time you use an agent, Weilo downloads it from npm.

Nothing else is sent anywhere. Weilo listens only on `127.0.0.1` and answers only devices you
paired. Reaching it from your phone comes in the next version. See [SECURITY.md](SECURITY.md).

## Develop

You need Rust 1.90 or newer, Node 22 and Postgres 16.

```sh
cargo test --workspace                 # host and protocol tests (skips the Postgres ones if it's missing)
cd apps/web && npm install && npm test
npm run build                          # the host serves apps/web/dist
cargo run -p weilo-host -- up
npm run dev                            # http://localhost:5173, uses the host on :3210
npm run e2e                            # end-to-end tests in a real browser
```

Add `?fixture=1` to the dev address to try the app with sample data and no host.

| Folder | What's in it |
|---|---|
| `crates/weilo-host` | The `weilo` program: Postgres, the event log, engines, approvals, and the web server ([README](crates/weilo-host/README.md)) |
| `crates/weilo-proto` | The messages between the app and the host; the TypeScript in `apps/web/src/proto` is made from it |
| `apps/web` | The app, made to fit desktop and phone screens (reaching it from your phone comes later) |
| `engines` | How Weilo starts each coding agent |
| `docs/plan` | The design plan and the UI mock |

The plan is [docs/plan/PLAN.md](docs/plan/PLAN.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).
