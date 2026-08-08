@echo off
setlocal
cd /d "%~dp0"
title DreamFrame Local Production Launcher

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the current Node.js LTS release.
  pause
  exit /b 1
)

if not exist ".env.local" copy /y ".env.example" ".env.local" >nul
if not exist "dreamframe-workers.json" copy /y "dreamframe-workers.example.json" "dreamframe-workers.json" >nul
if not exist "node_modules" (
  echo Installing DreamFrame dependencies...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
if not exist "dist\index.html" (
  echo Building the DreamFrame production application...
  call npm run build
  if errorlevel 1 pause & exit /b 1
)

echo Starting DreamFrame production server at http://127.0.0.1:3000
echo Multi-PC workers are loaded from dreamframe-workers.json
start "DreamFrame Production Server" cmd /k "npm run start"
timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:3000"
endlocal
