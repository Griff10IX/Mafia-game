@echo off
REM Shared UI for push-live*.bat - call as:
REM   call "%~dp0_deploy-ui.bat" INIT
REM   call "%~dp0_deploy-ui.bat" HEADER "Title" "Subtitle"
REM   call "%~dp0_deploy-ui.bat" STEP 1 6 "Label"
REM   call "%~dp0_deploy-ui.bat" INFO "detail line"
REM   call "%~dp0_deploy-ui.bat" OK "message"
REM   call "%~dp0_deploy-ui.bat" WARN "message"
REM   call "%~dp0_deploy-ui.bat" FAIL "message"
REM   call "%~dp0_deploy-ui.bat" FOOTER "Done line"
setlocal EnableExtensions EnableDelayedExpansion

if /i "%~1"=="INIT" goto INIT
if /i "%~1"=="HEADER" goto HEADER
if /i "%~1"=="STEP" goto STEP
if /i "%~1"=="INFO" goto INFO
if /i "%~1"=="OK" goto OK
if /i "%~1"=="WARN" goto WARN
if /i "%~1"=="FAIL" goto FAIL
if /i "%~1"=="FOOTER" goto FOOTER
if /i "%~1"=="BLANK" goto BLANK
exit /b 1

:INIT
set "DUI_USE_COLOR=0"
where powershell >nul 2>&1 && (
  for /F "delims=" %%V in ('powershell -NoProfile -Command "try{$s='using System;using System.Runtime.InteropServices;public class C{[DllImport(\"\"kernel32.dll\"\")]public static extern IntPtr GetStdHandle(int n);[DllImport(\"\"kernel32.dll\"\")]public static extern bool GetConsoleMode(IntPtr h,out uint m);[DllImport(\"\"kernel32.dll\"\")]public static extern bool SetConsoleMode(IntPtr h,uint m);}';Add-Type -TypeDefinition $s -EA Stop;$h=[C]::GetStdHandle(-11);[uint32]$m=0;if([C]::GetConsoleMode($h,[ref]$m)){if([C]::SetConsoleMode($h,$m -bor 4)){Write-Output OK}}catch{}" 2^>nul') do (
    if /I "%%V"=="OK" set "DUI_USE_COLOR=1"
  )
)
for /F "delims=" %%a in ('echo prompt $E ^| cmd') do (
  endlocal ^
  & set "DUI_USE_COLOR=%DUI_USE_COLOR%" ^
  & set "DUI_ESC=%%a" ^
  & if "%DUI_USE_COLOR%"=="0" (
      set "DUI_RESET=" ^
      & set "DUI_BOLD=" ^
      & set "DUI_DIM=" ^
      & set "DUI_RED=" ^
      & set "DUI_GREEN=" ^
      & set "DUI_YELLOW=" ^
      & set "DUI_BLUE=" ^
      & set "DUI_MAG=" ^
      & set "DUI_CYAN=" ^
      & set "DUI_WHITE=" ^
      & set "DUI_BG="
    ) else (
      set "DUI_RESET=%%a[0m" ^
      & set "DUI_BOLD=%%a[1m" ^
      & set "DUI_DIM=%%a[2m" ^
      & set "DUI_RED=%%a[31m" ^
      & set "DUI_GREEN=%%a[32m" ^
      & set "DUI_YELLOW=%%a[33m" ^
      & set "DUI_BLUE=%%a[34m" ^
      & set "DUI_MAG=%%a[35m" ^
      & set "DUI_CYAN=%%a[36m" ^
      & set "DUI_WHITE=%%a[97m" ^
      & set "DUI_BG=%%a[48;5;236m"
    )
)
exit /b 0

:HEADER
set "T=%~2"
set "S=%~3"
echo.
echo %DUI_BG%%DUI_WHITE%%DUI_BOLD%  %T%  %DUI_RESET%
if not "%S%"=="" echo %DUI_DIM%  %S%!DUI_RESET!
echo %DUI_DIM%  ================================================================%DUI_RESET%
echo.
exit /b 0

:STEP
set /a "CUR=%~2"
set /a "TOT=%~3"
set "LBL=%~4"
set /a "PCT=(CUR * 100) / TOT"
set /a "FILLED=(CUR * 24) / TOT"
if !FILLED! gtr 24 set /a FILLED=24
set "BAR="
for /l %%i in (1,1,!FILLED!) do set "BAR=!BAR!#"
set /a "EMPTY=24-FILLED"
for /l %%i in (1,1,!EMPTY!) do set "BAR=!BAR!-"
echo %DUI_CYAN%%DUI_BOLD%[!CUR!/!TOT!]%DUI_RESET% %LBL%
echo %DUI_DIM%[!BAR!] !PCT!%%%DUI_RESET%
exit /b 0

:INFO
echo   %DUI_DIM%^> %~2!DUI_RESET!
exit /b 0

:OK
echo   %DUI_GREEN%[OK] %~2!DUI_RESET!
exit /b 0

:WARN
set "MSG=%~2"
echo   %DUI_YELLOW%[^^!^^!] !MSG!!DUI_RESET!
exit /b 0

:FAIL
echo   %DUI_RED%[XX] %~2!DUI_RESET!
exit /b 0

:FOOTER
echo.
echo %DUI_DIM%  ================================================================%DUI_RESET%
echo %DUI_GREEN%%DUI_BOLD%  [OK] %~2!DUI_RESET!
echo.
exit /b 0

:BLANK
echo.
exit /b 0
