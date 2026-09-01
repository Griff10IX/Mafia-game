@echo off
REM Double-click when the API must restart (Python already on the server, or you want a forced restart).
REM Downtime page: System AI is updating the game engine.
REM Optional: push-live-restart.bat --updating "Casino tables" "Your commit message"
call "%~dp0push-live.bat" --restart --updating "the game engine" %*
