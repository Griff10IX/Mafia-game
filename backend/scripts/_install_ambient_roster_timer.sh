#!/bin/bash
# Install morning (09–11) + afternoon (16:00–00:00) roster timers on LIVE server.
# Usage: bash /opt/mafia-app/backend/scripts/_install_ambient_roster_timer.sh
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

# Drop old single-shot timer if present
systemctl disable --now mafia-session-warmup.timer 2>/dev/null || true
rm -f /etc/systemd/system/mafia-session-warmup.timer /etc/systemd/system/mafia-session-warmup.service

# --- Morning: 09:00 local + up to 2h random → ~09:00–11:00 ---
cat > /etc/systemd/system/mafia-session-warmup-am.service << EOF
[Unit]
Description=Mafia session warmup (morning)
After=network.target mafia-backend.service

[Service]
Type=oneshot
WorkingDirectory=$PROJECT/backend
Environment=MAFIA_BACKEND_DIR=$PROJECT/backend
Environment=AMBIENT_ROSTER_DAILY=2
Environment=AMBIENT_ROSTER_BATCH=1
Environment=AMBIENT_ROSTER_SLOT=morning
ExecStart=$PY $SCRIPT --morning
Nice=10
EOF

cat > /etc/systemd/system/mafia-session-warmup-am.timer << 'EOF'
[Unit]
Description=Mafia session warmup morning timer

[Timer]
OnCalendar=*-*-* 09:00:00
Persistent=true
RandomizedDelaySec=2h
AccuracySec=1min

[Install]
WantedBy=timers.target
EOF

# --- Afternoon: 16:00 local + up to 8h random → ~16:00–00:00 ---
cat > /etc/systemd/system/mafia-session-warmup-pm.service << EOF
[Unit]
Description=Mafia session warmup (afternoon)
After=network.target mafia-backend.service

[Service]
Type=oneshot
WorkingDirectory=$PROJECT/backend
Environment=MAFIA_BACKEND_DIR=$PROJECT/backend
Environment=AMBIENT_ROSTER_DAILY=2
Environment=AMBIENT_ROSTER_BATCH=1
Environment=AMBIENT_ROSTER_SLOT=afternoon
ExecStart=$PY $SCRIPT --afternoon
Nice=10
EOF

cat > /etc/systemd/system/mafia-session-warmup-pm.timer << 'EOF'
[Unit]
Description=Mafia session warmup afternoon timer

[Timer]
OnCalendar=*-*-* 16:00:00
Persistent=true
RandomizedDelaySec=8h
AccuracySec=1min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now mafia-session-warmup-am.timer mafia-session-warmup-pm.timer
systemctl list-timers 'mafia-session-warmup*' --no-pager || true
echo "Installed morning (9–11) + afternoon (4pm–midnight) timers."
echo "Ledger: /opt/mafia-app/backups/.ops_roster.jsonl"
echo "Manual: $PY $SCRIPT --morning | --afternoon | --force"
