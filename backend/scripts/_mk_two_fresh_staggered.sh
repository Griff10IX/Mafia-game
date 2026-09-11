#!/bin/bash
# Create one fresh player now, then another after 5 minutes.
set -e
cd /opt/mafia-app/backend
echo "=== PLAYER 1 (now) $(date -u +%H:%M:%S)Z ==="
venv/bin/python scripts/_mk_fresh_player_ar.py
echo "=== sleeping 300s for player 2 ==="
sleep 300
echo "=== PLAYER 2 (+5m) $(date -u +%H:%M:%S)Z ==="
venv/bin/python scripts/_mk_fresh_player_ar.py
echo "=== BOTH DONE ==="
