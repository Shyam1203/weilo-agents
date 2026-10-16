#!/bin/sh
set -eu
mkdir -p "$HOME/.weilo-agents/isolated" "$HOME/.weilo-agents/isolated-sessions" "$HOME/.weilo-agents/isolated-homes" "$HOME/.weilo-agents/agent/skills" "$HOME/.weilo-agents/agent/extensions"
docker compose up -d --no-build
trap 'docker compose logs; docker compose down' EXIT
for i in $(seq 1 60); do curl -fs http://localhost:3210/api/health >/dev/null && break; sleep 2; done
curl -fs http://localhost:3210/api/health
docker exec weilo-core node --input-type=module -e 'const s = await (await import("/app/sandbox/client.mjs")).sandboxStatus(); console.log(s); process.exit(s.namespaces ? 0 : 1)'
curl -fs -H "Accept-Encoding: br" -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:3210/
