# Phase 3 — React Componentization Plan

- TASK ID: CR-P3-001
- AGENT: OpenCode / OC-LEAD (Lead Architect + System Implementation)
- STATUS: PLANNED (planning-only task; no application source code changed)
- BRANCH: task/CR-P3-001-react-componentization-plan
- Scope: `liquidity-radar-react/` (React + Vite + TypeScript app)
- Companion doc: root `AGENTS.md` (Phase 0 + Phase 3 rules are authoritative)

---

## 1. Purpose

Phase 3 converts the existing working, mostly imperative React app into clean,
reusable React components — **incrementally**, preserving current behavior at every
step. This document is the architecture plan and task sequence. It is deliberately
planning-only: no app source code is modified by this task.

### Constraints (from AGENTS.md, must survive every slice)

- Preserve: market data, WebSocket streams, charts, indicators, news, analysis,
  chat, search, storage, theme system, Vite configuration, production deployment.
- No giant one-shot componentization. One logical slice per commit, verified
  after each unit.
- No new state-management library without approval (Redux/Zustand/Jotai etc. are
  NOT approved — the project uses plain React state + engine callbacks).
- No replacing the charting system (lightweight-charts 4.1.3), data services,
  frameworks, or the 62 KB `index.css` (class names must survive byte-identical).
- No rewriting the whole application. Preserve the product design.
- Every slice: lint + build + relevant smoke tests + focused commit + push branch
  + PR to master. Never merge self. Never work on master.

---

## 2. Current Architecture Map

```
index.html (#root)
  └─ src/main.tsx            React 19 root; StrictMode deliberately OFF
       └─ src/App.tsx        renders <Shell/>, then useEffect → dynamic
          │                     import('./engine/app') → initApp()
          └─ src/components/Shell.tsx   (~36 KB mechanical JSX port of the
                 original index.html <body>; every #id/.class preserved)
                     ▲
                     │ React renders STATIC shell once; engine owns life.
                     │
         src/engine/app.ts   imperative orchestrator (8 KB, @ts-nocheck seam)
                     │  wireUserActions() / wireMarketHooks() / init()
                     ▼
      feature modules (features/*)   services (services/*, api/*)   utils/*
      ┌───────────────────────────   ─────────────────────────   ─────────────
      │ charts/chartRender.ts        store.ts  (shared mutable state)
      │ charts/multiCharts.ts        market.ts (md store/monitor/cache/debug)
      │ signals/signals.ts           marketData.ts (REST polling + hooks)
      │ news/newsFeed.ts             streams.ts (3 WebSockets + callbacks)
      │ chat/chat.ts                 storage.ts (localStorage + cache)
      │ analysis/analytics.ts        api/client.ts (jget/jget2/rlSchedule:
      │   (+ calendar.ts)               dedup, throttle 90ms, retry/backoff)
      │ snapshots/snapshots.ts
      │ portfolios/portfolio.ts      utils/dom.ts ($, showToast, openModal…)
      │ alerts/alerts.ts             utils/format.ts, coins.ts, indicators.ts
      │ search/search.ts             types/market.ts, constants/market.ts
      │ theme/theme.ts
      │ aiScanner/aiScanner.ts
      │ bubbles/bubbles.ts
      │ heatmap/heatmap.ts
      │ keyboard/keyboard.ts
      └───────────────────────────
```

### Rendering model (the heart of the problem)

React currently renders the Shell **once**. Everything after that is imperative:

- The engine and feature modules read/write the DOM directly via
  `$('#id')` (`utils/dom.ts`), mostly `textContent`/`innerHTML` swaps.
- Live data flows from `services/` into DOM through **injected callback**
  surfaces (REST polling hooks in `marketData.ts`, WS callbacks in
  `streams.ts`) that the engine wires to render functions in step
  `renderLoop()` (`requestAnimationFrame`).
- Generated HTML uses **window globals** and inline handlers:
  `window.setSymbol`, `window.switchTab`, `switchSigMode`, `onSigSearch`,
  `analyzeSigCoin`, `closeModal`, `addPosition`, `addAlert`, `enableAlerts`,
  `removePosition`, `removeAlert`, `selectPalette`, `mcChangeInterval`,
  `mcChangeSymbol`, `mcAdd`, `mcRemove`, `mdToggleDebug` — plus inline
  `onclick="setSymbol(...);switchTab('radar')"`, `onclick="removePosition(i)"`,
  and `onchange="mcChangeInterval(...)"` in generated markup.
- `charts/chartRender.ts` holds a live lightweight-charts instance (`#chart`)
  plus a canvas drawing layer and order-book/heatmap renders.
- `heatmap.ts` and `snapshots.ts` own `<canvas>` F&G / liquidation heat-map
  loops (1 s / continuous) that bypass React entirely.

### State model

Two overlapping mirrors:

1. `services/store.ts` — single mutable `state` object (`symbol`, `tab`, `tf`,
   `tickers`, `candles`, `ob`, `fr`, `oi`, `fg`, `whales`, `wsOpen`, `ctxCache`,
   `mem`, … index signature). Mutation is silent: **no pub/sub today**.
2. `services/market.ts` — normalized/validated mirror `md` (tickers, candles,
   ob, fr, oi, health, cache, debug) fed through the same REST/WS paths.

React has no bridge into either. This is the main architectural seam that
componentization must cross.

---

## 3. Componentization Strategy

### 3.1 Golden rule

> A React component may NOT own a DOM region that the engine/features write into
> imperatively — unless that write is converted to a React state commit at the
> same time.

If React re-renders a subtree it owns, it will clobber engine `textContent` /
`innerHTML` writes inside it. Three safe patterns:

- **P0 Isolated widget** — the region has its own state + fetch path and the
  engine never writes into it (e.g., coin search results). Convert freely.
- **P1 Commit channel** — the feature module keeps computing data but, instead of
  writing `innerHTML`, commits it to a tiny subscription bridge; the new React
  component re-renders from that bridge. Engine behavior, REST/WS paths, CSS
  classes all unchanged.
- **P2 Host island** — React owns the *wrapper* card/container only; the
  engine keeps owning an unmanaged inner host node (e.g., `<div id="chart">`).
  Safe **only** while React never renders children into that node. Use for
  canvas/ticker-heavy regions that are impractical to unhook yet, and mark them
  LATE.

### 3.2 The one new architectural piece (small, approved scope)

A minimal **commit channel** (~30 lines, no new library) in
`src/components/bridge.ts`:

```ts
// subscribers: Map<channel, Set<(payload)=>void>>
export function commit(channel, payload) /* feature → React */
export function useCommit(channel, deps)  /* React → re-render on commit */
```

Per-slice recipe:

1. Extract the DOM template from the feature module into a new component
   (`src/components/<feature>/<Name>.tsx`) keeping all `id`/`class` exactly.
2. Feature module keeps owning data + business logic; replace only its
   `el.innerHTML = …` with `commit('<channel>', data)`.
3. Component owns presentation; class names and data attributes byte-identical.
4. Wire window-global + inline-handler call sites to the component's callbacks
   **in the same slice** (or keep the global, which now just calls the compute
   function and the component picks up the commit — no double-render risk).
5. Verify: same screenshot/DOM, lint, build, smoke, commit.

This pattern converts "engine writes HTML" into "engine commits data" with no
ordering changes, no WS rework, no `state` refactor.

---

## 4. Component Candidates

| # | Candidate | Source today | Engine writes today? | Extract → | Risk |
|---|-----------|--------------|-----------------------|-----------|------|
| C1 | `CoinSearchWidget` | `features/search/search.ts` | no (self-contained) | NOW + P0 | LOW |
| C2 | `Footer` | Shell static div | no | NOW + P0 | LOW |
| C3 | `ThemeToggle` + `PalettePicker` | `features/theme/theme.ts` | yes (pick one: palGrid) | LATER + P1 | MED |
| C4 | Header cluster (`StatusPill`, `TickerBar`, `ActionButtons`) | Shell + engine (`setWsStatus`, `mdPill`, `renderTicker`, `onTickerLive`) | yes — frequent | AFTER C1–C3 + P1 | MED-HIGH |
| C5 | `TabNav` (tabs + section visibility) | Shell + `engine switchTab()` | yes — toggles `active`/`aria-selected` | LATE + P1 (needs switchTab migration) | MED-HIGH |
| C6 | Radar `HeroCard` | `charts/chartRender.ts renderHero` + `onHero` (1 s) | yes | LATER + P1 | MED |
| C7 | Main `ChartCard` (lightweight-charts + toolbar + draw layer) | `charts/chartRender.ts initChart/toolbar/resize` | yes (canvas host + tool state) | LATE + P2 (island) | HIGH |
| C8 | `OrderBookCard` | `chartRender.renderOB` + depth WS `onOB` | yes | LATER + P1 | MED |
| C9 | `IndicatorPanel` (EMA/SMA/BB/VWAP/vol/RSI/MACD) | `chartRender` overlay writes | yes | LATER + P1 | MED |
| C10 | `PortfolioTab` | `features/portfolio/portfolio.ts` | yes — `renderPortfolio` on ticker loop | CR-P3-004 + P1 | MED |
| C11 | `AlertsModal` | `features/alerts/alerts.ts` | yes — render on add/remove/enable | LATER + P1 | MED |
| C12 | `SignalsTab` (auto grid + search/analysis) | `features/signals/signals.ts` (2 min loop) | yes | LATE + P1 | HIGH |
| C13 | `NewsTab` (+ `ForexCalendar`) | `features/news/newsFeed.ts` + `analysis/calendar.ts` | yes | LATE + P1 | HIGH |
| C14 | `ChatTab` (log, chips, composer) | `features/chat/chat.ts` | yes — `pushMsg` | LATE + P1 | HIGH |
| C15 | `MarketTab` (Top10, Celebs, Overview, MemeUniverse) | `snapshots.ts` + `bubbles.ts` | yes | LATER + P1 | MED-HIGH |
| C16 | `BubblesTab` (bubble field + filters) | `features/bubbles/bubbles.ts` | yes | LATER + P1 | MED-HIGH |
| C17 | `Analysis` (LiqZones, LiqHeatmap, VolumeProfile) | `analytics.ts` + `heatmap.ts` (canvas 1 s) | yes | LATE + P2/P1 | HIGH |
| C18 | `MultiChartTab` (panel grid) | `multiCharts.ts` | yes | LATE + P2/P1 | HIGH |

Slices proceed LOW → MED → HIGH only after the commit-channel recipe is proven
by a LOW slice.

---

## 5. Recommended Component Tree (target)

```
App
├─ Header
│  ├─ Logo
│  ├─ TickerBar            (P1, engine commits ticker rows)
│  ├─ StatusPill           (P1, engine commits status)
│  ├─ ActionButtons        (Alerts / Palette / Theme toggles)
│  └─ TabNav               (P1, owns tab + section visibility)
├─ CoinSearchWidget        (P0)   ← first slice
├─ Main                    (tab-section hosts; converted one tab at a time)
│  ├─ RadarTab
│  │  ├─ HeroCard          (P1)
│  │  ├─ ChartCard         (P2 island, hosts #chart + toolbar)
│  │  ├─ OrderBookCard     (P1)
│  │  ├─ IndicatorPanel    (P1)
│  │  ├─ FngGauge          (P2 canvas island)
│  │  ├─ ForecastCard      (P1)
│  │  └─ WhaleTracker      (P1)
│  ├─ PortfolioTab         (P1)
│  ├─ MultiChartTab        (P2 grid of ChartPanel islands)
│  ├─ SignalsTab           (P1: SignalScanner + SignalAnalysis)
│  ├─ MarketTab            (P1: Overview, TopCoinsTable, CelebrityGrid,
│  │                              MemeUniverse)
│  ├─ BubblesTab           (P1: BubbleFilters + BubbleField)
│  ├─ AnalysisTab          (P1/P2: LiqZones, LiqHeatmap, VolumeProfile)
│  ├─ NewsTab              (P1: BreakingBox, ForexCalendar, NewsFeed,
│  │                              TrendingList, SentimentGauge)
│  └─ ChatTab              (P1: ChatLog, ChatChips, ChatComposer)
├─ Footer                  (P0)
├─ Modals                  (PortfolioModal, AlertsModal, PaletteModal — P1)
└─ Toast                   (P1)
```

Components may only depend on `features/*`, `services/*`, `utils/*`, `types/`,
`constants/`. Features/Services must never import `components/*` (no cycles,
layering enforced by review; engine file remains lint-ignored).

---

## 6. Incremental Implementation Order

Each row is a separate task (new task ID), a focused commit, pushed branch, and
PR to master. The FIRST slice (CR-P3-002) is the smallest, safest, self-contained
unit — it proves the cookbook and gives the team a zero-risk reference.

| ID | Slice | Type | Risk | Notes |
|----|-------|------|------|-------|
| CR-P3-002 | `CoinSearchWidget` (C1) | feature | LOW | P0. Self-contained; no engine coupling. |
| CR-P3-003 | `Footer` + establish `components/` layout + `bridge.ts` (commit channel) | chore/refactor | LOW | Adds the seam (P1) so later slices have a home. |
| CR-P3-004 | `PortfolioTab` (C10) | feature | MED | First P1 slice: converts `renderPortfolio` → commit; keeps `addPosition`/`removePosition` globals working. |
| CR-P3-005 | `AlertsModal` (C11) | feature | MED | Same pattern as portfolio; localStorage kept. |
| CR-P3-006 | `ThemeToggle` + `PalettePicker` (C3) | feature | MED | Keeps `applyPalette`/CSS-var mechanism untouched; only picker grid + button become React. |
| CR-P3-007 | Radar `HeroCard` (C6) | feature | MED | P1 on 1 s `onHero` commits. |
| CR-P3-008 | `OrderBookCard` (C8) | feature | MED | P1 (30 s REST + depth WS). |
| CR-P3-009 | `IndicatorPanel` (C9) | feature | MED | P1 overlay value commits. |
| CR-P3-010 | `TickerBar` + `StatusPill` (C4) | feature | MED-HIGH | Frequent commits; must batch updates (only re-render on change). |
| CR-P3-011 | `MarketTab` (C15) | feature | MED-HIGH | Overview/Top10/Celebs/MemeUniverse; snapshots + bubbles data. |
| CR-P3-012 | `BubblesTab` (C16) | feature | MED-HIGH | Filters + bubble field. |
| CR-P3-013 | `ForecastCard` + `WhaleTracker` | feature | MED | Small radar-card slices. |
| CR-P3-014 | `TabNav` migration (C5) | refactor | MED-HIGH | `switchTab` becomes React state; engine `switchTab` global updated to dispatch. |
| CR-P3-015 | `SignalsTab` (C12) | feature | HIGH | 2-min scan loop → commits; analysis search view. |
| CR-P3-016 | `NewsTab` + `ForexCalendar` (C13) | feature | HIGH | newsFeed + calendar; largest single tab. |
| CR-P3-017 | `ChatTab` (C14) | feature | HIGH | brain (`generateReply`/`signalData`) stays a service; only DOM becomes React. |
| CR-P3-018 | Main `ChartCard` island (C7) | feature | HIGH | P2: React owns wrapper + toolbar state; `#chart` stays host island; verify resize/fullscreen/draw layer. |
| CR-P3-019 | `MultiChartTab` (C18) | feature | HIGH | P2 grid of panel islands; `mcChange*`/`mcAdd`/`mcRemove` become React. |
| CR-P3-020 | `Analysis` (C17) | feature | HIGH | LiqZones/LiqHeatmap/VolumeProfile; heatmap canvas stays island. |
| CR-P3-021 | `SignalsTab` / `NewsTab` / others: window-global cleanup | chore | MED | Sweep remaining inline `onclick=`/`onchange=` → React handlers; shrink `exposeGlobals`. |
| CR-P3-022 | Final audit: `Shell.tsx` trim, engine decoupling report | chore | MED | Last slice: remove now-dead static markup; confirm parity. |

Ordering rationale: LOW-first to prove cookbook → MED server/feature cards (no
canvas, bounded update frequency) → HIGH canvas/ticker-loop tabs last.

---

## 7. Risk Analysis

### 7.1 Critical (must not break)

| Risk | Why | Mitigation |
|------|-----|------------|
| React re-render clobbers engine DOM writes | Engine owns textContent/innerHTML in regions React may own | Golden rule (3.1); P1 commits; P2 islands only where React never renders children |
| WebSocket duplication on mount | StrictMode double-mount doubles 3 WS + charts | StrictMode stays OFF (`main.tsx`); slices must not remount engine subtrees |
| `state` has no pub/sub | React can't observe engine mutations | `bridge.ts` commit channel; no store refactor needed |
| Inline `window.on*` handlers in generated HTML | Converting a component without converting its handlers breaks clicks | Same-slice wiring (3.2 recipe step 4); keep `exposeGlobals` until migration complete |
| lightweight-charts instance identity | Creating a second chart on `#chart` crashes layout | Only create once in `initChart`; ChartCard is P2 island, never re-created |
| Canvas loops (`heatmap.ts` 1 s, F&G, bubbles) | High-frequency writes into React-managed regions | Keep as islands (P2) or commit throttled snapshots; never re-render on each frame |
| 62 KB `index.css` drift | Class/ID mismatch silently breaks styling | Extracted templates copy class/id tokens verbatim; no CSS touched during Phase 3 |
| Smoke gates tied to DOM (`9 tab buttons`, `≥8 canvases`, globals present) | Conversion could drop a node and fail gate | Smoke is parity check on converted slices; keep node counts constant per slice |

### 7.2 High / notable

- **`switchTab` and section visibility** — currently imperative class toggles
  both on `.tab-btn` and `.tab-section`; converting tabs (CR-P3-014) touches
  engine behavior. Defer until commit channel is proven; one focused refactor.
- **Signals auto-scan loop** mutates `signalData` and re-renders grid every 2 min —
  the grid commit must be change-detected to avoid pointless re-renders.
- **Chat / news append-only logs** — append-style growth in React state is fine,
  but must cap or keep `pushMsg` behavior identical (scroll pinning).
- **Multi-chart**: each panel runs its own WS + REST; panel count/keyed
  reconciliation is the main risk (React keying must mirror `mcChange*` state).
- **Cross-feature imports** (features → features: signals→charts, chat→signals/
  snapshots, analysis→heatmap) must not create feature→component cycles.

### 7.3 Preserved-externally

No API/endpoint/message-format changes. No env/secret handling changes. No
dependency additions. Vercel build pipeline (`npm run build`) untouched.

---

## 8. Verification Strategy

Per slice (mandatory, before commit):

1. `npm run lint` — must exit 0 (engine folder remains lint-excluded).
2. `npm run build` — must exit 0 (`tsc -b && vite build`).
3. `npm run smoke` — Chromium smoke test via Chrome DevTools Protocol; gates:
   ticker, hero price, sym select, live streams, canvases ≥ 8, tab activation,
   window-globals presence, **no app-level JS errors**. Report pass/fail;
   never claim success without executing.
4. Manual parity pass on the converted slice: run dev server, exercise both old
   and new interactions (click paths, keyboard, resize), compare rendered DOM
   class/id tokens for the converted region only.
5. `git diff` / `git status` review — no unintended files; only slice-scoped
   changes (see AGENTS.md multi-agent ownership).
6. Focused commit message (conventional), push branch, PR → master; never merge
   self.

Post-migration audit (CR-P3-022): full parity walk, dead-markup trim, final
report of remaining engine-owned DOM.

---

## 9. Recommended First Slice — CR-P3-002 (`CoinSearchWidget`)

Chosen because it is the only non-trivial UI feature the engine never touches:
lowest risk, proves the cookbook, immediately reusable.

- **Behavior to preserve**: fetch `exchangeInfo` once; type-ahead filter of
  `COINS`; keyboard (ArrowUp/Down/Enter/Escape) navigation; click-outside to
  close; result `onclick → setSymbol(...)`; class names
  (`search-wrap`, `search-box`, `search-results`, `search-item`, …).
- **Sub-slice format** (in place of a full task record here):
  it becomes its own chapter/task file — see `tasks/CR-P3-002.md` (created at
  kickoff by the lead, not by this planning task).
- The slice must leave `window.setSymbol` intact and touch **no other file**
  outside `src/components/search/`, `src/App.tsx`/`Shell` swap-in, and
  `features/search/index.ts` (search.ts removed only if fully replaced).

---

## 10. Do-Nots (Phase 3 hard boundaries)

- No React StrictMode re-enable.
- No new state-management or charting library.
- No engine `@ts-nocheck` removal / no wholesale engine rewrite.
- No changes to `api/*`, `services/*` polling, streams, or trade logic during
  component slices (allowed only in dedicated refactor tasks with approval).
- No CSS refactoring, formatting pass, or class renames.
- No window-global removal until its last call site is converted.
- No Phase 4 testing work inside Phase 3 slices (separate tasks).

---

## 11. Open Questions (for lead review)

1. Should C4 (TickerBar/StatusPill) be one combined slice or split?
   (Recommend split — different update cadences.)
2. Confirm `ChartCard` as P2 island vs. full P1 commit (P2 keeps
   lightweight-charts simpler; P1 enables React-resizable toolbar sooner).
3. Ownership: `SignalsTab` etc. — Cline (CL-UI) may take feature-level DRA, but
   each still goes through OC-LEAD architecture review per AGENTS.md.
4. Branch naming for implementation: propose
   `feature/p3-0NN-<slug>` for slices that touch `components/`, matching the
   task ID for traceability.