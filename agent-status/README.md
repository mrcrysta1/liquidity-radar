# Agent Status Monitor (CR-P0-008)

A small, isolated monitor that shows the current **BUSY / REST / BLOCKED / UNKNOWN** state of the
three AI agents in the Liquidity Radar project.

| Agent   | Agent ID | Role                              |
|---------|----------|-----------------------------------|
| OpenCode | OC-LEAD  | Lead Architect + System Implementation |
| Cline    | CL-UI    | UI/UX + Feature Developer         |
| Aider    | AI-REF   | Refactoring + Maintenance + Testing |

Location: `agent-status/`. It is isolated infrastructure/monitoring and does **not** touch any
application source, trading, API, chart, engine, search-widget, CSS/UI, or production behavior.

## What is (and is not) auto-detected

The BUSY/REST/BLOCKED state of an agent lives in the agent's head/session and **cannot be
reliably auto-detected** from the environment. This monitor therefore never guesses it. Instead it
reads a structured source — `agent-status/status.json` — that the agent launch/task systems (or a
human) keep up to date, and it reports `UNKNOWN` for any agent whose status is missing or invalid.

It *does* integrate the real, detectable signals that already exist, clearly labelled:

- **Canonical identities** — from `agents/identities.json` (single source of truth).
- **Task cross-reference** — when a `taskId` is present in `status.json`, it is looked up in
  `tasks/index.json` and the registered lifecycle status is shown in the NOTE column.
- **Session detection** — the launcher (`startup/agent-env.mjs`) writes lock files in the OS temp
  dir (`liquidity-radar-<AGENT_ID>.lock`). The monitor reads those and shows **SESSION(detected)** =
  `open`/`closed`. This reflects "an agent launch window is currently open" and is **never** treated
  as the agent's BUSY/REST state.

## Status lifecycle

High-level surface (what the monitor displays):

```
REST → BUSY → BLOCKED → UNKNOWN
```

Internal task phases are also accepted and map to the BUSY family so they stay compatible with the
high-level surface:

```
REST → BUSY → TESTING → VERIFYING → PR → PRODUCTION → REST
                       └─────────────────────────────────┘ (all surface as BUSY)
```

`BLOCKED` is always kept distinct (never folded into BUSY). Accepted tokens in `status.json`:

```
REST | BUSY | BLOCKED | UNKNOWN | TESTING | VERIFYING | PR | PRODUCTION
```

## status.json schema

```json
{
  "version": 1,
  "schema": "liquidity-radar/agent-status@1",
  "updatedAt": "ISO-8601",
  "note": "free text",
  "agents": {
    "OC-LEAD": {
      "name": "OpenCode",
      "status": "BUSY",
      "taskId": "CR-P0-008",
      "taskName": "Agent Status Monitor",
      "startedAt": "ISO-8601",
      "lastActivity": "ISO-8601",
      "note": "free text"
    }
  }
}
```

Optional fields: `taskId`, `taskName`, `startedAt`, `lastActivity`, `note`. All three agents
(`OC-LEAD`, `CL-UI`, `AI-REF`) should be present; a missing agent is reported as `UNKNOWN`.

## Usage (Windows)

Run from the repo root with Node (already a project dependency):

```text
node agent-status\agent-status.mjs status     human-readable table (default)
node agent-status\agent-status.mjs json       normalized, validated JSON
node agent-status\agent-status.mjs validate   exit 0=valid, 1=invalid, 2=missing source
node agent-status\agent-status.mjs snapshot   print a fresh status.json scaffold
node agent-status\agent-status.mjs set <ID> <STATUS> [options]   update status.json
```

`set` options: `--task-id X`, `--task-name Y`, `--note Z`, `--started-at ISO`,
`--last-activity ISO`.

Example:

```text
node agent-status\agent-status.mjs set OC-LEAD BUSY --task-id CR-P0-009 --task-name "Next task"
```

## How future automation updates status (easy)

The design is intentionally simple so any agent launch/task system can publish state:

1. **Direct write** — overwrite `agent-status/status.json` (same schema) and set `updatedAt`.
   Validation (`validate`) is a separate, cheap step.
2. **CLI helper** — call the `set` command from a wrapper/launcher to update one agent without
   rewriting the whole file.
3. **Lock sync (recommended)** — the launcher already writes a temp-dir lock per agent. A future
   system can write `status.json` right after acquiring the lock (BUSY) and clear it (REST) when
   the agent exits, giving SESSION(detected) and the published status coherent, real values.

Rules for automation:

- Use only the accepted status tokens above.
- Never mark an agent BUSY on a guess; if unknown, use `UNKNOWN`.
- Keep `updatedAt` current so downstream readers can detect staleness.

## Tests

```text
node agent-status\agent-status.test.mjs
```

Covers: valid status file, all status tokens / public mapping, missing source, invalid JSON,
invalid status token, missing agent, unknown agent key, name mismatch, and the `set` CLI.

## Report format

When an agent reports on this task it must include the standard identity header
(`TASK ID`, `AGENT ID`, ...) and real values; see `AGENTS.md` and `tasks/`.