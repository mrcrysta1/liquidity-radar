# LIQUIDITY RADAR — API QUICK REFERENCE

Compiled 2026-09-12. Full details, scores and verification status: `LIQUIDITY-RADAR-FREE-API-MASTER-MAP.md`. Machine-readable: `data/liquidity-radar-apis.json`.

## 1. Core stack (use these first)

| Need | Use | Base URL | Key | Limit | Fallback |
|---|---|---|---|---|---|
| Spot/perp prices, klines, book, trades | Binance | `https://api.binance.com` / `https://fapi.binance.com` (US infra: `https://data-api.binance.vision`) | No | 6000 / 2400 weight/min/IP | Bybit → OKX |
| Funding, OI, L/S, basis | Binance futures | `/fapi/v1/premiumIndex`, `/fapi/v1/fundingRate`, `/fapi/v1/openInterest`, `/futures/data/openInterestHist`, `/futures/data/globalLongShortAccountRatio`, `/futures/data/basis` | No | as above | Bybit `/v5/market/*` → OKX `/api/v5/public/*`, `/rubik/stat/*` |
| Liquidations (live) | Binance WS | `wss://fstream.binance.com/ws/!forceOrder@arr` | No | 1 event/s/symbol | Bybit WS `allLiquidation.{symbol}` |
| Unified exchange layer | CCXT | npm `ccxt` / pip `ccxt` | No | per exchange | — |
| Options / IV / DVOL | Deribit | `https://www.deribit.com/api/v2/public/*` | No | 20 req/s | Binance `https://eapi.binance.com` |
| Perp DEX + wallet positions | Hyperliquid | `POST https://api.hyperliquid.xyz/info` | No | 1200 weight/min | — |
| Coin metadata, trending, categories | CoinGecko Demo | `https://api.coingecko.com/api/v3` header `x-cg-demo-api-key` | Yes (free) | 10k/mo, 30–100/min | CoinMarketCap Basic (15k credits/mo) |
| DEX pairs / liquidity | DexScreener | `https://api.dexscreener.com/latest/dex/*` | No | 300/min (pairs), 60/min (profiles) | GeckoTerminal |
| DEX OHLCV / new pools | GeckoTerminal | `https://api.geckoterminal.com/api/v2` | No | 30/min | Birdeye (Sol) |
| TVL, stablecoins, fees, CEX reserves, price oracle | DefiLlama | `https://api.llama.fi`, `https://stablecoins.llama.fi`, `https://coins.llama.fi` | No | fair use | CoinGecko |
| EVM explorer data | Etherscan V2 | `https://api.etherscan.io/v2/api?chainid=1&…` | Yes (free) | 3/s, 100k/day, selected chains | Blockscout instances |
| EVM RPC + webhooks + transfers | Alchemy | `https://{chain}.g.alchemy.com/v2/{KEY}` | Yes (free) | 30M CU/mo, 300 CU/s | Infura → dRPC |
| Solana RPC + webhooks | Helius | `https://mainnet.helius-rpc.com/?api-key=` | Yes (free) | 1M credits/mo, 10 RPS | QuickNode |
| Bitcoin mempool/fees | mempool.space | `https://mempool.space/api` + WS | No | fair use | Blockchain.com |
| Token security | GoPlus | `https://api.gopluslabs.io/api/v1/token_security/{chainId}?contract_addresses=` | Optional | low w/o key | Honeypot.is, RugCheck (Sol) |
| Fear & Greed | Alternative.me | `https://api.alternative.me/fng/?limit=0` | No | fair use | CMC `/v3/fear-and-greed/latest` |
| Macro series | FRED | `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=` | Yes (free) | 120/min | DBnomics `https://api.db.nomics.world/v22` |
| Filings, insiders, 13F | SEC EDGAR | `https://data.sec.gov/submissions/CIK##########.json`, `https://efts.sec.gov/LATEST/search-index?q=` | No (**User-Agent required**) | 10/s | — |
| Stocks, ETFs, FX, news, WS | Finnhub | `https://finnhub.io/api/v1` | Yes (free) | 60/min, personal use | Twelve Data (800/day) |
| FX daily | Frankfurter | `https://api.frankfurter.dev/v1/latest` | No | none stated | `https://open.er-api.com/v6/latest/USD` |
| Prediction markets | Polymarket | `https://gamma-api.polymarket.com`, `https://clob.polymarket.com` | No (reads) | 4k/10s Gamma | Kalshi |
| LLM (fast) | Groq | `https://api.groq.com/openai/v1` | Yes (free) | ~30 RPM, 1k RPD | Gemini → OpenRouter |
| LLM (long context) | Gemini | `https://generativelanguage.googleapis.com/v1beta` | Yes (free) | Flash: ~10–30 RPM, 500–1500 RPD | Groq |
| Embeddings | Cloudflare Workers AI | `@cf/baai/bge-base-en-v1.5` | Yes (free) | 10k Neurons/day | Gemini embeddings / local |
| Alerts | Telegram Bot | `https://api.telegram.org/bot{TOKEN}/sendMessage` | Yes (free) | 30 msg/s | Discord webhook, Web Push, Resend |

## 2. Key WebSocket streams

```
Binance spot:    wss://stream.binance.com:9443/stream?streams=btcusdt@depth@100ms/btcusdt@aggTrade/btcusdt@bookTicker
Binance futures: wss://fstream.binance.com/stream?streams=btcusdt@markPrice@1s/!forceOrder@arr/btcusdt@depth@100ms
Bybit:           wss://stream.bybit.com/v5/public/linear   {"op":"subscribe","args":["orderbook.50.BTCUSDT","allLiquidation.BTCUSDT","tickers.BTCUSDT"]}
OKX:             wss://ws.okx.com:8443/ws/v5/public        {"op":"subscribe","args":[{"channel":"books","instId":"BTC-USDT-SWAP"},{"channel":"liquidation-orders","instType":"SWAP"}]}
Coinbase:        wss://ws-feed.exchange.coinbase.com       {"type":"subscribe","product_ids":["BTC-USD"],"channels":["level2_batch","matches"]}
Deribit:         wss://www.deribit.com/ws/api/v2          {"method":"public/subscribe","params":{"channels":["deribit_volatility_index.btc_usd"]}}
Hyperliquid:     wss://api.hyperliquid.xyz/ws              {"method":"subscribe","subscription":{"type":"l2Book","coin":"BTC"}}
mempool.space:   wss://mempool.space/api/v1/ws             {"action":"want","data":["blocks","mempool-blocks","stats"]}
```

## 3. Bulk historical data (backfills)
- `https://data.binance.vision/?prefix=data/futures/um/daily/` → `klines`, `aggTrades`, `bookDepth`, `metrics` (OI, L/S, taker vol) as daily zips.
- Binance REST klines: 1000/req, paginate by `startTime`; full history to 2017 (spot) / 2019 (futures).
- FRED: full history per series in one call.
- Alternative.me F&G: `?limit=0` returns all since 2018.

## 4. Free-tier gotchas
- **Binance.com blocks US IPs** → `data-api.binance.vision` (market data only) or Binance.US.
- **CoinGecko keyless** = 5–15 req/min shared by IP. Always use Demo key. Demo = non-commercial.
- **Etherscan free** excludes Avalanche, Base, BNB, Optimism since Dec 2025 → Blockscout or $49 Lite.
- **DexScreener has no OHLC/history** → GeckoTerminal for candles.
- **Coinglass has no free API** (Hobbyist $29 personal; commercial ≥ $299 Standard).
- **X API has no free tier** (pay-per-use, $0.005/read).
- **Dune free tier** changed Sept 2026 (legacy free → view-only).
- **Gemini free tier trains on inputs**; Mistral Experiment too. No PII.
- **SEC EDGAR** requires `User-Agent: AppName contact@email` or you get blocked.
- **Finnhub / Reddit / CoinGecko Demo / Coinglass low tiers** are personal-use licences — audit before monetizing.
- **Liquidations & L2 have no free history** → start recording on day one.

## 5. Env var naming convention
```
COINGECKO_DEMO_KEY  ETHERSCAN_API_KEY  ALCHEMY_API_KEY  HELIUS_API_KEY
FRED_API_KEY  FINNHUB_API_KEY  GOPLUS_APP_KEY  GROQ_API_KEY  GEMINI_API_KEY
OPENROUTER_API_KEY  CF_ACCOUNT_ID  CF_AI_TOKEN  TELEGRAM_BOT_TOKEN  DISCORD_WEBHOOK_URL
RESEND_API_KEY  BRAVE_SEARCH_KEY  REDDIT_CLIENT_ID  REDDIT_CLIENT_SECRET  SEC_USER_AGENT
```
Never commit keys. All of the above have free registration paths.

## 6. Integration order
1. CCXT + Binance/Bybit/OKX derivatives → 2. CoinGecko Demo → 3. F&G + FRED → 4. DexScreener + GeckoTerminal + DefiLlama → 5. RSS + Groq classification → 6. Telegram/Discord/Web Push → 7. Alchemy/Helius webhooks (whales) → 8. GoPlus/RugCheck gate → 9. SEC EDGAR → 10. Polymarket/Kalshi → 11. Deribit vol → 12. Listing sniper (exchangeInfo diff).
