\# AI Agent Governance



\## Project



This repository is the Liquidity Radar / Crypto Radar React application.



The project is currently in:

\- Phase 1: React + Vite + TypeScript — COMPLETE

\- Phase 2: Modularization — COMPLETE

\- Phase 3: React Componentization — NEXT

\- Phase 4: Testing + Multi-Agent Workflow — UPCOMING

\- Phase 5: Vercel Production — COMPLETE



Production:

https://liquidity-radar-seven.vercel.app/



Git:

\- Main branch: master

\- Remote: origin

\- master is the production branch



\---



\# Core Rules



\## 1. Never work directly on master



AI agents MUST NOT:

\- commit directly to master

\- push directly to master

\- force-push master

\- reset/rewrite master history

\- make destructive changes to master



Every development task must use a dedicated branch.



Examples:



feature/dashboard

feature/charts

feature/news

feature/signals

refactor/componentization

refactor/cleanup

test/e2e

fix/chart-rendering



\---



\## 2. Branch Workflow



Before starting development:



1\. Check git status.

2\. Check current branch.

3\. Make sure the working tree is understood.

4\. Create/use an appropriate task branch.

5\. Make changes only inside that branch.

6\. Run relevant tests.

7\. Review git diff.

8\. Commit with a clear message.

9\. Push the task branch.

10\. Open a Pull Request to master.



Do not merge your own work into master unless explicitly instructed.



\---



\# Agent Roles



\## OpenCode — Lead Developer



Primary responsibilities:



\- Overall architecture

\- Major feature development

\- Cross-feature integration

\- Complex implementation

\- Technical decisions

\- Phase 3 componentization planning

\- Core React architecture

\- Reviewing architectural conflicts



OpenCode should avoid unnecessary rewrites.



OpenCode must preserve existing working functionality unless the task explicitly requires changing it.



\---



\## Cline — UI/UX + Feature Developer



Primary responsibilities:



\- React UI

\- UI/UX improvements

\- Frontend feature implementation

\- Responsive design

\- Components

\- Visual interactions

\- Dashboard interfaces

\- Feature-level frontend work



Cline should avoid changing core architecture unless explicitly assigned.



Cline must preserve existing APIs, services and business logic unless required by the assigned task.



\---



\## Aider — Refactoring + Maintenance + Testing



Primary responsibilities:



\- Refactoring

\- Code cleanup

\- Test improvements

\- Bug fixes

\- TypeScript cleanup

\- Small maintenance tasks

\- Dependency/configuration maintenance

\- Reviewing repetitive or mechanical changes



Aider should NOT independently start major new features.



Aider should NOT automatically begin Phase 3 componentization.



Aider must avoid unnecessary changes.



\---



\# Shared Development Rules



\## Preserve Existing Functionality



Do not break:



\- market data

\- WebSocket streams

\- charts

\- indicators

\- news

\- analysis

\- chat

\- search

\- storage

\- theme system

\- Vite configuration

\- production deployment



If a task requires changing existing behavior, clearly explain why.



\---



\## Minimal Changes



Prefer:



\- small changes

\- focused commits

\- existing utilities

\- existing services

\- existing types

\- reusable components



Avoid:



\- unnecessary rewrites

\- replacing working libraries

\- changing unrelated files

\- introducing new dependencies without justification

\- changing APIs without approval



\---



\# React Architecture



The React application lives in:



liquidity-radar-react/



Important structure:



src/

\- api/

\- features/

\- services/

\- types/

\- utils/



Phase 3 will gradually introduce reusable React components.



Do NOT perform a giant one-shot componentization.



Componentization should be incremental and verified after each logical unit.



\---



\# Testing Requirements



Before committing:



\- run lint

\- run production build

\- run relevant tests/smoke tests

\- inspect git diff

\- confirm no accidental files changed



If a test cannot be run, report the reason.



Never claim a test passed if it was not actually executed.



\---



\# Git Commit Rules



Use clear conventional-style commit messages.



Examples:



feat: add market dashboard

feat: add chart workspace

fix: resolve chart rendering issue

fix: correct websocket reconnect handling

refactor: extract dashboard components

refactor: simplify market service

test: add chart smoke tests

chore: update dependencies



Keep commits focused.



\---



\# Multi-Agent Coordination



Multiple AI agents may work on this repository.



Agents must:



\- inspect existing code before modifying it

\- respect existing architecture

\- avoid overwriting another agent's work

\- avoid changing files outside the assigned task

\- report files changed

\- report tests executed

\- report known limitations



If another agent's changes are detected in the working tree:



DO NOT overwrite them.



Stop and inspect the situation before proceeding.



\---



\# File Ownership



Prefer isolated ownership.



Examples:



Charts work:

src/features/charts/



News work:

src/features/news/



Chat work:

src/features/chat/



Market data:

src/services/marketData.ts

src/services/market.ts



UI components:

react component directories assigned to the specific task



If a task requires touching another agent's area, minimize the change and explain it.



\---



\# Phase 3 Rules



Phase 3 is React componentization.



Do not:



\- rewrite the whole application

\- change the product design unnecessarily

\- replace the existing charting system

\- replace existing data services

\- migrate frameworks

\- introduce a new state-management library without approval



Goal:



Convert the existing working application into clean, reusable React components incrementally while preserving current behavior.



Each componentization step must:



1\. preserve functionality

2\. pass lint

3\. pass build

4\. pass relevant smoke tests

5\. have a focused commit



\---



\# Production Safety



Production is deployed through Vercel.



master represents production.



Before merging:



\- build must pass

\- tests must pass

\- no accidental debug code

\- no secrets committed

\- no API keys committed

\- no production-breaking changes



Never commit:



.env

.env.local

API keys

private credentials

tokens

passwords



\---



\# Communication Format



When finishing a task, report:



\## Summary

What was changed.



\## Files Changed

List exact files.



\## Tests

List commands/tests run and their results.



\## Git

Branch name and commit hash.



\## Notes

Any limitations, warnings, or follow-up work.



\---



\# Important



Do not assume a task is approved merely because it seems useful.



Only perform the assigned task.



Do not start unrelated improvements.



Do not automatically continue into the next project phase.



When uncertain about a potentially architectural or destructive change, stop and ask for confirmation.



\---




\# Phase 0 — Agent Operating System

Crypto Radar runs its own multi-agent operating system. ChatGPT is PROJECT LEAD. The three agent identities below are authoritative; the single source of truth is agents/identities.json. Phase 0 only defines identity, task, report, startup and handoff protocols. It does not change application behavior.



\## 1. AGENT IDENTITY

Stable identities (authoritative store: agents/identities.json):

\- OC-LEAD = OpenCode = Lead Architect + System Implementation

\- CL-UI = Cline = UI/UX + Feature Developer

\- AI-REF = Aider = Refactoring + Maintenance + Testing

Every task MUST contain: TASK ID, AGENT ID, AGENT NAME, AUTHORIZED ROLE, PROJECT, EXPECTED OUTPUT.

Before working, every agent MUST validate these values with:

node scripts/agent-os.mjs task <file> [--agent-id <AGENT_ID>]

If the task is assigned to another agent, the agent MUST NOT execute it. Return exactly:

WRONG AGENT

Expected Agent: OC-LEAD

Current Agent: CL-UI

Task ID: CR-P0-001

Action: STOP

Reason: This task is not authorized for this agent.

Do not attempt to "help anyway."



\## 2. TASK / PROMPT PROTOCOL

ChatGPT authors every task using the template tasks/TEMPLATE.md and records it in tasks/index.json. Required header fields: TASK ID, PHASE, PRIORITY, AGENT ID, AGENT NAME, AUTHORIZED ROLE, PROJECT, EXPECTED OUTPUT, OBJECTIVE, SCOPE, DO NOT, DEPENDENCIES, REQUIRED VERIFICATION.

Task IDs are unique and traceable: CR-<PHASE>-NNN.

Each task specifies a dedicated branch: <chore|feature|fix|test|refactor>/<short-slug>.

Agents never self-assign tasks and never start unrelated work.



\## 3. OUTPUT / REPORT PROTOCOL

Every agent report MUST include: TASK ID, AGENT NAME, AGENT ID, STATUS, BRANCH, COMMIT, FILES CHANGED, TEST RESULTS, BLOCKERS, NEXT RECOMMENDED ACTION.

A report that does NOT contain valid task + agent identification MUST be treated as UNVERIFIED and re-submitted.

Validate reports with:

node scripts/agent-os.mjs report <file> [--agent-id <AGENT_ID>]



\## 4. DAILY PLUG-AND-PLAY STARTUP

Windows one-click launcher:

startup\START-AGENTS.bat

It verifies repository state, current branch, agent identities, git/node availability, and project dependencies; prints the agent identities and validates current task headers; warns when on master. No application work is performed by the launcher.



\## 5. HANDOFF + VERIFICATION LIFECYCLE

CHATGPT → TASK CREATED (tasks/) → AGENT ASSIGNED → AGENT VALIDATES IDENTITY → AGENT WORKS ON TASK BRANCH → AGENT RUNS VERIFICATION → AGENT REPORT → CHATGPT VERIFIES REPORT → NEXT TASK / NEXT AGENT → PR → MASTER → VERCEL

ChatGPT decides priority, architecture, task breakdown, dependencies, assignment, prompts, verification, the next agent and the next task. Agents complete only their assigned task, push only their task branch, and open a PR to master; merging is authorized by the lead.

