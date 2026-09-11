#!/bin/bash
# Revert PERF #2 (lazy Layout) on live. See docs/PERF_OPS_CHANGES.md
set -eu
BACKUP=/opt/mafia-app/backups/App.js.pre-lazy-layout-2026-09-11.js
TARGET=/opt/mafia-app/src/App.js
if [ ! -f "$BACKUP" ]; then
  echo "Missing backup: $BACKUP"
  exit 1
fi
cp -a "$BACKUP" "$TARGET"
echo "Restored $TARGET from backup."
echo "Rebuild frontend next (npm run build) for it to take effect on the site."
