#!/bin/bash
# Run ON THE SERVER to install the robot bodyguard auto-search ticker (systemd).
# Renews Attack searches for subscribers every ~15 minutes — works even if nobody opens Attack.
#
# Prerequisites (backend/.env):
#   CRON_SECRET=...
#   BASE_URL=http://127.0.0.1:8000   (or your public API URL)
#   ROBOT_BG_AUTO_SEARCH_USE_CRON=1  (disables in-process ticker; this service drives renewals)
#
# Usage (from project root):
#   sudo PROJECT=/opt/mafia-app bash scripts/install-cron-robot-bg-auto-search-on-server.sh

set -e
PROJECT="${PROJECT:-/opt/mafia-app}"
ENV_FILE="$PROJECT/backend/.env"

if [ ! -f "$PROJECT/scripts/cron-robot-bg-auto-search.py" ]; then
  echo "Missing $PROJECT/scripts/cron-robot-bg-auto-search.py" >&2
  exit 1
fi

chmod +x "$PROJECT/scripts/cron-robot-bg-auto-search.py"

if [ -f "$ENV_FILE" ]; then
  if ! grep -q '^ROBOT_BG_AUTO_SEARCH_USE_CRON=1' "$ENV_FILE"; then
    echo ""
    echo "Add to $ENV_FILE (then restart mafia-backend):"
    echo "  ROBOT_BG_AUTO_SEARCH_USE_CRON=1"
    echo ""
  fi
else
  echo "Warning: $ENV_FILE not found — set CRON_SECRET, BASE_URL, ROBOT_BG_AUTO_SEARCH_USE_CRON=1" >&2
fi

cat > /etc/systemd/system/cron-robot-bg-auto-search.service << EOF
[Unit]
Description=Robot bodyguard auto-search ticker (every 15m)
After=network.target mafia-backend.service

[Service]
Type=simple
WorkingDirectory=$PROJECT
ExecStart=/usr/bin/python3 $PROJECT/scripts/cron-robot-bg-auto-search.py
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable cron-robot-bg-auto-search
systemctl restart cron-robot-bg-auto-search

echo ""
echo "Done. Robot BG auto-search ticker installed."
echo "  systemctl status cron-robot-bg-auto-search"
echo "  journalctl -u cron-robot-bg-auto-search -f"
echo ""
systemctl status cron-robot-bg-auto-search --no-pager || true
