# Security

Weilo runs AI agents on your own computer with your files and your accounts, so its security
model is part of the product. In short:

- **Only this computer can reach it.** Weilo listens on `127.0.0.1` only and checks `Host`,
  `Origin` and `Sec-Fetch-Site` on every request. Only paired devices can use it. A pairing code
  works once and for 10 minutes, and only `weilo pair`, run as the same user on the same computer,
  can make one.
  After a wrong code the next try waits a second, and after 10 wrong codes pairing stops for 10
  minutes. A paired browser gets its key only in the answer to pairing and keeps it in its own
  storage for this one address, so other web pages on your computer never receive it. You can
  remove a paired device in Settings; it is disconnected at once.
- **Agents ask first, when their engine asks.** When an agent asks to do something (run a
  command, change or delete files, open a web page), the question waits in Needs you. An answer is recorded once: a second
  answer from another device is refused. A question no one answers within a day expires and the
  agent is told no. "Always allow" rules are kept and checked by Weilo, per agent and per exact
  command, and can be removed in Settings; the agent itself is only ever told "yes, this once".
- **Agents get little.** Each agent runs as its own process group with a short list of
  environment variables, and Weilo ends the whole group when it stops. A coding session in a git
  project works in its own copy (a git worktree) until you bring the changes back; in other
  folders it edits the folder directly, and the app says so. Sessions can't be started in your
  home folder or in Weilo's own folder. Chat agents work in their own folders in `~/Weilo/agents`,
  away from Weilo's data. Agents are installed from npm with install scripts
  turned off, from lockfiles that pin every package by its hash. API keys you give Weilo are kept
  in files only your user can read, and are only ever sent to their own provider.
- **Data stays local.** Postgres listens on a Unix socket that only its own user can open, not on
  the network, and lets in only Weilo's user: no database password exists. The socket is in
  your Weilo folder, or in a private temporary folder when that path is too long. While Weilo
  runs, it signs in only with a database role that can't change the schema and can only add to
  the audit log and the event log. Every change and every answer you give is written to a
  hash-chained audit log, checked when Weilo starts and with `weilo audit verify`.
- **Releases are traceable.** Release files are built by GitHub Actions pinned to commit SHAs,
  come with SHA-256 checksums that the installer checks, and carry build provenance.

**What this does not protect against.** There is no sandbox around agents in this release. They
run as your user, with your files and the sign-ins you already have for Claude Code, Codex or
Gemini. Anything that runs as your user, an agent included, can do what you can: run `weilo pair`
to pair a device, read Weilo's files, or change Weilo's data (the audit check would show it). An
agent only asks first when its engine asks; it can do other things without asking. The questions
in Needs you are a safety net, not a wall. A cloud version comes later.

## Reporting a vulnerability

Please report it privately through GitHub's
[private vulnerability reporting](https://github.com/Shyam1203/weilo-agents/security/advisories/new),
not in a public issue. Say what you found, how to reproduce it, and the version (`weilo version`).
You'll get an answer within a week.
