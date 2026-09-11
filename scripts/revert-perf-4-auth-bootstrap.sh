#!/bin/bash
# Revert PERF #4 (shared /auth/me + deferred polls). See docs/PERF_OPS_CHANGES.md
set -eu
B=/opt/mafia-app/backups
S=/opt/mafia-app/src
for pair in \
  "Layout.js.pre-auth-bootstrap-2026-09-11.js:components/Layout.js" \
  "dashboardSessionCache.js.pre-auth-bootstrap-2026-09-11.js:utils/dashboardSessionCache.js" \
  "api.js.pre-auth-bootstrap-2026-09-11.js:utils/api.js"
do
  src="${pair%%:*}"
  dest="${pair##*:}"
  if [ ! -f "$B/$src" ]; then
    echo "Missing backup: $B/$src"
    exit 1
  fi
  cp -a "$B/$src" "$S/$dest"
  echo "Restored $S/$dest"
done
rm -f "$S/utils/authMeBootstrap.js"
echo "Removed $S/utils/authMeBootstrap.js"
echo "Rebuild: cd /opt/mafia-app && bash scripts/deploy-after-pull.sh"
