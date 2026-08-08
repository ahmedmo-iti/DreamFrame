@echo off
setlocal
cd /d "%~dp0"
if not exist "dreamframe-workers.json" copy /y "dreamframe-workers.example.json" "dreamframe-workers.json" >nul
start "" notepad.exe "dreamframe-workers.json"
start "" "MULTI_PC_SETUP.md"
endlocal
