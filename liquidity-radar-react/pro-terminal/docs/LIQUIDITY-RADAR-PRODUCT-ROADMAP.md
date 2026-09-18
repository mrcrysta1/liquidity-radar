# LIQUIDITY RADAR — PRODUCT ROADMAP

**Version:** 1.0 · **Date:** 2026-09-12 · **Status:** DRAFT FOR APPROVAL — no implementation started
**Inputs:** `LIQUIDITY-RADAR-FREE-API-MASTER-MAP.md`, `LIQUIDITY-RADAR-API-QUICK-REFERENCE.md`, `data/liquidity-radar-apis.json`

> ⚠️ **Repository not inspected.** This roadmap was produced outside the repo (no `AGENTS.md`, no source tree, no Git state, no test results available). Sections 1–2 are **audit templates** that Claude Code must complete on first run before any code changes. Nothing below claims a feature exists in the codebase.

---

## 1. CURRENT ARCHITECTURE — *AUDIT REQUIRED*

Claude Code first-run checklist (do not skip):

```bash
cat AGENTS.md
git status --porcelain && git stash list && git branch --show-current
find src -maxdepth 2 -type d
grep -rlE "lightweight-charts|recharts|d3|chart\.js|tradingview" src | head
grep -rlE "new WebSocket|ws:\/\/|wss:\/\/|socket\.io" src | head
grep -rlE "zustand|redux|jotai|recoil|createContext" src | head
grep -rlE "anthropic|openai|groq|gemini|generativelanguage" src | head
grep -rniE "binance|bybit|okx|coingecko|etherscan|alchemy|helius|dexscreener|defillama|fred|finnhub" src | cut -d: -f1 | sort -u
ls -d **/__tests__ **/*.test.* **/*.spec.* e2e playwright* vitest* jest* 2>/dev/null
```

Fill in:

| Area | Finding | File(s) |
|---|---|---|
| Framework / bundler | UNKNOWN | |
| Chart library | UNKNOWN (task states a lightweight chart system exists — keep it unless blocked) | |
| WebSocket layer | UNKNOWN | |
| State/store | UNKNOWN | |
| AI layer | UNKNOWN | |
| Backend/proxy | UNKNOWN | |
| Tests / smoke | UNKNOWN | |
| Providers integrated | UNKNOWN | |
| Uncommitted work to preserve | UNKNOWN | |

## 2. EXISTING FUNCTIONALITY — *AUDIT REQUIRED*

Status legend used everywhere in this document and the Feature Matrix:
`IMPLEMENTED` · `PARTIAL` · `PLANNED` · `REQUIRES API` · `REQUIRES PAID` · `REQUIRES RESEARCH` · `UNKNOWN (audit)`

All features default to `UNKNOWN (audit)` until the checklist above is completed.

## 3. MISSING FUNCTIONALITY (target vs. brief)

Everything in brief §1–§22 is assumed missing until audited. Items that are **structurally unavailable for free** regardless of codebase:

| Capability | Why | Mitigation |
|---|---|---|
| Historical liquidations | No free source | Record own from Binance/Bybit/OKX WS from day one |
| Historical L2 order books | No free source (partial: data.binance.vision bookDepth) | Record own snapshots (1s) |
| Liquidation heatmap | Vendor-derived (Coinglass, paid → excluded) | Own estimate from OI Δ + price + leverage tiers; label "estimate" |
| X/Twitter data | No free tier since 2026-02 | Reddit, Telegram, YouTube, Bluesky, Wikipedia pageviews instead |
| Token unlock calendar | Paid vendors only | Manual/community JSON + CoinGecko supply deltas |
| Economic calendar with consensus | No robust free API | Static release schedules (BLS/BEA/Fed) + ForexFactory weekly JSON (unofficial) |
| ETF daily flows | No free API | Issuer CSV + Farside scrape (daily job) |
| Exchange inflow/outflow as service | Paid | Own label DB + Alchemy/Helius webhooks |
| Smart-money labels | Paid (Nansen) | Etherscan name tags + OSS label lists + Hyperliquid positions |

## 4. API MAPPING (feature → provider chain)

Provider chains are **Primary → Fallback → Cache → Degrade**. Full table in Master Map §27; condensed:

| Domain | Primary | Fallback | Key? | Licence flag |
|---|---|---|---|---|
| Spot/perp klines, book, trades | Binance | Bybit → OKX | No | display OK |
| Funding / OI / L-S / basis | Binance | Bybit → OKX | No | |
| Liquidations (live) | Binance WS | Bybit WS → OKX WS | No | |
| Options / IV | Deribit | Binance eapi | No | |
| Perp-DEX + wallet positions | Hyperliquid | — | No | |
| Coin metadata / trending | CoinGecko Demo | CoinMarketCap Basic | Free key | **non-commercial on Demo** |
| DEX pairs / OHLCV | DexScreener | GeckoTerminal | No | |
| TVL / stablecoins / CEX reserves | DefiLlama | CoinGecko | No | |
| EVM chain data | Etherscan V2 | Blockscout | Free key | free = selected chains |
| EVM RPC + webhooks | Alchemy | Infura → dRPC | Free key | |
| Solana | Helius | QuickNode | Free key | |
| Bitcoin | mempool.space | Blockchain.com | No | |
| Token security | GoPlus | Honeypot.is / RugCheck | Optional | |
| News | Direct RSS | Finnhub news → Google News RSS | No / free key | Finnhub personal-use |
| Fear & Greed | Alternative.me | CMC | No | |
| Macro | FRED | DBnomics → BLS/Treasury | Free key | |
| FX | Frankfurter | Finnhub → open.er-api | No | |
| Commodities | FRED | EIA → PAXG/XAUT pairs | Free key | |
| Filings / insiders | SEC EDGAR | FMP | No (User-Agent) | |
| Prediction markets | Polymarket | Kalshi | No | |
| Social | Reddit API | Telegram Bot/MTProto → YouTube | Free key | Reddit non-commercial |
| Attention proxy | Wikipedia pageviews | Google Trends (unofficial) | No | |
| LLM | Groq | Gemini → OpenRouter → Cerebras → Ollama | Free key | Gemini free trains on inputs |
| Embeddings | Cloudflare Workers AI | Gemini → local | Free key | |
| Alerts | Telegram | Discord → Web Push → Resend | Free key | |

**Keys required (all free):** COINGECKO_DEMO_KEY, ETHERSCAN_API_KEY, ALCHEMY_API_KEY, HELIUS_API_KEY, FRED_API_KEY, FINNHUB_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, REDDIT_CLIENT_ID/SECRET, CF_AI_TOKEN. **Credit card required:** none. **Paid:** none.

## 5. FEATURE DEPENDENCY GRAPH

```
Provider layer (A) ──┬── Chart workspace (B) ──── Indicators (B) ──── Signal engine (G/K)
                     ├── Market/Futures/Liquidity intel (C) ─┬─ Scanner (D) ─── Screener (D)
                     │                                       ├─ Alerts (H)
                     │                                       └─ Backtesting (I) ── Paper trading (J)
                     ├── Whale/On-chain (E) ────────────────┬─ Scanner (D)
                     │                                       └─ AI analyst (G)
                     ├── News/Social/Sentiment (F) ─────────┬─ Scanner (D)
                     │                                       └─ AI analyst (G)
                     └── Macro (F) ──────────────────────────── Macro risk (K)
Data-quality badges (A) ── every panel
Own recorders (A: liquidations, L2, OI) ── Liquidity heatmap (K), Backtesting (I)
```

Hard rules: Scanner cannot ship before C; AI analyst cannot ship before C+E+F produce structured evidence; Backtesting cannot ship before recorders have ≥30 days data.

## 6. RECOMMENDED IMPLEMENTATION ORDER

A → B → C → D → H (alerts early: cheap, high perceived value) → E → F → G → I → J → K

Rationale: C is the differentiator and needs only keyless exchange APIs; H reuses C's signals; E/F need free keys and webhooks (more setup); G needs structured inputs from C/E/F.

## 7. ARCHITECTURE CHANGES

### 7.1 Provider abstraction (Phase A — critical)
```ts
interface Provider<TReq, TRes> {
  id: string; label: 'FREE'|'FREE TIER'|'OPEN SOURCE'|'PUBLIC DATA';
  capabilities: Capability[]; health(): Health;
  fetch(req: TReq, signal?: AbortSignal): Promise<Envelope<TRes>>;
}
interface Envelope<T> { data: T; provider: string; ts: number; freshness: 'LIVE'|'DELAYED'|'STALE'|'OFFLINE'|'FALLBACK'; confidence: 0..1; error?: string }
```
Domain interfaces: `MarketDataProvider`, `ExchangeProvider`, `DerivativesProvider`, `OnChainProvider`, `WhaleProvider`, `NewsProvider`, `SocialProvider`, `SentimentProvider`, `MacroProvider`, `SecurityProvider`, `AIProvider`, `AlertTransport`.
`ProviderChain` = ordered providers + circuit breaker + cache (stale-while-revalidate) + degradation policy. Every UI panel consumes `Envelope`, never raw provider responses.

### 7.2 Backend proxy (required)
Keys for CoinGecko/Etherscan/Alchemy/Helius/FRED/Finnhub/Groq/Gemini must never reach the browser. Minimal Node/Edge proxy (Cloudflare Workers or existing backend) with per-provider rate-limit buckets and response cache. Exchange public endpoints can be called directly from browser (CORS OK on Binance/Bybit/OKX) but should still route through a shared WS fan-out to avoid per-tab connections.

### 7.3 Symbol normalization
Canonical `Asset` (CoinGecko id ↔ contract addresses ↔ exchange symbols). Single `SymbolRegistry` service; all providers map through it.

### 7.4 Recorders (Phase A, run from day one)
Server-side jobs persisting: liquidations (all venues), OI 1m, funding, L2 snapshots (1s, top 50 levels), aggTrades → CVD. Storage: TimescaleDB/ClickHouse (self-host) or Supabase Postgres free tier initially.

## 8. DATA ARCHITECTURE

- **Hot path:** WebSocket → worker (parse, aggregate, indicator update) → store slices → memoized selectors → panels.
- **Warm path:** REST via proxy, cached (TTL per endpoint: klines 1m=5s, funding=60s, CG metadata=10m, FRED=6h).
- **Cold path:** recorders + data.binance.vision backfills → Postgres/ClickHouse → backtesting/heatmap.
- **Models:** `Candle`, `BookLevel/BookSnapshot`, `Trade`, `Funding`, `OpenInterest`, `Liquidation`, `LongShortRatio`, `Basis`, `Transfer`, `WalletLabel`, `NewsItem` (+embedding, cluster id, sentiment, importance), `SocialMetric`, `MacroSeries`, `MacroEvent`, `Score{value, components[], evidence[]}`, `Signal`, `Alert`, `Watchlist`.
- **Scores are deterministic and versioned** (`score_version`), every component stored with its weight and input values → UI "why" drawer.

## 9. UI ARCHITECTURE

- Dockable panel system (own implementation or lightweight OSS grid) with layout presets: *Trading*, *Screener*, *Whale*, *Macro*, *Research*.
- Keep existing lightweight chart; extend via indicator overlay/panel registry (`IndicatorDefinition{ id, inputs, compute(candles)→series, render }`).
- Virtualized tables (screener, trades, news). Command palette (⌘K) for symbol/feature search. Keyboard shortcuts for timeframe, layout, panels.
- Every panel header shows freshness badge + provider chip. Dark terminal theme tokens; light theme later.

## 10. AI ARCHITECTURE

- AI never computes numbers. Input = structured `EvidencePack` (scores, components, latest facts, news clusters). Output schema (JSON, validated): `{ bias, confidence, evidence[], risks[], invalidation[], sources[] }`.
- Provider chain: Groq (fast, structured) → Gemini (long context) → OpenRouter → Ollama. Prompt versioning; outputs cached per (asset, evidence hash) for 5–15 min.
- Classification jobs (server-side): news importance/category/sentiment, social sentiment, narrative clustering (embeddings + pgvector).
- Guardrails: no PII to free tiers; disclaimers embedded in schema; show model + timestamp.

## 11. TESTING STRATEGY

- Unit: indicators against reference vectors (TA-Lib parity fixtures), score functions, symbol normalization, envelope/freshness logic.
- Contract tests: recorded fixtures per provider (nock/msw); schema validation of live responses in nightly job (detect API drift).
- Integration: ProviderChain failover (kill primary → fallback → cache → degrade badge).
- E2E smoke: workspace loads, chart renders, WS reconnects, screener filters, alert fires.
- Backtest determinism: same inputs → identical results; look-ahead test (shift data by +1 bar must change results).
- Use whatever runner the repo already has (audit §1); never fabricate results.

## 12. PERFORMANCE STRATEGY

- One shared WS connection per venue (SharedWorker/BroadcastChannel across tabs); combined streams; subscribe only to visible symbols.
- Throttle book renders to 10 fps; batch aggTrades to 250 ms; indicators incremental (O(1) per bar).
- Workers for indicator/CVD/score computation; transferable ArrayBuffers.
- Memoized selectors; panel-level `React.memo`; virtualization; no global store churn on tick data (ring buffers outside React, subscribe via `useSyncExternalStore`).
- Cache: memory → IndexedDB (klines) → proxy cache. Exponential backoff + jitter; heartbeat/ping; resubscribe on reconnect.

## 13. SECURITY STRATEGY

- Keys server-side only; `.env.example` with placeholders; secret scanning in CI (gitleaks).
- Proxy allow-list of upstream hosts; per-IP rate limits; no user-supplied URLs fetched server-side.
- Read-only exchange keys if user portfolio features ever added; encrypted at rest; never logged.
- CSP, no inline scripts; sanitize news HTML.

## 14. FREE API STRATEGY

- Every provider tagged with label + licence flag; CI fails if a provider file lacks `label` or introduces a `PAID` label without `docs/ADR-*.md`.
- Personal-use licences (CoinGecko Demo, Finnhub, Reddit) are acceptable for development and non-commercial launch; **licence audit milestone before monetization**.
- Quota budgeting: central `QuotaLedger` per provider (calls/min, calls/day); UI shows quota health in a dev panel.
- Quarterly re-verification job against the watchlist in Master Map §30.

## 15. FUTURE PAID-PROVIDER ABSTRACTION

No paid providers are planned. If ever justified, they must plug into the same domain interfaces behind a feature flag and an ADR documenting cost, licence, and the free alternative that was insufficient. UI must keep working when the flag is off.

## 16. RISKS

| Risk | Impact | Mitigation |
|---|---|---|
| Free-tier changes (Etherscan chains, Dune, LLM limits) | Feature outage | ProviderChain fallbacks; quota ledger; watchlist re-checks |
| Exchange geo-blocks (Binance US IPs) | Data gap | `data-api.binance.vision`; Bybit/OKX fallbacks; deploy region choice |
| Licence violation on monetization | Legal | Licence audit milestone; swap to commercial-safe sources |
| WS scale (many symbols × venues) | Cost/perf | Server fan-out; subscribe-on-view; combined streams |
| Score credibility | Trust | Transparent components, versioned, backtested |
| AI hallucination | Trust | Structured evidence only; schema validation; disclaimers |
| Scope creep | Delivery | Strict phase gates; roadmap approval per phase |
| No repo audit yet | Rework | Complete §1–2 before Phase A code |

## 17. MILESTONES

| Phase | Scope | Depends | APIs | Key components/services | Data models | Tests | Complexity |
|---|---|---|---|---|---|---|---|
| **A** Foundation | Audit; ProviderChain; Envelope/freshness; proxy; SymbolRegistry; WS fan-out; recorders; quota ledger | — | Binance, Bybit, OKX, CoinGecko | `providers/*`, `ProviderChain`, `WsHub`, `Recorder*`, `FreshnessBadge` | Envelope, Candle, Trade, BookSnapshot | unit + failover | High |
| **B** Chart/Workspace | Timeframes 1m–1M, layouts, compare, symbol search, indicator registry (SMA/EMA/WMA/VWAP/RSI/MACD/BB/ATR/Stoch/CCI/ROC/OBV/Supertrend/Keltner/Ichimoku), swing/BOS/CHoCH, fullscreen, drawing (basic) | A | Binance klines (+fallbacks) | `ChartWorkspace`, `IndicatorRegistry`, `PanelDock`, `CommandPalette` | IndicatorDefinition, Layout | indicator parity fixtures, e2e render | High |
| **C** Liquidity/Futures | L2 walls, imbalance, spread, slippage, CVD, funding, OI, L/S, basis, price/OI matrix, liquidation feed, **Liquidity Score** | A | Binance/Bybit/OKX REST+WS, Deribit, Hyperliquid | `OrderBookEngine`, `LiquidityScore`, `FuturesPanel`, `CrossExchangeRadar` | Funding, OI, Liquidation, LSRatio, Basis, Score | score unit tests, WS integration | High |
| **D** Scanner/Screener | Configurable columns, AND/OR filters, presets, saved screens | B, C | above + CoinGecko | `ScreenerEngine`, `FilterBuilder`, virtualized grid | ScreenDefinition | filter logic unit, perf | Medium |
| **H** Alerts (early) | Price/%/volume/OI/funding/liq/technical/scanner alerts; Telegram, Discord, Web Push, email | C, D | Telegram, Discord, Web Push, Resend | `AlertEngine`, `AlertTransport*` | Alert, AlertEvent | rule eval unit, transport mocks | Medium |
| **E** Whale/On-chain | Transfer webhooks, label DB, exchange flow classification, holders, Hyperliquid positions, TVL/stablecoins, mempool, **Whale Score**, token security gate | A | Alchemy, Helius, Etherscan, Blockscout, DefiLlama, mempool.space, GoPlus/RugCheck, Hyperliquid | `WhaleEngine`, `LabelStore`, `OnChainPanel`, `SecurityGate` | Transfer, WalletLabel, HolderStat, Score | webhook ingestion tests, label classification | High |
| **F** News/Social/Sentiment/Macro | RSS ingestion, dedup (embeddings), importance/sentiment/category (LLM/FinBERT), Reddit/Telegram/YouTube/Wikipedia metrics, F&G, FRED macro, calendar (static schedules), **Macro Risk**, sentiment indices | A (+G for LLM classification) | RSS, Finnhub, Reddit, Telegram, YouTube, Wikimedia, Alternative.me, FRED, BLS, Polymarket, Kalshi, Groq/Gemini, Cloudflare AI | `NewsIngest`, `Deduper`, `SentimentEngine`, `MacroPanel`, `CalendarService` | NewsItem, SocialMetric, MacroSeries, MacroEvent | ingestion fixtures, dedup precision | High |
| **G** AI Analyst | EvidencePack → structured bias/confidence/evidence/risks/invalidation; provider chain; caching | C, E, F | Groq, Gemini, OpenRouter, Ollama | `EvidencePackBuilder`, `AIProviderChain`, `AnalystPanel` | AnalystOutput | schema validation, golden prompts | Medium |
| **I** Backtesting | Event-driven engine on recorded/backfilled data; indicator/signal/funding/OI/whale strategies; fees/funding/slippage; metrics | A recorders ≥30d, B, C | data.binance.vision, own DB | `BacktestEngine`, `StrategyDSL`, `MetricsReport` | Strategy, BacktestRun, TradeRecord | look-ahead tests, determinism | High |
| **J** Paper Trading | Virtual account, orders, SL/TP, P&L incl. fees/funding, history, stats | C, I | live WS | `PaperBroker`, `PositionsPanel` | Account, Order, Position | fill logic unit | Medium |
| **K** Advanced | Signal engine (11 sub-scores → Opportunity Score), liquidity heatmap estimate, narrative detection, knowledge center (search over news/filings), fundamental score, watchlist cloud sync | all | SEC EDGAR, Wikipedia, Brave/Tavily, pgvector | `SignalEngine`, `HeatmapEstimator`, `KnowledgeSearch` | Signal, Narrative, KnowledgeDoc | score backtests | High |

Watchlist (local persistence, multiple lists, pin/sort/alerts/mini-charts) ships in **B**; cloud sync deferred to **K**.

---

**Approval gate:** Phase A begins only after §1–2 audit is completed and this roadmap is approved. Implementation proceeds via the project's Agent OS task/branch/PR rules per `AGENTS.md`.
