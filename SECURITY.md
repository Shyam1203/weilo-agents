# Security

Weilo Agents runs AI agents on your own computer with your keys and your data, so its security model is part of the product. [docs/security.html](docs/security.html) describes it in full; in short:

- The app listens on `127.0.0.1` only, checks `Host`, `Origin` and `Sec-Fetch-Site`, and answers only paired devices.
- No agent holds a provider's API key, an account sign-in's token or a plugin's secret: the app adds them to the agent's requests.
- Each agent is a Linux user of its own. Isolated agents, and the plugins they use, run in a separate sandbox container, each in namespaces of its own (processes, mounts, `/tmp`), with only their own folder. Set `WEILO_SANDBOX_RUNTIME=runsc` to give the sandbox gVisor's kernel.
- Every change made through the API, and every question an agent asks you, is recorded in `~/.weilo-agents/agent/audit.jsonl` (Settings > Security & devices).

## Reporting a vulnerability

Please report it privately, through GitHub's [private vulnerability reporting](https://github.com/Shyam1203/weilo-agents/security/advisories/new), not in a public issue. Say what you found, how to reproduce it, and the version (Settings > General). You will get an answer within a week.
