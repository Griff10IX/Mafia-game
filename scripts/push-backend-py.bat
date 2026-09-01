@echo off
REM Double-click to push backend Python-only updates and restart the live API quickly.
REM Optional: push-backend-py.bat "Your commit message"
REM Optional: --updating "Casino tables"  (player-facing line on the downtime page)
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "SSH_PASSWORD=Ka?dz5Z6MK?h#4t"
set "UI=%~dp0_deploy-ui.bat"
call "%UI%" INIT

set "msg=Backend Python update"
set "MAINT_BY=system_ai"
set "MAINT_WHAT=the game engine"

:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--updating" goto parse_updating
set "msg=%~1"
shift
goto parse_args
:parse_updating
if not "%~2"=="" set "MAINT_WHAT=%~2"
shift
shift
goto parse_args
:args_done

call "%UI%" HEADER "MAFIA WARS - BACKEND QUICK PUSH" "Python only - no frontend build"

call "%UI%" STEP 1 6 "Stage backend Python"
git add -- "backend/*.py" "backend/**/*.py"
call "%UI%" OK "Staged .py files"

call "%UI%" STEP 2 6 "Commit locally"
git commit -m "%msg%" 2>nul
if errorlevel 1 (call "%UI%" WARN "No backend Python changes to commit") else (call "%UI%" OK "Committed: %msg%")

call "%UI%" STEP 3 6 "Push to origin (Mafia-game)"
git push origin MAfiaGame2
if errorlevel 1 (call "%UI%" FAIL "git push origin failed" & goto END)
call "%UI%" OK "origin updated"

call "%UI%" STEP 4 6 "Push to mafia2 (Mafia-Game-2)"
git push mafia2 MAfiaGame2
if errorlevel 1 (call "%UI%" FAIL "git push mafia2 failed" & goto END)
call "%UI%" OK "mafia2 updated"

call "%UI%" STEP 5 6 "Restart API on server (SSH)"
call "%UI%" INFO "Fetch + reset - preserves backend/.env"
call "%UI%" INFO "systemctl restart mafia-backend"
echo.
plink -batch -pw "%SSH_PASSWORD%" root@178.128.38.68 "cd /opt/mafia-app && export MAFIA_MAINT_BY=!MAINT_BY! && export MAFIA_MAINT_WHAT='!MAINT_WHAT!' && ([ -f backend/.env ] && cp backend/.env /tmp/env-backup); git fetch origin && git reset --hard origin/MAfiaGame2 && ([ -f /tmp/env-backup ] && cp /tmp/env-backup backend/.env); bash scripts/apply-maintenance.sh restart-backend; sudo systemctl status mafia-backend --no-pager -l"
if errorlevel 1 (call "%UI%" FAIL "Remote restart failed" & goto END)
call "%UI%" OK "API restarted"

call "%UI%" STEP 6 6 "Verify"
call "%UI%" FOOTER "DONE - BACKEND QUICK LIVE"
goto DONE

:END
call "%UI%" FOOTER "DEPLOY FAILED - check output above"
:DONE
pause
endlocal
