@echo off
setlocal
cd /d "%~dp0"
call npm install
if errorlevel 1 exit /b 1
call npm run check
if errorlevel 1 exit /b 1
echo.
echo Checks passed. Production files are in the dist folder.
pause
endlocal
