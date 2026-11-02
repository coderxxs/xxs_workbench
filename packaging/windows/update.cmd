@echo off
setlocal
set "TARGET_DIR=%~1"
if not defined TARGET_DIR set "TARGET_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" -TargetPath "%TARGET_DIR%"
if errorlevel 1 (
  echo Update failed. Existing data was not removed.
  pause
  exit /b 1
)
echo Update completed. Start the workbench with start.cmd.
