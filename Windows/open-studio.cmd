@echo off
setlocal
cd /d "%~dp0.."

call npm run studio
if errorlevel 1 (
  echo.
  echo Studio did not start. Run install.cmd first.
  pause
)
