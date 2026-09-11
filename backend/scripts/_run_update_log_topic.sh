#!/bin/bash
set -e
cd /opt/mafia-app
[ -f backend/.env ] && cp backend/.env /tmp/env-backup-updatelog
git fetch origin
git reset --hard origin/MAfiaGame2
[ -f /tmp/env-backup-updatelog ] && cp /tmp/env-backup-updatelog backend/.env
DBVAL=$(grep DB_NAME= backend/.env | head -1 | cut -d= -f2- | tr -d '"')
export MONGO_DB="$DBVAL"
export DB_NAME="$DBVAL"
backend/venv/bin/python backend/seeds/update_update_log_topic.py
echo DONE