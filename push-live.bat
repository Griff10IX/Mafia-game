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

echo [1/4] Staging all changes...
git add -A
echo.

echo [2/4] Committing: %msg%
git commit -m "%msg%" 2>nul || echo (no changes to commit)
echo.

echo [3/4] Pushing to GitHub...
git push origin MAfiaGame2
git push mafia2 MAfiaGame2
echo.

echo [4/4] Deploying on server (SSH)...
echo      - Enabling maintenance page
echo      - Fetching latest code
echo      - Building frontend
echo      - Restarting backend
echo      - Disabling maintenance page
ssh root@178.128.38.68 "cd /opt/mafia-app && cp public/maintenance.html /var/www/html/maintenance.html 2>/dev/null; touch /tmp/mafia-maintenance && sudo systemctl reload nginx 2>/dev/null; git fetch mafia2 && git reset --hard mafia2/MAfiaGame2 && npm run build && sudo systemctl restart mafia-backend && sleep 2 && rm -f /tmp/mafia-maintenance && sudo systemctl reload nginx 2>/dev/null"
echo.

echo ============================================
echo              ALL DONE - LIVE!
echo ============================================
pause
