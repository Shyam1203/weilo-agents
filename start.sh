#!/bin/sh
# Start Weilo Agents and open it in the browser.
cd "$(dirname "$0")" || exit 1

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Install or start Docker Desktop. Then run this script again."
  exit 1
fi

# Made here, not by Docker: Docker would make it owned by root.
mkdir -p "$HOME/.weilo-agents"
docker compose up -d --build || exit 1

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

case "$(uname)" in
  Darwin) open "$url" ;;
  *) xdg-open "$url" >/dev/null 2>&1 || echo "Open $url" ;;
esac
