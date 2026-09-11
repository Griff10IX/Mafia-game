#!/bin/bash
# Revert PERF #5 (lucide per-file trim). See docs/PERF_OPS_CHANGES.md
set -eu
B=/opt/mafia-app/backups
S=/opt/mafia-app/src
if [ ! -f "$B/Layout.js.pre-lucide-trim-2026-09-11.js" ]; then
  echo "Missing backup: $B/Layout.js.pre-lucide-trim-2026-09-11.js"
  exit 1
fi
cp -a "$B/Layout.js.pre-lucide-trim-2026-09-11.js" "$S/components/Layout.js"
rm -f "$S/components/layoutLucideIcons.js"
echo "Restored Layout.js; removed layoutLucideIcons.js"
echo "Rebuild: cd /opt/mafia-app && bash scripts/deploy-after-pull.sh"
