# CR-P3-005 — CoinSearchWidget Independent Implementation-Readiness & Regression Checklist

TASK ID: CR-P3-005
AGENT: CLINE
AGENT ID: CL-UI
ROLE: UI/UX Verification Agent (independent review)
PROJECT: Crypto Radar / Liquidity Radar React
BRANCH: task/CR-P3-005-coin-search-verification
TYPE: Review / verification checklist only — NOT an implementation.

This checklist equips the {CR-P3-004} implementer (OpenCode / OC-LEAD) and a
reviewer with an independent, ordered set of checks to prove the
`CoinSearchWidget` slice is both implementation-ready and regression-free.

Reference artifacts:
- `docs/CR-P3-002-COINSEARCH-WIDGET-SPEC.md` (the UI/UX spec, CR-P3-002)
- `docs/PHASE3-COMPONENTIZATION-PLAN.md` (CR-P3-001)
- Root `AGENTS.md` (Phase 3 Rules + Testing Requirements)
- Working implementation inspected: `liquidity-radar-react/src/components/search/CoinSearchWidget.tsx`
  plus the surviving feature module `src/features/search/search.ts`.
- Engine/files reviewed in-place: `Shell.tsx`, `features/search/*`,
  `features/keyboard/keyboard.ts`, `features/actions/userActions.ts`,
  `services/store.ts`, `constants/market.ts`, `utils/format.ts`, `index.css`,
  `engine/app.ts`, `scripts/smoke.mjs`.

How to run these checks locally (Windows PowerShell at repo root):

    cd liquidity-radar-react
    npm run lint
    npm run build
    npm run smoke          # requires build first (dist/) + a Chrome path
    # manual checks: use `npm run dev` and drive the search widget in a browser

---

## 1. UI Parity

- [ ] Search markup is rendered in the same top-level slot (between `header.top`
      and `div.container`) as today.
- [ ] The widget renders the identical element order: `.search-wrap` >
      `.search-icon` (🔍) > `input#coinSearch` > `div#searchResults`.
- [ ] Input attributes match: `type="text"`, `autoComplete="off"`,
      `maxLength={50}`, and the exact placeholder string.
- [ ] No visual jump/defocus during type-ahead: panel opens below the input
      without shifting layout (`.search-results` is `position:absolute`).
- [ ] Prices/change use the same formatting as before (`pfmt`, `.chg` classes).
- [ ] Popular vs. muted symbol color preserved (`var(--cyan)` / `var(--muted)`).

## 2. Existing CSS / Class Preservation

- [ ] No CSS was edited for this slice (Phase 3 no-CSS-refactor rule).
- [ ] These classes remain emitted exactly: `.search-wrap`, `.search-icon`,
      `.search-box`, `.search-results` (+ `.show`), `.search-item`,
      `.si-sym`, `.si-name`, `.si-price`, `.si-chg`, `.search-count`.
- [ ] `#coinSearch` and `#searchResults` ids are still in the DOM (the `/`
      shortcut and any selectors depend on them).
- [ ] No new CSS classes were introduced that reimplement existing styles
      (only `.active` for keyboard highlight is acceptable, and only if it
      cannot reuse an existing hover treatment).

---
## 3. Search Dropdown Behavior

- [ ] Panel is hidden by default (empty query → no `.show`).
- [ ] Empty/whitespace query keeps panel closed.
- [ ] Type >= 1 char filters by `base` OR full `sym` substring (case-insensitive).
- [ ] Result list is capped at 30.
- [ ] No-match case renders exactly one `.search-count` row:
      `No matches for "<q>"`.
- [ ] Match case renders rows + a `.search-count` footer: `"<N> pairs found"`.
- [ ] Clicking outside `.search-wrap` closes the panel.
- [ ] Focusing the input with a non-empty query re-opens the panel.

## 4. Mobile / Responsive Behavior

- [ ] `.search-wrap` remains fluid and centered; no fixed width introduced.
- [ ] Panel spans the input width (`.search-results` `left:14px; right:14px`).
- [ ] Long pair names truncate with ellipsis (`si-name` overflow rules intact);
      `si-sym` / `si-price` / `si-chg` do not shrink (flex-shrink:0 preserved).
- [ ] Panel scrolls within its `max-height:320px; overflow-y:auto` on small
      screens.
- [ ] No mobile-specific search UI added (single fluid input retained).

## 5. Keyboard Behavior

- [ ] `/` shortcut still focuses + selects `#coinSearch` (unchanged in
      `features/keyboard/keyboard.ts` — global `keydown` handler).
- [ ] ArrowDown moves active highlight down (wrap/clamp), panel auto-scrolls to
      keep selection visible.
- [ ] ArrowUp moves active highlight up (wrap/clamp).
- [ ] Enter selects the active row (calls `setSymbol`, clears input, closes).
- [ ] Enter with no active row does nothing (no crash).
- [ ] Escape closes the panel and clears the active index.
- [ ] No conflict with the global Escape handler (fullscreen/modals) — confirm
      search Escape does not accidentally trigger `radar-fs` removal or modal
      close unexpectedly, and vice versa.
- [ ] Typing when focus is elsewhere still triggers `/` correct (global handler
      already returns early when an input/textarea/select is focused).

## 6. Accessibility

- [ ] Input has an accessible name (`aria-label` added).
- [ ] Keyboard-operable results: Arrow keys move an `aria-selected`/active row;
      Enter selects it.
- [ ] Active row has a visible, non-color-only indicator (background change) so
      sighted keyboard users can track position.
- [ ] Pricing change remains signaled by text sign (`+/-`) in addition to color
      (`.chg` class) — color is not the only signal.
- [ ] `aria-expanded` tracks panel open state; `aria-activedescendant` points at
      the selected option id when one is active (or is omitted when inactive).
- [ ] The panel is `role="listbox"`, items `role="option"` with stable unique
      ids.
- [ ] No focus trap / `aria-modal` (widget is not a modal) — confirm none added.

---
## 7. Search Result Rendering

- [ ] Each row: symbol cell (`.si-sym`), pair label (`.si-name` = `base/USDT`),
      price (`.si-price`, `$` + `pfmt`), change (`.si-chg` via `.chg` class).
- [ ] Live price + 24h change read from `state.tickers[sym]` (not hard-coded).
- [ ] Missing ticker falls back to `—` price and `chg flat —`.
- [ ] Popular/aliased coins (`COIN_ALIASES` truthy OR `TOP16` contains base)
      highlighted cyan; others muted.
- [ ] Row carries `data-sym={sym}` and is clickable to select.

## 8. Coin Selection Behavior

- [ ] Selecting a result calls the exported `setSymbol(sym)` (from
      `features/actions/userActions.ts`) — NOT a duplicate/renamed action.
- [ ] `window.setSymbol` global stays intact (engine re-exposes it).
- [ ] After selection: input cleared, panel closed, active index reset.
- [ ] Selecting the already-active symbol still routes correctly (`setSymbol`
      handles `state.symbol === sym` by switching to the radar tab).
- [ ] Selecting a coin updates charts/hero via the existing setSymbol pipeline
      (fetchKlines/OB/FR/OI/whales + stream reconnect + render).
- [ ] `symSelect` dropdown stays in sync with the chosen symbol (setSymbol
      appends the option if missing).

## 9. DOM Ownership Boundaries

- [ ] The engine does NOT write into `#searchResults` anywhere (only the widget
      writes results).
- [ ] The old imperative listener block is gone from `features/search/search.ts`
      (no duplicated `input`/`click` listeners on the same ids).
- [ ] `features/search/index.ts` no longer re-exports a dead `initSearch`, OR if
      kept, it references a no-op — no double wiring that duplicates event
      listeners.
- [ ] No React-owned element is also driven by imperative engine code (no fight
      over `innerHTML` on `#searchResults`).
- [ ] `initSearch()` is removed from `engine/app.ts` `init()` (line ~158) and its
      import removed — no orphan boot call.
- [ ] `src/components/search/CoinSearchWidget.tsx` owns all search state; the
      shell renders the widget in place of inline search-markup.

## 10. React / Engine Integration Risks

- [ ] Widget mounts without races: React has rendered `#coinSearch` BEFORE the
      engine boots (`App.tsx` imports the engine dynamically after `<Shell/>`).
- [ ] The `/` shortcut still resolves `#coinSearch` (id preserved).
- [ ] Cleanup correctness: the document `click` listener is removed on unmount
      (no duplicate listeners across remounts).
- [ ] No React 18 StrictMode double-mount regression (Phase 3: StrictMode must
      stay disabled — confirm not re-enabled, else effects run twice and
      `exchangeInfoFetch` still guards the double fetch).
- [ ] The arbitrary-string index key `key={s.sym}` is stable (fine), and no
      Fast-Refresh stale-module issue for the module-level `allBinanceSymbols`.
- [ ] Build/TS: no `@ts-nocheck`, no `any` leaks that break `tsc -b`.
- [ ] Tailwind/Vite build includes the new `.tsx` without config change.

---
## 11. Potential Regressions (trace + verify)

- [ ] Search still works after the engine no longer calls `initSearch()`.
- [ ] No other feature imported `initSearch` (only `engine/app.ts` and
      `features/search/index.ts` did).
- [ ] The Signals-tab search (`#sigSearchBox` / `onSigSearch`) is unaffected and
      still works (separate widget — not touched).
- [ ] `/` shortcut and `?` shortcut sheet both still function.
- [ ] Tab switching, charts, ticker, portfolio, alerts, chat all still render
      (smoke gates below guard the broad surface).
- [ ] No accidental CSS/selector/class renames leaked into other features.
- [ ] Lint + build pass with the new component; no unused imports (`esc`,
      `chgHtml` from the old module should be gone if unreferenced).
- [ ] `eslint`/prettier formatting of the new file is clean (no semantic noise).

## 12. Acceptance Criteria for the OpenCode Implementation

Per `docs/CR-P3-002-COINSEARCH-WIDGET-SPEC.md` section 10 (must all hold):

1. One `exchangeInfo` fetch per page load (module-level cache); silent failure.
2. Empty/whitespace query → panel closed.
3. Substring filter (base or symbol), case-insensitive, capped at 30.
4. Correct symbol / `base/USDT` / live price / 24h change / popular highlight.
5. "No matches for <q>" vs "<N> pairs found" footers.
6. Click select → `setSymbol`, clear input, close panel.
7. Outside click closes.
8. `/` focuses+selects; ArrowUp/Down nav; Enter select; Escape close.
9. `#coinSearch` and `#searchResults` ids preserved.

Hard verification gates (AGENTS.md Phase 3 each-slice rule):

- [ ] `npm run lint` exits 0 (in `liquidity-radar-react`).
- [ ] `npm run build` (`tsc -b && vite build`) exits 0.
- [ ] `npm run smoke` — all gates pass. NOTE: the current `smoke.mjs` does NOT
      directly exercise `#coinSearch` (it checks `#tickerTrack`, `symSelect`,
      tabs, globals). It is a broad regression net, not a search-specific test.
      Treat a green smoke run as evidence of no broader regression; add a
      manual/search-specific check (#1-#9) to prove search parity.
- [ ] `git diff`/status contains ONLY slice-scoped files (new component +
      shell swap-in + search module removal + engine `initSearch` removal).
      No `api/*`, `services/*`, `index.css`, `features/signals`, or
      charting changes.

Conformance (must hold):

- [ ] No new state-management or charting library.
- [ ] No CSS refactor / class renames.
- [ ] No React StrictMode re-enable.
- [ ] No window-global removal except `initSearch` once its last call site is gone.
- [ ] `aider.conf.yml` / `.gitignore` (added separately, CR-P3-002 branch) remain
      intact; sensitive files stay protected.

---
## What OpenCode MUST NOT change (hard boundaries)

- `src/index.css` (search or any) — no edits in this slice.
- `api/*`, `services/*` (store, streams, tickers, polling, trade logic).
- `features/signals`, `features/keyboard` (`/` shortcut), `features/actions`
  (`setSymbol`, `switchTab`) signatures.
- Charting system, `engine/app.ts` beyond removing the `initSearch()` call + its
  import (no other engine refactor).
- `tsconfig*`, `vite.config.ts`, `package.json`, `eslint.config.js`.
- Global `window.*` APIs except the removal of `initSearch` only after its last
  call site is removed.
- Do NOT hand-edit `Shell.tsx` beyond swapping the search-markup block for
  `<CoinSearchWidget />`. `Shell.tsx` is normally generated by `html2jsx.cjs` —
  keep the diff minimal and explain any deviation from the generator.

## Review Notes (independent observations, not defects to fix now)

- The inspected WIP `CoinSearchWidget.tsx` replaces the imperative module well
  and preserves classes/ids/behavior; the module-level fetch cache plus a
  `Promise` dedupe (`exchangeInfoFetch`) is a reasonable hardening over the
  original single-`try` fetch.
- Keyboard nav (ArrowUp/Down/Enter/Escape) is an **additive** behavior not
  present in the original engine module. This is a deliberate UX improvement per
  the spec; confirm OC-LEAD/lead intended the addition before finalizing
  (spec section Risks flags the parity decision).
- `smoke.mjs` currently offers no search-specific assertion; a search manual
  probe (typing -> results -> select -> symbol change) is the recommended extra
  gate not covered by CI smoke.
- This checklist is advisory/review-only; it introduces no code change and
  commits only this document.