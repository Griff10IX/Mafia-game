@echo off
REM Refresh the "How To" forum topic from docs/FORUM_HOW_TO.md on the LIVE server (Mongo update).
REM Does not take the site down, so the downtime page is not shown.
REM Like push-faq-topic.bat: SSH to the app host, sync repo, run backend/seeds/update_how_to_topic.py
REM
REM Prerequisite: commit and PUSH your How To edits to origin/MAfiaGame2 so the server can pull them.
REM
REM Usage:
REM   push-how-to-topic.bat          -> sync git on server + update How To topic in DB
REM   push-how-to-topic.bat python   -> only run the Python updater (no git pull; uses whatever is on disk)

cd /d "%~dp0"

set "SSH_PASSWORD=Ka?dz5Z6MK?h#4t"
set "SSH_HOST=root@178.128.38.68"
set "APP_DIR=/opt/mafia-app"

echo ============================================
echo   MAFIA - PUSH HOW TO TOPIC TO LIVE (Mongo)
echo ============================================
echo.

if /i "%~1"=="python" goto RUNPYTHON

echo [1/2] Server: git fetch + reset to origin/MAfiaGame2, then update How To topic...
echo.
plink -batch -pw "%SSH_PASSWORD%" %SSH_HOST% "cd %APP_DIR% && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup-howto) && git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup-howto ] && cp /tmp/env-backup-howto backend/.env) && if [ -x backend/venv/bin/python ]; then backend/venv/bin/python backend/seeds/update_how_to_topic.py; else python3 backend/seeds/update_how_to_topic.py; fi"
goto DONE

:RUNPYTHON
echo [1/1] Server: running update_how_to_topic.py only (no git sync)...
echo.
plink -batch -pw "%SSH_PASSWORD%" %SSH_HOST% "cd %APP_DIR% && if [ -x backend/venv/bin/python ]; then backend/venv/bin/python backend/seeds/update_how_to_topic.py; else python3 backend/seeds/update_how_to_topic.py; fi"

:DONE
echo.
echo ============================================
echo   How To topic refresh finished.
echo ============================================
pause
