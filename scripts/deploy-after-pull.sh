#!/usr/bin/env bash
# Run on the server from /opt/mafia-app after git reset (used by push-live*.bat).
# Builds into build.next while leaving build/ untouched so nginx keeps serving the old bundle
# for the whole compile. Only after a successful build do we rotate build/ -> build.prev -> new.
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

if [ -t 1 ] && [ "${MAFIA_DEPLOY_ASCII:-}" != "1" ]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_CYAN=$'\033[36m'
else
  C_RESET= C_BOLD= C_DIM= C_RED= C_GREEN= C_YELLOW= C_CYAN=
fi

step() {
  local cur="$1" tot="$2" label="$3"
  local pct=$((cur * 100 / tot))
  local filled=$((cur * 20 / tot))
  local bar=""
  local i
  for ((i = 0; i < filled; i++)); do bar+="#"; done
  for ((i = filled; i < 20; i++)); do bar+="-"; done
  printf '%b\n' "${C_CYAN}${C_BOLD}[${cur}/${tot}]${C_RESET} ${label}"
  printf '%b\n' "${C_DIM}[${bar}] ${pct}%${C_RESET}"
}

info() { printf '  %b> %s%b\n' "${C_DIM}" "$1" "${C_RESET}"; }
ok()   { printf '  %b[OK] %s%b\n' "${C_GREEN}" "$1" "${C_RESET}"; }
warn() { printf '  %b[!!] %s%b\n' "${C_YELLOW}" "$1" "${C_RESET}"; }
fail() { printf '  %b[XX] %s%b\n' "${C_RED}" "$1" "${C_RESET}"; }

echo
printf '%b\n' "${C_BOLD}  MAFIA WARS - SERVER DEPLOY${C_RESET}"
printf '%b\n' "${C_DIM}  ========================================${C_RESET}"
echo

step 1 4 "Build frontend (build.next - live site stays up)"
build_start=$(date +%s)
info "npm run build - usually 2-5 minutes"
echo

rm -rf build.next

cleanup_failed_build() {
  rm -rf build.next
}
trap cleanup_failed_build ERR

export BUILD_PATH=build.next
npm run build

if [ ! -f build.next/index.html ]; then
  fail "build.next/index.html missing after npm run build"
  exit 1
fi

build_secs=$(( $(date +%s) - build_start ))
ok "Build finished in ${build_secs}s"
echo

step 2 4 "Swap frontend bundle"
trap - ERR

rm -rf build.prev
if [ -d build ]; then
  mv build build.prev
fi
mv build.next build
# Keep previous hashed assets so tabs still on the old index.html do not get HTML-as-JS
# (nginx used to fall through missing /static/* to index.html → ChunkLoadError forever).
if [ -d build.prev/static ]; then
  mkdir -p build/static
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --ignore-existing build.prev/static/ build/static/
  else
    cp -an build.prev/static/. build/static/ 2>/dev/null || true
  fi
  ok "Kept previous static assets for in-flight clients"
fi
rm -rf build.prev
ok "build/ rotated - nginx will serve new bundle"
echo

step 3 4 "Reload nginx"
sudo systemctl reload nginx
ok "nginx reloaded"
echo

if [ "$restart_backend" -ne 1 ]; then
  if git rev-parse --verify --quiet ORIG_HEAD >/dev/null; then
    if git diff --name-only ORIG_HEAD HEAD -- backend | grep -qE '\.py$'; then
      restart_backend=1
      warn "Backend Python changed vs previous live commit - will restart API"
    fi
  fi
fi

if [ "$restart_backend" -ne 1 ]; then
  step 4 4 "Backend"
  ok "API left running (no Python restart needed)"
  echo
  printf '%b\n' "${C_GREEN}${C_BOLD}  [OK] Deploy complete - frontend live${C_RESET}"
  echo
  exit 0
fi

step 4 4 "Restart backend API"
info "Maintenance page while uvicorn restarts"
bash scripts/apply-maintenance.sh restart-backend
ok "API restart finished - site restored"
echo
printf '%b\n' "${C_GREEN}${C_BOLD}  [OK] Deploy complete - frontend + API live${C_RESET}"
echo
