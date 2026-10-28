# Security

Weilo runs AI agents on your own computer with your files and your accounts, so its security
model is part of the product. In short:

- **Only you can reach it.** Weilo listens on `127.0.0.1` only and checks `Host`, `Origin` and
  `Sec-Fetch-Site` on every request. Only paired devices can use it. A pairing code works once and
  for 10 minutes, and only `weilo pair`, run as the same user on the same computer, can make one.
  After a wrong code the next try waits a second.
- **Agents ask first.** When an agent asks to do something (run a command, change or delete
  files, open a web page), the question waits in Needs you. An answer is recorded once: a second
  answer from another device is refused. A question no one answers within a day expires and the
  agent is told no.
  "Always allow" rules are kept per agent.
- **Agents get little.** Each agent runs as its own process with a short list of environment
  variables, and each coding session works in its own git worktree. Agents are installed from npm
  with install scripts turned off.
- **Data stays local.** Postgres listens on a Unix socket in your Weilo folder, not on the network.
  The app uses a database role that can't change the schema and can only add to the audit log.
  Every change and every answer you give is written to a hash-chained audit log.
- **Releases are traceable.** Release files are built by GitHub Actions pinned to commit SHAs,
  come with SHA-256 checksums that the installer checks, and carry build provenance.

Not in this release: a sandbox around agents (they run as your user), and a cloud version.

## Reporting a vulnerability

Please report it privately through GitHub's
[private vulnerability reporting](https://github.com/Shyam1203/weilo-agents/security/advisories/new),
not in a public issue. Say what you found, how to reproduce it, and the version (`weilo version`).
You'll get an answer within a week.
