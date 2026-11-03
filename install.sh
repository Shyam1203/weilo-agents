#!/bin/sh
# Install Weilo on macOS or Linux:
#   curl -fsSL https://github.com/Shyam1203/weilo-agents/releases/latest/download/install.sh | sh
# Remove Weilo (your chats and agents' folders stay):
#   curl -fsSL https://github.com/Shyam1203/weilo-agents/releases/latest/download/install.sh | sh -s -- --uninstall
# Remove Weilo and delete your data too (it asks first):
#   curl -fsSL https://github.com/Shyam1203/weilo-agents/releases/latest/download/install.sh | sh -s -- --uninstall --purge
# Settings: WEILO_VERSION=0.2.0 for a given version, WEILO_PREFIX to install somewhere else
# (default ~/.local).
#
# Each version goes in its own folder (~/.local/share/weilo/<version>) and ~/.local/bin/weilo
# is switched to it in one step, so a Weilo that's running keeps its own files.
#
# Everything below is inside functions, and only the last line runs them: if the download
# of this script is cut off, nothing runs.
set -eu

repo="Shyam1203/weilo-agents"
min_glibc="2.35" # the release is built on Ubuntu 22.04
min_pg=16        # crates/weilo-host/src/pg.rs MIN_MAJOR

say() { printf '%s\n' "$*"; }
doing="installed"
fail() {
  say "Weilo couldn't be $doing: $*" >&2
  exit 1
}
need() { command -v "$1" >/dev/null 2>&1 || fail "it needs $1."; }

# --- Questions ---------------------------------------------------------------------------

# A question can be asked only with a terminal (curl | sh reads the script, not answers).
can_ask() { [ -t 2 ] && (true </dev/tty) 2>/dev/null; }

# "y" or "yes" answers yes; anything else, or no terminal, is no.
ask() {
  can_ask || return 1
  printf '%s [y/N] ' "$1" >/dev/tty
  read -r reply </dev/tty || return 1
  case "$reply" in
    [yY] | [yY][eE][sS]) return 0 ;;
  esac
  return 1
}

# --- This computer -----------------------------------------------------------------------

# One field of /etc/os-release (or the file given), without quotes.
os_release_field() {
  [ -r "$1" ] || return 0
  sed -n "s/^$2=//p" "$1" | head -n 1 | sed 's/^"//; s/"$//; s/^'"'"'//; s/'"'"'$//'
}

# debian, fedora, rhel, arch or other, from os-release's ID and ID_LIKE.
distro_family() {
  # ID first, then ID_LIKE in order: Rocky says "rhel centos fedora", so it's rhel.
  for word in $1 $2; do
    case "$word" in
      debian | ubuntu) say debian && return 0 ;;
      rhel | centos | rocky | almalinux | ol) say rhel && return 0 ;;
      fedora) say fedora && return 0 ;;
      arch | manjaro | endeavouros) say arch && return 0 ;;
    esac
  done
  say other
}

# The glibc version ("2.35"), "musl", or nothing when it can't be told.
libc_version() {
  v="$(getconf GNU_LIBC_VERSION 2>/dev/null | awk '{print $2}')" || v=""
  if [ -z "$v" ] && command -v ldd >/dev/null 2>&1; then
    out="$(ldd --version 2>&1 || true)"
    case "$out" in
      *musl*) v="musl" ;;
      *) v="$(say "$out" | head -n 1 | awk '{print $NF}')" ;;
    esac
  fi
  case "$v" in
    musl | [0-9]*.[0-9]*) say "$v" ;;
  esac
}

# Whether dotted version $1 is at least $2.
version_at_least() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    n = split(a, x, "."); m = split(b, y, "."); if (m > n) n = m
    for (i = 1; i <= n; i++) { if (x[i] + 0 > y[i] + 0) exit 0; if (x[i] + 0 < y[i] + 0) exit 1 }
    exit 0 }'
}

# Says why this Linux can't run Weilo, if it can't ($1: libc_version's answer).
libc_problem() {
  case "$1" in
    "") ;;
    musl) say "Weilo needs a Linux with glibc, like Ubuntu, Debian or Fedora. Alpine and other musl-based Linux aren't supported yet." ;;
    *) version_at_least "$1" "$min_glibc" ||
      say "this Linux is too old for Weilo. Weilo needs glibc $min_glibc or newer (Ubuntu 22.04, Debian 12, Fedora 36 or newer), and this computer has glibc $1." ;;
  esac
}

# --- Weilo 0.1 ---------------------------------------------------------------------------

# 0.1 ran in Docker and kept pi's files in ~/.weilo-agents (agent/, isolated/). 0.2 keeps
# secrets/ there instead.
old_data_in() {
  [ -d "$1" ] || return 1
  [ ! -d "$1/secrets" ] || return 1
  [ -d "$1/agent" ] || [ -d "$1/isolated" ] || [ -d "$1/isolated-sessions" ]
}

# 0.1 answers /api/health with {"ok":true}; 0.2 also says its version.
old_health() {
  case "$1" in
    *'"version"'*) return 1 ;;
    *'"ok":true'* | *'"ok": true'*) return 0 ;;
  esac
  return 1
}

# The folder with 0.1's compose.yaml, from its container (weilo-core or weilo-sandbox).
old_compose_folder() {
  command -v docker >/dev/null 2>&1 || return 1
  for c in weilo-core weilo-sandbox; do
    d="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$c" 2>/dev/null)" || continue
    say "${d:-unknown}"
    return 0
  done
  return 1
}

# What to do about 0.1 ($1: its compose folder, or "unknown"; $2: its data folder).
old_steps() {
  say "Weilo 0.1 is on this computer. Weilo 0.2 is a new program and can't use 0.1's data,"
  say "so turn 0.1 off and set its data aside first:"
  say ""
  if [ "$1" = unknown ]; then
    say "  1. Stop Weilo 0.1. In Terminal, go to the folder you unzipped it in (the one with"
    say "     start.sh) and run:"
    say "       docker compose down"
  else
    say "  1. Stop Weilo 0.1:"
    say "       cd \"$1\" && docker compose down"
  fi
  say "  2. Move its data aside:"
  say "       mv \"$2\" \"$2-0.1\""
  say "     (If it says \"Permission denied\", put sudo in front.)"
  say ""
  say "Then run this installer again. Your 0.1 chats and files stay in $2-0.1."
}

# Stops with old_steps when 0.1 is here or running.
check_old_install() {
  data="$HOME/.weilo-agents"
  folder="$(old_compose_folder)" || folder=""
  if [ -z "$folder" ]; then
    body="$(curl -fsS -m 2 http://127.0.0.1:3210/api/health 2>/dev/null)" || body=""
    if old_health "$body" || old_data_in "$data"; then folder="unknown"; fi
  fi
  [ -n "$folder" ] || return 0
  old_steps "$folder" "$data" >&2
  exit 1
}

# --- A running Weilo ---------------------------------------------------------------------

weilo_home() { say "${WEILO_HOME:-$HOME/.weilo-agents}"; }

# Whether Weilo runs for this home. Asks the installed `weilo status` when it has that
# (exit 0: running), else reads host.json, which the host writes while it runs.
weilo_running() {
  bin="$1"
  if [ -x "$bin" ] && "$bin" status --help >/dev/null 2>&1; then
    "$bin" status >/dev/null 2>&1
    return
  fi
  file="$(weilo_home)/host.json"
  [ -f "$file" ] || return 1
  pid="$(sed -n 's/.*"pid":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$file")"
  [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1
}

stop_hint() {
  if [ -x "$1" ] && "$1" stop --help >/dev/null 2>&1; then
    say "run: weilo stop"
  else
    say "press Ctrl+C in the window where it runs"
  fi
}

# --- Postgres ----------------------------------------------------------------------------

# The Postgres installs here, one per line: "<major> <bin folder> <found by Weilo: 1 or 0>".
# $1 is a folder to look under instead of / (for tests).
pg_scan() {
  root="${1:-}"
  if [ -z "$root" ] && command -v pg_config >/dev/null 2>&1; then
    m="$(pg_config --version 2>/dev/null | sed -n 's/^PostgreSQL \([0-9][0-9]*\).*/\1/p')"
    d="$(pg_config --bindir 2>/dev/null)" || d=""
    [ -n "$m" ] && [ -x "$d/initdb" ] && say "$m $d 1"
  fi
  for initdb in "$root"/usr/lib/postgresql/*/bin/initdb \
    "$root"/opt/homebrew/opt/postgresql@*/bin/initdb \
    "$root"/usr/local/opt/postgresql@*/bin/initdb \
    "$root"/usr/pgsql-*/bin/initdb \
    "$root"/Applications/Postgres.app/Contents/Versions/*/bin/initdb; do
    [ -x "$initdb" ] || continue
    d="${initdb%/initdb}"
    m="${d%/bin}"
    m="${m##*/}"
    m="${m#postgresql@}"
    m="${m#pgsql-}"
    case "$m" in *[!0-9]* | "") continue ;; esac
    case "$d" in
      */usr/pgsql-* | */Postgres.app/*) say "$m $d 0" ;;
      *) say "$m $d 1" ;;
    esac
  done
  # Fedora's and Arch's own packages put Postgres in /usr/bin.
  if [ -x "$root/usr/bin/initdb" ] && [ -x "$root/usr/bin/postgres" ]; then
    m="$("$root/usr/bin/postgres" --version 2>/dev/null | sed -n 's/.*PostgreSQL) \([0-9][0-9]*\).*/\1/p')"
    [ -n "$m" ] && say "$m $root/usr/bin 0"
  fi
  return 0
}

# The newest Postgres major apt can install, if it's new enough (package list on stdin).
apt_best_major() {
  sed -n 's/^postgresql-\([0-9][0-9]*\)$/\1/p' | sort -n | awk -v min="$min_pg" '$1 >= min { m = $1 } END { if (m) print m }'
}

# How to install Postgres. $1 family (macos, debian, fedora, rhel, arch, other), $2 the OS
# version (os-release VERSION_ID), $3 the chip (uname -m), $4 the newest Postgres apt has
# (or nothing), $5 1 when Homebrew is here.
pg_advice() {
  case "$1" in
    macos)
      if [ "${5:-0}" = 1 ]; then
        say "  brew install postgresql@$min_pg"
      else
        say "  First get Homebrew from https://brew.sh, then run:"
        say "  brew install postgresql@$min_pg"
      fi
      ;;
    debian)
      if [ -n "${4:-}" ]; then
        say "  sudo apt install -y postgresql-$4"
      else
        say "  sudo apt install -y postgresql-common"
        say "  sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y"
        say "  sudo apt install -y postgresql-$min_pg"
      fi
      ;;
    fedora)
      say "  sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/F-${2%%.*}-$3/pgdg-fedora-repo-latest.noarch.rpm"
      say "  sudo dnf install -y postgresql$min_pg-server"
      ;;
    rhel)
      el="${2%%.*}"
      say "  sudo dnf install -y https://download.postgresql.org/pub/repos/yum/reporpms/EL-$el-$3/pgdg-redhat-repo-latest.noarch.rpm"
      case "$el" in 8 | 9) say "  sudo dnf -qy module disable postgresql" ;; esac
      say "  sudo dnf install -y postgresql$min_pg-server"
      ;;
    arch)
      say "  sudo pacman -S postgresql"
      ;;
    *)
      say "  Get it from https://www.postgresql.org/download/"
      ;;
  esac
}

# Says whether Postgres is ready, and how to get it when it isn't ($1: os, $2: chip).
check_postgres() {
  found="$(pg_scan "")"
  known="$(say "$found" | awk -v min="$min_pg" '$1 >= min && $3 == 1' | sort -n | tail -n 1)"
  [ -z "$known" ] || return 0
  other="$(say "$found" | awk -v min="$min_pg" '$1 >= min && $3 == 0' | sort -n | tail -n 1)"
  say ""
  if [ -n "$other" ]; then
    m="${other%% *}"
    d="${other#* }"
    d="${d% *}"
    say "Postgres $m is here, in $d. If Weilo says it can't find Postgres, start it with:"
    say "  WEILO_PG_BIN=$d weilo up"
    return 0
  fi
  old="$(say "$found" | awk 'NF' | sort -n | tail -n 1)"
  if [ -n "$old" ]; then
    say "Postgres ${old%% *} is here, but Weilo needs Postgres $min_pg or newer. Install it with:"
  else
    say "Weilo keeps its data in Postgres $min_pg or newer, which isn't installed yet. Install it with:"
  fi
  if [ "$1" = apple-darwin ]; then
    brew=0
    command -v brew >/dev/null 2>&1 && brew=1
    pg_advice macos "" "$2" "" "$brew"
  else
    family="$(distro_family "$(os_release_field /etc/os-release ID)" "$(os_release_field /etc/os-release ID_LIKE)")"
    apt_major=""
    if [ "$family" = debian ] && command -v apt-cache >/dev/null 2>&1; then
      apt_major="$(apt-cache pkgnames postgresql- 2>/dev/null | apt_best_major)" || apt_major=""
    fi
    pg_advice "$family" "$(os_release_field /etc/os-release VERSION_ID)" "$2" "$apt_major" 0
  fi
  say "Weilo starts and stops its own copy, so you don't need to set it up or run it."
}

# --- PATH --------------------------------------------------------------------------------

# Where to add the bin folder to PATH, and the line: "<file>|<line>".
# $1 shell name (zsh, bash, fish…), $2 os (apple-darwin or Linux), $3 bin folder, $4 home.
path_advice() {
  case "$3" in
    "$4"/*) shown="\$HOME${3#"$4"}" ;;
    *) shown="$3" ;;
  esac
  line="export PATH=\"$shown:\$PATH\""
  case "$1" in
    zsh) if [ "$2" = apple-darwin ]; then file="$4/.zprofile"; else file="$4/.zshrc"; fi ;;
    bash) if [ "$2" = apple-darwin ]; then file="$4/.bash_profile"; else file="$4/.bashrc"; fi ;;
    fish)
      file="$4/.config/fish/config.fish"
      line="fish_add_path $shown"
      ;;
    *) file="$4/.profile" ;;
  esac
  say "$file|$line"
}

# Offers to put the bin folder on PATH. Says how to start Weilo either way.
check_path() {
  bindir="$1"
  case ":$PATH:" in
    *":$bindir:"*)
      say ""
      say "Start it with: weilo up"
      return 0
      ;;
  esac
  advice="$(path_advice "$(basename "${SHELL:-sh}")" "$2" "$bindir" "$HOME")"
  file="${advice%%|*}"
  line="${advice#*|}"
  shown_file="$file"
  tilde="~"
  case "$file" in "$HOME"/*) shown_file="$tilde${file#"$HOME"}" ;; esac
  say ""
  if [ -f "$file" ] && grep -qsF "$line" "$file"; then
    say "Open a new Terminal window, then start Weilo with: weilo up"
    return 0
  fi
  say "Your Terminal doesn't look in $bindir for programs yet. To fix that, add this line"
  say "to $shown_file:"
  say "  $line"
  if ask "Add it now?"; then
    mkdir -p "$(dirname "$file")"
    printf '\n# Added by the Weilo installer\n%s\n' "$line" >>"$file"
    say "Added. Open a new Terminal window, then start Weilo with: weilo up"
  else
    say "Until then, start Weilo with: $bindir/weilo up"
  fi
}

# --- Download checks ---------------------------------------------------------------------

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# SHA256SUMS comes from the same release as the download, so a match shows the file
# arrived whole and undamaged, not who made it. The GitHub check below shows that GitHub's
# release workflow for this repo built it; it needs the GitHub CLI, signed in.
check_attestation() {
  file="$1"
  couldnt="The checksum matched, so the file arrived whole, but that alone can't show who built it."
  if ! command -v gh >/dev/null 2>&1; then
    return 0
  fi
  if ! gh attestation --help >/dev/null 2>&1; then
    say "Couldn't check where this download was built: your GitHub CLI is too old for it (update gh to check)."
    say "Going on: $couldnt"
    return 0
  fi
  if ! gh auth status >/dev/null 2>&1; then
    say "Couldn't check where this download was built: sign in to the GitHub CLI (gh auth login) to check."
    say "Going on: $couldnt"
    return 0
  fi
  if out="$(gh attestation verify "$file" --repo "$repo" 2>&1)"; then
    say "Checked: GitHub built this download for Weilo."
    return 0
  fi
  case "$out" in
    *"dial tcp"* | *"timeout"* | *"connection refused"* | *"connection reset"* | \
      *"no such host"* | *"TLS"* | *"HTTP 5"[0-9][0-9]* | *"rate limit"* | *"HTTP 403"*)
      say "Couldn't check where this download was built: GitHub didn't answer."
      say "Going on: $couldnt"
      return 0
      ;;
  esac
  fail "this download isn't the one GitHub built for Weilo, so nothing was installed. Please tell us at https://github.com/$repo/issues"
}

# --- Install -----------------------------------------------------------------------------

install() {
  prefix="${WEILO_PREFIX:-$HOME/.local}"
  bindir="$prefix/bin"
  share="$prefix/share/weilo"
  link="$bindir/weilo"

  need curl
  need tar
  need mktemp

  case "$(uname -s)" in
    Linux) os="unknown-linux-gnu" ;;
    Darwin) os="apple-darwin" ;;
    *) fail "it runs on macOS and Linux only." ;;
  esac
  chip="$(uname -m)"
  case "$chip" in
    x86_64 | amd64) arch="x86_64" ;;
    arm64 | aarch64) arch="aarch64" ;;
    *) fail "this computer's chip ($chip) isn't supported." ;;
  esac
  target="$arch-$os"
  if [ "$os" = unknown-linux-gnu ]; then
    problem="$(libc_problem "$(libc_version)")"
    [ -z "$problem" ] || fail "$problem"
  fi

  check_old_install

  if [ -n "${WEILO_VERSION:-}" ]; then
    tag="v${WEILO_VERSION#v}"
  else
    tag="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest" 2>/dev/null || true)"
    tag="${tag##*/}"
    case "$tag" in
      v*) ;;
      *) fail "there's no released version to download yet. See https://github.com/$repo for news." ;;
    esac
  fi
  version="${tag#v}"
  # Releases before 0.2.0 don't have the files this installer looks for.
  case "$version" in
    0.0.* | 0.1.* | 0.1)
      say "Weilo 0.2.0 isn't released yet. Build it from source for now: https://github.com/$repo#develop" >&2
      exit 1
      ;;
  esac
  name="weilo-$version-$target"
  base="https://github.com/$repo/releases/download/$tag"
  vdir="$share/$version"

  running=0
  weilo_running "$link" && running=1
  previous="$(readlink "$link" 2>/dev/null)" || previous=""

  if [ "$running" = 1 ] && [ -x "$vdir/weilo" ]; then
    # Replacing the folder a running Weilo uses would pull its files out from under it.
    mkdir -p "$bindir"
    ln -s "$vdir/weilo" "$bindir/.weilo.new.$$"
    mv -f "$bindir/.weilo.new.$$" "$link"
    say "Weilo $version is already installed, and Weilo is running."
    say "To install it again, stop Weilo first ($(stop_hint "$link")), then run this again."
    return 0
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  say "Downloading Weilo $version for $target…"
  curl -fsSL -o "$tmp/$name.tar.gz" "$base/$name.tar.gz" || fail "the download didn't work."
  curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" || fail "the checksums didn't download."

  expected="$(grep " $name.tar.gz\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
  [ -n "$expected" ] || fail "the checksum for $name is missing."
  [ "$(sha256_of "$tmp/$name.tar.gz")" = "$expected" ] || fail "the download is damaged (checksum mismatch)."
  say "Checked: the download arrived whole and undamaged."
  check_attestation "$tmp/$name.tar.gz"

  tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
  [ -x "$tmp/$name/weilo" ] || fail "the download doesn't have Weilo in it."
  mkdir -p "$bindir" "$share"
  rm -rf "$vdir.new"
  mv "$tmp/$name" "$vdir.new"
  rm -rf "$vdir"
  mv "$vdir.new" "$vdir"
  # One rename switches the link, so `weilo` is always a whole version.
  ln -s "$vdir/weilo" "$bindir/.weilo.new.$$"
  mv -f "$bindir/.weilo.new.$$" "$link"

  # Tidy up: keep this version and the one before it (a running Weilo may use it).
  if [ "$running" = 0 ]; then
    # The layout before versioned folders: Weilo's files right in $share.
    rm -rf "$share/weilo" "$share/web" "$share/README.md" "$share/SECURITY.md" "$share/CHANGELOG.md"
    for old in "$share"/*; do
      [ -d "$old" ] || continue
      [ "$old" = "$vdir" ] && continue
      [ "$old/weilo" = "$previous" ] && continue
      rm -rf "$old"
    done
  fi

  say "Weilo $version is installed in $vdir."
  if [ "$running" = 1 ]; then
    say "Weilo is running the version from before. To switch to $version, stop Weilo"
    say "($(stop_hint "$link")), then start it again with: weilo up"
  fi

  check_postgres "$os" "$chip"

  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    say ""
    say "Weilo's built-in AI and some AI apps need Node.js. Get it from https://nodejs.org"
  fi

  check_path "$bindir" "$os"
}

# --- Uninstall ---------------------------------------------------------------------------

uninstall() {
  doing="removed"
  purge="$1"
  prefix="${WEILO_PREFIX:-$HOME/.local}"
  share="$prefix/share/weilo"
  link="$prefix/bin/weilo"
  home="$(weilo_home)"
  agents="${WEILO_WORKSPACES:-$HOME/Weilo/agents}"

  if weilo_running "$link"; then
    say "Weilo is running. Stop it first ($(stop_hint "$link")), then run this again." >&2
    exit 1
  fi

  if [ "$purge" = 1 ]; then
    for d in "$home" "$agents"; do
      case "$d" in
        "" | / | "$HOME" | "$HOME/" | /root | /home | /Users) fail "$d is not a folder Weilo made, so --purge won't delete it." ;;
      esac
    done
    can_ask || fail "deleting your data needs you to confirm it in a Terminal window. Download this script and run it there: sh install.sh --uninstall --purge"
    say "This deletes Weilo and all your Weilo data for good:"
    say "  $home (chats, settings, saved keys and the database)"
    say "  $agents (your agents' folders)"
    printf 'Type delete to go on: ' >/dev/tty
    read -r reply </dev/tty || reply=""
    [ "$reply" = delete ] || {
      say "Nothing was deleted."
      exit 1
    }
  fi

  removed=0
  target="$(readlink "$link" 2>/dev/null)" || target=""
  case "$target" in
    "$share"/*)
      rm -f "$link"
      removed=1
      ;;
    "") ;;
    *) say "Left $link alone: it isn't the one this installer made." ;;
  esac
  if [ -d "$share" ]; then
    rm -rf "$share"
    removed=1
  fi
  if [ "$removed" = 1 ]; then say "Weilo is removed."; else say "Weilo wasn't installed in $prefix."; fi

  if [ "$purge" = 1 ]; then
    rm -rf "$home" "$agents" || say "Some of it couldn't be deleted. Try again with sudo in front."
    rmdir "$HOME/Weilo" 2>/dev/null || true
    say "Your Weilo data is deleted."
    [ ! -d /var/lib/weilo-agents ] || say "Weilo's database from running it as root is in /var/lib/weilo-agents. Delete it with: sudo rm -rf /var/lib/weilo-agents"
  else
    say ""
    say "Your data is still here, if you want it back or want to delete it:"
    say "  $home: chats, settings, saved keys and the database"
    say "  $agents: your agents' folders"
    [ ! -d /var/lib/weilo-agents ] || say "  /var/lib/weilo-agents: the database, from running Weilo as root"
    say "To delete these too, run this again with: --uninstall --purge"
  fi
  say ""
  say "Coding sessions may have left copies of your projects in a .weilo-worktrees folder next"
  say "to each project, and branches named weilo/… in the projects. Weilo never deletes these, so"
  say "your work stays. To see the branches, run this in a project: git branch --list 'weilo/*'"
}

usage() {
  say "Install Weilo:              sh install.sh"
  say "Remove Weilo, keep data:    sh install.sh --uninstall"
  say "Remove Weilo and data:      sh install.sh --uninstall --purge"
}

main() {
  mode=install
  purge=0
  for arg in "$@"; do
    case "$arg" in
      --uninstall) mode=uninstall ;;
      --purge) purge=1 ;;
      -h | --help)
        usage
        return 0
        ;;
      *)
        usage >&2
        fail "it doesn't know \"$arg\"."
        ;;
    esac
  done
  if [ "$purge" = 1 ] && [ "$mode" != uninstall ]; then
    fail "--purge only goes with --uninstall."
  fi
  if [ "$mode" = uninstall ]; then uninstall "$purge"; else install; fi
}

main "$@"
