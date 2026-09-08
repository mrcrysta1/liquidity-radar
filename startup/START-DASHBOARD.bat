@echo off
REM Agent OS Control Center launcher - CR-P0-009 (CL-UI)
REM Starts the local dashboard server and opens the default browser to it.
setlocal EnableExtensions
title Liquidity Radar - Agent OS Control Center
set "ROOT=%~dp0.."

pushd "%ROOT%" >nul 2>&1
if errorlevel 1 (
  echo [AGENT-OS] ERROR: cannot enter repository root
  exit /b 1
)

echo [AGENT-OS] Agent OS Control Center
echo [AGENT-OS] serving dashboard at http://127.0.0.1:8787/
echo [AGENT-OS] opens in your default browser; close this window to stop the server.

node agent-os\control-center.mjs start --port 8787 --host 127.0.0.1 --open
popd
exit /b 0