#!/usr/bin/env bash
# Run on the server from /opt/mafia-app after git reset (used by push-live*.bat).
# Builds the React app into a temp output dir, then swaps into build/ in one step so nginx
# keeps serving the previous bundle for the whole compile (avoids "frontend down" during npm run build).
#
# Usage:
#   bash scripts/deploy-after-pull.sh              # reload nginx only
#   bash scripts/deploy-after-pull.sh --restart-backend

set -euo pipefail

cd /opt/mafia-app

restart_backend=0
if [ "${1:-}" = "--restart-backend" ]; then
  restart_backend=1
fi

rm -rf build.next

if [ -d build ]; then
  rm -rf build.prev
  mv build build.prev
else
  rm -rf build.prev
fi

restore_on_fail() {
  rm -rf build.next
  if [ ! -d build ] && [ -d build.prev ]; then
    mv build.prev build
  fi
}
trap restore_on_fail ERR

# react-scripts 4+ respects BUILD_PATH; output never touches live "build/" until mv below
export BUILD_PATH=build.next
npm run build

trap - ERR

mv build.next build
rm -rf build.prev

sudo systemctl reload nginx

if [ "$restart_backend" -eq 1 ]; then
  sudo systemctl restart mafia-backend
fi
