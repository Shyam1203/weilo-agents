#!/bin/sh
# Prints the CHANGELOG.md section for a version (the lines under "## <version>", up to the
# next "## "), for the release notes. Fails when there's no such section, or it's empty.
#   .github/scripts/release-notes.sh 0.2.0 [CHANGELOG.md]
set -eu
version="${1:?usage: release-notes.sh <version> [changelog]}"
file="${2:-CHANGELOG.md}"
notes="$(awk -v v="$version" '
  /^## / {
    if (found) exit
    head = $2; gsub(/[][]/, "", head)
    if (head == v) { found = 1; next }
  }
  found { print }
' "$file")"
if [ -z "$(printf '%s' "$notes" | tr -d '[:space:]')" ]; then
  echo "CHANGELOG.md has no entry for $version. Add a \"## $version\" section before tagging." >&2
  exit 1
fi
printf '%s\n' "$notes"
