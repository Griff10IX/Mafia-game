#!/bin/bash
# Run ON THE SERVER to install World Cup fixture sync (nightly) + auto-settle (every 30m).
#
# Prerequisites (backend/.env):
#   CRON_SECRET=...
#   BASE_URL=http://127.0.0.1:8000
#   THE_ODDS_API_KEY=...   (Odds API — pulls R16/QF/SF/final as bookmakers list them)
#
# After install, also set (script appends if missing):
#   WORLD_CUP_SYNC_USE_CRON=1
#   WORLD_CUP_SYNC_TICKER=0
#   WORLD_CUP_AUTO_SETTLE_USE_CRON=1
#   WORLD_CUP_AUTO_SETTLE_TICKER=0
#
# Usage (from project root on server):
#   sudo PROJECT=/opt/mafia-app bash scripts/install-cron-world-cup-on-server.sh

set -e
PROJECT="${PROJECT:-/opt/mafia-app}"
ENV_FILE="$PROJECT/backend/.env"

if [ ! -f "$PROJECT/scripts/cron-world-cup-sync.py" ]; then
  echo "Missing $PROJECT/scripts/cron-world-cup-sync.py" >&2
  exit 1
fi

chmod +x "$PROJECT/scripts/cron-world-cup-sync.py"
chmod +x "$PROJECT/scripts/cron-world-cup-settle.py"

_ensure_env() {
  local key="$1"
  local val="$2"
  if [ ! -f "$ENV_FILE" ]; then
    echo "Warning: $ENV_FILE not found" >&2
    return
  fi
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    return
  fi
  echo "" >> "$ENV_FILE"
  echo "# Added by install-cron-world-cup-on-server.sh" >> "$ENV_FILE"
  echo "${key}=${val}" >> "$ENV_FILE"
  echo "Appended ${key}=${val} to $ENV_FILE"
}

_ensure_env "WORLD_CUP_SYNC_USE_CRON" "1"
_ensure_env "WORLD_CUP_SYNC_TICKER" "0"
_ensure_env "WORLD_CUP_AUTO_SETTLE_USE_CRON" "1"
_ensure_env "WORLD_CUP_AUTO_SETTLE_TICKER" "0"

# --- Nightly fixture sync at 00:00 UK (Europe/London) ---
cat > /etc/systemd/system/world-cup-fixture-sync.service << EOF
[Unit]
Description=World Cup fixture sync (Odds API + official schedule)
After=network.target mafia-backend.service

[Service]
Type=oneshot
WorkingDirectory=$PROJECT
ExecStart=/usr/bin/python3 $PROJECT/scripts/cron-world-cup-sync.py
StandardOutput=journal
StandardError=journal
EOF

cat > /etc/systemd/system/world-cup-fixture-sync.timer << EOF
[Unit]
Description=World Cup fixture sync daily at midnight UK

[Timer]
OnCalendar=*-*-* 00:00:00
Timezone=Europe/London
Persistent=true
Unit=world-cup-fixture-sync.service

[Install]
WantedBy=timers.target
EOF

# --- Auto-settle every 30 minutes ---
cat > /etc/systemd/system/world-cup-auto-settle.service << EOF
[Unit]
Description=World Cup auto-settle ticker (every 30m)
After=network.target mafia-backend.service

[Service]
Type=simple
WorkingDirectory=$PROJECT
ExecStart=/usr/bin/python3 $PROJECT/scripts/cron-world-cup-settle.py
Restart=always
RestartSec=30
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable world-cup-fixture-sync.timer
systemctl enable world-cup-auto-settle.service
systemctl start world-cup-fixture-sync.timer
systemctl restart world-cup-auto-settle.service

echo "Running initial fixture sync now..."
systemctl start world-cup-fixture-sync.service || true

echo ""
echo "Done. World Cup cron installed."
echo "  Fixture sync: daily 00:00 Europe/London"
echo "    systemctl status world-cup-fixture-sync.timer"
echo "    journalctl -u world-cup-fixture-sync.service -n 20"
echo "  Auto-settle: every 30 minutes"
echo "    systemctl status world-cup-auto-settle"
echo "    journalctl -u world-cup-auto-settle -f"
echo ""
echo "Restart backend so in-process WC tickers stay off:"
echo "  sudo systemctl restart mafia-backend"
echo ""
systemctl status world-cup-fixture-sync.timer --no-pager || true
systemctl status world-cup-auto-settle --no-pager || true
