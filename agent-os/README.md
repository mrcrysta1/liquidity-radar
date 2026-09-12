# Agent OS Control Center — CR-P0-009

A polished, always-on **Agent OS desktop/browser Control Center** for the Liquidity Radar
multi-agent operating system. It launches with the existing one-click startup system and
continuously shows the status of OpenCode / Cline / Aider, the task registry, and project
activity.

## Source of truth

The dashboard **reuses the existing Agent Status Monitor**
(`agent-status/agent-status.mjs`) as its source of truth. It imports the monitor's
`analyze()` and `loadTaskRegistry()` and renders the normalized records directly.

The BUSY / REST / BLOCKED / UNKNOWN states shown are the exact tokens produced by the
monitor. **The dashboard never guesses a status** — it only visualizes what the monitor
emits, and shows `UNKNOWN` (with a warning) when the source is missing.

```
Agent Status Monitor (analyze/loadTaskRegistry)
        └── control-center.mjs (/api/state)
                └── dashboard.js → glass UI
```

No agent status, task, or project signal is duplicated or invented in this module.

## Run

```text
node agent-os/control-center.mjs start [--port 8787] [--host 127.0.0.1] [--open]
```

- Open `http://127.0.0.1:8787/` for the dashboard.
- `GET /api/state` returns the normalized JSON data.
- `GET /api/health` returns service health.

One-click desktop launch (used by `startup/START-AGENTS.bat`):

```text
startup\START-DASHBOARD.bat
```

## Features

- Modern glass / translucent UI with adjustable opacity (slider, persisted).
- Status chips per agent (BUSY / REST / BLOCKED / UNKNOWN) plus aggregate pills.
- Agent cards: status, task id, task name, branch (from the registry), latest activity,
  live session indicator (from the launcher's own lock files), notes and source warnings.
- Project overview: current phase, active / pending / completed / reopened / blocked task
  counts, latest PR, production state.
- Task activity list from `tasks/index.json`.
- Auto-refresh (15s) + manual refresh, last-updated timestamp.
- Compact mode (collapse to a slim dot bar) and expand/collapse.
- "Pin on top" affordance for keeping the panel above other in-page content.
- Clear loading / empty / error states; never shows a guessed status.
- Responsive sizing on narrow windows.

## Desktop vs browser mode

The dashboard is a single static SPA served over localhost. In **browser mode** it floats
as a translucent panel so your other work stays visible around/behind it. In **desktop
mode** (`startup\START-DASHBOARD.bat`) the server opens your default browser to the same
panel in a dedicated window. This is the smallest reliable solution for this repository —
no Electron/Tauri/Vite or new runtime dependencies. Trade-off: true OS-level "always on
top across every other application window" depends on the host browser / desktop shell;
the panel always floats above in-page content and supports the pin affordance.

## Security

- Local-only bind to `127.0.0.1` (default host).
- Reads only repository status/task/governance files.
- **No secrets, API keys, credentials, or environment secrets are read or exposed.**
- No write endpoints; the server is read-only for the repository.

## Tests

```text
node agent-os/control-center.test.mjs
```

## Files

```
agent-os/
  control-center.mjs          local stdlib HTTP server + CLI (reuses agent-status monitor)
  control-center.test.mjs     unit + live HTTP integration tests
  public/
    index.html                dashboard structure
    dashboard.css             glass / translucent theme
    dashboard.js              dashboard logic (refresh, opacity, compact, pin)
  README.md
```