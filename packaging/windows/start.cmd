@echo off
setlocal
set "ROOT_DIR=%~dp0"
if not defined DEV_AGENT_HOME set "DEV_AGENT_HOME=%ROOT_DIR%data"
if not defined DEV_AGENT_HOST set "DEV_AGENT_HOST=0.0.0.0"
if not defined DEV_AGENT_PORT set "DEV_AGENT_PORT=4317"
if not defined DEV_AGENT_NODE set "DEV_AGENT_NODE=%ROOT_DIR%runtime\node\node.exe"
if not defined DEV_AGENT_PYTHON set "DEV_AGENT_PYTHON=%ROOT_DIR%runtime\python\python.exe"
set "PATH=%ROOT_DIR%runtime\node;%ROOT_DIR%runtime\python;%PATH%"

if not exist "%DEV_AGENT_NODE%" (
  echo [ERROR] Missing bundled Node.js: %DEV_AGENT_NODE%
  pause
  exit /b 1
)
if not exist "%DEV_AGENT_PYTHON%" (
  echo [ERROR] Missing bundled Python: %DEV_AGENT_PYTHON%
  pause
  exit /b 1
)
if not exist "%DEV_AGENT_HOME%" mkdir "%DEV_AGENT_HOME%"

cd /d "%ROOT_DIR%"
echo Starting xxs_workbench at http://127.0.0.1:%DEV_AGENT_PORT%
echo LAN access: http://THIS-WINDOWS-IP:%DEV_AGENT_PORT%
echo Press Ctrl+C to stop.
"%DEV_AGENT_NODE%" dist\src\server.js
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
