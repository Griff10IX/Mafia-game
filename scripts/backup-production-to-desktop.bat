@echo off
REM Production MongoDB backup -> Desktop (run BEFORE risky DB/state changes)
REM For full project files zip, run: scripts\backup-files-to-desktop.bat
cd /d "%~dp0.."

set "SSH_PASSWORD=Ka?dz5Z6MK?h#4t"
set "SSH_HOST=root@178.128.38.68"
set "APP_DIR=/opt/mafia-app"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%i"
set "DEST=%USERPROFILE%\Desktop\mafia-backup-pre-change-%TS%"
mkdir "%DEST%" 2>nul

echo ============================================
echo   MAFIA - PRODUCTION MONGODB BACKUP
echo   Destination: %DEST%
echo ============================================
echo.

echo [1/4] Running mongodump on production server...
plink -batch -pw "%SSH_PASSWORD%" %SSH_HOST% "cd %APP_DIR% && (test -x backend/venv/bin/python && backend/venv/bin/python backend/mongo_backup_dump.py || python3 backend/mongo_backup_dump.py)"
if errorlevel 1 (
    echo ERROR: mongodump failed on server.
    pause
    exit /b 1
)

echo.
echo [2/4] Locating newest backup archive on server...
for /f "delims=" %%F in ('plink -batch -pw "%SSH_PASSWORD%" %SSH_HOST% "ls -t %APP_DIR%/backups/mongo-*.archive.gz 2>/dev/null | head -1"') do set "REMOTE_FILE=%%F"
if not defined REMOTE_FILE (
    echo ERROR: No mongo archive found on server under %APP_DIR%/backups/
    pause
    exit /b 1
)
echo      %REMOTE_FILE%

echo.
echo [3/4] Downloading to Desktop...
pscp -batch -pw "%SSH_PASSWORD%" "%SSH_HOST%:%REMOTE_FILE%" "%DEST%\"
if errorlevel 1 (
    echo ERROR: pscp download failed.
    pause
    exit /b 1
)

echo.
echo [4/4] Writing manifest...
for /f "delims=" %%G in ('plink -batch -pw "%SSH_PASSWORD%" %SSH_HOST% "cd %APP_DIR% && git rev-parse HEAD 2>/dev/null || echo unknown"') do set "GIT_SHA=%%G"
(
    echo Mafia production MongoDB backup
    echo Created: %TS% local time
    echo Server: 178.128.38.68
    echo Remote archive: %REMOTE_FILE%
    echo Git commit on server: %GIT_SHA%
    echo.
    echo Restore: mongorestore --uri=YOUR_MONGO_URL --drop --gzip --archive=FILE.archive.gz
) > "%DEST%\README.txt"

echo.
echo ============================================
echo   BACKUP COMPLETE
echo   Folder: %DEST%
echo ============================================
dir "%DEST%"
echo.
pause
