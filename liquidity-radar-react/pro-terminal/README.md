# Liquidity Radar

Free-first crypto trading intelligence terminal. Charting is the foundation; order-book liquidity, futures positioning, cross-exchange comparison and transparent scores are the product.

**Data sources used by this build: Binance, Bybit, OKX public endpoints only. No API keys, no accounts, no paid services.**

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: provider chain, indicators, liquidity score, price×OI
npm run build      # typecheck + production bundle
```

US-hosted deployments: Binance.com blocks US IPs. Set `VITE_BINANCE_SPOT=https://data-api.binance.vision` (market data only) or rely on the Bybit/OKX fallbacks, which engage automatically.

## What is implemented (Phase A–C of `docs/LIQUIDITY-RADAR-PRODUCT-ROADMAP.md`)

| Area | Status | Where |
|---|---|---|
| Provider abstraction: Primary → Fallback → Cached (STALE) → OFFLINE, circuit breaker, per-call freshness envelope | Implemented, tested | `src/core/providers/chain.ts` |
| Exchange providers: Binance, Bybit, OKX (spot klines/ticker/depth; perp funding/OI/OI history/long-short) | Implemented | `src/providers/*` |
| Freshness badges (LIVE / DELAYED / STALE / OFFLINE / FALLBACK) + provider name on every panel | Implemented | `src/components/Badge.tsx` |
| WebSocket: Binance depth diff (local L2 book with snapshot sync), aggTrade, markPrice, all-market forced orders; auto-reconnect with backoff | Implemented | `src/core/ws/*` |
| Chart: candles, 16 timeframes (1s native from Binance; 15s/30s aggregated from 1s; 1m–1M native), live candle updates from the trade stream, crosshair/zoom/pan, volume pane, indicator overlays and panes | Implemented | `src/components/Chart.tsx` |
| Indicators (deterministic, unit-tested): SMA, EMA, WMA, VWAP (session), Bollinger, ATR, RSI, MACD, Stochastic, OBV, Supertrend, Keltner, CCI, ROC | Implemented (SMA20/EMA50/EMA200/VWAP/BB/Supertrend/Volume/RSI/MACD wired to chart; the rest available in `src/core/indicators`) | `src/core/indicators` |
| Market structure: fractal swings, HH/HL/LH/LL, BOS, CHoCH, nearest support/resistance | Implemented | `src/core/analysis/structure.ts` |
| Order book: depth bars, spread, ±1% / ±2% depth, imbalance, wall detection, slippage ladder ($10k/$100k/$1M) | Implemented | `src/components/OrderBook.tsx` |
| **Liquidity Score v1** with visible components, weights and reasons | Implemented, tested | `src/core/scores/liquidityScore.ts` |
| Futures panel: funding (+annualised, countdown), OI, OI Δ4h, long/short accounts, mark/index basis, price×OI regime matrix with explanations, funding-extreme flag | Implemented | `src/components/Futures.tsx` |
| Live liquidation feed (all Binance USD-M symbols) with 5-minute long/short totals | Implemented | `src/components/Liquidations.tsx` |
| Cross-exchange radar: last price, 24h volume, spread, ±1% depth, funding per venue; gap and dispersion signals | Implemented | `src/components/CrossExchange.tsx` |
| Watchlists: multiple lists, pin, add via search (⌘K), remove (double-click %), persisted locally | Implemented | `src/store/useApp.ts` |
| Panel toggles, keyboard focus, responsive collapse | Implemented | `src/App.tsx`, `global.css` |

## Ultimate-tier feature set (each verified by headless screenshot in `docs/verified/`)

| Feature | Implementation | Limit/notes |
|---|---|---|
| 16 charts per tab | `ChartGrid` layouts 1/2/3/4/6/8/9/12/16, each with own symbol, timeframe, type, indicators; active chart drives side panels | 16 |
| Indicators per chart | 16 native + 38 Pine library + unlimited user Pine scripts | **no limit** |
| Indicators on indicators | Series-input indicators can take another indicator's output as source (EMA of RSI, BB on MACD…); dependent draws in its source's pane | — |
| 40K historical bars | Backwards pagination on scroll (Binance 1000/req, any timeframe) up to 40,000; counter in chart header | 40,000 |
| 200 parallel chart connections | One multiplexed WebSocket, live SUBSCRIBE/UNSUBSCRIBE, ref-counted per (symbol, interval), auto-resubscribe | 200 streams (Binance allows 1024/socket) |
| 1,000 price / 1,000 technical / 15 watchlist alerts | Edge-triggered rule engine, browser notifications, persisted; one batched request per cycle for all prices | limits enforced with visible message |
| Volume profile | Buy/sell split, POC, 70% value area, drawn as chart primitive on price pane | rows / VA% configurable |
| Custom timeframes | Any `N[s|m|h|d|w]` (45m, 7m, 3d…), built from the largest dividing native interval, live-updated | — |
| Custom range bars | Range bars from OHLC path; auto size = ATR(14) or user-set | approximation of tick-built bars |
| Multiple watchlists | Create, switch, pin, add via search, persisted | — |
| Bar replay | Per-chart step/play/pause/speed; indicators recompute on truncated data | — |
| Web, desktop, mobile | PWA (manifest + app-shell service worker; never caches market data), installable from Chrome/Edge/Safari | not native store apps |
| No ads | No ad or tracking code; stated in footer | — |

## Liquidation heatmap (Coinglass-style, own model)

`src/core/liquidity/heatmap.ts` + `components/LiqHeatmap.tsx`. Price × time grid where every bar opens new leveraged positions around its price; each leverage tier implies a liquidation level (long `p·(1−1/L)`, short `p·(1+1/L)`). Levels accumulate as horizontal bands, weighted by volume·price (and open-interest change when available), persist through time and are cleared when price trades through them. Three presets (Model 1 retail 10–100x, Model 2 balanced 5–50x, Model 3 low-leverage 3–10x), 12h/24h/3d/1w/1m ranges, four colormaps, liquidity-threshold slider, candle overlay, hover tooltip, strongest current clusters listed under the chart. Available as a full page (rail → Heatmap) and as a drawer tab.

**Honesty:** Coinglass's heatmap is a proprietary model and their API is paid; this is an independent estimate from free Binance data and is labelled as such in the UI. No one outside the exchange has real position data.

## v2 UI and News

- New shell: left icon rail (Terminal / News / Alerts / Watchlist), top bar with symbol pill + price, tabbed right sidebar (Order book / Liquidity / Futures / Structure), tabbed bottom drawer (Trades / Liquidations / Cross-exchange / News / Alerts), all collapsible. Manrope type, blue accent, soft 8px surfaces.
- **Live news**: 11 RSS feeds (CoinDesk, Cointelegraph, The Block, Decrypt, Blockworks, Bitcoin Magazine, CNBC, Federal Reserve, SEC, CFTC, Google News) merged, de-duplicated, refreshed every 60s, with search, category/source filters and an importance highlight (heuristic, not a prediction).
- **Economic calendar (Forex Factory)**: their public weekly JSON (`nfs.faireconomy.media/ff_calendar_thisweek.json`) rendered in Forex Factory's layout — day header rows, Time / Currency / Impact folder icon (red/orange/yellow/gray) / Event / Actual / Forecast / Previous, "next" marker, past rows dimmed, impact and currency filters, this/next week, local-time conversion, actual colored better/worse vs forecast.
- **Proxy required** for RSS and Forex Factory (no CORS on those feeds): in `npm run dev` it is built into Vite (`/api/fetch`, allow-listed hosts in `server/allowlist.mjs`). In production run `node server/proxy.mjs` (port 8787) behind the same origin, or set `VITE_PROXY_BASE` at build time. The proxy never touches exchange APIs and never stores keys.

## Pine Script engine (own implementation)

- `src/core/pine/parser.ts` + `runtime.ts`: a Pine Script v5 interpreter (lexer, indentation-aware parser, bar-by-bar evaluator with per-call-site state, exactly like Pine's series model). Paste any public Pine v5 indicator in the **Pine editor** tab, Compile, Add to chart, Save to *My scripts*. Inputs declared with `input.*` become editable fields in the *On chart* tab.
- Supported: `indicator/study`, `input.int/float/bool/string/source/timeframe`, `plot` (line/histogram/columns/area/circles/stepline, per-bar `color=`), `hline`, `plotshape/plotchar`, `var`, `:=`, `[n]` history on any expression, `if / else if / else`, `for`, `while`, user functions (single- and multi-line), tuple returns/destructuring, ternary, `and/or/not`, `na/nz/fixnan`, `math.*`, `color.new/rgb`, `str.tostring`, and `ta.*`: sma ema rma wma hma vwma swma rsi macd stoch bb bbw kc atr tr cci wpr mfi obv vwap dmi sar supertrend crossover crossunder cross highest lowest highestbars lowestbars change mom roc cum sum stdev variance dev linreg pivothigh pivotlow valuewhen barssince rising falling tsi cmo correlation percentrank median range.
- Not supported (ignored with a warning): `strategy.*` orders, `label/line/box/table` drawing, `request.security`, arrays/matrices/maps.
- **Indicator library** (`src/core/pine/library.ts`): 38 indicators written in Pine — RSI, MACD, Bollinger, MA (SMA/EMA/WMA/HMA/VWMA), EMA Ribbon, Supertrend, Ichimoku, VWAP, Stochastic, Stoch RSI, ATR, ADX/DMI, CCI, Williams %R, MFI, OBV, Volume, Awesome Oscillator, Momentum, ROC, Keltner, Donchian, Parabolic SAR, BB %B, BB Width, TRIX, Ultimate Oscillator, Chaikin MF, Aroon, Choppiness, Vortex, CMO, TSI, LinReg, Pivots, Z-Score, HV, EMA Cross. These are original implementations of the standard public formulas (the same indicators TradingView ships as built-ins), not TradingView's source. TradingView community scripts cannot be imported from their servers (ToS), but their code can be pasted.
- **No indicator limit** per chart (previous cap of 50 removed; verified with 69 on one chart).

## Not implemented yet (see roadmap phases D–K)

Scanner/screener, whale & on-chain (Alchemy/Helius/Etherscan), news/social/sentiment, macro (FRED), AI analyst, Telegram/Discord/email alert transports (browser notifications only for now), backtesting, paper trading, drawing tools, drag-to-rearrange panels, Coinbase/Kraken/KuCoin/Bitget/Gate/MEXC providers, historical liquidation/L2 recorders. None of these are stubbed as if they work.

## Honesty notes

- This build was compiled and unit-tested in a sandbox **without internet access to exchanges**; live rendering against real Binance/Bybit/OKX responses has not been verified here. Run `npm run dev` and check the provider-error badge in the header if a panel stays empty.
- All interpretations (price×OI regimes, funding extremes, cross-venue gaps) are heuristics from public data, labelled as such in the UI. Nothing here is a prediction or trading advice.
- No secrets are needed or read. `.env.example` lists optional variables for future phases; keys must only ever be used from a server-side proxy.

## Architecture

```
src/core/providers   Envelope, ProviderChain, domain interfaces
src/providers        binance / bybit / okx adapters + chain wiring (change fallback order in index.ts)
src/core/ws          reconnecting Binance streams, LocalOrderBook
src/core/indicators  pure functions over Candle[]
src/core/analysis    market structure, price×OI matrix
src/core/scores      Liquidity Score (versioned, componentised)
src/store            zustand: app settings/watchlists (persisted), market data (volatile), data loop
src/components       one panel per file
docs/                API master map, quick reference, roadmap, feature matrix, machine-readable API DB
```
