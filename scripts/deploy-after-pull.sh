#!/usr/bin/env bash
# Run on the server from /opt/mafia-app after git reset (used by push-live*.bat).
# Builds into build.next while leaving build/ untouched so nginx keeps serving the old bundle
# for the whole compile. Only after a successful build do we rotate build/ → build.prev → new.
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

if [ "$restart_backend" -eq 1 ]; then
  sudo systemctl restart mafia-backend
  # If the API fails to start, nginx may still return 5xx — check: journalctl -u mafia-backend -e
fi
