TASK ID: <CR-<PHASE>-NNN>
AGENT: <Agent display name — e.g. OpenCode>
AGENT ID: <OC-LEAD | CL-UI | AI-REF>
AGENT NAME: <Agent display name — must equal AGENT (validator key)>
ROLE: <Authorized role, e.g. Lead Architect + System Implementation>
AUTHORIZED ROLE: <Same role value as ROLE (validator key)>
PHASE: <0 | 1 | 2 | 3 | 4 | 5>
PRIORITY: <HIGH | MEDIUM | LOW>
PROJECT: LIQUIDITY-RADAR
EXPECTED OUTPUT: <single-line deliverable summary>
STATUS: <PENDING | IN_PROGRESS | SELF_TESTING | SELF_VERIFICATION | REFACTORING | RETESTING | PASS | PR | PRODUCTION | PRODUCTION_TEST | COMPLETED | REOPENED | FIXING | BLOCKED>
---
OBJECTIVE:
<What must be built and why. One paragraph.>

SCOPE:
- Which files / areas are in scope
- List exactly what the agent may create or modify

OUT OF SCOPE:
- Explicit prohibitions
- Areas and files the agent MUST NOT touch

ALLOWED FILES:
- Granular allowed paths / directories, one per bullet

DEPENDENCIES:
- Task IDs this task depends on, if any (or "none")

ACCEPTANCE CRITERIA:
1. Checkable acceptance criteria (each one verifiable)
2. Include the required verification commands

IMPLEMENTATION:
- Step-by-step implementation plan (do not include code review steps here)

SELF TEST:
- Exact commands the agent ran and the expected results
- Never claim a test passed unless it actually ran

SELF VERIFICATION:
- Static/diff review checks: git diff, whitespace, JSON syntax, no out-of-scope files

REFACTOR/FIX:
- What was improved/fixed after initial testing, if anything

RETEST:
- Re-run commands from SELF TEST after any fix; record results

GIT/PR:
- Branch name, commit subject conventions
- PR to master; merge ONLY through GitHub; never push to master

PRODUCTION:
- Expected production impact (usually "none" for governance/test tasks)

PRODUCTION VERIFICATION:
- How production health is verified after merge (URL/checks)

FINAL REPORT:
- STATUS: <final>
- BRANCH: <real>
- COMMIT: <real>
- PR: <real>
- FILES CHANGED: <real list>
- IMPLEMENTATION SUMMARY: <what was actually done>
- SELF TEST: <real results>
- SELF VERIFICATION: <real results>
- ISSUES/FIXES: <real>
- PRODUCTION STATUS: <real>
- PRODUCTION TEST: <real>
- FINAL VERDICT: <PASS | FAIL | BLOCKED>

---

# Rules

- Every value must be REAL. Never invent commit hashes, PR numbers, test results, or production results.
  If a value cannot be verified, write UNKNOWN / BLOCKED and say exactly which capability is missing.
- Run the identity validator before starting:
    node scripts/agent-os.mjs task <task-file> --agent-id <YOUR AGENT ID>
- Never work directly on master. Work only on the dedicated task branch.
- Preserve existing functionality. Make minimal changes. Inspect the diff before committing.
- Stop and escalate when: destructive action required, architecture materially ambiguous,
  task scope conflicts, production safety uncertain, credentials/secrets required,
  another agent's work would be overwritten, or acceptance criteria cannot be determined safely.

Branch: <chore|feature|fix|test|refactor|docs>/<short-slug>
Commit: one conventional commit per logical change
PR: <dedicated branch> -> master (do not merge yourself unless explicitly authorized)