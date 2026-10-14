# Liquidity Radar — Autonomous Task Queue

GOVERNANCE — queue/planning only. No application behavior changes.

The owner can give ChatGPT (the Project Leader) a batch of tasks and step away. The Project
Leader breaks the work into isolated, queueable task entries, assigns them to the capable
agents, and the agents drive their own lifecycle without asking for permission on normal
implementation decisions. Escalation happens only on the explicit list in section 7.

---

## 1. Queue entry schema

Every queued task must include:

| Field | Meaning |
|-------|---------|
| Task ID | `CR-<PHASE>-NNN` (unique) |
| Description | What must be delivered and why |
| Assigned agent | Agent display name |
| Agent ID | OC-LEAD / CL-UI / AI-REF |
| Priority | HIGH / MEDIUM / LOW |
| Dependencies | Task IDs that must finish first (or "none") |
| Allowed files/modules | Exact scope the agent may touch |
| Status | QUEUED / ASSIGNED / IN_PROGRESS / SELF_TESTING / SELF_VERIFICATION / PASS / PR / PRODUCTION / PRODUCTION_TEST / COMPLETED / BLOCKED / REOPENED |
| Execution rules | Branch naming, commit conventions, verification gates, escalation rules |
| Verification requirements | Exact commands/checks (tests, lint, build, probes) |
| Production requirements | Whether the task affects production and how production is verified |

Entries are authored from `tasks/TEMPLATE.md` and recorded in `tasks/index.json`.

---

## 2. Closing the queue loop

```
Owner gives tasks to Project Leader
  -> Project Leader validates identities + breaks work into isolated entries
  -> Entries queued in tasks/index.json + this file
  -> Each agent validates its task (node scripts/agent-os.mjs task <file> --agent-id <id>)
  -> Agent completes the lifecycle on its task branch
  -> PR to master, merge only through GitHub
  -> Production verified where applicable
  -> Project Leader reviews final state and closes the task
```

---

## 3. Parallel work — isolation rule

Three agents may work in parallel ONLY when their implementation surfaces are isolated.

Example division by layer for one feature:

- OpenCode (OC-LEAD): architecture / core logic / integration
- Cline (CL-UI): UI / UX / components / responsive behavior
- Aider (AI-REF): tests / refactoring / review / maintenance

Rule: NEVER allow two agents to modify the same file or the same implementation surface
at the same time, unless explicitly coordinated and serialized. If a task touches another
agent's area, minimize the touch, explain it, and record it.

Current file-ownership map (from AGENTS.md):

| Area | Files/dirs | Primary owner |
|------|-----------|---------------|
| Charts | liquidity-radar-react/src/features/charts/ | Cline (UI) |
| News | liquidity-radar-react/src/features/news/ | Cline (UI) |
| Chat | liquidity-radar-react/src/features/chat/ | Cline (UI) |
| Market data | liquidity-radar-react/src/services/marketData.ts, market.ts | OpenCode |
| Search widget | liquidity-radar-react/src/components/search/ | OpenCode |
| Engine wiring | liquidity-radar-react/src/engine/app.ts | OpenCode |
| UI components | assigned react component dirs | Cline |
| Services/logic | liquidity-radar-react/src/services/, src/utils/, src/types/ | OpenCode / Aider |
| Tests/refactor | liquidity-radar-react/src + scripts | Aider |
| Governance | tasks/, agents/, scripts/, startup/, docs/ | OpenCode (coordinated) |

Shared governance files (`tasks/index.json`, `AGENTS.md`) are coordinated/serialized —
never edited by two agents concurrently.

---

## 4. Work ownership

### Project Leader — ChatGPT
- Decides priority, creates task IDs, divides work, assigns agents
- Identifies dependencies and prevents file conflicts
- Monitors the task lifecycle through the task board
- Decides when tasks are ready; reopens failed production tasks; consolidates final reports

### Owner — the user
- Final decision maker
- Provides the task batch and reviews the consolidated final reports
- Does not need to manually orchestrate subtasks once they are assigned autonomously

### Agents — OpenCode / Cline / Aider
- Complete only their assigned task on its own branch
- Self-test and self-verify with real commands
- Report with real values or UNKNOWN/BLOCKED
- Never push to master, never merge their own PRs, never overwrite another agent's work

---

## 5. Daily autonomous workflow

When the owner says: "I am busy today. Give the agents their task queue." the Project Leader:

1. Reviews open work and defines isolated tasks.
2. Validates each task file against the agent identities.
3. Assigns tasks and records them.
4. Agents proceed through their full lifecycle independently.
5. Agents report back; the Project Leader consolidates.

Agents continue without asking permission for normal implementation decisions. They STOP and
escalate only on the escalation list (section 7).

---

## 6. New-feature workflow

1. Project Leader defines the feature.
2. Feature is divided into isolated responsibilities.
3. OpenCode handles architecture/core implementation where appropriate.
4. Cline handles UI/UX where appropriate.
5. Aider handles tests/refactoring/review where appropriate.
6. Each agent self-tests.
7. Each agent self-verifies.
8. Problems are fixed and retested.
9. PRs are created.
10. Production is deployed.
11. Production is verified.
12. Task Board is updated.
13. Project Leader reviews the final state.

---

## 7. Escalation — stop and ask

Agents stop and escalate when any of these apply:

- destructive action is required
- architecture is materially ambiguous
- task scope conflicts with another agent's work
- production safety is uncertain
- credentials / secrets are required
- another agent's work would be overwritten
- acceptance criteria cannot be determined safely

In every escalation the agent reports BLOCKED with the exact missing capability or decision.

---

## 8. Agent safety (always)

- Never push directly to master.
- Use dedicated task branches; create PRs; merge only through GitHub.
- Preserve existing functionality; make minimal changes.
- Inspect the diff before committing; run appropriate tests.
- Never overwrite another agent's work; stop if scope conflict is detected.
- Never modify files outside assigned scope without justification.
- Keep Aider (AI-REF) fully registered; advisory mode is a capability limit, not abandonment.

---

## 9. Current queue

No tasks currently queued beyond those registered in `tasks/index.json`.
New entries are appended here with their Task ID and the fields from section 1.