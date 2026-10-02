#!/usr/bin/env bash
# Daily StackGrade badge re-grade: node tools/badges.mjs, then commit + push badge/ if anything changed.
# Usage: tools/badges-daily.sh [--if-needed]   (--if-needed = skip if today's run already succeeded; used by the box cron backup)
# Writes .state/last-status (ok|fail + time + error tail) every run and .state/last-success-date on success.
set -uo pipefail
cd "$(dirname "$0")/.."
export TZ=America/Chicago HOME="${HOME:-/home/box}"
[ -x "$HOME/.local/node22/bin/node" ] && export PATH="$HOME/.local/node22/bin:$PATH"
export PATH="$PATH:/usr/local/bin:/usr/bin:/bin"
mkdir -p .state logs
TODAY="$(date +%F)"
if [ "${1:-}" = "--if-needed" ] && [ "$(cat .state/last-success-date 2>/dev/null)" = "$TODAY" ]; then exit 0; fi
exec 9>.state/badges.lock; flock -n 9 || exit 0
LOG="logs/badges-$TODAY.log"
run() {
  set -e
  echo "=== $(date) trigger=${1:-manual} ==="
  git pull -q --rebase --autostash origin main || true
  node tools/badges.mjs
  git add -A badge domains.json
  if git diff --cached --quiet; then echo "no badge changes"; else
    git -c user.name=299nhs7sjg-netizen -c user.email=299nhs7sjg-netizen@users.noreply.github.com commit -q -m "Daily badge re-grade $TODAY"
    git push -q origin HEAD:main
    echo "pushed $(git rev-parse --short HEAD)"
  fi
  echo "=== done $(date) ==="
}
( run "${1:-manual}" ) > "$LOG.tmp" 2>&1; RC=$?
cat "$LOG.tmp" >> "$LOG"
if [ $RC -eq 0 ]; then echo "$TODAY" > .state/last-success-date; printf 'ok %s\n' "$(date '+%F %T %Z')" > .state/last-status
else { printf 'fail %s exit=%s\n--- error tail ---\n' "$(date '+%F %T %Z')" "$RC"; tail -25 "$LOG.tmp"; } > .state/last-status; fi
rm -f "$LOG.tmp"; tail -3 "$LOG"; exit $RC
