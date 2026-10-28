#!/bin/sh
# Install Weilo on macOS or Linux:
#   curl -fsSL https://github.com/Shyam1203/weilo-agents/releases/latest/download/install.sh | sh
# Set WEILO_VERSION=0.2.0 for a given version, WEILO_PREFIX to install somewhere else.
set -eu

repo="Shyam1203/weilo-agents"
prefix="${WEILO_PREFIX:-$HOME/.local}"

say() { printf '%s\n' "$*"; }
fail() { say "Weilo couldn't be installed: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "it needs $1."; }

need curl
need tar

case "$(uname -s)" in
  Linux) os="unknown-linux-gnu" ;;
  Darwin) os="apple-darwin" ;;
  *) fail "it runs on macOS and Linux only." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) arch="x86_64" ;;
  arm64 | aarch64) arch="aarch64" ;;
  *) fail "this computer's chip ($(uname -m)) isn't supported." ;;
esac
target="$arch-$os"

if [ -n "${WEILO_VERSION:-}" ]; then
  tag="v${WEILO_VERSION#v}"
else
  tag="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")"
  tag="${tag##*/}"
  case "$tag" in v*) ;; *) fail "the newest version couldn't be found." ;; esac
fi
version="${tag#v}"
name="weilo-$version-$target"
base="https://github.com/$repo/releases/download/$tag"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

say "Downloading Weilo $version for $target…"
curl -fsSL -o "$tmp/$name.tar.gz" "$base/$name.tar.gz" || fail "the download didn't work."
curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" || fail "the checksums didn't download."

expected="$(grep " $name.tar.gz\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
[ -n "$expected" ] || fail "the checksum for $name is missing."
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$name.tar.gz" | cut -d' ' -f1)"
else
  actual="$(shasum -a 256 "$tmp/$name.tar.gz" | cut -d' ' -f1)"
fi
[ "$actual" = "$expected" ] || fail "the download is damaged (checksum mismatch)."

tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
dest="$prefix/share/weilo"
rm -rf "$dest.new"
mkdir -p "$prefix/bin" "$prefix/share"
mv "$tmp/$name" "$dest.new"
rm -rf "$dest"
mv "$dest.new" "$dest"
ln -sf "$dest/weilo" "$prefix/bin/weilo"

say "Weilo $version is installed in $dest."

has_pg=0
command -v pg_config >/dev/null 2>&1 && has_pg=1
for initdb in /usr/lib/postgresql/*/bin/initdb /opt/homebrew/opt/postgresql@*/bin/initdb /usr/local/opt/postgresql@*/bin/initdb; do
  [ -x "$initdb" ] && has_pg=1
done
if [ "$has_pg" = 0 ]; then
  say ""
  say "Weilo keeps its data in Postgres, which isn't installed yet. Install it with:"
  if [ "$os" = "apple-darwin" ]; then
    say "  brew install postgresql@16"
  else
    say "  sudo apt install postgresql-16"
  fi
  say "Weilo starts and stops its own copy, so you don't need to set it up or run it."
fi

case ":$PATH:" in
  *":$prefix/bin:"*) ;;
  *) say ""; say "Add $prefix/bin to your PATH, or run $prefix/bin/weilo." ;;
esac

say ""
say "Start it with: weilo up"
