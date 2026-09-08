# Liquidity Radar — Project Task Board

Permanent task-tracking board for the Liquidity Radar multi-agent project.
This board is GOVERNANCE ONLY — rows here never change application behavior.

Single source of truth for the live task registry: `tasks/index.json`.
This file documents the board schema, the lifecycle, the history rules, and the current state.

---

## 1. Lifecycle

A task moves through the states below. Every transition is written down; a task may move
backwards through the failure loop, but its history is never erased.

### Happy path

```
PENDING
  -> IN_PROGRESS
  -> SELF_TESTING
  -> SELF_VERIFICATION
  -> REFACTORING        (only if issues found)
  -> RETESTING          (only if refactored)
  -> PASS
  -> PR
  -> PRODUCTION         (merged to master, Vercel deploying)
  -> PRODUCTION_TEST    (verified against the live production URL)
  -> COMPLETED
```

### Failure loop (reopen)

```
COMPLETED  ->  REOPENED  ->  FIXING  ->  RETESTING  ->  PASS  ->  PR  ->  ...
```

Additional state: `BLOCKED` (capability missing / cannot proceed — report exactly why).

State transitions are recorded in the board row's **Status** column and, where relevant,
in `tasks/index.json`. A task only reaches COMPLETED after PRODUCTION_TEST passes
(or a documented non-app change is confirmed in production).

---

## 2. Required tracked fields

Every task row must track at minimum:

| # | Field | Meaning |
|---|-------|---------|
| 1 | Task ID | `CR-<PHASE>-NNN` (unique, traceable) |
| 2 | Task name | Concise title |
| 3 | Agent | Agent display name |
| 4 | Agent ID | `OC-LEAD` / `CL-UI` / `AI-REF` |
| 5 | Priority | HIGH / MEDIUM / LOW |
| 6 | Status | One lifecycle state (see section 1) |
| 7 | Created date/time | When the task was authored |
| 8 | Start date/time | When the agent started work |
| 9 | End date/time | When the task reached COMPLETED |
| 10 | Files/modules affected | Exact paths + feature areas |
| 11 | Self-test result | Result of the agent's own tests |
| 12 | Self-verification result | Diff/static/JSON checks |
| 13 | Test count | Number of tests executed |
| 14 | Test history | Ordered, append-only list (see section 3) |
| 15 | Issues found | Real issues discovered |
| 16 | Fixes applied | Real fixes applied |
| 17 | PR number | Real GitHub PR |
| 18 | Commit | Real commit hash(es) |
| 19 | Production status | Deployed / deploying / not applicable |
| 20 | Production test result | Real result of production verification |
| 21 | Final verdict | PASS / FAIL / BLOCKED |
| 22 | Notes | Limitations, follow-ups, warnings |

Long-form detail lives in the task file (`tasks/CR-<PHASE>-NNN.md`); the board carries the
summary row, and `tasks/index.json` is the machine-readable registry.

---

## 3. Test history — NEVER overwrite

Test results are append-only. Previous attempts must stay visible.

Example (correct):

```
Test #1 — FAIL — mobile layout issue
Test #2 — FAIL — spacing regression
Test #3 — PASS — verified
```

Each numbered `Test #N` entry in the task file and/or board row keeps its verdict and a
one-line reason. Deleting or editing an earlier `Test #N` is forbidden.

---

## 4. Current board state

Source: `tasks/index.json` (kept in sync with this table).

| Task ID | Name | Agent | Agent ID | Status | Branch | PR | Commit | Production |
|---------|------|-------|----------|--------|--------|----|--------|-----------|
| CR-P0-001 | Establish Phase 0 Agent Operating System | OpenCode | OC-LEAD | COMPLETED | chore/phase-0-agent-operating-system | — | — | N/A (governance) |
| CR-P0-006 | One-click multi-agent Windows launcher | OpenCode | OC-LEAD | COMPLETED | task/CR-P0-006-multi-agent-startup | — | — | N/A (governance) |
| CR-P0-007 | Task Board + Autonomous Task Queue + task template | OpenCode | OC-LEAD | COMPLETED | task/CR-P0-007-task-board | #11 | 8ccef9c | N/A (governance) |
| CR-P0-009 | Agent OS Control Center | Cline | CL-UI | IN_PROGRESS | task/CR-P0-009-agent-os-control-center | — | — | N/A (governance) |

Legacy Phase 1-5 application tasks predate this board and are not re-created here;
new tasks register in `tasks/index.json` and are appended to this table.

---

## 5. Board maintenance rules

- The Project Leader (ChatGPT) owns the board: priority, state transitions, reopen decisions.
- The owner is the final decision maker. The owner does not need to manually orchestrate
  individual subtasks when autonomous tasks have already been assigned.
- Agents update their own row with real values only.
- A row may never claim a test, commit, PR, or production result that was not actually
  executed. Use UNKNOWN / BLOCKED instead.
- Scope conflicts and another agent's in-flight work are never overwritten: stop and escalate.