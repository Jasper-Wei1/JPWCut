@echo off
setlocal
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 LTS or newer is required.
  echo Install it from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

call npm run setup
if errorlevel 1 goto :failed

call npm run doctor
if errorlevel 1 goto :failed

echo.
echo Installation completed. Run open-studio.cmd to start review.
pause
exit /b 0

:failed
echo.
echo Installation did not finish. See Windows\Windows快速开始.md.
pause
exit /b 1
