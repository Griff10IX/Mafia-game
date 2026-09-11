#!/bin/bash
# Revert PERF #3 (lazy themes-expanded + ThemePicker). See docs/PERF_OPS_CHANGES.md
set -eu
B=/opt/mafia-app/backups
S=/opt/mafia-app/src
for pair in \
  "themes.js.pre-lazy-expanded-2026-09-11.js:constants/themes.js" \
  "ThemeContext.js.pre-lazy-expanded-2026-09-11.js:context/ThemeContext.js" \
  "Layout.js.pre-lazy-expanded-2026-09-11.js:components/Layout.js" \
  "ThemePicker.js.pre-lazy-expanded-2026-09-11.js:components/ThemePicker.js"
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
echo "Rebuild frontend next: cd /opt/mafia-app && bash scripts/deploy-after-pull.sh"
