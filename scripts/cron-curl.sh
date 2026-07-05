#!/usr/bin/env bash
# Call POST /api/auto-rank/cron with CRON_SECRET from backend/.env.
# Use this from crontab so the secret always matches the backend (no copy-paste).
#
# Usage: ./scripts/cron-curl.sh [main|bust|robot-bg|wc-sync|wc-settle]
#   main      = /api/auto-rank/cron  (default)
#   bust      = /api/auto-rank/cron-bust
#   robot-bg  = /api/attack/cron/robot-bg-auto-search
#   wc-sync   = /api/world-cup/cron/sync-fixtures
#   wc-settle = /api/world-cup/cron/auto-settle
#
# IMPORTANT: Crontab only runs at most once per minute (* * * * * = every 60s).
# So if you set "interval" to 5s in admin, it will still only run every 60s when
# using crontab. For a 5s (or 10s) interval, run the ticker instead:
#   python scripts/cron-cycle-ticker.py   # calls main cron every 5s (set CRON_CYCLE_INTERVAL to match admin)
#
# Crontab examples (run from project root) — effective interval = 60s:
#   * * * * * /path/to/Game-files-mafia/scripts/cron-curl.sh main
#   * * * * * /path/to/Game-files-mafia/scripts/cron-curl.sh bust

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../backend" && pwd)"
ENV_FILE="$BACKEND_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

# Load CRON_SECRET and optional BASE_URL from .env (same file the backend uses)
export CRON_SECRET=""
export BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"
  case "$line" in
    CRON_SECRET=*) CRON_SECRET="${line#CRON_SECRET=}"; CRON_SECRET="${CRON_SECRET#\"}"; CRON_SECRET="${CRON_SECRET%\"}"; CRON_SECRET="${CRON_SECRET#\'}"; CRON_SECRET="${CRON_SECRET%\'}"; CRON_SECRET="${CRON_SECRET// }"; ;;
    BASE_URL=*)    BASE_URL="${line#BASE_URL=}"; BASE_URL="${BASE_URL#\"}"; BASE_URL="${BASE_URL%\"}"; BASE_URL="${BASE_URL%\/}"; ;;
  esac
done < "$ENV_FILE"

if [ -z "$CRON_SECRET" ]; then
  echo "CRON_SECRET not set in $ENV_FILE" >&2
  exit 1
fi

PATH_SUFFIX="api/auto-rank/cron"
case "${1:-main}" in
  bust) PATH_SUFFIX="api/auto-rank/cron-bust" ;;
  robot-bg) PATH_SUFFIX="api/attack/cron/robot-bg-auto-search" ;;
  wc-sync) PATH_SUFFIX="api/world-cup/cron/sync-fixtures" ;;
  wc-settle) PATH_SUFFIX="api/world-cup/cron/auto-settle" ;;
  main) ;;
  *)   echo "Usage: $0 [main|bust|robot-bg|wc-sync|wc-settle]" >&2; exit 1 ;;
esac

curl -s -X POST \
  -H "X-Cron-Secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  "${BASE_URL}/${PATH_SUFFIX}"
