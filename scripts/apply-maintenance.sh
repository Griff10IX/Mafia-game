#!/usr/bin/env bash
# Show or hide the live downtime page, and write /deploy-notice.json for the in-game overlay.
#
# Env (set by the Windows push bats):
#   MAFIA_MAINT_BY     commission | system_ai
#   MAFIA_MAINT_WHAT   short player-facing phrase, e.g. "the game engine"
#   MAFIA_MAINT_HEADLINE / LINE1 / LINE2 / FOOTER / ESTIMATE  (optional overrides)
#
# Usage:
#   bash scripts/apply-maintenance.sh on
#   bash scripts/apply-maintenance.sh off
#   bash scripts/apply-maintenance.sh restart-backend

set -euo pipefail

cd /opt/mafia-app

mode="${1:-on}"
index_bak=/tmp/mafia-index.html.bak
live_index=/opt/mafia-app/build/index.html
notice_path=/opt/mafia-app/build/deploy-notice.json
www_maint=/var/www/html/maintenance.html
template=/opt/mafia-app/maintenance.html
if [ ! -f "$template" ]; then
  template=/var/www/html/maintenance.html
fi

py() {
  if [ -x /opt/mafia-app/backend/venv/bin/python ]; then
    /opt/mafia-app/backend/venv/bin/python "$@"
  else
    python3 "$@"
  fi
}

render() {
  MAFIA_MAINT_BY="${MAFIA_MAINT_BY:-commission}" \
  MAFIA_MAINT_WHAT="${MAFIA_MAINT_WHAT:-}" \
  MAFIA_MAINT_HEADLINE="${MAFIA_MAINT_HEADLINE:-}" \
  MAFIA_MAINT_LINE1="${MAFIA_MAINT_LINE1:-}" \
  MAFIA_MAINT_LINE2="${MAFIA_MAINT_LINE2:-}" \
  MAFIA_MAINT_FOOTER="${MAFIA_MAINT_FOOTER:-}" \
  MAFIA_MAINT_ESTIMATE="${MAFIA_MAINT_ESTIMATE:-}" \
  MAFIA_MAINT_ACTIVE="${MAFIA_MAINT_ACTIVE:-1}" \
  py - "$template" "$notice_path" "$www_maint" <<'PY'
import html, json, os, pathlib, sys

template_path, notice_path, www_maint = (pathlib.Path(p) for p in sys.argv[1:4])
by = (os.environ.get("MAFIA_MAINT_BY") or "commission").strip().lower()
if by not in ("system_ai", "commission"):
    by = "commission"
what = " ".join((os.environ.get("MAFIA_MAINT_WHAT") or "").split()).strip()
active = (os.environ.get("MAFIA_MAINT_ACTIVE") or "1").strip() not in ("0", "false", "off")

if by == "system_ai":
    headline = "System AI is updating"
    footer = "Posted by System AI"
    icon = (
        '<img class="ai-avatar" src="/images/system-ai-profile.jpg?v=5" '
        'alt="System AI" width="88" height="88" />'
    )
    line1 = f"Updating {what}." if what else "The streets are being patched."
else:
    headline = "Updating Game"
    footer = "The Commission will return"
    icon = "&#9876;"
    line1 = f"Updating {what}." if what else "We're pushing a fresh update to the streets."

line2 = "Hang tight, the game will be back shortly."
estimate = "~ 30 seconds"
title = "System AI is updating..." if by == "system_ai" else "Updating Game..."

headline = os.environ.get("MAFIA_MAINT_HEADLINE") or headline
line1 = os.environ.get("MAFIA_MAINT_LINE1") or line1
line2 = os.environ.get("MAFIA_MAINT_LINE2") or line2
footer = os.environ.get("MAFIA_MAINT_FOOTER") or footer
estimate = os.environ.get("MAFIA_MAINT_ESTIMATE") or estimate

notice = {
    "active": active,
    "by": by,
    "what": what,
    "headline": headline,
    "line1": line1,
    "line2": line2,
    "footer": footer,
    "estimate": estimate,
}

subs = {
    "__MAINT_TITLE__": html.escape(title),
    "__MAINT_ICON__": icon,
    "__MAINT_HEADLINE__": html.escape(headline),
    "__MAINT_LINE1__": html.escape(line1),
    "__MAINT_LINE2__": html.escape(line2),
    "__MAINT_ESTIMATE__": html.escape(estimate),
    "__MAINT_FOOTER__": html.escape(footer),
}

html_out = template_path.read_text(encoding="utf-8") if template_path.is_file() else ""
if html_out:
    for key, val in subs.items():
        html_out = html_out.replace(key, val)
    pathlib.Path("/tmp/mafia-maint-rendered.html").write_text(html_out, encoding="utf-8")
    www_maint.parent.mkdir(parents=True, exist_ok=True)
    www_maint.write_text(html_out, encoding="utf-8")

if notice_path.parent.is_dir():
    notice_path.write_text(json.dumps(notice, ensure_ascii=False), encoding="utf-8")
PY
}

show_page() {
  MAFIA_MAINT_ACTIVE=1
  export MAFIA_MAINT_ACTIVE
  render
  rendered=/tmp/mafia-maint-rendered.html
  if [ -f "$live_index" ] && [ -f "$rendered" ]; then
    if [ ! -f "$index_bak" ]; then
      cp -f "$live_index" "$index_bak"
    fi
    cp -f "$rendered" "$live_index"
    sudo systemctl reload nginx 2>/dev/null || true
  fi
}

hide_page() {
  if [ -f "$index_bak" ] && [ -d /opt/mafia-app/build ]; then
    cp -f "$index_bak" "$live_index"
    rm -f "$index_bak"
  fi
  MAFIA_MAINT_BY=commission
  MAFIA_MAINT_WHAT=""
  MAFIA_MAINT_HEADLINE=""
  MAFIA_MAINT_LINE1=""
  MAFIA_MAINT_LINE2=""
  MAFIA_MAINT_FOOTER=""
  MAFIA_MAINT_ACTIVE=0
  export MAFIA_MAINT_BY MAFIA_MAINT_WHAT MAFIA_MAINT_HEADLINE MAFIA_MAINT_LINE1 MAFIA_MAINT_LINE2 MAFIA_MAINT_FOOTER MAFIA_MAINT_ACTIVE
  render
  sudo systemctl reload nginx 2>/dev/null || true
}

wait_for_api() {
  local up=0
  local i
  for i in $(seq 1 30); do
    if curl -s -o /dev/null --max-time 2 http://127.0.0.1:8000/openapi.json 2>/dev/null; then
      up=1
      break
    fi
    echo "  > Waiting for API... (${i}/30)"
    sleep 3
  done
  if [ "$up" -ne 1 ]; then
    echo "  [!!] Backend did not answer on :8000 within 90s - restoring site anyway"
  fi
}

case "$mode" in
  on)
    show_page
    echo "  [OK] Maintenance page shown"
    ;;
  off)
    hide_page
    echo "  [OK] Maintenance page restored"
    ;;
  restart-backend)
    show_page
    echo "  [OK] Maintenance page shown"
    trap hide_page EXIT
    sudo systemctl restart mafia-backend
    wait_for_api
    hide_page
    trap - EXIT
    echo "  [OK] API restart finished - site restored"
    ;;
  *)
    echo "Usage: bash scripts/apply-maintenance.sh on|off|restart-backend" >&2
    exit 1
    ;;
esac
