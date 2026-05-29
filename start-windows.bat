@echo off
setlocal

cd /d "%~dp0"
set "PORT=42021"
set "URL=http://127.0.0.1:%PORT%/index.html?v=2.1"

where powershell >nul 2>nul
if %errorlevel%==0 (
  start "Left Hand Rule App Server" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve-local.ps1" -Port %PORT%
  timeout /t 2 /nobreak >nul
  start "" "%URL%"
  exit /b 0
)

where py >nul 2>nul
if %errorlevel%==0 (
  start "Left Hand Rule App Server" /min py -m http.server %PORT% --bind 127.0.0.1
  timeout /t 2 /nobreak >nul
  start "" "%URL%"
  exit /b 0
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "Left Hand Rule App Server" /min python -m http.server %PORT% --bind 127.0.0.1
  timeout /t 2 /nobreak >nul
  start "" "%URL%"
  exit /b 0
)

echo Unable to start a local server. Please install Python or run this folder from any localhost web server.
pause
