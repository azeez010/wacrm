#!/usr/bin/env bash
# List commits from the original open-source project (ArnasDon/wacrm) that this
# fork hasn't reviewed yet, as a Markdown checklist on stdout.
#
#   scripts/upstream-check.sh                 # locally: `origin` is the upstream
#   UPSTREAM_REMOTE=upstream scripts/upstream-check.sh
#
# A commit is "reviewed" once its 7-char hash is in .github/upstream-reviewed.txt
# (cherry-picked, or deliberately skipped). Add hashes there to silence them.
set -euo pipefail

UP="${UPSTREAM_REMOTE:-origin}"
BRANCH="${UPSTREAM_BRANCH:-main}"
REVIEWED=".github/upstream-reviewed.txt"

git fetch --quiet "$UP" "$BRANCH"
touch "$REVIEWED"

git log "HEAD..$UP/$BRANCH" --no-merges --abbrev=7 --date=short \
  --format='%h|%ad|%an|%s' |
while IFS='|' read -r sha date author subject; do
  grep -qx "$sha" <(sed 's/[[:space:]#].*//' "$REVIEWED") && continue
  echo "- [ ] \`$sha\` ($date, $author) $subject"
done
