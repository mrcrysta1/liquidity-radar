@echo off
REM Agent OS Control Center launcher - CR-P0-009
REM Starts the local dashboard server and opens the default browser to it.
REM Works from any working directory (paths derived from %~dp0).
REM Exit codes: 0 = control center running/being opened, 1 = start failed,
REM             higher = node error (EADDRINUSE or port conflict -> 1).
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
echo [AGENT-OS] if it is already running, the existing instance is reused (no duplicates).
echo [AGENT-OS] opens in your default browser; close this window to stop the server.

node agent-os\control-center.mjs start --port 8787 --host 127.0.0.1 --open
set "CODE=%ERRORLEVEL%"

popd
exit /b %CODE%