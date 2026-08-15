#!/usr/bin/env bash
# Run on the server from /opt/mafia-app after git reset (used by push-live*.bat).
# Builds into build.next while leaving build/ untouched so nginx keeps serving the old bundle
# for the whole compile. Only after a successful build do we rotate build/ → build.prev → new.
#
# Usage:
#   bash scripts/deploy-after-pull.sh              # reload nginx only (no API downtime)
#   bash scripts/deploy-after-pull.sh --restart-backend

set -euo pipefail

cd /opt/mafia-app

restart_backend=0
if [ "${1:-}" = "--restart-backend" ]; then
  restart_backend=1
fi

rm -rf build.next

cleanup_failed_build() {
  rm -rf build.next
}
trap cleanup_failed_build ERR

# react-scripts 4+ respects BUILD_PATH; live build/ is not touched until swap below
export BUILD_PATH=build.next
npm run build

if [ ! -f build.next/index.html ]; then
  echo "deploy-after-pull.sh: build.next/index.html missing after npm run build" >&2
  exit 1
fi

trap - ERR

# Swap new bundle in (sub-second gap between mvs; old bundle served until this point)
rm -rf build.prev
if [ -d build ]; then
  mv build build.prev
fi
mv build.next build
rm -rf build.prev

sudo systemctl reload nginx

if [ "$restart_backend" -ne 1 ]; then
  echo "deploy-after-pull.sh: frontend swapped; backend left running"
  exit 0
fi

# Show the maintenance page as the SPA shell while uvicorn is down, then put index.html back.
index_bak=/tmp/mafia-index.html.bak
live_index=/opt/mafia-app/build/index.html
maint=/opt/mafia-app/maintenance.html
if [ ! -f "$maint" ]; then
  maint=/var/www/html/maintenance.html
fi

restore_index() {
  if [ -f "$index_bak" ] && [ -d /opt/mafia-app/build ]; then
    cp -f "$index_bak" "$live_index"
    rm -f "$index_bak"
  fi
}
trap restore_index EXIT

if [ -f "$live_index" ] && [ -f "$maint" ]; then
  cp -f "$live_index" "$index_bak"
  cp -f "$maint" "$live_index"
  sudo systemctl reload nginx || true
  echo "deploy-after-pull.sh: maintenance page up while API restarts"
fi

sudo systemctl restart mafia-backend

up=0
for _ in $(seq 1 90); do
  if curl -sS -o /dev/null --max-time 2 http://127.0.0.1:8000/openapi.json; then
    up=1
    break
  fi
  sleep 1
done
if [ "$up" -ne 1 ]; then
  echo "deploy-after-pull.sh: backend did not answer on :8000 within 90s; restoring site anyway" >&2
fi

restore_index
trap - EXIT
sudo systemctl reload nginx || true
echo "deploy-after-pull.sh: API restart finished; site restored"
