@echo off
REM Double-click to push updates and deploy live
REM Optional: push-live.bat "Your commit message"
cd /d "%~dp0"

if "%~1"=="" (
    set "msg=Update"
) else (
    set "msg=%~1"
)

echo ============================================
echo          MAFIA GAME - PUSH ^& DEPLOY
echo ============================================
echo.

echo [1/5] Staging all changes...
git add -A
echo.

echo [2/5] Committing: %msg%
git commit -m "%msg%" 2>nul || echo (no changes to commit)
echo.

echo [3/5] Pushing to origin (Mafia-game)...
git push origin MAfiaGame2
echo [4/5] Pushing to mafia2 (Mafia-Game-2 - server pulls this)...
git push mafia2 MAfiaGame2
echo.

echo [5/5] Deploying on server (SSH)...
echo      - Fetching latest from origin (Mafia-Game-2)
echo      - Building frontend, restarting backend
ssh root@178.128.38.68 "cd /opt/mafia-app && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup); git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup ] && cp /tmp/env-backup backend/.env); npm run build && sudo systemctl restart mafia-backend && sudo systemctl reload nginx"
echo.
echo [5/5] Pushed and deployed.
echo.

echo ============================================
echo              ALL DONE - LIVE!
echo ============================================
pause
