// What Radar AI knows about the site and the bot that is not live data.
//
// Hand-written from LIQUIDITY_RADAR_FEATURES_TECH.txt, actions.ts TABS,
// radar-worker/README.md and .github/workflows/trading-bot.yml. Update it when
// those change. It is ~1.4k tokens, so it is sent only when the question (or
// the one before it, for follow-ups) is about the site or the bot — a market
// question does not pay for it, which matters on the free tiers' per-minute
// token limits. The tab list itself is always sent (actions.ts appGuide).

export const PROJECT_KNOWLEDGE = `SITE AND BOT KNOWLEDGE (static facts; live numbers are in BOT STATUS when present)

THE SITE — Liquidity Radar, a free live market terminal.
- Data: Binance spot and futures over WebSocket (prices, order book, funding, open interest, liquidations, whale trades) for ~400 USDT pairs; spot gold/silver, FX majors, indices, crude and equities from Yahoo. Fear & Greed index, crypto news with sentiment, economic calendar.
- Dashboard: snapshot of price, top signals, liquidity, movers, liquidations, sentiment, headlines.
- Radar: one market in depth with live chart, funding, OI, long/short, key levels.
- Charts: lightweight-charts workspace, 40+ indicators, drawings, Heikin Ashi/Renko/range/line-break/Kagi/P&F bars, footprint/TPO, multi-chart layouts, replay, script indicators.
- Signals: scanner over 19 markets on 1H/4H/1D every 2 min; a master BUY/SELL/WAIT score (-100..100), conviction by timeframe agreement, ATR trade plans (stop 1.5×ATR, targets 1.5× and 3×), graded win rate.
- Screener: sortable crypto table (RSI, MACD, EMAs, volatility, performance, technical rating) with presets.
- Analysis: liquidation heatmap, volume profile, order flow, liquidation levels, Fibonacci zones.
- Neural Net: an in-browser TensorFlow.js direction model per market with holdout accuracy, plus sentiment and movers.
- Self Learning: the in-browser paper-trading engine and the SERVER BOT panels — Binance testnet account mirror, strategies card, planned trades, trade journal (real + shadow), "Is it on track?", go-live readiness checklist, bot trades on the chart.
- Also: price alerts, watchlists, whale scanner, Bubbles map, News, Settings → Learning library (guides, glossary, PDF), dark/light theme.
- Radar AI (this chat): answers from the terminal's live data; commands like "open SOL", "take me to signals", "teach me RSI" work even with no AI model connected.

THE BOT — a 24/7 trading bot (radar-worker) on the Binance Futures TESTNET: fake money only; it refuses to start against a real-money endpoint. It runs on GitHub Actions, decides on each closed 4h candle for 24 markets (BTC ETH SOL BNB AAVE ADA ARB AVAX BCH DOT ETC INJ NEAR UNI APT ATOM DOGE FIL LINK LTC OP SUI TRX XRP), and writes every trade, plan and event to Supabase, which the site reads (read-only).
Strategies (priority order; each decides on every bar; a live one's signal is a real testnet order if every risk rule passes, any other signal is that strategy's SHADOW trade — simulated, no order):
- F1 (live): long only. Entry at a 4h close above EMA(300) and above the highest high of the prior 20 bars. Exchange-side stop at entry − 3×ATR14, no target, no time exit. Trailing stop each 4h close = max(stop, highest high since entry − 4×ATR14), never lowered. Exit on a close below the prior 10-bar low or not above EMA(300).
- C6 (shadow): F1's entries taken only when a GBDT model rates P(F1 trade wins) at least its base rate; exits as F1. Research 2021+: +0.218R/trade, PF 1.62, Sharpe 1.10 (F1 0.76).
- F1X (shadow): F1 with the exit on the prior 15-bar low instead of 10.
- C2 (shadow): bear-market mirror of F1 — short when BTC and the market are below EMA(300) and the close breaks the 20-bar low; 3 ATR stop, 4 ATR trail. Thin edge (dev +0.047R, PF 1.15), paper only.
- ML (shadow, BTC/ETH/SOL/BNB): a small neural network per side on 18 features, bracket stop 1.5×ATR / target 2.25×ATR, retrained with challenger-vs-champion on held-out data; shadow trades only.
Risk rules: 0.5% of equity risked per trade at the initial stop; one real position per market; portfolio heat cap ~1.5% open risk per side and ~2% total (the majors move together); 3% daily loss halts entries until the next UTC day; 15% drawdown from peak halts entries until reset; a manual kill switch. If the exchange stop cannot be placed the position is closed at once.
Health monitor (every minute, from closed real + shadow trades): a live strategy goes to PROBATION (still real, at half the risk per trade) when its rolling 30-trade expectancy falls under its research p5 or its drawdown exceeds p95, and to SHADOW under p1 / over p99. It returns to live only after 30+ new shadow trades with positive expectancy and drawdown within p95. F1 bands: rolling30 p5 −0.33R / p1 −0.43R, drawdown p95 22.1R / p99 27.7R. A strategy without bands (ML) never moves on its own.
Go-live readiness (Self Learning panel; real money is only considered when ALL pass): 8+ weeks of live testnet record, 60+ closed real trades, expectancy positive at the 80% lower bound and the last 30 trades not under p5, max drawdown within the research p95, uptime ≥ 98% over 14 days with a fresh heartbeat, no real errors in 7 days, average entry slippage ≤ 15 bps, an exchange stop on every trade, and no live strategy on probation or shadow. Win rate is shown but is not a criterion (a trend strategy wins rarely and can still make money).
Research (fees, slippage, funding included): F1 development 2019–Jan 2026 +0.376R/trade, PF 2.12, 615 trades; sealed holdout Feb–Nov 2026 +0.179R/trade, PF 1.48, 63 trades (positive but not statistically significant, t = 0.66); HOLD-NEW (10 markets never used in development) +0.169R/trade, PF 1.45, 834 trades; HOLD-3 Sharpe 0.72.
Honesty: backtests and testnet results do not guarantee future profit. No strategy guarantees profit; drawdowns and losing streaks are expected. Nothing here is financial advice.`

const WORDS =
  /\b(bot|bots|testnet|strateg(y|ies)|f1|f1x|c6|c2|shadow|probation|readiness|real money|go live|mainnet|drawdown|heat cap|kill switch|backtest|holdout|research|expectancy|site|website|app|this app|terminal|feature|features|tab|tabs|page|pages|radar ai|how does (this|it) work|what can (you|this) do|where (can|do) i|how do i (use|find|see|set)|self learning|learning lab|neural net|screener|journal)\b/

/** Whether a question is about the site or the bot (so the knowledge block is worth sending). */
export function wantsProjectKnowledge(question: string, previous?: string): boolean {
  const t = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  return WORDS.test(t(question)) || WORDS.test(t(previous))
}
