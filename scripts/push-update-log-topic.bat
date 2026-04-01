@echo off
REM Refresh the "Update Log" forum topic from docs/UPDATE_LOG.md on the LIVE server (Mongo update).
REM Like push-live.bat: SSH to the app host, sync repo, run backend/seeds/update_update_log_topic.py
REM
REM Prerequisite: commit and PUSH your update log changes to origin/MAfiaGame2 so the server can pull them.
REM
REM Usage:
REM   push-update-log-topic.bat          -> sync git on server + update Update Log topic in DB
REM   push-update-log-topic.bat python   -> only run the Python updater (no git pull; uses whatever is on disk)

cd /d "%~dp0"

set "SSH_PASSWORD=Ka?dz5Z6MK?h#4t"
set "SSH_HOST=root@178.128.38.68"
set "APP_DIR=/opt/mafia-app"

echo ============================================
echo   MAFIA - PUSH UPDATE LOG TOPIC TO LIVE
echo ============================================
echo.

if /i "%~1"=="python" goto RUNPYTHON

echo [1/2] Server: git fetch + reset to origin/MAfiaGame2, then update Update Log topic...
echo.
plink -batch -pw "%SSH_PASSWORD%" %SSH_HOST% "cd %APP_DIR% && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup-updatelog) && git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup-updatelog ] && cp /tmp/env-backup-updatelog backend/.env) && if [ -x backend/venv/bin/python ]; then backend/venv/bin/python backend/seeds/update_update_log_topic.py; else python3 backend/seeds/update_update_log_topic.py; fi"
goto DONE

:RUNPYTHON
echo [1/1] Server: running update_update_log_topic.py only (no git sync)...
echo.
plink -batch -pw "%SSH_PASSWORD%" %SSH_HOST% "cd %APP_DIR% && if [ -x backend/venv/bin/python ]; then backend/venv/bin/python backend/seeds/update_update_log_topic.py; else python3 backend/seeds/update_update_log_topic.py; fi"

:DONE
echo.
echo ============================================
echo   Update Log topic refresh finished.
echo ============================================
pause
