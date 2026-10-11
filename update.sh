#!/bin/sh
# Update Weilo Agents to the newest release, then start it. Your chats and settings stay (they are in ~/.weilo-agents).
# The body is a function and the file ends with `exit`: this file is replaced during the update, and a shell reads a script as it runs.
main() {
  cd "$(dirname "$0")" || exit 1

  if [ ! -f compose.yaml ]; then
    echo "compose.yaml is not in this folder. Run update.sh from the extracted folder."
    exit 1
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Install or start Docker Desktop. Then run this script again."
    exit 1
  fi

  repo=Shyam1203/weilo-agents
  current=$(tr -d '[:space:]' < VERSION 2>/dev/null)
  echo "Checking for a newer version..."
  latest=$(curl -fsS --max-time 20 "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -n 1)
  if [ -z "$latest" ]; then
    echo "Could not check for a new version. Check your internet connection and try again."
    exit 1
  fi
  if [ "$latest" = "$current" ]; then
    echo "You have the newest version, $current."
    exit 0
  fi

  echo "Updating from ${current:-an unknown version} to $latest..."
  work=$(mktemp -d) || exit 1
  trap 'rm -rf "$work"' EXIT
  if ! curl -fsSL --max-time 300 -o "$work/app.zip" "https://github.com/$repo/releases/download/v$latest/weilo-agents-$latest.zip"; then
    echo "Could not download version $latest. Try again in a few minutes."
    exit 1
  fi
  mkdir "$work/app"
  if command -v unzip >/dev/null 2>&1; then
    unzip -oq "$work/app.zip" -d "$work/app" || exit 1
  else
    tar -xf "$work/app.zip" -C "$work/app" || exit 1
  fi
  cp -f "$work"/app/* . || exit 1
  chmod +x ./*.sh

  ./start.sh
}

main "$@"; exit $?
