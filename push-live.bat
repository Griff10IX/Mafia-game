@echo off
REM Double-click to push updates and deploy live
REM Optional: push-live.bat "Your commit message"
cd /d "%~dp0"

REM SSH Password (change this after first use!)
set "SSH_PASSWORD=Ka?dz5Z6MK?h#4t"

if "%~1"=="" (
    set "msg=Update"
) else (
    set "msg=%~1"
)

echo ============================================
echo     MAFIA GAME - COMMIT, PUSH GIT, DEPLOY
echo ============================================
echo.

echo [1/6] Staging all changes...
git add -A
echo.

echo [2/6] Committing: %msg%
git commit -m "%msg%" 2>nul || echo (no changes to commit)
echo.

echo [3/6] Push to Git: origin (Mafia-game)...
git push origin MAfiaGame2
echo.

echo [4/6] Push to Git: mafia2 (Mafia-Game-2)...
git push mafia2 MAfiaGame2
echo.

echo [5/6] Deploying on server (SSH)...
echo      - Fetching latest from origin (Mafia-Game-2)
echo      - Building frontend, restarting backend
echo      - Uploading maintenance page
plink -pw "%SSH_PASSWORD%" root@178.128.38.68 "cd /opt/mafia-app && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup); git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup ] && cp /tmp/env-backup backend/.env); mkdir -p /var/www/html && cp maintenance.html /var/www/html/maintenance.html 2>/dev/null || true; npm run build && sudo systemctl restart mafia-backend && sudo systemctl reload nginx"
echo.
echo [6/6] Pushed and deployed.
echo.

echo ============================================
echo              ALL DONE - LIVE!
echo ============================================
pause
