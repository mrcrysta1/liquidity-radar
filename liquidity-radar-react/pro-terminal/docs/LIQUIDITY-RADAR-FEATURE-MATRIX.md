# LIQUIDITY RADAR — FEATURE MATRIX

**Date:** 2026-09-12 · Companion to `LIQUIDITY-RADAR-PRODUCT-ROADMAP.md`

> **Current status column:** the repository was not inspected. Every row is `UNKNOWN (audit)` until the Phase-A audit replaces it with `IMPLEMENTED` / `PARTIAL` / `PLANNED`. Rows marked `REQUIRES RESEARCH` or `NOT FREE` are structural (independent of codebase). **No feature requires a paid provider by design.**

Priority: P0 critical · P1 high · P2 medium · P3 low

| Feature | TradingView-style | Liquidity Radar | API (primary → fallback) | Current status | Priority | Phase |
|---|---|---|---|---|---|---|
| Candlestick / line / area charts | ✓ | ✓ keep existing lightweight chart | Binance klines → Bybit → OKX | UNKNOWN (audit) | P0 | B |
| Timeframes 1m…1M | ✓ | ✓ | Binance klines intervals | UNKNOWN (audit) | P0 | B |
| Zoom / pan / crosshair / OHLC / volume | ✓ | ✓ | — | UNKNOWN (audit) | P0 | B |
| Multi-chart layouts | ✓ | ✓ presets + dock | — | UNKNOWN (audit) | P1 | B |
| Multi-symbol compare | ✓ | ✓ | Binance / CoinGecko | UNKNOWN (audit) | P1 | B |
| Symbol search | ✓ | ✓ + ⌘K palette | SymbolRegistry (CoinGecko + exchangeInfo) | UNKNOWN (audit) | P0 | B |
| Fullscreen / theme | ✓ | ✓ dark terminal | — | UNKNOWN (audit) | P1 | B |
| Drawing tools | ✓ rich | ✓ basic (trend, h-line, rect, fib) | — | UNKNOWN (audit) | P2 | B |
| Indicators: SMA/EMA/WMA/VWAP | ✓ | ✓ deterministic | klines | UNKNOWN (audit) | P0 | B |
| Supertrend / Ichimoku / Keltner | ✓ | ✓ | klines | UNKNOWN (audit) | P1 | B |
| RSI / MACD / Stoch / CCI / ROC | ✓ | ✓ | klines | UNKNOWN (audit) | P0 | B |
| Bollinger / ATR | ✓ | ✓ | klines | UNKNOWN (audit) | P0 | B |
| OBV / buy-sell volume / CVD | ✓ partial | ✓ CVD from aggTrades | Binance aggTrade WS → Bybit | UNKNOWN (audit) | P1 | B/C |
| Volume Profile | ✓ (paid) | ✓ from aggTrades/klines | Binance | UNKNOWN (audit) | P2 | C |
| Swing highs/lows, HH/HL/LH/LL, BOS, CHoCH | ✗ (community) | ✓ deterministic | klines | UNKNOWN (audit) | P1 | B |
| Support/resistance auto-levels | ✗ (community) | ✓ | klines + L2 walls | UNKNOWN (audit) | P2 | C |
| Order book depth / walls / imbalance | ✗ | ✓ **core** | Binance depth WS → Bybit → OKX | UNKNOWN (audit) | P0 | C |
| Spread / slippage estimator | ✗ | ✓ core | bookTicker + local L2 | UNKNOWN (audit) | P0 | C |
| Large order / liquidity change detection | ✗ | ✓ | L2 diff stream | UNKNOWN (audit) | P1 | C |
| Liquidity sweeps / stop-hunt heuristics | ✗ | ✓ (labelled heuristic) | L2 + trades | UNKNOWN (audit) | P2 | K |
| Cross-exchange liquidity / price / funding radar | ✗ | ✓ core | Binance, Bybit, OKX, Coinbase, Kraken, KuCoin, Bitget, Gate, MEXC (CCXT) | UNKNOWN (audit) | P1 | C |
| Arbitrage signal (labelled) | ✗ | ✓ | as above + CoinGecko `is_stale` | UNKNOWN (audit) | P2 | C |
| **Liquidity Score** (transparent) | ✗ | ✓ core | derived | UNKNOWN (audit) | P0 | C |
| Funding rate live + history | ✗ | ✓ | Binance → Bybit → OKX | UNKNOWN (audit) | P0 | C |
| Open interest + OI change | ✗ | ✓ | Binance → Bybit → OKX | UNKNOWN (audit) | P0 | C |
| Long/short ratio | ✗ | ✓ | Binance → OKX rubik → Bybit | UNKNOWN (audit) | P1 | C |
| Basis / premium-discount | ✗ | ✓ | Binance basis, Deribit | UNKNOWN (audit) | P1 | C |
| Live liquidation feed | ✗ | ✓ | Binance `!forceOrder` → Bybit → OKX WS | UNKNOWN (audit) | P0 | C |
| Historical liquidations | ✗ | ✓ own recorder | own DB | REQUIRES RECORDER | P1 | A/C |
| Liquidation clusters / heatmap | ✗ | ✓ estimate (labelled) | own OI+price model | REQUIRES RESEARCH | P2 | K |
| Price × OI matrix explanations | ✗ | ✓ | derived | UNKNOWN (audit) | P1 | C |
| Options IV / skew / DVOL | ✗ | ✓ | Deribit → Binance eapi | UNKNOWN (audit) | P2 | C |
| Whale transfers (EVM) | ✗ | ✓ | Alchemy webhooks/Transfers → Etherscan | UNKNOWN (audit) | P1 | E |
| Whale transfers (Solana) | ✗ | ✓ | Helius webhooks → Solscan | UNKNOWN (audit) | P1 | E |
| Exchange deposits/withdrawals | ✗ | ✓ own label DB | Alchemy/Helius + Etherscan tags + OSS labels | REQUIRES RESEARCH (labels) | P1 | E |
| Wallet classification (exchange/whale/MM/VC/team) | ✗ | ✓ partial | label DB; Hyperliquid positions | REQUIRES RESEARCH | P2 | E |
| Smart-money perp positions | ✗ | ✓ | Hyperliquid Info API | UNKNOWN (audit) | P1 | E |
| Token holders / holder growth | ✗ | ✓ | Etherscan (holder count), Blockscout, Helius DAS | UNKNOWN (audit) | P2 | E |
| **Whale Score** | ✗ | ✓ | derived | UNKNOWN (audit) | P1 | E |
| Active addresses / network activity | ✗ | ✓ | Blockscout stats, mempool.space, BigQuery (batch) | UNKNOWN (audit) | P2 | E |
| DEX volume / liquidity | ✗ | ✓ | DexScreener → GeckoTerminal | UNKNOWN (audit) | P1 | E |
| TVL / stablecoin flows | ✗ | ✓ | DefiLlama | UNKNOWN (audit) | P1 | E |
| Token security / rug check | ✗ | ✓ gate | GoPlus → Honeypot.is / RugCheck | UNKNOWN (audit) | P1 | E |
| New token / pair discovery | ✗ | ✓ | DexScreener + GeckoTerminal new_pools | UNKNOWN (audit) | P2 | E |
| CEX listing detection | ✗ | ✓ | exchangeInfo diff + announcement feeds | UNKNOWN (audit) | P2 | E |
| News feed | ✓ | ✓ | Direct RSS → Finnhub → Google News RSS | UNKNOWN (audit) | P1 | F |
| News search / coin / category / source / time filters | ✓ partial | ✓ | own index | UNKNOWN (audit) | P1 | F |
| News importance / sentiment / dedup / event class | ✗ | ✓ | Groq/Gemini + FinBERT + Cloudflare embeddings | UNKNOWN (audit) | P1 | F/G |
| Regulatory / exchange announcements | ✗ | ✓ | SEC/CFTC/Fed RSS, exchange announcement feeds | UNKNOWN (audit) | P2 | F |
| X/Twitter monitoring | ✓ ideas feed | ✗ | — | NOT FREE (excluded) | — | — |
| Reddit mentions / sentiment | ✗ | ✓ | Reddit API | UNKNOWN (audit) | P2 | F |
| Telegram channel monitoring | ✗ | ✓ | Telegram Bot (admin) / MTProto | UNKNOWN (audit) | P2 | F |
| YouTube influencer activity | ✗ | ✓ | YouTube Data API | UNKNOWN (audit) | P3 | F |
| Google Trends | ✗ | ✓ proxy | Wikipedia pageviews (official) / pytrends (unofficial) | UNKNOWN (audit) | P3 | F |
| Fear & Greed | ✗ | ✓ | Alternative.me → CMC | UNKNOWN (audit) | P1 | F |
| Market / News / Social / Coin sentiment indices | ✗ | ✓ transparent | derived | UNKNOWN (audit) | P1 | F |
| Market cap / FDV / supply / category / links / contract | ✓ basic | ✓ | CoinGecko → CMC | UNKNOWN (audit) | P1 | F |
| Token unlocks / emissions | ✗ | ✓ partial | community JSON + CoinGecko supply deltas | REQUIRES RESEARCH | P3 | K |
| Holder / team / VC concentration | ✗ | ✓ partial | Etherscan/Blockscout holders + labels | REQUIRES RESEARCH | P3 | K |
| **Fundamental Score** | ✗ | ✓ | derived | UNKNOWN (audit) | P2 | K |
| Macro series (CPI, PPI, GDP, rates, yields, DXY) | ✓ (economic data) | ✓ | FRED → DBnomics → BLS/Treasury | UNKNOWN (audit) | P1 | F |
| Economic calendar (high-impact events) | ✓ | ✓ partial | static BLS/BEA/Fed schedules + FF weekly JSON | REQUIRES RESEARCH | P1 | F |
| Fed / CPI probabilities | ✗ | ✓ | Polymarket → Kalshi | UNKNOWN (audit) | P2 | F |
| **Macro Risk** indicator | ✗ | ✓ | derived | UNKNOWN (audit) | P2 | F/K |
| Scanner (multi-signal filters) | ✓ screener | ✓ intelligence-focused | all above | UNKNOWN (audit) | P0 | D |
| Screener: configurable columns, AND/OR, saved screens | ✓ | ✓ | — | UNKNOWN (audit) | P1 | D |
| AI Market Analyst (bias/confidence/evidence/risks/invalidation) | ✗ | ✓ enhancement layer | Groq → Gemini → OpenRouter → Ollama | UNKNOWN (audit) | P1 | G |
| Signal engine: 11 sub-scores → Opportunity Score, "why" drawer | ✗ | ✓ core | derived | UNKNOWN (audit) | P1 | K |
| Alerts (price/%/volume/OI/funding/liq/whale/liquidity/news/sentiment/technical/scanner/composite) | ✓ | ✓ | AlertEngine | UNKNOWN (audit) | P1 | H |
| Alert channels: browser push | ✓ | ✓ | Web Push (VAPID) | UNKNOWN (audit) | P1 | H |
| Alert channels: Telegram / Discord / Email / Webhook | ✓ webhook (paid) | ✓ | Telegram Bot, Discord webhook, Resend, own webhooks | UNKNOWN (audit) | P1 | H |
| Watchlists (multiple, pin, sort, alerts, mini-charts) | ✓ | ✓ local first | localStorage/IndexedDB | UNKNOWN (audit) | P1 | B |
| Watchlist cloud sync | ✓ | ✓ later | Supabase free tier | PLANNED | P3 | K |
| Dockable trading workspace | ✓ | ✓ own dock | — | UNKNOWN (audit) | P0 | B |
| Data freshness badges (LIVE/DELAYED/STALE/OFFLINE/FALLBACK) | ✗ | ✓ every panel | Envelope | UNKNOWN (audit) | P0 | A |
| Provider failover chain | ✗ | ✓ | ProviderChain | UNKNOWN (audit) | P0 | A |
| Backtesting (no look-ahead; fees/funding/slippage) | ✓ Pine | ✓ event-driven | data.binance.vision + own recorders | PLANNED | P2 | I |
| Paper trading | ✓ | ✓ | live WS | PLANNED | P2 | J |
| Knowledge / research center | ✗ | ✓ | SEC EDGAR, Wikipedia, Brave/Tavily, pgvector | PLANNED | P3 | K |
| Narrative detection | ✗ | ✓ | embeddings + LLM clustering | PLANNED | P3 | K |
| Real trading / broker integration | ✓ | ✗ (not planned) | — | OUT OF SCOPE | — | — |
| Social ideas / publishing | ✓ | ✗ (not planned) | — | OUT OF SCOPE | — | — |

**Structurally unavailable for free (no paid substitution planned):** X/Twitter data, vendor liquidation heatmaps, token-unlock vendors, consensus economic calendar, smart-money label vendors. Each has a free approximation listed above and in Roadmap §3.
