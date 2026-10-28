# Security

Weilo runs AI agents on your own computer with your files and your accounts, so its security
model is part of the product. In short:

- **Only you can reach it.** Weilo listens on `127.0.0.1` only and checks `Host`, `Origin` and
  `Sec-Fetch-Site` on every request. Only paired devices can use it. A pairing code works once and
  for 10 minutes, and only `weilo pair`, run as the same user on the same computer, can make one.
  After a wrong code the next try waits a second, and after 10 wrong codes pairing stops for 10
  minutes. A paired browser gets its key only in the answer to pairing and keeps it in its own
  storage for this one address, so other web pages on your computer never receive it. You can
  remove a paired device in Settings; it is disconnected at once.
- **Agents ask first.** When an agent asks to do something (run a command, change or delete
  files, open a web page), the question waits in Needs you. An answer is recorded once: a second
  answer from another device is refused. A question no one answers within a day expires and the
  agent is told no. "Always allow" rules are kept and checked by Weilo, per agent and per exact
  command, and can be removed in Settings; the agent itself is only ever told "yes, this once".
- **Agents get little.** Each agent runs as its own process group with a short list of
  environment variables, and Weilo ends the whole group when it stops. A coding session in a git
  project works in its own copy (a git worktree) until you bring the changes back; in other
  folders it edits the folder directly, and the app says so. Sessions can't be started in your
  home folder or in Weilo's own folder. Agents are installed from npm with install scripts
  turned off, from lockfiles that pin every package by its hash. API keys you give Weilo are kept
  in files only your user can read, and are only ever sent to their own provider.
- **Data stays local.** Postgres listens on a Unix socket that only its own user can open, not on
  the network, and lets in only Weilo's user: no database password exists. The socket is in
  your Weilo folder, or in a private temporary folder when that path is too long. The app uses a database role
  that can't change the schema and can only add to the audit log.
  Every change and every answer you give is written to a hash-chained audit log.
- **Releases are traceable.** Release files are built by GitHub Actions pinned to commit SHAs,
  come with SHA-256 checksums that the installer checks, and carry build provenance.

Not in this release: a sandbox around agents. They run as your user, with the sign-ins you
already have for Claude Code, Codex or Gemini, so the questions they ask in Needs you are the
main safety net. A cloud version comes later.

## Reporting a vulnerability

Please report it privately through GitHub's
[private vulnerability reporting](https://github.com/Shyam1203/weilo-agents/security/advisories/new),
not in a public issue. Say what you found, how to reproduce it, and the version (`weilo version`).
You'll get an answer within a week.
