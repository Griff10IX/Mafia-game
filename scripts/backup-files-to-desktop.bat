@echo off
REM Zip entire game project to Desktop (excludes node_modules, venv, .git)
cd /d "%~dp0.."
set "SRC=%~dp0.."
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%i"
set "ZIP=%USERPROFILE%\Desktop\mafia-files-backup-%TS%.zip"

echo ============================================
echo   MAFIA - PROJECT FILES BACKUP
echo   Output: %ZIP%
echo ============================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ts='%TS%'; $src=(Resolve-Path '%SRC%').Path; $zip='%ZIP%'; $temp=Join-Path $env:TEMP ('mafia-backup-staging-'+$ts); if(Test-Path $temp){Remove-Item $temp -Recurse -Force}; New-Item -ItemType Directory -Path $temp | Out-Null; robocopy $src $temp /E /XD node_modules backend\venv __pycache__ .git /XF *.pyc /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null; if(Test-Path $zip){Remove-Item $zip -Force}; Compress-Archive -Path (Join-Path $temp '*') -DestinationPath $zip -CompressionLevel Optimal; Remove-Item $temp -Recurse -Force; $mb=[math]::Round((Get-Item $zip).Length/1MB,2); Write-Host ('Done: '+$zip+' ('+$mb+' MB)')"

if errorlevel 1 (
    echo ERROR: backup failed.
    pause
    exit /b 1
)

echo.
pause
