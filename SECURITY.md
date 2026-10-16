# Security

Weilo Agents runs AI agents on your own computer with your keys and your data, so its security model is part of the product. [docs/security.html](docs/security.html) describes it in full; in short:

- The app listens on `127.0.0.1` only, checks `Host`, `Origin` and `Sec-Fetch-Site`, and answers only paired devices.
- No agent holds a provider's API key, an account sign-in's token or a plugin's secret: the app adds them to the agent's requests.
- Each agent is a Linux user of its own, and so is each plugin program a regular agent uses, so one plugin cannot read another's secrets. Root never follows a link an agent put in place of a folder or a chat file, and checks the real path of a file it has opened before serving it. Agents get only a short allow-list of the app's environment variables. Isolated agents, and the plugins they use, run in a separate sandbox container, each in namespaces of its own (processes, mounts, `/tmp`), with only their own folder. Set `WEILO_SANDBOX_RUNTIME=runsc` to give the sandbox gVisor's kernel.
- Both containers have process and memory limits (`WEILO_CORE_PIDS`, `WEILO_CORE_MEMORY`, `WEILO_SANDBOX_PIDS`, `WEILO_SANDBOX_MEMORY`).
- Releases are built from pinned inputs (pi from a lockfile with hashes, the base image by digest, GitHub Actions by commit SHA), smoke-tested before they are pushed, and carry provenance and an SBOM.
- Every change made through the API, and every question an agent asks you, is recorded in `~/.weilo-agents/agent/audit.jsonl` (Settings > Security & devices).

## Reporting a vulnerability

Please report it privately, through GitHub's [private vulnerability reporting](https://github.com/Shyam1203/weilo-agents/security/advisories/new), not in a public issue. Say what you found, how to reproduce it, and the version (Settings > General). You will get an answer within a week.
