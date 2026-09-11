#!/bin/bash
# Install quiet daily ambient roster job on the LIVE server only.
# Usage (on server): bash /opt/mafia-app/backend/scripts/_install_ambient_roster_timer.sh
set -euo pipefail
PROJECT="${PROJECT:-/opt/mafia-app}"
PY="$PROJECT/backend/venv/bin/python"
SCRIPT="$PROJECT/backend/scripts/_ambient_roster_daily.py"

if [[ ! -x "$PY" ]]; then
  echo "missing venv python: $PY" >&2
  exit 1
fi
if [[ ! -f "$SCRIPT" ]]; then
  echo "missing script: $SCRIPT" >&2
  exit 1
fi

cat > /etc/systemd/system/mafia-session-warmup.service << EOF
[Unit]
Description=Mafia session warmup
After=network.target mafia-backend.service

[Service]
Type=oneshot
WorkingDirectory=$PROJECT/backend
Environment=MAFIA_BACKEND_DIR=$PROJECT/backend
Environment=AMBIENT_ROSTER_DAILY=2
ExecStart=$PY $SCRIPT
Nice=10
EOF

cat > /etc/systemd/system/mafia-session-warmup.timer << 'EOF'
[Unit]
Description=Mafia session warmup timer

[Timer]
OnCalendar=*-*-* 08:00:00 UTC
Persistent=true
RandomizedDelaySec=10h
AccuracySec=1min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now mafia-session-warmup.timer
systemctl status mafia-session-warmup.timer --no-pager || true
echo "Installed. Ledger: /opt/mafia-app/backups/.ops_roster.jsonl"
echo "Manual run: $PY $SCRIPT"
echo "Force extra today: $PY $SCRIPT --force"
