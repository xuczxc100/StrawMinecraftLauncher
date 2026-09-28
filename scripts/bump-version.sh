#!/usr/bin/env bash
# Bump VERSION a.b.c.d (d = preview; 0 = release) and sync package.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT/VERSION"
cur="$(tr -d '[:space:]' < "$FILE")"
IFS=. read -r a b c d <<<"$cur"
part="${1:-preview}"
case "$part" in
  major) a=$((a+1)); b=0; c=0; d=1 ;;
  minor) b=$((b+1)); c=0; d=1 ;;
  patch) c=$((c+1)); d=1 ;;
  preview) d=$((d+1)) ;;
  release) d=0 ;;
  *) echo "usage: $0 [major|minor|patch|preview|release]"; exit 1 ;;
esac
next="$a.$b.$c.$d"
echo "$next" > "$FILE"
node "$ROOT/scripts/sync-version.mjs"
echo "bumped to $next"
