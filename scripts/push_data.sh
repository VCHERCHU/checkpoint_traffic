#!/usr/bin/env bash
# Publish data/analysis.json to the orphan `data` branch as a single commit.
#
# Builds a throwaway one-commit repo and force-pushes it, so the branch never
# accumulates history and the working checkout is never touched. Serving from
# this branch (via raw.githubusercontent.com) also avoids triggering a Pages
# rebuild on every one of the ~24 updates in a session.
set -euo pipefail

SRC="${1:-data/analysis.json}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"
TOKEN="${GITHUB_TOKEN:?GITHUB_TOKEN not set}"

[ -f "$SRC" ] || { echo "no $SRC to publish" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp "$SRC" "$TMP/analysis.json"

cd "$TMP"
git init -q -b data
git config user.name  "checkpoint-traffic bot"
git config user.email "noreply@github.com"
git add analysis.json
git commit -q -m "analysis $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -q --force "https://x-access-token:${TOKEN}@github.com/${REPO}.git" data
echo "  published to data branch"
