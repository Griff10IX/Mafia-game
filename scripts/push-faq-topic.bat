@echo off
REM Refresh the "FAQs" forum topic from docs/FORUM_FAQ.md on the LIVE server (Mongo update).
REM Like push-live.bat: SSH to the app host, sync repo, run backend/seeds/update_faq_topic.py
REM
REM Prerequisite: commit and PUSH your FAQ changes to origin/MAfiaGame2 so the server can pull them.
REM Optional: run full push-live.bat first (deploys + this FAQ step can be run after).
REM
REM Usage:
REM   push-faq-topic.bat          -> sync git on server + update FAQ topic in DB
REM   push-faq-topic.bat python   -> only run the Python updater (no git pull; uses whatever is on disk)

cd /d "%~dp0"

REM Same server as push-live.bat — keep password in sync if you change it
set "SSH_PASSWORD=Ka?dz5Z6MK?h#4t"
set "SSH_HOST=root@178.128.38.68"
set "APP_DIR=/opt/mafia-app"

echo ============================================
echo   MAFIA - PUSH FAQ TOPIC TO LIVE (Mongo)
echo ============================================
echo.

if /i "%~1"=="python" goto RUNPYTHON

echo [1/2] Server: git fetch + reset to origin/MAfiaGame2 (same as deploy), then update FAQ topic...
echo.
plink -batch -pw "%SSH_PASSWORD%" %SSH_HOST% "cd %APP_DIR% && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup-faq) && git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup-faq ] && cp /tmp/env-backup-faq backend/.env) && if [ -x backend/venv/bin/python ]; then backend/venv/bin/python backend/seeds/update_faq_topic.py; else python3 backend/seeds/update_faq_topic.py; fi"
goto DONE

:RUNPYTHON
echo [1/1] Server: running update_faq_topic.py only (no git sync)...
echo.
plink -batch -pw "%SSH_PASSWORD%" %SSH_HOST% "cd %APP_DIR% && if [ -x backend/venv/bin/python ]; then backend/venv/bin/python backend/seeds/update_faq_topic.py; else python3 backend/seeds/update_faq_topic.py; fi"

:DONE
echo.
echo ============================================
echo   FAQ topic refresh finished (check output above).
echo ============================================
pause
