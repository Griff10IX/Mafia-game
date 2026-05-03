@echo off
REM Build MafiaKillBot on this PC only — no git, no server.
REM Double-click, or: push-kill-bot.bat "C:\path\to\output-folder"
setlocal EnableExtensions
cd /d "%~dp0.."

if "%~1"=="" (
  set "KILLBOT_OUT=%USERPROFILE%\Desktop\MafiaKillBot"
) else (
  set "KILLBOT_OUT=%~1"
)

echo ============================================
echo   MafiaKillBot — local publish (PC only)
echo ============================================
echo Output: %KILLBOT_OUT%
echo.

dotnet publish "MafiaKillBot\MafiaKillBot.csproj" ^
  -c Release ^
  -r win-x64 ^
  --self-contained false ^
  -p:PublishReadyToRun=true ^
  -o "%KILLBOT_OUT%"

if errorlevel 1 (
  echo.
  echo BUILD FAILED — fix errors above, then run this script again.
  pause
  exit /b 1
)

echo.
echo OK — run MafiaKillBot.exe from:
echo   %KILLBOT_OUT%
echo.

REM Desktop shortcut (double-click to run; WorkingDirectory = publish folder for appsettings.json)
set "KILLBOT_OUT=%KILLBOT_OUT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dir = $env:KILLBOT_OUT; $exe = Join-Path $dir 'MafiaKillBot.exe'; if (-not (Test-Path -LiteralPath $exe)) { Write-Error 'MafiaKillBot.exe not found'; exit 1 }; $desk = [Environment]::GetFolderPath('Desktop'); $lnk = Join-Path $desk 'MafiaKillBot.lnk'; $w = New-Object -ComObject WScript.Shell; $s = $w.CreateShortcut($lnk); $s.TargetPath = $exe; $s.WorkingDirectory = $dir; $s.Description = 'MafiaKillBot (local publish)'; $s.Save(); Write-Host ('Desktop shortcut: ' + $lnk)"

echo.
echo Uses framework-dependent .NET 8 Windows. If the exe does not start,
echo install ".NET Desktop Runtime 8" (x64) from Microsoft.
echo No server deploy; edit appsettings.json next to the exe as needed.
echo ============================================
pause
