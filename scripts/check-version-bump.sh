#!/usr/bin/env bash
# Fails when source/config files changed relative to BASE without a VERSION change.
# BASE defaults to the previous commit (push) or the PR base (GITHUB_BASE_REF).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
  git fetch --no-tags --depth=50 origin "$GITHUB_BASE_REF" >/dev/null 2>&1 || true
  BASE="origin/$GITHUB_BASE_REF"
else
  BASE="${1:-HEAD~1}"
fi

if ! git rev-parse --verify -q "$BASE" >/dev/null; then
  echo "check-version-bump: base $BASE not found, skipping (initial commit)"
  exit 0
fi

changed="$(git diff --name-only "$BASE"...HEAD 2>/dev/null || git diff --name-only "$BASE" HEAD)"
relevant="$(echo "$changed" | grep -Ev '^(docs/|README\.md$|release-notes\.pending\.md$|\.github/ISSUE_TEMPLATE/)' | grep -v '^$' || true)"

if [[ -z "$relevant" ]]; then
  echo "check-version-bump: only docs changed, OK"
  exit 0
fi

if echo "$changed" | grep -qx 'VERSION'; then
  old="$(git show "$BASE:VERSION" 2>/dev/null | tr -d '[:space:]' || echo none)"
  new="$(tr -d '[:space:]' < VERSION)"
  if [[ "$old" == "$new" ]]; then
    echo "check-version-bump: VERSION touched but unchanged ($new)"
    exit 1
  fi
  echo "check-version-bump: $old -> $new OK"
  exit 0
fi

echo "check-version-bump: source changed without VERSION bump. Run scripts/bump-version.sh"
echo "$relevant"
exit 1
