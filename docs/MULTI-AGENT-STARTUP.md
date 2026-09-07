# Multi-Agent Startup (Phase 0)

Windows one-click launcher for the Liquidity Radar multi-agent operating system.

- OpenCode (OC-LEAD) — Lead Architect + System Implementation
- Cline (CL-UI) — UI/UX + Feature Developer
- Aider (AI-REF) — Refactoring + Maintenance + Testing

Single source of truth for identities: `agents/identities.json`.

---

## Prerequisites

- Windows (the launcher is a `.bat` + Node core)
- `git` and `node` on `PATH`
- Repository dependencies installed under `liquidity-radar-react/node_modules` (warned, not fatal)

Installed agent binaries are detected automatically:

| Agent  | Resolved from (checked in order)                                   |
|--------|--------------------------------------------------------------------|
| OpenCode | `%LOCALAPPDATA%\OpenCode\opencode-cli.exe` → `opencode` on PATH  |
| Cline    | `%APPDATA%\npm\cline.cmd` → `cline` on PATH                      |
| Aider    | `%USERPROFILE%\.local\bin\aider.exe` → `aider` on PATH           |

---

## Usage

Double-click `startup\START-AGENTS.bat` or run it from a terminal.

1. **Preflight** – validates the repository root, git/node availability, git work tree,
   current branch (warns when on `master`), the `agents/identities.json` file, and that
   every agent binary can be resolved.
2. **Launch** – opens one window per agent. Each window runs the agent against the repo
   root and stays open until you close it (Ctrl+C or the window close button).
3. The launcher window itself exits; the three agent windows keep running independently.

The launcher never checks out, pushes, or merges anything. It is inspect-only with
respect to Git state.

---

## Per-agent launch

| Agent  | Command                                      |
|--------|----------------------------------------------|
| OpenCode | `opencode-cli.exe <repo-root>`             |
| Cline    | `cline.cmd -c <repo-root> -i`              |
| Aider    | `aider.exe --model openrouter/openrouter/free --yes-always` |

- **Session continuity**: OpenCode sessions persist automatically in
  `%USERPROFILE%\.local\share\opencode` keyed by repo. Aider chat history persists in
  `.aider.chat.history.md` / `.aider.input.history` (git-ignored via `.aider*`); add
  `--restore-chat-history` to the Aider command in `startup\agent-env.mjs` (`buildAiderCmd`)
  to resume it. Cline supports `--id <session-id>` resume via its CLI.

---

## Single-instance guard

Each agent is guarded by a lock file in the OS temp dir
(`liquidity-radar-<agent>.lock`). If an agent window is still running when you re-run the
launcher, the duplicate is refused with a message showing the running PID. The lock is
released automatically when the agent window exits (or when the PID is found dead).

---

## Core logic and tests

The actual logic lives in Node (`startup\agent-env.mjs`) so it is testable and reusable;
`START-AGENTS.bat` is only a thin wrapper.

CLI reference (run from the repo root):

```text
node startup\agent-env.mjs preflight      validate repo + toolchain
node startup\agent-env.mjs info           print repo/toolchain summary
node startup\agent-env.mjs start <agent>  launch one agent (opencode|aider|cline)
node startup\agent-env.mjs help           show this help
```

Tests:

```text
node scripts\startup.test.mjs     launcher core tests (bins, builders, locks, safety)
node scripts\agent-os.test.mjs    Phase 0 validator tests (must keep passing)
```

The test suite asserts that no agent builder produces a command containing
`push` / `merge` / `checkout` / `commit` / `reset`.

---

## Troubleshooting

- **`git is not available on PATH` / `node is not available on PATH`** – add git/node to
  `PATH` and open a new terminal.
- **`binary not found` warning** – install the CLI, or add it to `PATH`; the launcher
  warns and skips that agent window.
- **`already running (pid …)`** – the agent is open in another window; close it first or
  use it directly.
- **On master warning** – expected behaviour: never implement directly on `master`. Open
  or switch to a task branch, then re-run the launcher.