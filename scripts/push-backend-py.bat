@echo off
REM Double-click to push backend Python-only updates and restart the live API quickly.
REM Optional: push-backend-py.bat "Your commit message"
setlocal EnableExtensions
cd /d "%~dp0.."

REM SSH Password (same server as push-live.bat)
set "SSH_PASSWORD=Ka?dz5Z6MK?h#4t"

if "%~1"=="" (
    set "msg=Backend Python update"
) else (
    set "msg=%~1"
)

echo ============================================
echo   MAFIA GAME - BACKEND PYTHON QUICK PUSH
echo ============================================
echo.

echo [1/6] Staging backend Python files only...
git add -- "backend/*.py" "backend/**/*.py"
echo.

echo [2/6] Committing: %msg%
git commit -m "%msg%" 2>nul || echo (no backend Python changes to commit)
echo.

echo [3/6] Push to Git: origin (Mafia-game)...
git push origin MAfiaGame2
echo.

echo [4/6] Push to Git: mafia2 (Mafia-Game-2)...
git push mafia2 MAfiaGame2
echo.

echo [5/6] Deploying backend on server (SSH)...
echo      - Fetching latest from origin
echo      - Resetting server checkout to origin/MAfiaGame2
echo      - Preserving backend/.env
echo      - Restarting mafia-backend only (no frontend build)
plink -pw "%SSH_PASSWORD%" root@178.128.38.68 "cd /opt/mafia-app && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup); git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup ] && cp /tmp/env-backup backend/.env); sudo systemctl restart mafia-backend && sudo systemctl status mafia-backend --no-pager -l"
echo.

echo [6/6] Backend Python pushed and API restarted.
echo.

echo ============================================
echo          DONE - BACKEND QUICK LIVE!
echo ============================================
pause
