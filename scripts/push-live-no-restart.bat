@echo off
REM Double-click to push updates and deploy live WITHOUT restarting the backend
REM Optional: push-live-no-restart.bat "Your commit message"
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "SSH_PASSWORD=Ka?dz5Z6MK?h#4t"
set "UI=%~dp0_deploy-ui.bat"
call "%UI%" INIT

if "%~1"=="" (set "msg=Update") else (set "msg=%~1")

call "%UI%" HEADER "MAFIA WARS — DEPLOY (NO API RESTART)" "Frontend rebuild only — backend process unchanged"

call "%UI%" STEP 1 6 "Stage all changes"
git add -A
call "%UI%" OK "Staged"

call "%UI%" STEP 2 6 "Commit locally"
git commit -m "%msg%" 2>nul
if errorlevel 1 (call "%UI%" WARN "Nothing new to commit") else (call "%UI%" OK "Committed: %msg%")

call "%UI%" STEP 3 6 "Push to origin (Mafia-game)"
git push origin MAfiaGame2
if errorlevel 1 (call "%UI%" FAIL "git push origin failed" & goto END)
call "%UI%" OK "origin updated"

call "%UI%" STEP 4 6 "Push to mafia2 (Mafia-Game-2)"
git push mafia2 MAfiaGame2
if errorlevel 1 (call "%UI%" FAIL "git push mafia2 failed" & goto END)
call "%UI%" OK "mafia2 updated"

call "%UI%" STEP 5 6 "Deploy on live server (SSH)"
call "%UI%" INFO "Atomic frontend build — backend NOT restarted"
echo.
plink -batch -pw "%SSH_PASSWORD%" root@178.128.38.68 "cd /opt/mafia-app && export TERM=xterm-256color && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup); git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup ] && cp /tmp/env-backup backend/.env); mkdir -p /var/www/html && cp maintenance.html /var/www/html/maintenance.html 2>/dev/null || true; bash scripts/deploy-after-pull.sh"
if errorlevel 1 (call "%UI%" FAIL "Remote deploy failed" & goto END)
call "%UI%" OK "Server deploy finished"

call "%UI%" STEP 6 6 "Verify"
call "%UI%" FOOTER "DONE — frontend live; restart API manually when ready"
goto DONE

:END
call "%UI%" FOOTER "DEPLOY FAILED — check output above"
:DONE
pause
endlocal
