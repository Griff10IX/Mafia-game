@echo off
REM Double-click to push updates and deploy live
REM Optional: push-live.bat "Your commit message"
REM Optional: push-live.bat --restart
REM Optional: push-live.bat --restart "Your commit message"
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "SSH_PASSWORD=Ka?dz5Z6MK?h#4t"
set "UI=%~dp0_deploy-ui.bat"
call "%UI%" INIT

set "NEED_RESTART=0"
set "msg=Update"
if /i "%~1"=="--restart" (
    set "NEED_RESTART=1"
    if not "%~2"=="" set "msg=%~2"
) else if not "%~1"=="" (
    set "msg=%~1"
)

call "%UI%" HEADER "MAFIA WARS - COMMIT / PUSH / DEPLOY" "Branch MAfiaGame2 -> live server"

call "%UI%" STEP 1 6 "Stage all changes"
git add -A
if errorlevel 1 (call "%UI%" FAIL "git add failed" & goto END)
call "%UI%" OK "Staged"

call "%UI%" STEP 2 6 "Commit locally"
git commit -m "%msg%" 2>nul
if errorlevel 1 (
    call "%UI%" WARN "Nothing new to commit (continuing with existing commits)"
) else (
    call "%UI%" OK "Committed: %msg%"
)

if "%NEED_RESTART%"=="0" (
    plink -batch -pw "%SSH_PASSWORD%" root@178.128.38.68 "cd /opt/mafia-app && git rev-parse HEAD" > "%TEMP%\mafia-server-sha.txt" 2>nul
)
set "SERVER_SHA="
if exist "%TEMP%\mafia-server-sha.txt" (
    findstr /r /i /c:"^[0-9a-f][0-9a-f]*$" "%TEMP%\mafia-server-sha.txt" > "%TEMP%\mafia-server-sha2.txt" 2>nul
    set /p SERVER_SHA=<"%TEMP%\mafia-server-sha2.txt"
)
if defined SERVER_SHA set "SERVER_SHA=%SERVER_SHA:~0,40%"

if "%NEED_RESTART%"=="0" if defined SERVER_SHA (
    git diff --name-only "%SERVER_SHA%" HEAD -- backend > "%TEMP%\mafia-push-files.txt" 2>nul
    findstr /i /c:".py" "%TEMP%\mafia-push-files.txt" >nul 2>nul && set "NEED_RESTART=1"
)
if "%NEED_RESTART%"=="0" (
    git diff --name-only origin/MAfiaGame2 HEAD -- backend > "%TEMP%\mafia-push-files.txt" 2>nul
    findstr /i /c:".py" "%TEMP%\mafia-push-files.txt" >nul 2>nul && set "NEED_RESTART=1"
)

if "%NEED_RESTART%"=="1" (
    set "DEPLOY_SH=bash scripts/deploy-after-pull.sh --restart-backend"
    call "%UI%" WARN "API restart: YES (Python changed or --restart)"
) else (
    set "DEPLOY_SH=bash scripts/deploy-after-pull.sh"
    call "%UI%" INFO "API restart: no (frontend-only unless server detects .py)"
)
call "%UI%" BLANK

call "%UI%" STEP 3 6 "Push to origin (Mafia-game)"
git push origin MAfiaGame2
if errorlevel 1 (call "%UI%" FAIL "git push origin failed" & goto END)
call "%UI%" OK "origin updated"

call "%UI%" STEP 4 6 "Push to mafia2 (Mafia-Game-2)"
git push mafia2 MAfiaGame2
if errorlevel 1 (call "%UI%" FAIL "git push mafia2 failed" & goto END)
call "%UI%" OK "mafia2 updated"

call "%UI%" STEP 5 6 "Deploy on live server (SSH)"
call "%UI%" INFO "Fetch + reset to origin/MAfiaGame2"
call "%UI%" INFO "Atomic frontend build, then nginx reload"
if "%NEED_RESTART%"=="1" (
    call "%UI%" INFO "Maintenance page while API restarts"
) else (
    call "%UI%" INFO "Backend stays up unless server sees Python changes"
)
echo.
plink -batch -pw "%SSH_PASSWORD%" root@178.128.38.68 "cd /opt/mafia-app && export MAFIA_DEPLOY_ASCII=1 && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup); git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup ] && cp /tmp/env-backup backend/.env); mkdir -p /var/www/html && cp maintenance.html /var/www/html/maintenance.html 2>/dev/null || true; %DEPLOY_SH%"
if errorlevel 1 (call "%UI%" FAIL "Remote deploy failed" & goto END)
call "%UI%" OK "Server deploy finished"

call "%UI%" STEP 6 6 "Verify"
for /f "delims=" %%H in ('git rev-parse --short HEAD 2^>nul') do set "LOCAL_SHA=%%H"
call "%UI%" INFO "Local HEAD: !LOCAL_SHA!"
if "%NEED_RESTART%"=="1" (
    call "%UI%" FOOTER "ALL DONE - LIVE - API restarted"
) else (
    call "%UI%" FOOTER "ALL DONE - LIVE - API not restarted"
)
goto DONE

:END
call "%UI%" FOOTER "DEPLOY FAILED - check output above"
:DONE
pause
endlocal
