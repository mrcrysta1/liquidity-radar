@echo off
setlocal EnableExtensions

set "ROOT=%~dp0.."
pushd "%ROOT%" >nul 2>&1
if errorlevel 1 (
  echo [AGENT-OS] ERROR: cannot enter repository root
  exit /b 1
)

title Liquidity Radar - Agent Operating System

where git >nul 2>&1
if errorlevel 1 (
  echo [AGENT-OS] ERROR: git is not available on PATH
  popd
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo [AGENT-OS] ERROR: node is not available on PATH
  popd
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [AGENT-OS] ERROR: not inside a git repository
  popd
  exit /b 1
)

for /f "usebackq delims=" %%B in (`git branch --show-current`) do set "BRANCH=%%B"
echo [AGENT-OS] repository : %CD%
echo [AGENT-OS] branch     : %BRANCH%
if /i "%BRANCH%"=="master" (
  echo [AGENT-OS] WARNING   : you are on master. Agent implementation work must happen on a dedicated task branch.
)
if "%BRANCH%"=="" (
  echo [AGENT-OS] WARNING   : detached HEAD or branch unknown - check the checkout state.
)

if not exist "agents\identities.json" (
  echo [AGENT-OS] ERROR: agents\identities.json is missing
  popd
  exit /b 1
)
echo [AGENT-OS] identities : OK (agents\identities.json)

if not exist "liquidity-radar-react\node_modules" (
  echo [AGENT-OS] WARNING   : liquidity-radar-react\node_modules not found (run npm install there before app work)
)

echo.
echo [AGENT-OS] AGENT IDENTITIES
node scripts\agent-os.mjs identity
if errorlevel 1 (
  echo [AGENT-OS] ERROR: identity listing failed
  popd
  exit /b 1
)

echo.
echo [AGENT-OS] TASK VALIDATION
for %%F in (tasks\CR-*.md) do (
  node scripts\agent-os.mjs task "%%F"
  if errorlevel 1 (
    echo [AGENT-OS] WARNING: task header invalid for %%~nxF
  )
)

echo.
echo [AGENT-OS] AGENT ENTRY POINTS
where opencode >nul 2>&1 && echo   - OpenCode : run: opencode
if exist "%USERPROFILE%\.vscode\extensions" echo   - Cline    : open the Cline extension in VS Code
where aider >nul 2>&1 && echo   - Aider    : run: aider --read AGENTS.md

echo.
echo [AGENT-OS] startup checks complete.
popd
exit /b 0