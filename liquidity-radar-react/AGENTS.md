# AI Agent Governance

## Repository Overview
This is a React + TypeScript + Vite application called "Liquidity Radar" for crypto market analysis.

## Architecture
- `src/features/` - Feature modules (actions, aiScanner, analysis, charts, heatmap, news, signals, theme)
- `src/services/` - Services (market, marketData, storage, store, streams)
- `src/types/` - TypeScript interfaces
- `src/utils/` - Utility functions
- `scripts/` - Build and smoke test scripts

## Agent Roles
- **Frontend Agent**: UI components, hooks, state management
- **Data Agent**: Market data services, API integration, WebSocket streams
- **Analysis Agent**: Technical indicators, AI scanning, calendar
- **Build Agent**: Vite config, TypeScript, linting, deployment

## Workflow
1. Agents report status updates to the orchestrator
2. Cross-agent changes require review
3. No direct commits to master
4. Feature branches only

## Rules
- Do not modify package.json dependencies without approval
- Do not change deployment config without approval
- Run lint before committing
- Run build before merging
