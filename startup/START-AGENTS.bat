@echo off
setlocal EnableExtensions
title Liquidity Radar - Agent Operating System
set "ROOT=%~dp0.."

pushd "%ROOT%" >nul 2>&1
if errorlevel 1 (
  echo [AGENT-OS] ERROR: cannot enter repository root
  exit /b 1
)

echo [AGENT-OS] Liquidity Radar multi-agent launcher
echo.

node startup\agent-env.mjs preflight
if errorlevel 1 (
  echo.
  echo [AGENT-OS] preflight FAILED - fix the errors above and run again.
  popd
  exit /b 1
)

echo.
echo [AGENT-OS] LAUNCHING AGENTS (one window per agent)
echo [AGENT-OS] close each agent window to stop that agent; close the launcher window when done.
if defined LR_DRY_RUN (
  echo [AGENT-OS] DRY RUN - agents would launch as follows:
  echo   node startup\agent-env.mjs start opencode
  echo   node startup\agent-env.mjs start aider
  echo   node startup\agent-env.mjs start cline
) else (
  start "OpenCode Agent (OC-LEAD)" /D "%CD%" cmd /k "node startup\agent-env.mjs start opencode"
  start "Aider Agent (AI-REF)" /D "%CD%" cmd /k "node startup\agent-env.mjs start aider"
  start "Cline Agent (CL-UI)" /D "%CD%" cmd /k "node startup\agent-env.mjs start cline"
)

echo.
echo [AGENT-OS] launcher complete.
popd
exit /b 0