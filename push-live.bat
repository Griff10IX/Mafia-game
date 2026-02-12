@echo off
REM Push updates - double-click or run: push-live.bat "Your message"
cd /d "%~dp0"

if "%~1"=="" (
    set "msg=Update"
) else (
    set "msg=%~1"
)

echo === Mafia push live ===
echo.
echo 1. Staging changes...
git add -A
echo.
echo 2. Committing: %msg%
git commit -m "%msg%" 2>nul || echo (no changes to commit)
echo.
echo 3. Pushing to origin...
git push origin MAfiaGame2
echo.
echo 4. Pushing to mafia2 (server repo)...
git push mafia2 MAfiaGame2
echo.
echo === Done ===
echo On the server run: git fetch origin ^&^& git reset --hard origin/MAfiaGame2 ^&^& npm run build
pause
