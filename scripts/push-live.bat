@echo off
REM Double-click to push updates and deploy live
REM Optional: push-live.bat "Your commit message"
REM Optional: push-live.bat --restart
REM Optional: push-live.bat --restart "Your commit message"
setlocal EnableExtensions
cd /d "%~dp0"

REM SSH Password (change this after first use!)
set "SSH_PASSWORD=Ka?dz5Z6MK?h#4t"

set "NEED_RESTART=0"
set "msg=Update"
if /i "%~1"=="--restart" (
    set "NEED_RESTART=1"
    if not "%~2"=="" set "msg=%~2"
) else if not "%~1"=="" (
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

if "%NEED_RESTART%"=="0" (
    git diff --name-only origin/MAfiaGame2 HEAD > "%TEMP%\mafia-push-files.txt" 2>nul
    findstr /i /r /c:"^backend/.*\.py$" /c:"^backend\\.*\.py$" "%TEMP%\mafia-push-files.txt" >nul 2>nul && set "NEED_RESTART=1"
)

if "%NEED_RESTART%"=="1" (
    set "DEPLOY_SH=bash scripts/deploy-after-pull.sh --restart-backend"
    echo      API restart: YES ^(backend Python changed, or --restart^)
) else (
    set "DEPLOY_SH=bash scripts/deploy-after-pull.sh"
    echo      API restart: NO ^(frontend-only — no downtime^)
)
echo.

echo [3/6] Push to Git: origin (Mafia-game)...
git push origin MAfiaGame2
echo.

echo [4/6] Push to Git: mafia2 (Mafia-Game-2)...
git push mafia2 MAfiaGame2
echo.

echo [5/6] Deploying on server (SSH)...
echo      - Fetching latest from origin (Mafia-Game-2)
echo      - Atomic frontend build then nginx reload
if "%NEED_RESTART%"=="1" (
    echo      - Maintenance page while API restarts, then restore
) else (
    echo      - Backend left running
)
plink -pw "%SSH_PASSWORD%" root@178.128.38.68 "cd /opt/mafia-app && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup); git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup ] && cp /tmp/env-backup backend/.env); mkdir -p /var/www/html && cp maintenance.html /var/www/html/maintenance.html 2>/dev/null || true; %DEPLOY_SH%"
echo.
echo [6/6] Pushed and deployed.
echo.

echo ============================================
if "%NEED_RESTART%"=="1" (
    echo     ALL DONE - LIVE ^(API was restarted^)
) else (
    echo     ALL DONE - LIVE ^(API not restarted^)
)
echo ============================================
pause
