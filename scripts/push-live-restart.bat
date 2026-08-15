@echo off
REM Double-click when the API must restart (Python already on the server, or you want a forced restart).
call "%~dp0push-live.bat" --restart %*
