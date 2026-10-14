# LIQUIDITY RADAR — FREE API MASTER MAP

**Version:** 1.0 · **Compiled:** 2026-09-12 · **Owner:** Data Architecture
**Purpose:** Long-term reference database of ONLY free / free-tier / open data sources for Liquidity Radar. Do not re-research anything listed here without first checking the "Last verified" column.

> **Repo integration note:** This document was produced without access to the Liquidity Radar repository or `AGENTS.md`. The **CURRENTLY USED** section (§22) is a fill-in template. No application code, dependencies, or secrets were touched.

---

## 0. HOW TO READ THIS DOCUMENT

### 0.1 Labels
| Label | Meaning |
|---|---|
| **FREE** | Fully free, no meaningful cap for our scale (may need a key) |
| **FREE TIER** | Free plan exists with usable limits; paid tiers above |
| **OPEN SOURCE** | Self-hostable software / library (cost = infra) |
| **PUBLIC DATA** | Government / institutional open data, permissive license |
| **UNCERTAIN** | Free status could not be confirmed on 2026-09-12 |

### 0.2 Verification status
| Code | Meaning |
|---|---|
| **V** | Verified 2026-09-12 against official docs/pricing page or ≥2 recent (≤90 days) independent sources |
| **K** | Known/stable from training knowledge; limits should be re-checked before production use |
| **NV** | `UNKNOWN / NEEDS VERIFICATION` |

### 0.3 Scoring (each /10, overall = mean)
Free · Quality · Reliability · Rate limits · Real-time · Historical · Coverage · Docs · Integration · LR-usefulness

### 0.4 Tiers
🔥 MUST HAVE (≥8.0) · 🟢 HIGH VALUE (7.0–7.9) · 🟡 USEFUL (6.0–6.9) · 🔵 FUTURE (strategic, not now) · ⚪ BACKUP · 🔴 NOT RECOMMENDED

### 0.5 Common facts (apply unless stated)
- All REST APIs are JS/TS + Python compatible (plain HTTP/JSON).
- Exchange public endpoints: no key, no account, IP-based rate limits, real-time, WebSocket available, historical candles available (depth varies).
- Geographic: Binance, Bybit, OKX, KuCoin, Gate, MEXC, Bitget restrict some regions (US notably) for **trading**; public market data is generally reachable but Binance.com blocks US IPs on API — use `data-api.binance.vision` or Binance.US for US infra.
- Commercial use: most exchange public data is permitted for display; redistribution/resale usually prohibited. Aggregators (CoinGecko Demo, CMC Basic, Finnhub free, Coinglass Hobbyist/Startup) are **personal/non-commercial** — flag before monetizing.

---

## 1. CRYPTO MARKET DATA (by data type → best sources)

| Data type | Best free source | Backup | Notes |
|---|---|---|---|
| Spot ticker/price | Binance `/api/v3/ticker/24hr` | Bybit, OKX, Coinbase | All free, WS available |
| Spot OHLCV | Binance `/api/v3/klines` (1000/req, full history) | Bybit `/v5/market/kline`, OKX `/market/candles`, Kraken OHLC | Binance deepest & cleanest |
| Order book depth | Binance `/api/v3/depth` (≤5000) + `depth@100ms` WS | Bybit (≤500 spot/1000 linear), OKX (400) | No free historical L2 anywhere |
| Trades | Binance `/aggTrades`, WS `@aggTrade` | Bybit, OKX, Coinbase | Binance historical via data.binance.vision |
| Futures/Perps ticker | Binance `/fapi/v1/ticker/24hr` | Bybit linear, OKX SWAP | |
| Funding rate (live) | Binance `/fapi/v1/premiumIndex` | Bybit `/v5/market/tickers`, OKX `/public/funding-rate` | Aggregate across 3+ exchanges yourself |
| Funding rate (history) | Binance `/fapi/v1/fundingRate` | Bybit `/v5/market/funding/history`, OKX `/public/funding-rate-history` | Bybit history limited (~200/req) |
| Open interest (live) | Binance `/fapi/v1/openInterest` | Bybit `/v5/market/open-interest`, OKX `/public/open-interest` | |
| Open interest (history) | Binance `/futures/data/openInterestHist` (30 days) | Bybit OI history, OKX `/rubik/stat/contracts/open-interest-history` | Deep OI history is **paid** (Coinglass) |
| Liquidations (live) | Binance WS `!forceOrder@arr` | Bybit WS `allLiquidation.{symbol}`, OKX WS `liquidation-orders` | Binance throttles to 1 event/sec/symbol; **no free historical liquidations** |
| Long/short ratio | Binance `/futures/data/globalLongShortAccountRatio`, `topLongShortPositionRatio` | OKX `/rubik/stat/contracts/long-short-account-ratio`, Bybit `/v5/market/account-ratio` | 30-day history on Binance |
| Taker buy/sell volume | Binance `/futures/data/takerlongshortRatio` | OKX `/rubik/stat/taker-volume` | |
| Basis | Binance `/futures/data/basis` | Compute: perp mark − spot | |
| Mark/index price | Binance `/fapi/v1/premiumIndex`, WS `@markPrice` | Bybit/OKX tickers | |
| Options | Deribit public API (`/public/ticker`, `/public/get_book_summary_by_currency`) | Binance `/eapi/v1`, Bybit option, OKX option | Deribit = reference venue for IV/skew |
| Volatility (DVOL) | Deribit `/public/get_volatility_index_data` | Compute from Deribit IV; Bybit `/v5/market/historical-volatility` | |

---

## 2. EXCHANGE APIs

| # | Exchange | Label | Ver | Docs | Public REST limit | WS | Hist depth | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|---|---|
| 2.1 | **Binance** (Spot `api.binance.com`, USD-M `fapi.binance.com`, COIN-M `dapi`, Options `eapi`) | FREE | V/K | https://developers.binance.com/docs | Spot 6000 weight/min/IP; Futures 2400 weight/min | Yes (`stream.binance.com:9443`, `fstream.binance.com`), 1024 streams/conn | Spot klines to 2017; futures to 2019 | Bulk history free at https://data.binance.vision ; US IPs blocked → `data-api.binance.vision` (market data only) | 9.1 | 🔥 |
| 2.2 | **Bybit** V5 | FREE | K | https://bybit-exchange.github.io/docs/v5/intro | ~120 req/5s/IP per endpoint group (varies) | Yes (`stream.bybit.com`) | Kline to 2020 | Unified spot/linear/inverse/option in one API; liquidation WS | 8.5 | 🔥 |
| 2.3 | **OKX** V5 | FREE | K | https://www.okx.com/docs-v5/en/ | 20 req/2s typical per endpoint/IP | Yes (`ws.okx.com:8443`) | Candles: 1440 recent + `/history-candles` deeper | Rich "rubik" stats (L/S ratio, taker vol, OI history), options | 8.5 | 🔥 |
| 2.4 | **Coinbase Exchange / Advanced Trade** | FREE | K | https://docs.cdp.coinbase.com/exchange/docs | 10 req/s public | Yes (`ws-feed.exchange.coinbase.com`) | Candles 300/req | Best US-regulated spot reference; L2 WS full book | 7.8 | 🟢 |
| 2.5 | **Kraken** | FREE | K | https://docs.kraken.com/api/ | ~1 req/s public (counter-based) | Yes (v2) | OHLC 720 candles/req; Trades full history via `since` | Futures at `futures.kraken.com` | 7.3 | 🟢 |
| 2.6 | **KuCoin** | FREE | K | https://www.kucoin.com/docs-new | 2000 req/30s/IP public pool | Yes (token-based connect) | Klines 1500/req | Futures API separate | 7.0 | 🟢 |
| 2.7 | **Bitget** | FREE | K | https://www.bitget.com/api-doc | 20 req/s/IP | Yes | Candles 1000/req | Copy-trading data; fast altcoin listings | 6.9 | 🟡 |
| 2.8 | **Gate.io** V4 | FREE | K | https://www.gate.io/docs/developers/apiv4 | 200 req/10s/IP public | Yes | Candles 1000/req | Widest altcoin listing coverage | 6.9 | 🟡 |
| 2.9 | **MEXC** V3 | FREE | K | https://mexcdevelop.github.io/apidocs/ | 500 req/10s/IP (spot) | Yes | Klines 1000/req | Very early listings; Binance-like API shape | 6.6 | 🟡 |
| 2.10 | **HTX (Huobi)** | FREE | K | https://www.htx.com/en-us/opend/newApiPages/ | 100 req/10s | Yes | Klines 2000/req | Asia liquidity reference | 6.4 | ⚪ |
| 2.11 | **Deribit** | FREE | K | https://docs.deribit.com/ | 20 req/s non-matching | Yes (JSON-RPC over WS) | Full options history via `get_tradingview_chart_data` | **The** options/IV venue; DVOL index | 8.4 | 🔥 |
| 2.12 | **Hyperliquid** (perp DEX) | FREE | K | https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api | 1200 weight/min/IP | Yes | Candles 5000/req | Fully public L2 book, funding, OI, all positions (whale tracking!) | 8.0 | 🟢 |
| 2.13 | **dYdX v4** | FREE | K | https://docs.dydx.exchange/ | Indexer public | Yes | Yes | Perp DEX backup | 6.5 | 🔵 |
| 2.14 | **Bitfinex** | FREE | K | https://docs.bitfinex.com/ | 30–90 req/min | Yes | Deep (to 2013) | Funding/lending rates market; long/short positions stats (`stats1`) | 6.8 | 🟡 |
| 2.15 | **Bitstamp** | FREE | K | https://www.bitstamp.net/api/ | 400 req/s | Yes | OHLC | Oldest fiat on-ramp reference | 5.9 | ⚪ |
| 2.16 | **Crypto.com Exchange** | FREE | K | https://exchange-docs.crypto.com/ | 100 req/s public | Yes | Yes | Backup | 6.0 | ⚪ |
| 2.17 | **Binance.US** | FREE | K | https://docs.binance.us/ | 1200 weight/min | Yes | Yes | US-compliant fallback for US infra | 6.2 | ⚪ |
| 2.18 | **CCXT** (library) | OPEN SOURCE (MIT) | K | https://docs.ccxt.com/ | n/a (wraps above) | `ccxt.pro` now merged into ccxt (WS free) | Via exchanges | 100+ exchanges unified in JS/TS + Python; **default abstraction layer recommendation** | 8.7 | 🔥 |

**Authenticated exchange endpoints:** Not required for Liquidity Radar's intelligence layer. Only needed for user-portfolio features (future). Always read-only keys, never stored server-side without encryption.

---

## 3. AGGREGATORS

| # | Name | Label | Ver | Docs | Free limits | Key | WS | Hist | Commercial | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3.1 | **CoinGecko** | FREE TIER | V | https://docs.coingecko.com | Demo: 10,000 calls/mo, 30 → 100 req/min (docs now state 100/min); keyless public: 5–15/min IP-shared | Yes (Demo key, no card) | Paid only (Basic $35+) | 1 yr on Demo; hourly/daily granularity | Demo = non-commercial | Coins, exchanges, categories, trending, NFTs, **GeckoTerminal onchain DEX endpoints included** | 8.3 | 🔥 |
| 3.2 | **CoinMarketCap** | FREE TIER | V | https://coinmarketcap.com/api/documentation/v1/ | Basic: 15,000 credits/mo, 50 req/min; **no historical** on Basic | Yes | In development | Paid ($29 Hobbyist+) | Basic = personal use | Also x402 pay-per-call $0.01; DEX endpoints | 7.2 | ⚪ (backup to CG) |
| 3.3 | **CoinDesk Data (ex-CryptoCompare)** | FREE TIER | K/NV | https://developers.coindesk.com/ | Free key tier exists (limits NV; historically ~11k calls/mo) | Yes | Yes (paid tiers) | Deep minute/hour/day history | NV | Legacy `min-api.cryptocompare.com` still serving; CCCAGG index | 7.0 | 🟡 |
| 3.4 | **CoinPaprika** | FREE TIER | V(secondary) | https://api.coinpaprika.com/ | 20,000 calls/mo free; keyless | Optional | Enterprise | 1 yr free | NV | Good CG backup | 6.8 | ⚪ |
| 3.5 | **CoinCap** | FREE TIER | K/NV | https://docs.coincap.io/ | v3 requires key; free tier limits NV | Yes | Yes | Yes | NV | Simple; check v3 status | 5.8 | ⚪ |
| 3.6 | **Messari** | FREE TIER | K/NV | https://docs.messari.io/ | Free key, low rate; asset metrics/profiles | Yes | No | Yes | NV | Fundamentals/tokenomics | 6.3 | 🟡 |
| 3.7 | **Mobula** | FREE TIER | K/NV | https://docs.mobula.io/ | Free tier w/ key; limits NV | Yes | Yes | Yes | NV | Wallet portfolio + long-tail tokens | 6.2 | 🔵 |
| 3.9 | **TradingView** | 🔴 | K | — | No public API | — | — | — | — | Widgets only (embed OK); scraping violates ToS | — | 🔴 |

---

## 4. ON-CHAIN DATA

### 4.1 Block explorers / indexers

| # | Name | Label | Ver | Docs | Free limits | Chains | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|---|
| 4.1.1 | **Etherscan API V2** (unified key) | FREE TIER | V | https://docs.etherscan.io | Free: 3 calls/s, 100k/day, **selected chains only** (Avalanche, Base, BNB, Optimism moved to paid Dec 2025); Lite $49 = all 60+ chains | ETH + ~90% of 60+ EVM chains on free | Token transfers, holders (PRO), logs, gas oracle, contract source/ABI | 7.6 | 🟢 |
| 4.1.2 | **Blockscout** | OPEN SOURCE + FREE public instances | K | https://docs.blockscout.com/devs/apis | Public instances: generous, no key (per-instance) | Most EVM chains (Base, Optimism, Gnosis, Arbitrum…) | Etherscan-compatible API; **primary free backup for chains Etherscan paywalled** | 7.4 | 🟢 |
| 4.1.3 | **Solscan Public API** | FREE TIER | K/NV | https://pro-api.solscan.io/pro-api-docs/v2.0 | Free tier w/ key; limits NV | Solana | Token holders, transfers, DeFi activities | 6.5 | 🟡 |
| 4.1.4 | **Tronscan / TronGrid** | FREE TIER | K | https://developers.tron.network/ | TronGrid free key: 100k req/day (K) | TRON | USDT-TRC20 flows (huge stablecoin volume) | 6.4 | 🟡 |
| 4.1.5 | **mempool.space** | FREE + OPEN SOURCE | K | https://mempool.space/docs/api | Public: fair use, no key; WS | Bitcoin | Mempool, fees, blocks, address txs | 8.0 | 🟢 |
| 4.1.6 | **Blockchain.com Data API** | FREE | K | https://www.blockchain.com/explorer/api | Fair use | Bitcoin | Charts/stats endpoints (hashrate, tx count) | 6.5 | ⚪ |
| 4.1.7 | **Blockchair** | FREE TIER | K | https://blockchair.com/api/docs | 1440 req/day free (K) | BTC, ETH, LTC, DOGE, XRP, +15 | Multi-chain SQL-like queries | 6.0 | ⚪ |

### 4.2 RPC node providers

| # | Name | Label | Ver | Docs | Free limits | Chains | Extras | Score | Tier |
|---|---|---|---|---|---|---|---|---|---|
| 4.2.1 | **Alchemy** | FREE TIER | V | https://docs.alchemy.com | 30M CU/mo, 300 CU/s; no card | ETH, Base, Arbitrum, Optimism, Polygon, Solana, BNB, Avalanche +100 | Transfers API, Token API, **Webhooks (address activity)**, Prices API | 8.4 | 🔥 |
| 4.2.2 | **Helius** | FREE TIER | V | https://docs.helius.dev | 1M credits/mo, 10 RPS | Solana | DAS API, Webhooks (1 credit/push), Parsed Events | 8.2 | 🔥 (Solana) |
| 4.2.3 | **QuickNode** | FREE TIER | V(secondary) | https://www.quicknode.com/docs | 10M credits/mo | 60+ | Streams/Functions add-ons | 7.2 | ⚪ |
| 4.2.4 | **Infura (MetaMask Developer)** | FREE TIER | K | https://docs.metamask.io/services/ | 3M credits/day (K) | ETH, L2s, Polygon, Avalanche | Stable | 7.0 | ⚪ |
| 4.2.5 | **Ankr** | FREE TIER | K | https://www.ankr.com/docs/ | Public endpoints (rate-limited, no key) + free tier | 40+ | Advanced API (token balances, NFT) | 6.8 | ⚪ |
| 4.2.6 | **dRPC** | FREE TIER | V(secondary) | https://drpc.org/docs | 210M CU/mo against public nodes | 100+ | Good public-node fallback | 6.5 | ⚪ |
| 4.2.7 | **Chainstack** | FREE TIER | V(secondary) | https://docs.chainstack.com | 3M req/mo | Multi | | 6.5 | ⚪ |
| 4.2.8 | **Public RPCs** (chainlist.org, `api.mainnet-beta.solana.com`, `https://bsc-dataseed.binance.org`, etc.) | FREE | K | https://chainlist.org | 100–200 RPS/IP, 2–5s delay, no SLA | All | Emergency fallback only | 5.5 | ⚪ |

### 4.3 Analytics / query platforms

| # | Name | Label | Ver | Docs | Free limits | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 4.3.1 | **Dune** | FREE TIER (**shrinking**) | V | https://docs.dune.com | New accounts (after 2026-07-21): 2,500 credits/mo; legacy free → view-only from 2026-09-10; Analyst $65/mo | SQL over all major chains; Sim APIs; **treat as fragile dependency** | 6.8 | 🟡 |
| 4.3.2 | **The Graph** | FREE TIER (decentralized) | K | https://thegraph.com/docs | 100k queries/mo free on network (K); Subgraph Studio dev | Uniswap/Aave/Curve subgraphs; needs GRT billing beyond free | 7.0 | 🟡 |
| 4.3.3 | **Bitquery** | FREE TIER | K/NV | https://docs.bitquery.io | Free dev points (NV) | GraphQL + Kafka streams; DEX trades incl. Solana pump.fun | 6.8 | 🔵 |
| 4.3.4 | **Flipside Crypto** | FREE TIER | K/NV | https://docs.flipsidecrypto.xyz | Free SQL w/ limits (NV) | Dune alternative | 6.2 | ⚪ |
| 4.3.5 | **Covalent / GoldRush** | FREE TIER | K/NV | https://goldrush.dev/docs | Free key, credits (NV) | Unified multi-chain balances/txs | 6.3 | 🔵 |
| 4.3.6 | **Moralis** | FREE TIER | V(partial) | https://docs.moralis.com | Free: 150 CU/s throughput; monthly CUs ~40k (secondary source, NV) | Wallet, token, DEX price APIs; premium endpoints locked | 6.7 | 🟡 |
| 4.3.7 | **Glassnode** | FREE TIER (tier 1 metrics only) | K | https://docs.glassnode.com | Free API key → T1 metrics, 24h resolution, 10 req/min (K) | Exchange balances, SOPR, MVRV, etc. mostly paid | 6.0 | 🔵 |
| 4.3.9 | **Santiment (SanAPI)** | FREE TIER | K | https://api.santiment.net/graphiql | Free: limited metrics, 30-day lag on some (K) | Social + on-chain | 6.0 | 🔵 |
| 4.3.10 | **Artemis** | FREE TIER | K/NV | https://docs.artemisanalytics.com | Free key (NV) | Chain fundamentals (DAU, fees, revenue) | 6.0 | 🔵 |
| 4.3.11 | **Token Terminal** | FREE TIER (limited) | K/NV | https://docs.tokenterminal.com | Free = limited (NV) | Protocol revenue/P/S | 5.8 | 🔵 |
| 4.3.12 | **Google BigQuery public crypto datasets** | PUBLIC DATA | K | https://cloud.google.com/blockchain-analytics/docs | 1 TB/mo query free | BTC, ETH, Polygon, Solana, etc. — for batch research/backfill | 7.0 | 🟡 |

---

## 5. WHALE / SMART MONEY

| # | Name | Label | Ver | Docs | Free limits | What | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 5.1 | **Alchemy Webhooks (Address Activity) + Transfers API** | FREE TIER | V | https://docs.alchemy.com/reference/notify-api-quickstart | Included in 30M CU | Build own whale tracker: watch known exchange hot wallets, large ERC-20 transfers | 8.0 | 🔥 |
| 5.2 | **Helius Webhooks / Enhanced WS** | FREE TIER | V | https://docs.helius.dev/webhooks-and-websockets | 1 credit/push | Solana whale + token-account monitoring | 7.8 | 🟢 |
| 5.3 | **Hyperliquid Info API** (`clearinghouseState`, `userFills`, leaderboard) | FREE | K | see 2.12 | 1200 weight/min | **Fully transparent perp positions of every wallet** — smart-money tracking for free | 8.2 | 🔥 |
| 5.4 | **Whale Alert** | FREE TIER (limits NV) | NV | https://docs.whale-alert.io | Free plan historically 10 req/min, ≥$500k transfers, 1h lookback (NV) | Cross-chain large transfers | 6.0 | 🟡 |
| 5.5 | **Arkham Intelligence** | UNCERTAIN | NV | https://www.arkhamintelligence.com | API access historically gated/application | Entity labels | 5.0 | 🔵 |
| 5.7 | **Etherscan Name Tags / Label Cloud** | FREE TIER (2 calls/s) | V | see 4.1.1 | Name-tag endpoints 2 calls/s | Exchange wallet labels | 6.5 | 🟡 |
| 5.8 | **Community label datasets** (e.g., `dawsbot/eth-labels`, Dune `labels.*`) | OPEN SOURCE | K | GitHub | n/a | Seed own label DB | 6.0 | 🟡 |
| 5.9 | **DefiLlama CEX transparency** (`/protocols`, cex TVL) | FREE | K | https://defillama.com/docs/api | No key | Exchange reserve balances | 7.0 | 🟢 |
| 5.10 | **Binance `/sapi/v1/asset/…`** proof-of-reserves | n/a | K | — | Not API-friendly | Use DefiLlama instead | — | ⚪ |
| 5.11 | **Bubblemaps** | FREE web / API NV | NV | https://bubblemaps.io | NV | Holder clustering | 5.0 | 🔵 |


---

## 6. DEFI / DEX

| # | Name | Label | Ver | Docs | Free limits | What | WS | Score | Tier |
|---|---|---|---|---|---|---|---|---|---|
| 6.1 | **DexScreener API** | FREE | V | https://docs.dexscreener.com/api/reference | 300 req/min pairs/search/tokens; 60 req/min profiles/boosts; **no key**; **no OHLC/history endpoint** | Pairs, liquidity, txns, makers, boosts, new profiles; 300+ DEXs / 80+ chains | WS only for profiles/boosts/ads | 8.3 | 🔥 |
| 6.2 | **GeckoTerminal API** (via CoinGecko onchain endpoints) | FREE | V | https://apiguide.geckoterminal.com | Public: 30 req/min no key; via CG Demo key higher | **OHLCV for DEX pools**, new pools, trending pools, trades — fills DexScreener's history gap | No | 8.0 | 🔥 |
| 6.3 | **DefiLlama** | FREE + OPEN SOURCE | K | https://defillama.com/docs/api | No key; fair use | TVL, protocol fees/revenue, stablecoins, yields, bridges, DEX volumes, **`/coins/prices` price oracle**, CEX reserves | No | 8.6 | 🔥 |
| 6.4 | **Jupiter** (Solana) | FREE | K | https://dev.jup.ag/docs | Public API rate limits (free key via portal, NV) | Quote/price API, token list, new tokens | No | 7.5 | 🟢 |
| 6.5 | **Birdeye** | FREE TIER | K/NV | https://docs.birdeye.so | Free Standard key, low RPS (NV) | Solana + multichain token OHLCV, trades, holders, new listings | Paid | 6.8 | 🟡 |
| 6.6 | **Raydium API** | FREE | K | https://api-v3.raydium.io/docs | No key | Pools, liquidity | No | 6.5 | 🟡 |
| 6.7 | **Uniswap subgraphs** (The Graph) | FREE TIER | K | https://docs.uniswap.org/api/subgraph/overview | see 4.3.2 | Pools, swaps, fees | No | 7.0 | 🟡 |
| 6.8 | **PancakeSwap** (subgraph + `api.pancakeswap.info`) | FREE | K/NV | https://developer.pancakeswap.finance | NV | BSC DEX | No | 6.0 | 🟡 |
| 6.9 | **Curve API** (`api.curve.finance`) | FREE | K | https://api.curve.finance | No key | Pools, volumes, gauges | No | 6.2 | 🔵 |
| 6.10 | **1inch Spot Price / Swap API** | FREE TIER | K | https://portal.1inch.dev | Free dev key, 1 RPS (K) | Aggregated DEX quotes (slippage estimation) | No | 6.5 | 🟡 |
| 6.11 | **0x Swap API** | FREE TIER | K/NV | https://0x.org/docs | Free key (NV) | DEX aggregation quotes | No | 6.0 | 🔵 |
| 6.12 | **Aave / Compound / Morpho APIs & subgraphs** | FREE | K | protocol docs | No key | Lending rates, liquidations (DeFi) | No | 6.5 | 🔵 |
| 6.13 | **Pump.fun (via Bitquery / PumpPortal / community APIs)** | FREE / UNCERTAIN | NV | https://pumpportal.fun | PumpPortal WS free (NV) | Solana memecoin launches | Yes | 5.8 | 🔵 |
| 6.14 | **Stablecoin supply**: DefiLlama `/stablecoins`, **Circle/Tether transparency pages** (no API), **CoinGecko categories** | FREE | K | — | — | Stablecoin mcap, chain distribution | — | 7.5 | 🟢 |
| 6.15 | **Chainlink Data Feeds** (on-chain read via RPC) | FREE | K | https://docs.chain.link/data-feeds | RPC cost only | Oracle prices, useful for sanity checks | No | 6.5 | 🔵 |
| 6.16 | **NFT (if relevant)**: Reservoir (deprecated Oct 2025 → 🔴), **OpenSea API** (free key), **Alchemy NFT API**, **SimpleHash (shut down 2025 → 🔴)** | mixed | K | — | — | Low priority for LR | 4.5 | 🔵 |

---

## 7. NEWS

| # | Name | Label | Ver | Docs | Free limits | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 7.1 | **RSS feeds (direct)** — CoinDesk, CoinTelegraph, The Block, Decrypt, Bitcoin Magazine, Blockworks, DL News, Reuters (limited), CNBC, MarketWatch, Federal Reserve press releases | FREE | K | publisher `/feed` or `/rss` URLs | Poll every 1–5 min | **Zero-cost, zero-dependency backbone.** Headlines + summaries only; respect robots/ToS for full text | 8.5 | 🔥 |
| 7.2 | **Google News RSS** (`news.google.com/rss/search?q=bitcoin`) | FREE | K | — | Fair use, unofficial | Broad keyword coverage | 7.0 | 🟢 |
| 7.3 | **CryptoPanic API** | UNCERTAIN | NV | https://cryptopanic.com/developers/api/ | A 2026 secondary source states the free Developer plan was discontinued early 2026; site still says "free or paid API" | Votes/sentiment metadata valuable if free path exists → **verify before depending** | 6.0 | 🟡 |
| 7.4 | **cryptocurrency.cv** (open-source news API) | FREE + OPEN SOURCE | V(secondary) | https://github.com/nirholas/cryptocurrency.cv | No key; RSS/JSON; 660k-article archive w/ sentiment | Small project — use as backup, not primary | 6.3 | ⚪ |
| 7.5 | **NewsAPI.org** | FREE TIER | K | https://newsapi.org/docs | Developer: 100 req/day, 24h delay, **non-commercial**, localhost only | Dev/testing only | 5.0 | ⚪ |
| 7.6 | **GNews** | FREE TIER | K | https://gnews.io/docs | 100 req/day free | Backup | 5.0 | ⚪ |
| 7.7 | **NewsData.io** | FREE TIER | K | https://newsdata.io/documentation | 200 credits/day free (12h delay) | Backup | 5.2 | ⚪ |
| 7.8 | **Finnhub news** (`/news?category=crypto`, `/company-news`) | FREE TIER | V | https://finnhub.io/docs/api/market-news | 60 req/min free (personal use) | Good general + crypto news feed | 7.5 | 🟢 |
| 7.9 | **Marketaux** | FREE TIER | K | https://www.marketaux.com/documentation | 100 req/day | Entity-tagged financial news + sentiment | 5.5 | ⚪ |
| 7.10 | **GDELT 2.0** | PUBLIC DATA | K | https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ | Free, 15-min updates | Global news events/tone — macro narrative signal | 6.5 | 🔵 |
| 7.11 | **Federal Reserve, ECB, BoE, BoJ RSS / press pages; SEC press releases RSS; CFTC RSS** | PUBLIC DATA | K | central-bank sites | Free | Primary-source macro/regulatory breaking news | 8.0 | 🟢 |
| 7.12 | **Exchange announcement feeds** — Binance `/bapi/composite/v1/public/cms/article/list/query` (unofficial), Bybit/OKX/Coinbase announcement pages & RSS | FREE (unofficial) | K | — | Fair use | **New-listing detection** (see §18) | 7.8 | 🟢 |
| 7.13 | **CoinGecko `/news`** (deprecated) | 🔴 | K | — | removed | Do not use | — | 🔴 |

---

## 8. SOCIAL INTELLIGENCE

| # | Name | Label | Ver | Docs | Free limits | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 8.2 | **Reddit API** | FREE TIER | K | https://www.reddit.com/dev/api/ | OAuth: 100 req/min per client; non-commercial free; commercial requires agreement | r/CryptoCurrency, r/Bitcoin, r/wallstreetbets — mentions & sentiment | 7.5 | 🟢 |
| 8.3 | **Reddit JSON endpoints** (`/r/x/new.json`) | FREE (unofficial) | K | — | ~10 req/min unauth | Fallback | 6.0 | ⚪ |
| 8.4 | **Telegram Bot API** | FREE | K | https://core.telegram.org/bots/api | 30 msg/s bot; getUpdates | Read public channels where bot is admin; **also our alert channel (§20)** | 8.0 | 🟢 |
| 8.5 | **Telegram MTProto (Telethon / GramJS)** | OPEN SOURCE | K | https://docs.telethon.dev | User-account API; flood limits | Read any public channel (alpha groups, whale alert channels). ToS-sensitive | 7.0 | 🟡 |
| 8.6 | **YouTube Data API v3** | FREE TIER | K | https://developers.google.com/youtube/v3 | 10,000 units/day (search = 100 units) | Channel uploads, view velocity for crypto influencers | 6.5 | 🟡 |
| 8.7 | **Google Trends** (pytrends / unofficial; no official API) | FREE (unofficial) | K | https://github.com/GeneralMills/pytrends | Rate-limited, breaks periodically; `trends.google.com/trends/api` | Retail interest proxy ("bitcoin" search volume) | 6.0 | 🟡 |
| 8.8 | **Discord API (bot)** | FREE | K | https://discord.com/developers/docs | 50 req/s global | Read servers where bot invited; alerts output | 6.5 | 🟡 |
| 8.9 | **Farcaster (Neynar API)** | FREE TIER | K | https://docs.neynar.com | Free starter key (limits NV) | Crypto-native social graph | 5.8 | 🔵 |
| 8.10 | **Bluesky AT Protocol firehose** | FREE | K | https://docs.bsky.app | Public firehose, no key | Growing finance community; sentiment backup | 5.5 | 🔵 |
| 8.11 | **StockTwits API** | UNCERTAIN | NV | https://api.stocktwits.com/developers/docs | Public streams historically free; status NV | Bullish/bearish tagged messages | 5.5 | 🔵 |
| 8.12 | **LunarCrush** | FREE TIER (limited) | K/NV | https://lunarcrush.com/developers/api | Free tier reduced; NV | Social volume/galaxy score | 5.5 | 🔵 |
| 8.13 | **Nitter / scraping X** | 🔴 | K | — | Unreliable, ToS violation | Do not build on | — | 🔴 |
| 8.14 | **Pushshift** | 🔴 (dead for public) | K | — | Reddit archive closed 2023 | Use Arctic Shift dumps (academic) instead | — | 🔴 |

---

## 9. SENTIMENT

| # | Name | Label | Ver | Docs | Free limits | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 9.1 | **Alternative.me Fear & Greed** | FREE | K | https://alternative.me/crypto/fear-and-greed-index/ (`/fng/?limit=0`) | No key; full history to 2018 | **Canonical crypto F&G** | 8.5 | 🔥 |
| 9.2 | **CoinMarketCap Fear & Greed** (`/v3/fear-and-greed/latest`, `/historical`) | FREE TIER | K | CMC docs | Within Basic credits | Backup | 6.5 | ⚪ |
| 9.3 | **CNN Fear & Greed (stocks)** (`production.dataviz.cnn.io/index/fearandgreed/graphdata`) | FREE (unofficial) | K | — | Fair use, unofficial | Equity risk sentiment | 6.0 | 🟡 |
| 9.4 | **AAII Sentiment Survey** | PUBLIC DATA | K | https://www.aaii.com/sentimentsurvey | Weekly, download | Retail equity sentiment | 5.5 | 🔵 |
| 9.5 | **CFTC Commitments of Traders** (BTC/ETH futures, DXY, gold) | PUBLIC DATA | K | https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm ; Socrata API `publicreporting.cftc.gov` | Free, weekly (Fri) | Institutional positioning | 7.5 | 🟢 |
| 9.6 | **Santiment social metrics** | FREE TIER | K | see 4.3.9 | Limited | | 5.8 | 🔵 |
| 9.7 | **Own model: FinBERT / CryptoBERT / DistilRoBERTa-financial (HF)** | OPEN SOURCE | K | https://huggingface.co/ProsusAI/finbert ; `ElKulako/cryptobert` | Self-host or HF Inference free tier | News/social sentiment classification pipeline | 8.0 | 🔥 |
| 9.8 | **VADER / TextBlob** | OPEN SOURCE | K | pip | n/a | Fast baseline sentiment | 6.0 | 🟡 |
| 9.9 | **LLM zero-shot sentiment** (see §15) | FREE TIER | V | — | Groq/Gemini free | Highest quality per token on structured extraction | 8.0 | 🟢 |
| 9.10 | **Coinglass Fear & Greed / Bull Market Peak indicators** | web free / API paid | V | — | — | Reference only | — | 🔵 |

---

## 10. FUNDAMENTALS

| # | Name | Label | Ver | Docs | Free limits | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 10.1 | **SEC EDGAR APIs** (`data.sec.gov/submissions`, `xbrl/companyfacts`, `xbrl/frames`; full-text search `efts.sec.gov/LATEST/search-index`) | PUBLIC DATA | K | https://www.sec.gov/search-filings/edgar-application-programming-interfaces | 10 req/s; **User-Agent header required**; no key | Filings, XBRL financials, **Form 4 insider trades**, **13F institutional holdings**, 8-K (incl. crypto-treasury companies, ETF filings) | 9.0 | 🔥 |
| 10.2 | **SEC EDGAR RSS** (latest filings by form type) | PUBLIC DATA | K | https://www.sec.gov/Archives/edgar/usgaap.rss.xml etc. | Free | Real-time 8-K/S-1/13F alerts | 7.5 | 🟢 |
| 10.3 | **Finnhub** | FREE TIER | V | https://finnhub.io/docs/api | 60 req/min; personal use; real-time US quotes + **free WebSocket** | Fundamentals, earnings calendar, insider transactions, ETF holdings (some paid), crypto candles | 8.0 | 🔥 |
| 10.4 | **Financial Modeling Prep (FMP)** | FREE TIER | V(secondary) | https://site.financialmodelingprep.com/developer/docs | 250 req/day free; many endpoints now paid | Statements, ratios, ETF holdings | 6.0 | 🟡 |
| 10.5 | **Alpha Vantage** | FREE TIER | V | https://www.alphavantage.co/documentation/ | 25 req/day, 5/min; no card | Fundamentals, 50+ TA indicators, FX, crypto, **economic indicators (CPI, GDP, Fed funds)** | 6.2 | 🟡 |
| 10.6 | **Twelve Data** | FREE TIER | V | https://twelvedata.com/docs | 800 req/day, 8/min; WS on paid | Stocks, FX, crypto, ETFs, indices | 6.8 | 🟡 |
| 10.7 | **Massive (ex-Polygon.io)** | FREE TIER | V | https://massive.com/docs (api.polygon.io still works) | 5 req/min, EOD, 2-yr history free | Best docs; options chain (paid) | 6.3 | 🟡 |
| 10.8 | **EODHD** | FREE TIER | K | https://eodhd.com/financial-apis | 20 req/day free | Budget historical | 5.5 | ⚪ |
| 10.9 | **Tiingo** | FREE TIER | V(secondary) | https://www.tiingo.com/documentation | 1,000 req/day, 50/hr free | EOD + IEX quotes + crypto | 6.5 | ⚪ |
| 10.10 | **yfinance** (Yahoo, unofficial) | OPEN SOURCE (unofficial) | K | https://github.com/ranaroussi/yfinance | Unlimited-ish; breaks periodically | Research/backfill only; **never production-critical** | 6.5 | 🟡 |
| 10.11 | **Alpaca Market Data** | FREE TIER | V(secondary) | https://docs.alpaca.markets/docs/about-market-data-api | Free: IEX real-time (200 req/min), WS, crypto data | US stocks + crypto; needs account | 7.2 | 🟢 |
| 10.12 | **Nasdaq Data Link (ex-Quandl)** | FREE TIER (limited datasets) | K | https://docs.data.nasdaq.com | 50 req/day anon, 300/10s w/ key; many datasets paid | Some free macro/commodity series | 5.5 | ⚪ |
| 10.13 | **OpenInsider / Quiver Quant** | web / FREE TIER | K | https://www.quiverquant.com | Quiver free tier limited | Congress trading, insider — derived from 10.1 anyway | 5.5 | 🔵 |
| 10.14 | **US House / Senate financial disclosures** | PUBLIC DATA | K | https://disclosures-clerk.house.gov ; efdsearch.senate.gov | Free | Politician trades | 5.5 | 🔵 |
| 10.15 | **OpenBB Platform** | OPEN SOURCE | K | https://docs.openbb.co | Wraps many of the above | Python unified fundamentals layer | 7.0 | 🟡 |
| 10.16 | **Crypto ETF flows**: Farside Investors (web table, no API), **SEC N-PORT/13F**, **issuer pages** (BlackRock IBIT, Fidelity FBTC holdings CSV), CoinGlass (paid API) | PUBLIC DATA / scrape | K | https://farside.co.uk/btc/ | Scrape daily | Daily spot-ETF net flows — high-value, **no clean free API → RESEARCH GAP** | 6.5 | 🟢 |
| 10.17 | **Crypto fundamentals**: DefiLlama (fees/revenue), Token Terminal, Artemis, Messari, CoinGecko (supply, FDV), **Tokenomist/TokenUnlocks (web, API paid)** | mixed | K | — | — | Unlock schedules = RESEARCH GAP for free API | 6.5 | 🟡 |
| 10.18 | **IEX Cloud** | 🔴 DEAD (shut down Aug 2024) | K | — | — | Do not use | — | 🔴 |

---

## 11. MACRO ECONOMICS

| # | Name | Label | Ver | Docs | Free limits | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 11.1 | **FRED API** (St. Louis Fed) | PUBLIC DATA | K | https://fred.stlouisfed.org/docs/api/fred/ | Free key; 120 req/min | 800k+ series: CPI, PPI, GDP, unemployment, Fed funds, **Treasury yields (DGS2/DGS10)**, **DXY (DTWEXBGS)**, M2, balance sheet (WALCL), RRP, TGA. **Single most valuable macro source** | 9.3 | 🔥 |
| 11.2 | **ALFRED** (vintages) | PUBLIC DATA | K | same key | Free | Real-time data as-first-published (backtesting without look-ahead) | 7.0 | 🟡 |
| 11.3 | **BLS API v2** | PUBLIC DATA | K | https://www.bls.gov/developers/ | 500 req/day w/ key | CPI, NFP, unemployment direct from source (release-time precise) | 8.0 | 🟢 |
| 11.4 | **BEA API** | PUBLIC DATA | K | https://apps.bea.gov/API/signup/ | Free key | GDP, PCE | 7.0 | 🟡 |
| 11.5 | **US Treasury Fiscal Data API** | PUBLIC DATA | K | https://fiscaldata.treasury.gov/api-documentation/ | No key | Daily Treasury yields, debt, auctions, TGA | 8.0 | 🟢 |
| 11.6 | **Federal Reserve Data Download / FOMC calendar page** | PUBLIC DATA | K | https://www.federalreserve.gov/datadownload/ ; FOMC calendar HTML | Free | H.4.1, H.15; FOMC dates (scrape/maintain static JSON) | 7.0 | 🟡 |
| 11.7 | **CME FedWatch** | web only (no API) | K | https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html | — | Rate-cut probabilities. Alternatives: compute from FRED fed-funds futures proxies or **Polymarket/Kalshi Fed markets (§14)** | 5.0 | 🔵 |
| 11.8 | **ECB Data Portal API** | PUBLIC DATA | K | https://data.ecb.europa.eu/help/api/overview | No key (SDMX) | ECB rates, EUR data | 7.0 | 🟡 |
| 11.9 | **Bank of England IADB** | PUBLIC DATA | K | https://www.bankofengland.co.uk/boeapps/database/ | CSV download | | 6.0 | 🔵 |
| 11.10 | **BIS / IMF (SDMX, IMF Data API) / World Bank API** | PUBLIC DATA | K | https://data.imf.org ; https://api.worldbank.org/v2 | No key | Global macro, policy rates | 6.5 | 🔵 |
| 11.11 | **OECD API** | PUBLIC DATA | K | https://data.oecd.org/api/ | No key (SDMX) | CLI, inflation | 6.0 | 🔵 |
| 11.12 | **DBnomics** | PUBLIC DATA + OPEN SOURCE | K | https://api.db.nomics.world/v22/apidocs | No key | Aggregates 80+ statistical providers in one API — excellent FRED complement | 7.5 | 🟢 |
| 11.13 | **Economic calendar**: Finnhub `/calendar/economic` (paid on Finnhub → NV), **Trading Economics** (free API limited to guest indicators; full paid), **Forex Factory** (no API; XML feed `ff_calendar_thisweek.json` unofficial), **Investing.com** (no API, scrape = ToS issue), **Nasdaq economic calendar** (HTML) | UNCERTAIN / mixed | NV | https://docs.tradingeconomics.com | TE free: limited countries | **No robust free economic-calendar API → RESEARCH GAP.** Practical: build from BLS/BEA/Fed release schedules (published yearly) + FF JSON | 5.5 | 🟡 |
| 11.14 | **Alpha Vantage economic indicators** | FREE TIER | V | see 10.5 | 25/day | CPI, inflation, Fed funds, Treasury yields (redundant with FRED) | — | ⚪ |
| 11.15 | **US Treasury yield curve XML** (`home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml`) | PUBLIC DATA | K | | No key | Daily par yield curve | 7.0 | 🟡 |

---

## 12. FOREX

| # | Name | Label | Ver | Docs | Free limits | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 12.1 | **Frankfurter** | FREE + OPEN SOURCE | K | https://frankfurter.dev | No key, no limit stated; ECB daily reference rates | Best free daily FX; self-hostable | 8.0 | 🟢 |
| 12.2 | **ECB reference rates XML** | PUBLIC DATA | K | https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml | Free | Source of 12.1 | 7.0 | ⚪ |
| 12.3 | **ExchangeRate-API (open endpoint)** | FREE | K | https://www.exchangerate-api.com/docs/free | `open.er-api.com/v6/latest/USD`, daily, no key, attribution | Simple conversion | 6.5 | ⚪ |
| 12.4 | **exchangerate.host / Fixer / Currencylayer** (APILayer) | FREE TIER | K | https://exchangerate.host | 100 req/mo free | Weak free tier | 4.5 | ⚪ |
| 12.5 | **Open Exchange Rates** | FREE TIER | K | https://docs.openexchangerates.org | 1,000 req/mo, USD base only | | 5.0 | ⚪ |
| 12.6 | **Twelve Data / Finnhub / Alpha Vantage FX** | FREE TIER | V | see §10 | see §10 | Intraday FX incl. **DXY proxies (EURUSD, USDJPY…)**; Finnhub free has forex candles via OANDA/FXCM feeds | 7.0 | 🟢 |
| 12.7 | **OANDA v20 (practice account)** | FREE (demo) | K | https://developer.oanda.com/rest-live-v20/introduction/ | Demo account, real prices, 120 req/s | Real-time FX + streaming; needs demo signup | 7.5 | 🟢 |
| 12.8 | **Dukascopy historical tick data** | FREE (download) | K | https://www.dukascopy.com/swiss/english/marketwatch/historical/ | Bulk download (unofficial `dukascopy-node`) | Deep FX tick history for backtests | 6.5 | 🔵 |
| 12.9 | **Crypto-native FX**: Binance stablecoin pairs (EURUSDT, USDTTRY, USDTBRL) | FREE | K | see 2.1 | | 24/7 FX proxy + stablecoin premium signal | 7.0 | 🟡 |

---

## 13. COMMODITIES

| # | Name | Label | Ver | Docs | Free limits | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 13.1 | **FRED** (Gold LBMA `GOLDAMGBD228NLBM`, WTI `DCOILWTICO`, Brent `DCOILBRENTEU`, Henry Hub `DHHNGSP`, copper, wheat…) | PUBLIC DATA | K | see 11.1 | Daily, T+1 | Free daily commodity benchmarks | 8.0 | 🟢 |
| 13.2 | **EIA API v2** | PUBLIC DATA | K | https://www.eia.gov/opendata/ | Free key | Oil/gas inventories, prices — weekly petroleum status | 7.5 | 🟢 |
| 13.3 | **Finnhub / Twelve Data / Massive** (futures proxies: `GC=F` style tickers via ETFs GLD, USO, UNG; Twelve Data has commodities symbols) | FREE TIER | V | see §10 | see §10 | Intraday via ETFs | 6.5 | 🟡 |
| 13.4 | **Tokenized gold**: PAXG/USDT & XAUT/USDT on Binance/Bybit/OKX | FREE | K | see §2 | Real-time WS | **24/7 gold proxy** — very useful for crypto-native macro dashboards | 7.5 | 🟢 |
| 13.5 | **Metals.dev / GoldAPI.io / Metals-API** | FREE TIER | K | https://metals.dev | 100 req/mo–day free | Spot metals | 5.0 | ⚪ |
| 13.6 | **LBMA / CME** | web only | K | — | — | Official fixes, no free API | — | 🔵 |
| 13.7 | **yfinance futures** (`GC=F`, `CL=F`, `NG=F`) | OPEN SOURCE (unofficial) | K | see 10.10 | Delayed | Research only | 6.0 | ⚪ |
| 13.8 | **USDA / World Bank Pink Sheet** | PUBLIC DATA | K | https://www.worldbank.org/en/research/commodity-markets | Monthly | Long-horizon | 5.0 | 🔵 |

---

## 14. PREDICTION / FORECASTING

**Distinction:** *Prediction markets* = real crowd-priced probabilities (real data). *Forecast/ML services* = model outputs (opinions). Never present the latter as data.

| # | Name | Type | Label | Ver | Docs | Free limits | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|---|
| 14.1 | **Polymarket** (Gamma `gamma-api.polymarket.com`, CLOB `clob.polymarket.com`, Data API) | Market data | FREE | V | https://docs.polymarket.com | Gamma 4,000/10s, CLOB 9,000/10s, Data 1,000/10s; WS; no key for reads | Fed decisions, BTC price targets, ETF approvals, elections. **Geo-gated for trading, reads global** | 8.3 | 🔥 |
| 14.2 | **Kalshi API** | Market data | FREE (reads) | K | https://trading-api.readme.io | Public market/orderbook reads; trading auth | US-regulated: CPI, Fed, jobs markets — direct macro probabilities | 7.5 | 🟢 |
| 14.3 | **Metaculus API** | Forecast aggregation | FREE | K | https://www.metaculus.com/api/ | Free key, fair use | Long-horizon crypto/macro forecasts | 5.5 | 🔵 |
| 14.4 | **Manifold Markets API** | Play-money market | FREE | K | https://docs.manifold.markets/api | No key reads | Sentiment-ish only | 4.5 | 🔵 |
| 14.5 | **Deribit implied vol / options skew** | Market-implied forecast | FREE | K | see 2.11 | | Market's own probability distribution for BTC/ETH | 8.0 | 🔥 |
| 14.6 | **CME FedWatch / Fed-funds futures** | Market-implied | web | K | see 11.7 | | | — | 🔵 |
| 14.7 | **Kaggle / HF datasets** (BTC OHLCV, order-book snapshots, tweets) | ML datasets | PUBLIC DATA | K | https://www.kaggle.com/datasets ; https://huggingface.co/datasets | Free | Training/backtest data | 6.5 | 🔵 |
| 14.8 | **data.binance.vision** | ML dataset | FREE | K | https://data.binance.vision | Bulk daily/monthly zips: klines, trades, aggTrades, **bookDepth (futures), metrics (OI, L/S)** | **Best free historical derivatives dataset** | 8.5 | 🔥 |
| 14.9 | **Time-series foundation models** — Chronos (Amazon), TimesFM (Google), Moirai (Salesforce), Lag-Llama | Prediction (model) | OPEN SOURCE | K | HF | Self-host | Experimental; label outputs as model estimates | 5.0 | 🔵 |
| 14.10 | **Commercial "AI crypto prediction" APIs** (various) | Prediction (vendor) | PAID / UNCERTAIN | NV | — | — | 🔴 Do not integrate; unverifiable claims | — | 🔴 |
| 14.11 | **Nixtla TimeGPT** | Prediction (vendor) | FREE TIER (trial) | K/NV | https://docs.nixtla.io | Free trial credits (NV) | Forecast API; label as model output | 5.0 | 🔵 |

---

## 15. AI / LLM

| # | Name | Label | Ver | Docs | Free limits (2026-09) | Best use | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 15.1 | **Groq** | FREE TIER | V | https://console.groq.com/docs | ~30 RPM, ~1,000 RPD on flagship OSS models (e.g., gpt-oss-120b; 14.4k RPD on smaller Llama); ~200k TPD; no card | Fastest inference → real-time headline classification, structured extraction | 8.5 | 🔥 |
| 15.2 | **Google AI Studio (Gemini API)** | FREE TIER | V | https://ai.google.dev/gemini-api/docs/rate-limits | Flash/Flash-Lite free (≈10–30 RPM, 500–1,500 RPD depending on model); 1M context; **free-tier data used to improve Google products**; Search grounding paid only | Long-document summarization (filings, whitepapers), multimodal | 8.3 | 🔥 |
| 15.3 | **OpenRouter** (`:free` models) | FREE TIER | V | https://openrouter.ai/docs | 20 RPM, 50 RPD (<$10 lifetime credits) → 1,000 RPD (≥$10) | Single key → many providers; failover router | 7.5 | 🟢 |
| 15.4 | **Cerebras** | FREE TIER | V | https://inference-docs.cerebras.ai | ~30 RPM, 1M tokens/day, 8k context cap; no card | Ultra-fast classification backup | 7.0 | 🟢 |
| 15.5 | **Mistral (Experiment tier)** | FREE TIER | V | https://docs.mistral.ai | 2 RPM, 500k TPM, 1B tokens/mo (data-use terms) | Batch summarization; **embeddings (`mistral-embed`)** | 6.8 | 🟡 |
| 15.6 | **Cloudflare Workers AI** | FREE TIER | V | https://developers.cloudflare.com/workers-ai/ | 10,000 Neurons/day | Edge embeddings (`bge`), small LLMs, image classification | 7.0 | 🟢 |
| 15.7 | **Hugging Face Inference Providers / Serverless** | FREE TIER | K | https://huggingface.co/docs/inference-providers | Monthly free credits (small); rate-limited | FinBERT, CryptoBERT, embeddings (`bge-m3`, `e5`) | 7.2 | 🟢 |
| 15.8 | **NVIDIA NIM (build.nvidia.com)** | FREE TIER | V(secondary) | https://build.nvidia.com | Free credits to hosted models | Backup LLM | 6.0 | ⚪ |
| 15.9 | **GitHub Models** | FREE TIER | K | https://docs.github.com/en/github-models | Low RPM/RPD per model; GitHub account | Prototyping | 5.5 | ⚪ |
| 15.10 | **Ollama / vLLM / llama.cpp (self-host)** | OPEN SOURCE | K | https://ollama.com | Hardware cost only | Unlimited private inference; embeddings (`nomic-embed-text`) | 7.5 | 🟢 |
| 15.13 | **Embeddings (free paths)**: Cloudflare `bge-base`, Gemini `gemini-embedding`, Mistral `mistral-embed`, HF `bge-m3`, local `nomic-embed` | FREE TIER / OSS | V/K | — | — | Semantic news dedup, RAG over filings | 8.0 | 🟢 |
| 15.14 | **Vector DBs**: pgvector (OSS), Qdrant (OSS + 1 GB free cloud), Chroma (OSS), LanceDB (OSS) | OPEN SOURCE | K | — | — | pgvector recommended if Postgres already used | 8.0 | 🟢 |
| 15.15 | **Vision**: Gemini Flash (free) for chart-image parsing; Tesseract (OSS) for OCR | FREE TIER / OSS | V/K | — | — | Low priority | 6.0 | 🔵 |

**Reliability warning:** free LLM tiers change limits without notice and may train on inputs (Gemini free, Mistral Experiment). Never send user PII; implement provider-rotation (e.g., `freelm`-style failover).

---

## 16. SEARCH / KNOWLEDGE

| # | Name | Label | Ver | Docs | Free limits | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 16.1 | **Wikipedia / Wikidata APIs** | FREE | K | https://www.mediawiki.org/wiki/API ; https://query.wikidata.org | Fair use, User-Agent required | Entity resolution (companies, protocols, people) | 7.0 | 🟡 |
| 16.2 | **Wikimedia Pageviews API** | FREE | K | https://wikimedia.org/api/rest_v1/ | Fair use | "Bitcoin" article views = retail attention proxy (Google Trends alternative) | 7.0 | 🟢 |
| 16.3 | **Brave Search API** | FREE TIER | K | https://api.search.brave.com | 2,000 queries/mo free (1 QPS); card may be required | Best free web search API | 7.0 | 🟢 |
| 16.4 | **Tavily** | FREE TIER | K | https://docs.tavily.com | 1,000 credits/mo | LLM-optimized search + extract | 6.8 | 🟡 |
| 16.5 | **SerpAPI / Serper** | FREE TIER | K | serpapi.com ; serper.dev | SerpAPI 250/mo; Serper 2,500 one-time | Google results | 5.5 | ⚪ |
| 16.6 | **Exa** | FREE TIER | K | https://docs.exa.ai | $10 credits | Neural search | 5.5 | ⚪ |
| 16.7 | **DuckDuckGo (unofficial `duckduckgo-search`)** | FREE (unofficial) | K | PyPI | Rate-limited | Fallback | 5.0 | ⚪ |
| 16.8 | **SearXNG** | OPEN SOURCE | K | https://docs.searxng.org | Self-host | Private meta-search | 6.0 | 🔵 |
| 16.9 | **arXiv API / Semantic Scholar API** | FREE | K | https://info.arxiv.org/help/api ; api.semanticscholar.org | Fair use / 1 RPS free | q-fin research | 5.5 | 🔵 |
| 16.10 | **Common Crawl / Internet Archive Wayback API** | PUBLIC DATA | K | https://archive.org/help/wayback_api.php | Free | Historical page states (tokenomics pages, delisted announcements) | 5.5 | 🔵 |
| 16.11 | **Firecrawl / Jina Reader (`r.jina.ai`)** | FREE TIER | K | https://jina.ai/reader | Jina: 20 RPM no key; Firecrawl 500 credits one-time | URL → clean markdown for LLM ingestion | 7.0 | 🟢 |
| 16.12 | **Crawlee / Playwright / Scrapy** | OPEN SOURCE | K | — | n/a | Own scrapers (announcement pages, Farside, FF calendar) — respect robots.txt/ToS | 7.0 | 🟢 |
| 16.13 | **GitHub REST API** | FREE TIER | K | https://docs.github.com/rest | 5,000 req/hr w/ token | Protocol dev activity (commits, stars) as fundamental signal | 6.5 | 🔵 |
| 16.14 | **Awesome lists**: `public-apis/public-apis`, `narekgevorgyan/free-crypto-apis`, `cheahjs/free-llm-api-resources` | OPEN SOURCE | V | GitHub | — | Watchlist inputs for future discovery | — | 🔵 |

---

## 17. SECURITY / RISK

| # | Name | Label | Ver | Docs | Free limits | Chains | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|---|
| 17.1 | **GoPlus Security API** | FREE TIER | K | https://docs.gopluslabs.io | Free without key (low rate); free key raises limits (exact NV) | 20+ EVM chains + Solana | **Token security (honeypot, mintable, owner privileges, tax), malicious address, approval risk, dApp/phishing** — primary rug-pull screen | 8.3 | 🔥 |
| 17.2 | **Honeypot.is API** | FREE | K | https://honeypot.is (`api.honeypot.is/v2/IsHoneypot`) | No key, fair use | ETH/BSC/Base honeypot simulation | 7.0 | 🟢 |
| 17.3 | **Token Sniffer** | FREE TIER (API via Solidus) | K/NV | https://tokensniffer.com | API limits NV | Contract similarity, scam score | 6.0 | 🟡 |
| 17.4 | **RugCheck.xyz API** (Solana) | FREE | K | https://api.rugcheck.xyz/swagger/index.html | No key, fair use | Solana token risk score, LP lock, mint/freeze authority | 7.8 | 🟢 |
| 17.5 | **De.Fi Scanner / Rekt API** | FREE TIER | K/NV | https://docs.de.fi | Free key (NV) | Contract scan; exploit database (rekt) | 6.0 | 🟡 |
| 17.6 | **Etherscan contract source/ABI + verified flag** | FREE TIER | V | see 4.1.1 | 3 calls/s | Verified-source check | 7.5 | 🟢 |
| 17.7 | **Sourcify** | OPEN SOURCE + FREE | K | https://docs.sourcify.dev | No key | Contract verification across chains | 6.5 | 🟡 |
| 17.8 | **Slither / Mythril (static analysis)** | OPEN SOURCE | K | GitHub | Self-run | Deep contract analysis (batch, not real-time) | 5.5 | 🔵 |
| 17.9 | **Chainabuse (TRM) API** | FREE TIER | K/NV | https://www.chainabuse.com/api | NV | Scam reports | 5.5 | 🔵 |
| 17.10 | **CryptoScamDB / ScamSniffer lists** | OPEN SOURCE | K | GitHub | n/a | Phishing domain/address blocklists | 6.0 | 🟡 |
| 17.11 | **Forta Network** | FREE TIER (alerts) | K/NV | https://docs.forta.network | Public alert API (NV) | Real-time exploit detection bots | 6.0 | 🔵 |
| 17.12 | **DefiLlama `/hacks`** | FREE | K | see 6.3 | — | Exploit history dataset | 6.5 | 🟡 |
| 17.14 | **Regulatory info**: SEC/CFTC press RSS (§7.11), **Federal Register API** (free), **EUR-Lex / ESMA MiCA registers** (public), CoinGecko exchange `trust_score`, **Regulations.gov API** (free key) | PUBLIC DATA | K | https://www.federalregister.gov/developers/documentation/api/v1 | Free | Regulatory event tracking | 6.5 | 🟡 |

---

## 18. TOKEN DISCOVERY

| # | Name | Label | Ver | Docs | Free limits | What | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 18.1 | **DexScreener** `/token-profiles/latest/v1`, `/token-boosts/latest/v1`, WS profiles | FREE | V | see 6.1 | 60 req/min | New token profiles, boosted (paid promo) tokens | 8.0 | 🔥 |
| 18.2 | **GeckoTerminal** `/networks/{n}/new_pools`, `/trending_pools` | FREE | V | see 6.2 | 30 req/min | New pools with OHLCV | 8.0 | 🔥 |
| 18.3 | **CoinGecko** `/search/trending`, `/coins/list/new`, `/coins/markets` (recently added) | FREE TIER | V | see 3.1 | Demo credits | Trending & newly listed on CG | 7.5 | 🟢 |
| 18.4 | **Exchange listing announcements** (§7.12) + **exchangeInfo diff** (Binance `/api/v3/exchangeInfo`, Bybit `/v5/market/instruments-info`, OKX `/public/instruments`, Bitget, Gate, MEXC, KuCoin symbol lists polled every 30–60s) | FREE | K | — | Public limits | **Most reliable CEX new-listing detector** (diff symbol sets) | 8.5 | 🔥 |
| 18.5 | **Hyperliquid `meta`** (new perp listings) | FREE | K | see 2.12 | | Perp-DEX listings | 7.0 | 🟢 |
| 18.6 | **Jupiter token list / Birdeye new listings** | FREE / FREE TIER | K | see 6.4, 6.5 | | Solana | 7.0 | 🟢 |
| 18.7 | **Pump.fun / Moonshot / launchpad feeds** (PumpPortal WS, Bitquery) | UNCERTAIN | NV | see 6.13 | | Memecoin launches (noisy) | 5.5 | 🔵 |
| 18.8 | **Uniswap `PoolCreated` / PancakeSwap `PairCreated` events** via Alchemy webhooks / eth_getLogs | FREE TIER | V | see 4.2.1 | CU cost | Zero-latency new-pair detection on EVM | 7.8 | 🟢 |
| 18.9 | **Raydium `initialize2` program logs** via Helius webhooks | FREE TIER | V | see 4.2.2 | credits | Solana new pools | 7.5 | 🟢 |
| 18.10 | **CoinMarketCap `/cryptocurrency/listings/new`, `/trending/latest`** | FREE TIER | K | see 3.2 | credits | Backup | 6.5 | ⚪ |
| 18.11 | **ICO/IDO calendars** (CryptoRank, ICODrops, CoinList) | web / paid API | K | — | — | RESEARCH GAP for free API | 4.5 | 🔵 |

---

## 19. LIQUIDITY / MARKET INTELLIGENCE

| # | Signal | Free source(s) | Method | Score | Tier |
|---|---|---|---|---|---|
| 19.1 | **Order-book depth / imbalance** | Binance, Bybit, OKX, Coinbase, Hyperliquid WS | Maintain local L2 via diff streams; compute depth within ±0.5/1/2% | 9.0 | 🔥 |
| 19.2 | **Spread** | Exchange bookTicker WS (`<symbol>@bookTicker`) | Best bid/ask per venue | 9.0 | 🔥 |
| 19.3 | **Slippage estimation (CEX)** | Local L2 | Walk the book for $X notional | 8.5 | 🔥 |
| 19.4 | **Slippage (DEX)** | 1inch/0x/Jupiter quote APIs; GeckoTerminal pool reserves | Quote size ladder | 7.5 | 🟢 |
| 19.5 | **Cross-exchange price differences / arbitrage** | All §2 tickers via CCXT | Normalize symbols; account for fees & withdrawal status (`/sapi/v1/capital/config/getall` requires key → use CoinGecko `/exchanges/{id}/tickers` `trust_score`/`is_stale` as free proxy) | 8.5 | 🔥 |
| 19.6 | **Liquidity heatmap (liquidation clusters)** | No free vendor (none free) | Approximate from OI change + price + leverage assumptions; label as estimate | 6.0 | 🔵 |
| 19.7 | **Volume profile / VWAP** | Exchange klines/aggTrades | Compute | 8.0 | 🟢 |
| 19.8 | **Exchange volume share / dominance** | CoinGecko `/exchanges`, DefiLlama DEX volumes | | 7.5 | 🟢 |
| 19.9 | **Stablecoin premium/discount** (USDT/USD, USDC/USDT, USDT/TRY) | Kraken USDTUSD, Coinbase USDTUSD, Binance pairs | Risk-on/off & regional stress | 7.5 | 🟢 |
| 19.10 | **Perp-spot basis & funding term structure** | Binance `/futures/data/basis`, quarterly futures, Deribit futures | Compute annualized basis | 8.5 | 🔥 |
| 19.12 | **Whale limit orders / spoofing detection** | Local L2 diff stream | Detect large adds/cancels | 7.0 | 🟡 |
| 19.13 | **Historical L2 (backtesting)** | data.binance.vision `bookDepth` (futures, 1s snapshots, limited levels); Tardis.dev (paid), Kaiko (paid) | Record own L2 from day one | 6.5 | 🟡 |
| 19.14 | **CVD / taker flow** | aggTrade WS (`m` maker flag) | Compute per venue | 8.5 | 🔥 |

---

## 20. ALERTS / NOTIFICATIONS

| # | Name | Label | Ver | Docs | Free limits | Notes | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 20.1 | **Telegram Bot API** | FREE | K | https://core.telegram.org/bots/api | 30 msg/s overall, 20 msg/min per group; unlimited | **Primary alert channel**; inline buttons, channels | 9.5 | 🔥 |
| 20.2 | **Discord Webhooks / Bot** | FREE | K | https://discord.com/developers/docs/resources/webhook | 30 req/min per webhook | Embeds, community | 9.0 | 🔥 |
| 20.3 | **Web Push (VAPID) via `web-push` lib** | FREE + OPEN SOURCE | K | https://developer.mozilla.org/docs/Web/API/Push_API | Browser vendors' services, free | PWA push — no third party needed | 8.5 | 🔥 |
| 20.4 | **Firebase Cloud Messaging** | FREE | K | https://firebase.google.com/docs/cloud-messaging | Unlimited free | Mobile push (Android/iOS/web) | 8.5 | 🟢 |
| 20.5 | **OneSignal** | FREE TIER | K | https://documentation.onesignal.com | 10k web subscribers free (K) | Managed push alternative | 7.0 | ⚪ |
| 20.6 | **Resend** | FREE TIER | K | https://resend.com/docs | 3,000 emails/mo, 100/day | Transactional email | 8.0 | 🟢 |
| 20.7 | **Brevo (ex-Sendinblue)** | FREE TIER | K | https://developers.brevo.com | 300 emails/day | Email backup | 7.0 | ⚪ |
| 20.8 | **Amazon SES** | FREE TIER (12 mo) | K | AWS | 3,000/mo first 12 months | Scale path | 6.5 | ⚪ |
| 20.9 | **ntfy.sh** | FREE + OPEN SOURCE | K | https://docs.ntfy.sh | Public server free; self-host | Simple pub/sub push (ops alerts) | 7.5 | 🟡 |
| 20.10 | **Pushover** | one-time $5 | K | https://pushover.net/api | 10k msg/mo after $5 | Personal ops alerts | 6.0 | ⚪ |
| 20.11 | **Twilio SMS** | trial credit only | K | twilio.com | ~$15 trial | No free SMS at scale; skip | 4.0 | 🔵 |
| 20.12 | **Slack Incoming Webhooks** | FREE | K | https://api.slack.com/messaging/webhooks | 1 msg/s | Team ops | 7.5 | 🟡 |
| 20.13 | **Generic webhooks (own) / Svix (5k/mo free) / Hookdeck** | FREE TIER | K | https://docs.svix.com | Svix 5k msgs/mo | Outbound webhooks for API users | 6.5 | 🔵 |
| 20.14 | **Apprise** | OPEN SOURCE | K | https://github.com/caronc/apprise | n/a | One library → 100+ notification services | 7.5 | 🟢 |

---

## 21. UTILITY (geo / time / infra)

| # | Name | Label | Ver | Docs | Free limits | Use | Score | Tier |
|---|---|---|---|---|---|---|---|---|
| 21.1 | **ip-api.com** | FREE (non-commercial) / ipinfo.io (50k/mo) / MaxMind GeoLite2 (free DB) | K | — | ip-api 45 req/min | Geo-fencing compliance (block restricted regions), timezone for users | 7.0 | 🟡 |
| 21.2 | **TimeAPI.io / WorldTimeAPI** | FREE | K | https://timeapi.io | Fair use | Timezone conversion — better done locally (`Intl`, `luxon`, IANA tz db) | 5.0 | ⚪ |
| 21.3 | **Nager.Date holidays** + **NYSE holiday calendar (static)** | FREE / OPEN SOURCE | K | https://date.nager.at/Api | Fair use | Market-hours / holiday awareness | 6.5 | 🟡 |
| 21.4 | **Cloudflare Workers / Pages, Vercel, Fly.io free tiers** | FREE TIER | K | — | CF Workers 100k req/day | Edge collectors/cron | 8.0 | 🟢 |
| 21.5 | **Upstash Redis / QStash** | FREE TIER | K | https://upstash.com/docs | 500k cmds/mo; QStash 500 msgs/day | Serverless cache + scheduler | 7.5 | 🟢 |
| 21.6 | **Supabase / Neon Postgres** | FREE TIER | K | — | Supabase 500 MB; Neon 0.5 GB | Storage + pgvector | 8.0 | 🟢 |
| 21.7 | **TimescaleDB / ClickHouse / QuestDB** | OPEN SOURCE | K | — | Self-host | Tick/candle storage; ClickHouse Cloud trial | 8.0 | 🟢 |
| 21.8 | **Grafana Cloud** | FREE TIER | K | — | 10k series, 50 GB logs | Ops dashboards | 7.0 | 🟡 |
| 21.9 | **Healthchecks.io / UptimeRobot / Better Stack** | FREE TIER | K | — | 20 checks / 50 monitors | Collector liveness | 7.0 | 🟡 |

---

# PART II — LIQUIDITY RADAR API MAP

## 22. CURRENTLY USED  *(fill in — repo not inspected)*

| Provider | Module/feature in LR | Endpoint types | Key required | Notes |
|---|---|---|---|---|
| _e.g., Binance_ | _order book, funding_ | _REST + WS_ | _no_ | |
| | | | | |

> **Action:** run `grep -rniE "binance|bybit|okx|coingecko|coinglass|etherscan|alchemy|helius|dexscreener|defillama|cryptopanic|finnhub|fred" src/ | cut -d: -f1 | sort -u` in the repo and paste results here.

## 23. IMMEDIATE NEXT (0–4 weeks)
1. **CCXT** as unified exchange abstraction (if not already) → instant Bybit/OKX backups for every Binance call.
2. **Binance + Bybit + OKX derivatives trio**: funding, OI, L/S, liquidation WS — aggregate, don't depend on one.
3. **CoinGecko Demo key** (metadata, categories, trending, GeckoTerminal onchain) — register key, stop using keyless.
4. **Alternative.me F&G** + **FRED** (DXY, DGS10, WALCL) → macro overlay with 2 trivial integrations.
5. **DexScreener + GeckoTerminal** → DEX liquidity & new pools.
6. **DefiLlama** → TVL, stablecoins, CEX reserves, price oracle backup.
7. **RSS news backbone** (10–15 feeds) + **Groq/Gemini** classification → replace/augment any paid news API.
8. **Telegram + Discord + Web Push** alert transports.

## 24. PHASE 3/4
- **Alchemy Webhooks + Helius Webhooks** → whale/exchange-flow scanner with own label DB (Etherscan tags + OSS labels).
- **Hyperliquid Info API** → transparent smart-money perp positions & leaderboard.
- **GoPlus + RugCheck + Honeypot.is** → token risk gate before surfacing any new token.
- **SEC EDGAR** (Form 4, 13F, 8-K) → institutional/insider module; ETF holdings from issuer CSVs.
- **Polymarket + Kalshi** → event-probability panel (Fed, CPI, BTC targets).
- **Deribit** → IV/skew/DVOL, market-implied distributions.
- **Exchange `exchangeInfo` differ** → CEX listing sniper.
- **Reddit + Telegram (MTProto) + YouTube** → social velocity metrics; **Wikipedia pageviews** as Google Trends stand-in.
- **data.binance.vision** bulk backfill → historical OI/L-S/bookDepth for backtests.

## 25. FUTURE
- The Graph / Dune paid tiers for protocol-level analytics.
- Time-series foundation models as clearly-labelled experimental forecasts.
- Own recorded L2 archive → proprietary liquidity heatmap (replaces Coinglass need).

## 26. BACKUPS (never single-provider)

| Function | Primary | Backup 1 | Backup 2 |
|---|---|---|---|
| Spot/perp market data | Binance | Bybit | OKX |
| Order book | Binance WS | Bybit WS | Coinbase WS (spot), Hyperliquid (perp) |
| Funding/OI/L-S | Binance | Bybit | OKX |
| Liquidations (live) | Binance `!forceOrder` | Bybit `allLiquidation` | OKX `liquidation-orders` |
| Options/IV | Deribit | Binance `eapi` | Bybit option |
| Coin metadata/prices | CoinGecko | CoinMarketCap | CoinPaprika → DefiLlama `/coins/prices` |
| DEX pairs | DexScreener | GeckoTerminal | Birdeye (Sol) / Uniswap subgraph |
| DEX OHLCV | GeckoTerminal | Birdeye | Bitquery |
| EVM chain data | Etherscan V2 | Blockscout | Alchemy Transfers API |
| EVM RPC | Alchemy | Infura | dRPC / public RPC |
| Solana | Helius | QuickNode | Solana public RPC + Solscan |
| Bitcoin | mempool.space | Blockchain.com | Blockchair |
| Whale transfers | Own (Alchemy/Helius webhooks) | Whale Alert | Hyperliquid positions (perp) |
| Token security | GoPlus | Honeypot.is / RugCheck | Token Sniffer |
| News | RSS (direct) | Finnhub news | Google News RSS → CryptoPanic (if free) |
| Fear & Greed | Alternative.me | CMC F&G | — |
| Macro series | FRED | DBnomics | BLS/BEA/Treasury direct |
| FX | Frankfurter | Finnhub FX | open.er-api.com |
| Commodities | FRED | EIA | PAXG/XAUT pairs (24/7) |
| Stocks/ETF | Finnhub | Twelve Data | Alpaca / Massive |
| Filings | SEC EDGAR | — (primary source) | FMP |
| Prediction markets | Polymarket | Kalshi | Metaculus |
| LLM | Groq | Gemini | OpenRouter → Cerebras → self-host |
| Embeddings | Cloudflare Workers AI | Gemini embeddings | local nomic-embed |
| Search | Brave | Tavily | Jina Reader + DDG |
| Alerts | Telegram | Discord | Web Push / Resend email |

---

## 27. FEATURE → API MAPPING

| Liquidity Radar Feature | Required Data | Best Free API | Backup | Real-time | Historical | Priority |
|---|---|---|---|---|---|---|
| Order Book Radar | L2 depth, imbalance | Binance depth WS | Bybit / OKX WS | Yes (100ms) | No (record own) | Critical |
| Spread & Slippage Monitor | bookTicker, L2 | Binance bookTicker WS | Bybit / OKX | Yes | Record own | Critical |
| Funding Rate Dashboard | Funding live+hist | Binance premiumIndex / fundingRate | Bybit, OKX | Yes (8h/1h) | Full (Binance) | Critical |
| Open Interest Tracker | OI live+hist | Binance openInterest / openInterestHist | Bybit, OKX | Yes | 30d (free); deep via data.binance.vision | Critical |
| Liquidation Feed | Forced orders | Binance `!forceOrder@arr` | Bybit, OKX WS | Yes (throttled) | No free (record own) | Critical |
| Long/Short Ratio | Global/top-trader L/S | Binance futures/data | OKX rubik, Bybit | 5m | 30d + bulk | High |
| CVD / Taker Flow | aggTrades | Binance aggTrade WS | Bybit, OKX | Yes | data.binance.vision | High |
| Basis & Term Structure | Perp/quarterly/spot | Binance basis + Deribit futures | OKX | Yes | Yes | High |
| Volatility Panel | IV, DVOL, RV | Deribit | Binance eapi | Yes | Yes | High |
| Cross-Exchange Arb Scanner | Multi-venue tickers | CCXT (Binance/Bybit/OKX/Coinbase/Kraken) | Direct REST | Yes | No | High |
| Whale Transfer Scanner | Large transfers, labels | Alchemy webhooks + Etherscan tags | Whale Alert | Yes | Alchemy Transfers API | High |
| Exchange Flow Monitor | Labelled wallet txs | Own label DB + Alchemy/Helius | DefiLlama CEX reserves | Yes | Partial | High |
| Smart-Money Perp Tracker | Wallet positions | Hyperliquid Info API | — | Yes | userFills | High |
| Solana Whale/Token Monitor | Token account changes | Helius webhooks | Solscan | Yes | Helius | Medium |
| Bitcoin Mempool/Fees | Mempool, fees | mempool.space | Blockchain.com | Yes (WS) | Yes | Medium |
| DEX Liquidity Radar | Pairs, liquidity, txns | DexScreener | GeckoTerminal | ~Real-time | GeckoTerminal OHLCV | High |
| New Token / Pair Discovery | New pools, profiles | DexScreener + GeckoTerminal new_pools | Alchemy `PoolCreated` logs | Yes | No | High |
| CEX Listing Sniper | Symbol list diffs + announcements | Exchange exchangeInfo endpoints | Announcement feeds | Yes (30–60s) | No | High |
| Token Risk Gate | Honeypot, owner privileges, LP lock | GoPlus | RugCheck / Honeypot.is | Yes | No | Critical (for discovery) |
| Trending Tokens | Trending/search | CoinGecko trending | CMC trending, DexScreener boosts | 10m | No | Medium |
| Stablecoin Monitor | Supply, peg, premium | DefiLlama stablecoins + Kraken USDTUSD | CoinGecko | Yes | Yes | Medium |
| TVL / DeFi Health | TVL, fees, revenue | DefiLlama | The Graph | Hourly | Yes | Medium |
| News Feed + Classification | Headlines | RSS (multi) + Groq | Finnhub news | 1–5 min | Own archive | High |
| Breaking Macro/Regulatory Alerts | Primary-source releases | Fed/SEC/CFTC/BLS RSS | Google News RSS | Yes | No | High |
| Sentiment Index | F&G + news/social sentiment | Alternative.me + FinBERT/LLM | CMC F&G | Daily / streaming | 2018+ | High |
| Social Velocity | Mentions/velocity | Reddit API + Telegram | YouTube, Wikipedia pageviews | Yes | Limited | Medium |
| Macro Dashboard | CPI, rates, yields, DXY, balance sheet | FRED | DBnomics / BLS / Treasury | Daily | Deep | High |
| Economic Calendar | Release schedule | BLS/BEA/Fed schedules (static JSON) + FF JSON | Trading Economics guest | Yes | — | High (GAP) |
| Fed Probability Panel | Rate-decision odds | Polymarket + Kalshi | Fed-funds futures proxies | Yes | Yes (Polymarket) | Medium |
| FX Overlay | Majors, DXY proxy | Finnhub FX / Frankfurter | OANDA demo | Intraday/daily | Yes | Medium |
| Gold/Oil Overlay | Spot benchmarks | FRED + PAXG/XAUT pairs | EIA, Twelve Data | Daily / 24/7 | Yes | Medium |
| Equity Risk Context | SPX/NDX/VIX proxies (SPY, QQQ, VIXY) | Finnhub | Alpaca / Twelve Data | Real-time (IEX) | Yes | Medium |
| Insider & Institutional | Form 4, 13F | SEC EDGAR | FMP | Near-real-time RSS | Full | Medium |
| Crypto ETF Flows | Daily net flows, holdings | Issuer CSVs + Farside (scrape) | SEC N-PORT | Daily | Yes | Medium (GAP) |
| Regulatory Tracker | Rules, enforcement | Federal Register API + SEC/CFTC RSS | Regulations.gov | Daily | Yes | Low |
| Protocol Dev Activity | Commits, releases | GitHub API | — | Daily | Yes | Low |
| AI Summaries / Briefs | LLM | Groq / Gemini | OpenRouter / self-host | — | — | High |
| Semantic News Dedup / RAG | Embeddings + vector DB | Cloudflare Workers AI + pgvector | Gemini embeddings | — | — | Medium |
| User Alerts | Push transport | Telegram | Discord / Web Push / Resend | Yes | — | Critical |
| Geo-Compliance | IP geolocation | MaxMind GeoLite2 (local DB) | ipinfo.io | — | — | Medium |
| Backtesting Data Lake | Bulk history | data.binance.vision | Exchange REST klines | — | Deep | Medium |
| Token Unlock Calendar | Vesting schedules | — (GAP) | none | — | — | Future |

---

# PART III — DO NOT RESEARCH AGAIN

## 28. CORE APIs (primary providers — memorize)
Binance · Bybit · OKX · Deribit · Hyperliquid · CCXT · CoinGecko (Demo + GeckoTerminal) · DexScreener · DefiLlama · Etherscan V2 · Alchemy · Helius · mempool.space · GoPlus · Alternative.me F&G · FRED · SEC EDGAR · Finnhub · Polymarket · Groq · Gemini · Telegram Bot API · Discord · Direct RSS feeds

## 29. BACKUP APIs
Coinbase · Kraken · KuCoin · Gate · MEXC · Bitget · CoinMarketCap · CoinPaprika · Blockscout · Infura · QuickNode · dRPC · Whale Alert · Honeypot.is · RugCheck · Twelve Data · Alpaca · Massive · DBnomics · BLS · Treasury Fiscal Data · Frankfurter · Kalshi · OpenRouter · Cerebras · Cloudflare Workers AI · Resend · Web Push · CMC F&G · Finnhub news · Google News RSS

## 30. API WATCHLIST (re-check quarterly)
| API | Why watch | Re-check |
|---|---|---|
| CryptoPanic | Confirm whether a free developer plan still exists | 2026-12 |
| Dune | Free-tier policy in flux (Sept 2026 change) | 2026-12 |
| Etherscan V2 free chain list | More chains may move to paid | 2026-12 |
| X API | Pricing changed twice in 2026; watch for read allowances | 2026-12 |
| CoinMarketCap WebSocket | "Under development" — could add free real-time | 2027-03 |
| CoinGecko Demo rate limit | Docs show 100/min vs older 30/min — confirm on own key | 2026-10 |
| Moralis free monthly CUs | Only secondary-source figure (40k) | 2026-10 |
| Whale Alert free plan | Limits unverified | 2026-10 |
| Bitquery / Birdeye / Jupiter free limits | Unverified exact numbers | 2026-10 |
| Google Trends | Any official API launch | 2027-01 |
| Farcaster/Bluesky | Crypto-social migration off X | 2027-01 |
| Solana Foundation RPC monitor / new free RPCs | Provider churn | 2027-01 |
| Mobula, Artemis, Token Terminal | Free-tier scope | 2027-01 |
| Trading Economics / calendar vendors | Any free calendar API | 2026-12 |
| Groq / Gemini free limits | Change without notice | monthly |

## 31. DEAD / DEPRECATED — DO NOT USE
| API | Status |
|---|---|
| IEX Cloud | Shut down Aug 2024 |
| Twitter API v1.1 / free v2 tier | Discontinued for new devs Feb 2026 |
| Pushshift (public) | Closed 2023 |
| Reservoir NFT API | Deprecated Oct 2025 |
| SimpleHash | Shut down 2025 |
| CoinGecko `/news`, `/global/decentralized_finance_defi` (check) | Removed/changed |
| Etherscan API V1 single-chain endpoints | Sunset 31 May 2025 → use V2 |
| CryptoCompare legacy brand | Rebranded CoinDesk Data; old host still works but migrate |
| Polygon.io brand | Renamed Massive (Oct 2025); endpoints unchanged |
| Nitter instances | Unreliable / ToS violation |
| Quandl (brand) | Now Nasdaq Data Link; most datasets paid |
| Coinbase Pro API | Sunset 2023 → Coinbase Exchange / Advanced Trade |
| Bybit V3/V2 APIs | Deprecated → V5 |
| Binance WS `wss://stream.binance.com:9443` for US | Blocked → binance.vision / Binance.US |
| CoinGecko Public (keyless) for production | 5–15 req/min shared — unusable at scale |

## 32. RESEARCH GAPS (need future investigation)
1. **Free economic-calendar API** with consensus/actual/previous — none robust; build from primary schedules.
2. **Free historical liquidation data** — none; start recording own from day one.
3. **Free historical L2 order books** — only data.binance.vision bookDepth (partial).
4. **Crypto ETF daily flows API** — Farside scrape / issuer CSVs only.
5. **Token unlock/vesting schedules** — paid vendors only.
6. **Exchange inflow/outflow as a service** — paid (CryptoQuant/Glassnode); own-label approach required.
7. **X/Twitter data at zero cost** — no legitimate path; decide budget or skip.
8. **Comprehensive free wallet-label dataset** — fragmented OSS sources; needs curation.
9. **CryptoPanic free API status** — conflicting sources.
10. **Free options data beyond Deribit/Binance/Bybit** (e.g., equity options for VIX/SPX) — Massive options is paid; CBOE delayed CSVs exist (check).
11. **Solana-specific free limits** (Birdeye, Jupiter portal, Solscan) — exact numbers unverified.
12. **Commercial-use licensing audit** for CoinGecko Demo, Finnhub free, Reddit API before monetization.

---

# PART IV — FINAL REPORT

1. **Total APIs/data sources catalogued:** ~190 (entries across §2–§21, including grouped items).
2. **Completely free (FREE/PUBLIC DATA, no meaningful cap):** ~85
3. **Free tier:** ~70
4. **Open-source/self-hostable:** ~25
5. **Paid-only:** 0 — excluded by policy (Coinglass, X API, Nansen, CryptoQuant, Kaiko, Tokenomist noted only as non-options in Research Gaps).
6. **Top 20 for Liquidity Radar:** Binance · Bybit · OKX · CCXT · Deribit · Hyperliquid · CoinGecko+GeckoTerminal · DexScreener · DefiLlama · Alchemy · Helius · Etherscan V2 · GoPlus · FRED · SEC EDGAR · Alternative.me F&G · Finnhub · Polymarket · Groq · Telegram Bot API
7. **Top per category:** 1 Binance · 2 Binance · 3 CoinGecko · 4 Alchemy · 5 Alchemy webhooks + Hyperliquid · 6 DefiLlama · 7 Direct RSS · 8 Reddit API · 9 Alternative.me · 10 SEC EDGAR · 11 FRED · 12 Frankfurter · 13 FRED/EIA · 14 Polymarket · 15 Groq · 16 Brave Search · 17 GoPlus · 18 DexScreener · 19 Binance WS (own computation) · 20 Telegram
8. **Biggest gaps:** historical liquidations & L2, economic calendar, ETF flows, X data cost, token unlocks, wallet labels.
9. **Recommended integration order:** §23 items 1–8 → §24 in listed order → §25.
10. **Monitor:** §30 watchlist.
11. **Files created:** `docs/LIQUIDITY-RADAR-FREE-API-MASTER-MAP.md`, `docs/LIQUIDITY-RADAR-API-QUICK-REFERENCE.md`, `docs/data/liquidity-radar-apis.json`. **Modified:** none.
12. **Verification status:** 25 high-impact items verified 2026-09-12 (V); remainder K (stable knowledge) or NV. All V/K/NV codes per row.
13. **Could not verify:** CryptoPanic free plan; Whale Alert free limits; Moralis monthly CUs; Bitquery/Birdeye/Jupiter/Solscan free limits; Arkham API access; StockTwits API status; LunarCrush free tier; Trading Economics free scope; Nixtla trial; Forta public alert API; De.Fi/Token Sniffer API limits; CoinCap v3 free tier; CoinDesk Data free limits.
