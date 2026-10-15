#!/bin/sh
# Start Weilo Agents and open it in the browser.
cd "$(dirname "$0")" || exit 1

if [ ! -f compose.yaml ]; then
  echo "compose.yaml is not in this folder. Run start.sh from the extracted folder."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Install or start Docker Desktop. Then run this script again."
  exit 1
fi

# Made here, not by Docker: Docker would make it owned by root.
mkdir -p "$HOME/.weilo-agents"

# The released image for this version (the VERSION file); built here only if it cannot be pulled.
WEILO_VERSION=$(tr -d '[:space:]' < VERSION 2>/dev/null)
export WEILO_VERSION
echo "Getting Weilo Agents ${WEILO_VERSION:-latest}. The first time this downloads the app and can take a few minutes."
if ! docker compose pull; then
  echo "Could not download it. Building it here instead, which takes longer."
  docker compose build || exit 1
fi

echo "Starting Weilo Agents..."
docker compose up -d || exit 1

echo "Waiting for Weilo Agents to be ready..."
url=http://localhost:3210
tries=0
until curl -fs "$url" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 90 ]; then
    echo "Weilo Agents did not start. For details, run: docker compose logs"
    exit 1
  fi
  sleep 1
done

# A link that pairs this browser (a code that works for 10 minutes); an already paired browser just opens the app.
pair=$(docker exec weilo-core node /app/pair.mjs 2>/dev/null) && url=$pair

case "$(uname)" in
  Darwin) open "$url" ;;
  *) xdg-open "$url" >/dev/null 2>&1 || echo "Open $url" ;;
esac
