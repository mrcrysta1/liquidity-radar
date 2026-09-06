# CR-P3-002 — CoinSearchWidget UI/UX Implementation Specification

TASK ID: CR-P3-002
AGENT: CLINE
AGENT ID: CL-UI
ROLE: UI/UX + Frontend Developer
PROJECT: Crypto Radar / Liquidity Radar React
TYPE: Phase 3 — first React componentization slice (documentation only; NOT implemented)

Purpose: an implementation-ready UI/UX specification for the `CoinSearchWidget`
slice. Governed by root `AGENTS.md` and the Phase 3 plan at
`docs/PHASE3-COMPONENTIZATION-PLAN.md` (CR-P3-001). All behavior/classes verified
against the actual source in this repository.

---

## 0. Current State (verified against source)

The search widget is the app's global type-ahead coin search under the header.

- Markup lives in React already: `src/components/Shell.tsx` lines 35-39
  (`<div class="search-wrap">`, `.search-icon`, `#coinSearch` input,
  `#searchResults` container).
- Behavior lives in the engine-owned feature module:
  `src/features/search/search.ts` (`initSearch()`), re-exported by
  `src/features/search/index.ts`.
- `initSearch()` is invoked by the engine at boot:
  `src/engine/app.ts` line 158 (inside `init()` after `connectStreams()`).
- The global `/` shortcut (focus + select) lives in
  `src/features/keyboard/keyboard.ts` lines 37-42.
- CSS lives in `src/index.css` lines 862-888 (`search-wrap`, `search-box`,
  `search-icon`, `search-results`, `search-item`, `si-*`, `search-count`).
- Selecting a result calls `setSymbol(sym)` from
  `src/features/actions/userActions.ts` (global `window.setSymbol`).

Engine/DOM ownership: search is a **P0 isolated widget** — the engine never
writes into `#searchResults`. It is fully self-contained in a feature module.
Convert freely; this is the lowest-risk first slice.

---

## 1. Component Responsibility

`CoinSearchWidget` is a presentational + stateful component that owns the global
coin search box and its dropdown results panel.

Responsibilities:
1. Render the input (`#coinSearch`) and results panel (`#searchResults`) with the
   preserved class names so existing CSS and existing global shortcuts keep working.
2. Preload the Binance USDT `exchangeInfo` symbol list once (module-level cache).
3. Provide type-ahead filtering (base/symbol substring match, case-insensitive),
   capped at 30 results.
4. Render each result row: symbol, pair, live price, 24h change, popular-coin
   highlight — using the existing utility functions, NOT hand-rolled HTML.
5. Track open/closed panel state; handle the three ways to close: empty input,
   outside click, and selection.
6. On select, call the exported `setSymbol(sym)` action, clear the input, close
   the panel.

Out of scope / NOT owned by the widget:
- Global keyboard shortcut `/` activation (stays in `features/keyboard`).
- All chart/market/stream rendering (engine-owned).
- The Signals-tab search (`#sigSearchBox` / `onSigSearch`) — a different feature.

---
## 2. Props / State / Events

### Props (intended, all optional — zero required props to preserve boot order)
Suggested minimal or empty props. If a prop surface is desired for later reuse:
- `placeholder?: string` — default `'Search any coin... (e.g. PEPE, SOL, DOGE, PEPEPE, TRUMP)'`
- `maxLength?: number` — default `50`
- `onSelect?: (sym: string) => void` — if provided, called instead of/in addition
  to the default `setSymbol(sym)`.

Recommendation: keep the first slice **prop-free** (or a single optional
`onSelect`) to avoid entangling with the engine boot sequence.

### Internal state (useState / useReducer; no new state library — Phase 3 do-not)
- `query: string` — current input value.
- `open: boolean` — whether the results panel is shown.
- `symbols: SearchSymbol[]` — preloaded Binance list (or empty until fetch).
- `index: number` — active result index for keyboard navigation (-1 = none).

### Module-level (outside component) state
- `let allBinanceSymbols: SearchSymbol[]` — fetched once, shared across remounts
  (preserve existing behavior: the fetch happens once per page load).

### Events handled
- `input` on `#coinSearch` — update query, recompute matches, update open state,
  rendered rows.
- `focus` on input — if query non-empty, open panel.
- `keydown` on input — ArrowUp / ArrowDown / Enter / Escape (see section 5).
- Click on a result row — select.
- `click` on `document` — close if the click target is outside `.search-wrap`
  (formerly the global `document.addEventListener` in search.ts line 62).

---

## 3. Existing Styles / Classes to Preserve (verbatim)

Do NOT refactor, rename, or restyle. Preserve these exact classes (from
`src/index.css` 862-888). The React component must output these so existing CSS
and any external selectors keep matching:

- `.search-wrap` — wrapper row (position: relative; max-width 1400px; centered; padding 10px 14px 0)
- `.search-icon` — magnifier, absolutely positioned, non-interactive
- `.search-box` — the text input (`#coinSearch`)
- `.search-box:focus` — primary border + focus ring
- `.search-box::placeholder` — dim placeholder color
- `.search-results` — dropdown panel (`#searchResults`); `display:none` by default; `.show` reveals it
- `.search-results.show` — reveal class
- `.search-item` — a result row (`.search-item[data-sym=...]`)
- `.search-item .si-sym` — symbol cell, inline style for popular highlight color
- `.search-item .si-name` — pair label
- `.search-item .si-price` — price
- `.search-item .si-chg` — change HTML
- `.search-count` — footer counter / "No matches" row

Also preserve the **inline style** on `.si-sym`: `color: var(--cyan)` for
popular/aliased coins, else `var(--muted)`.

The change-format helper `chgHtml(p)` (returns `<span class="chg up|down|flat">…`)
from `src/utils/format.ts` must be reused; the result row already depends on the
existing `.chg` classes. In a JSX port, render the change as a `<span class=…>`
(React will render it directly; do not inject this helper's HTML string as-is —
map it to JSX).

---
## 4. Search Interaction Behavior (preserve exactly)

1. On mount, fetch `https://api.binance.com/api/v3/exchangeInfo` once; filter
   `status === 'TRADING'` and `symbol.endsWith('USDT')`; keep `{ sym, base,
   quote, prec }` (prec = PRICE_FILTER tickSize or `'0.01'`); sort by
   `base.localeCompare`; cache at module level. Silently ignore fetch errors
   (empty list → "No matches" path).
2. On empty query (after trim) → do NOT show panel.
3. On query of length >= 1, compute matches where
   `base.toLowerCase().includes(q) || sym.toLowerCase().includes(q)`, slice(0, 30).
4. If no matches → show a single `.search-count` row: `No matches for "<q>"`.
5. If matches → render up to 30 `.search-item` rows (symbol, `base/USDT`, live
   price from `state.tickers[sym].last` via `pfmt`, change via `chgHtml(pct)`,
   falls back to `—` / flat when no ticker) + a footer `.search-count`:
   `"<N> pairs found"`.
6. Popular highlight: check `COIN_ALIASES[base.toUpperCase()]` truthy OR
   `TOP16.includes(base.toUpperCase())` → cyan symbol, else muted.
7. On select (click, or Enter): call `setSymbol(sym)`, clear input, close panel.
8. Click outside `.search-wrap` → close panel.

---

## 5. Keyboard Behavior

Preserve the existing shortcut that activates the search (stays in
`features/keyboard/keyboard.ts`, lines 37-42): pressing `/` (when not typing in
an input/textarea/select and not ctrl/meta/alt) calls `focus()` + `select()` on
`#coinSearch`.

Inside the widget, add the following keydown handling (this is the one behavior
gap in the current engine module — today it has none):
- `ArrowDown` — move active index down (wrap or clamp to last), highlight row,
  consider scrolling into view.
- `ArrowUp` — move active index up (wrap/clamp to first), highlight row.
- `Enter` — if an index is active, select that result (`setSymbol` + close +
  clear). If no index, do nothing (no-op like today).
- `Escape` — close the panel and clear the active index (do not blur if not
  needed; matches the global Escape handling which currently only handles
  fullscreen + modals — confirm no conflict: global Escape handler runs on
  `document` and will also run; it does not touch the search panel, so add
  `stopPropagation` on the search input's Escape is optional but safe if needed).

Because the component is self-contained, manage the active index in local state
and apply a `.search-item` highlight (reuse `:hover` visual via an `.active`
class or `background` inline — do not add new CSS unless required; prefer a
temporary `class` attribute only if it cannot reuse an existing selector).

---

## 6. Responsive Behavior

The current CSS already handles responsiveness; no changes required:
- `.search-wrap` centered, `max-width: 1400px`, fluid width.
- `.search-results` is `position:absolute; left:14px; right:14px` within the
  wrapper, so it spans the input width on both desktop and mobile.
- At `max-height:320px; overflow-y:auto`, the panel scrolls on small screens.
- `index.css` media rule keeps `.search-wrap` padding within
  `.top-inner`/`.nav.tabs` horizontal padding on small widths.
- The `si-name` cell has `overflow:hidden; text-overflow:ellipsis` so long pair
  labels truncate on narrow screens; `si-sym`/`si-price`/`si-chg` are
  `flex-shrink:0`.

Do not add a mobile-specific search UI; keep the single fluid input.

## 7. Accessibility Considerations

Current state (points to preserve + improvements that are additive and safe):
- The input has no `<label>`; it relies on a `placeholder`. **Additive**: provide
  an accessible name (e.g. `aria-label="Search coins"` on the input) without
  altering layout/classes.
- The dropdown is not associated with the input. **Additive (recommended)**:
  use `role="combobox"` + `aria-expanded` on the input and
  `role="listbox"` with `aria-selected` / `aria-activedescendant` on the panel,
  OR at minimum `role="listbox"` on the results container. Keep this non-breaking.
- Result rows: give each `.search-item` `role="option"` with an id referenced by
  `aria-activedescendant`, and make them keyboard+click operable. `.search-item`
  is a `<div>` today (non-focusable) — keyboard nav is internal via Arrow keys,
  so manual focus management on the panel is acceptable; ensure the active row
  is visually distinct for sighted keyboard users.
- Color is not the only signal for price change (uses sign text `+/-` plus `.chg`
  class), so no change needed there.
- The global search is not a modal, so no focus trap / `aria-modal` needed.

---

## 8. Integration Boundary with Existing Engine/Search Module

### Ownership
- `#searchResults` is **never written by the engine** (verified: only
  `features/search/search.ts` writes it). Fully safe to convert.
- Keep the input element `id="coinSearch"` and the panel `id="searchResults"`.
  The keyboard module (`keyboard.ts`) references `$('coinSearch')` directly —
  the id must remain the single source the shortcut focuses.
- Keep `window.setSymbol` intact. The widget should call the exported
  `setSymbol` from `features/actions/userActions.ts` (which the engine wires),
  not bypass state.

### Boot order (critical)
- `App.tsx` mounts `<Shell/>`, then dynamically imports the engine and runs
  `initApp()` (App.tsx lines 10-12). The engine's `init()` calls
  `initSearch()` at app.ts:158.
- **Migration must keep the engine boot intact.** Two options:
  - (A) Replace `initSearch()` feature module with the React widget, and have
    the widget own state; remove the `initSearch()` call (or make it a no-op) —
    preferred, P0-clean.
  - (B) Keep `initSearch()` as-is and mount the widget as a pure pass-through.
    Not recommended.
- The `/` shortcut will still find the input because the id is preserved.

### Files the widget may read (feature/service/util boundaries)
- `src/services/store.ts` — `state.tickers` (read-only) and `state.symbol`.
- `src/features/actions/userActions.ts` — `setSymbol`.
- `src/constants/market.ts` — `COIN_ALIASES`, `TOP16`.
- `src/utils/format.ts` — `pfmt`, `esc` (for the "No matches" message), and reused
  change semantics via `chgCls`/`chgHtml` mapping.
- `src/utils/dom.ts` — `$` used by the keyboard shortcut, not required by the widget.

---

## 9. Files Likely Touched During Implementation

- **Create** `src/components/search/CoinSearchWidget.tsx` (new component).
- **Create** `src/components/search/index.ts` (barrel export, optional).
- **Modify** `src/components/Shell.tsx` — replace lines 35-39 with
  `<CoinSearchWidget />` (or render the widget in the same slot). Keep the
  wrapper/classes such that the component outputs `search-wrap` etc.
- **Modify** `src/features/search/search.ts` — either removed if fully replaced
  by the widget, or reduced to data-loading only (fetch cached list) if the
  widget reuses it. Per CR-P3-001 section 9, `features/search/index.ts`
  search.ts removal is allowed only when fully replaced.
- **Modify** `src/engine/app.ts` — remove the `initSearch()` call (line 158) and
  the unused import (line 68) if the widget fully owns behavior.
- **Likely no change** `src/index.css` — preserve all search CSS (Phase 3
  no-CSS-refactor rule).
- **Likely no change** `src/features/keyboard/keyboard.ts` — keep `/` shortcut
  working via preserved `id="coinSearch"`.
- **Not touched**: `api/*`, `services/*` (streams/polling/trade logic),
  `features/signals`, balance modules, charting.

---

## 10. Acceptance Criteria

Functional parity (must match current behavior):
1. On page load, one `exchangeInfo` fetch (module-level cache); failures are
   silent (no crash, no error toast) and yield the "No matches" path.
2. Empty/whitespace query → panel closed.
3. Typing filters by base or symbol substring (case-insensitive), caps at 30.
4. Results show correct symbol, `base/USDT`, live price (from `state.tickers`),
   24h change, and cyan-vs-muted highlight using `COIN_ALIASES`/`TOP16`.
5. "No matches for <q>" shown when nothing matches; "<N> pairs found" footer
   otherwise.
6. Clicking a result calls `setSymbol(sym)`, clears the input, closes the panel.
7. Clicking outside `.search-wrap` closes the panel.
8. Keyboard: `/` focuses+selects the input (shortcut unchanged); ArrowUp/Down
   move the highlight; Enter picks the active result; Escape closes the panel.
9. `#coinSearch` and `#searchResults` ids preserved (shortcut + smoke test rely
   on them).

Verification gates (from AGENTS.md Phase 3 rules — each slice must):
- `npm run lint` passes (in `liquidity-radar-react`).
- `npm run build` (`tsc -b && vite build`) passes.
- `npm run smoke` passes (test relies on `#coinSearch`, `#searchResults`,
  `.search-item`, `.search-count` the widget retains). UNVERIFIED here — must be
  run at implementation time.
- `git diff`/status contains only slice-scoped files (no CSS/api/services/engine
  churn).
- Existing searches still navigate to the Radar tab (via `setSymbol`) and update
  price/change rows.

Conformance:
- No new state-management or charting library.
- No CSS refactor / class renames.
- No React StrictMode re-enable.
- No window-global removal except `initSearch` after its last call site is gone.

---

## Risks / Blockers / Open Questions

- Boot-order coupling: the widget replaces `initSearch()`; must confirm the
  engine's `init()` has no other dependency on that function's completion
  (it is `async` and currently un-awaited, so safe).
- Keyboard highlight: today there is no Arrow-key nav in the engine module; this
  spec ADDS it. Confirm with the lead (OC-LEAD) whether adding nav is desired for
  parity vs. strict parity-only. If strict parity is required, defer Arrow-key
  nav to a follow-up and accept "no keyboard nav inside the panel" as current
  behavior.
- The report validator (CR-P0) treats BRANCH/COMMIT/etc. as advisory; this report
  still provides them.
- `reports/` directory does not exist yet; this spec stays under `docs/` to match
  the CR-P3-001 artifact location rather than creating a new top-level structure
  without approval.