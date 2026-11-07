// How Liquidity Radar's models and engines actually work — written from the
// code (features/signals, features/ml, features/selflearn, radar-worker). Keep
// this in step with the code: when a model changes, change its entry here.
import type { LearnSection } from './types'

export const MODELS: LearnSection = {
  id: 'models',
  title: 'Models & how they learn',
  intro:
    'Every model here is trained and checked on data it did not learn from, and reports how it did. ' +
    'Where a model shows no reliable edge, the app says so and stops it from moving signals. ' +
    'None of this is financial advice, and no model can promise profit.',
  entries: [
    {
      id: 'signal-scanner',
      title: 'Signal Scanner',
      summary:
        'Scores 19 markets every two minutes on three timeframes (1H, 4H, 1D) and turns the result into BUY, SELL or WATCH with a trade plan.',
      inApp: 'Signals tab; Top Signals on the Dashboard',
      tags: ['signals', 'scanner', 'score', 'buy', 'sell'],
      body: [
        { p: 'For each timeframe, the scanner takes the last closed candles (the still-forming candle is ignored) and scores a set of rules. Each rule adds or subtracts its **weight**:' },
        {
          list: [
            '**RSI(14)**: below 30 = oversold (+), above 70 = overbought (−); between them it reads momentum: 55–70 adds, 30–45 subtracts.',
            '**MACD(12,26,9)**: a real cross (histogram changes sign on the last bar) counts most; otherwise the histogram sign gives a smaller trend vote.',
            '**EMA 20**: price above it (+) or below it (−).',
            '**Bollinger %B (20, 2)**: touching the lower band (+) or stretched past the upper band (−).',
            '**Volume trend**: rising (+) or falling (−).',
            '**RSI divergence**: a new 10-bar high with RSI at least 5 points weaker (−), or a new low with RSI 5+ points stronger (+).',
            '**Near a 20-bar swing high/low**: a small nudge away from resistance, towards support.',
          ],
        },
        { formula: 'master = 0.25 × score(1H) + 0.40 × score(4H) + 0.35 × score(1D)\nfinal  = master + whale flow + neural read   (clamped to −100…+100)\nBUY if final > 15, SELL if final < −15, otherwise WATCH' },
        { p: '**Conviction** is High when the score is strong (|score| ≥ 45) and at least two timeframes agree; Medium for a moderate score with agreement, or a strong one without; otherwise Low.' },
        { p: 'A BUY or SELL comes with a **trade plan** from the 4H ATR: stop 1.5 ATR away, target 1 at 1.5 ATR, target 2 at 3 ATR (so the plan is always 1 : 2 risk-to-reward to target 2).' },
        { tip: 'Filter by High confidence and check that the timeframe badges agree before reading anything into a signal.' },
      ],
    },
    {
      id: 'scanner-learning',
      title: 'How the scanner learns (graded calls)',
      summary:
        'Every BUY/SELL with a plan becomes a "call" that is graded on whether price reached the target or the stop first. Each indicator then earns more or less say from that record.',
      inApp: 'Signals tab → Win Rate',
      tags: ['win rate', 'learning', 'weights', 'accuracy', 'calls'],
      body: [
        { list: [
          'One call per market at a time; a new one opens only after the previous one is decided.',
          'Graded on hourly candles that start **after** the call: target 1 first = **win**, stop first = **loss**, a candle touching both = loss, neither within 72 hours = **expired** (shown, not counted).',
          'If the app was closed long enough to leave a gap in the candles, the call is marked expired rather than guessed.',
        ] },
        { formula: 'Win rate = wins ÷ (wins + losses)   — shown once 10 calls are decided' },
        { p: 'For each indicator the app keeps how often the calls it **agreed with** were won. An indicator whose calls win more often than calls overall gets more weight; one that does worse gets less. The rate is smoothed toward the overall rate, it needs at least 20 such calls before it moves, and it stays between 0.5× and 1.5× of its default, so one bad week cannot switch an indicator off. It is recalculated from the whole record each time, so it does not drift.' },
        { warn: 'A win rate means little on its own: a 40% win rate can be profitable with 1 : 2 trades, and 60% can lose money with small wins and big losses. Read it with the plan\'s risk-to-reward.' },
      ],
    },
    {
      id: 'neural-direction',
      title: 'Neural direction model',
      summary:
        'A small neural network (TensorFlow.js, in your browser) that estimates the chance the price is higher 3 hours from now.',
      inApp: 'Signals cards ("Neural" line); used in the scanner score only when it shows a real edge',
      tags: ['neural network', 'tensorflow', 'machine learning', 'probability', 'P(up)'],
      body: [
        { p: '**Inputs**: 9 features from the last candles: 1-, 3- and 10-bar returns, RSI, MACD histogram (% of price), distance from the EMA (%), Bollinger %B, volume vs its average and ATR (% of price), standardised using the training data only. **Output**: P(up), the probability the close 3 bars ahead is higher.' },
        { p: '**Training**: about 400 hourly candles per market, split in time: the first 75% to learn, the last 25% to test. The few training samples whose labels look into the test period are dropped (a "purge gap"), so the test is genuinely unseen.' },
        { p: '**Is it any good?** Its test accuracy is compared with simply always guessing the more common direction in that same period (the **baseline**). In a trending market, always guessing "up" can already score 60%.' },
        { formula: 'proven edge = accuracy − baseline − 1.645 × √(baseline × (1 − baseline) ÷ n)\ncounts in the score only if proven edge > 0 (full weight at +10 points)' },
        { p: 'This bar means a model with no real skill is accepted only about 5% of the time. The old fixed 52% bar accepted such a model about a third of the time.' },
        { tip: 'The card says plainly which it is: "beats always-guessing (55%) by more than chance" or "no edge over always-guessing (55%), not counted".' },
      ],
    },
    {
      id: 'self-learning-engine',
      title: 'Self-learning engine (paper trading)',
      summary:
        'Trains a pair of models (long and short) per market and style, opens paper trades on its own when the expected value clears a bar, and learns from every closed trade.',
      inApp: 'Self Learning tab; Neural Net tab',
      tags: ['self learning', 'paper trading', 'logistic regression', 'expected value', 'auto trade'],
      body: [
        { p: '**Markets and styles**: BTC (BTCUSDT.P) and Gold (XAUUSDT.P, the Binance perpetual that follows spot XAUUSD), priced from Binance futures; **Scalp** on 15-minute candles (target 2.25 ATR, stop 1.5 ATR) and **Swing** on 4-hour candles (target 3 ATR, stop 1.5 ATR). Only trades in the direction of the EMA 20/50 trend.' },
        { p: '**Models**: two logistic-regression models per market and style, one for "would a long hit its target before its stop", one for shorts, trained on 3,000 candles with 15 scale-free features (returns over 1/3/6/12 bars, RSI, MACD, distance from EMA 20 and 50, ATR %, volume, Bollinger position, candle body, stochastic, distance to recent high and low). Training runs in a background thread (Web Worker) so the page never freezes.' },
        { formula: 'expected value (R) = p × (target ÷ stop) − (1 − p) − costs\nopen a trade when EV > the strategy\'s bar (Scalp 0.25R, Swing 0.10R)' },
        { p: 'The bar rises after a run of losses and falls back after a win. Trades enter at the live price; a decision reached long after its candle closed is not acted on.' },
        { p: '**Edge proven**: the model\'s trades on unseen history are pooled with its live paper trades, and the average result must beat zero by more than chance (a one-sided 95% bound). With few trades the bar is high; it falls as trades accumulate. Live losses can take the badge away.' },
        { p: '**Learning**: every closed trade nudges the model that took it; full retrains run every 6 hours (Scalp) and 24 hours (Swing) on fresh data.' },
        { warn: 'Paper only: the browser never sends orders to an exchange. It also only runs while the page is open and visible.' },
      ],
    },
    {
      id: 'forecast-ridge',
      title: 'AI Prediction (price path forecast)',
      summary:
        'Projects the % move 1, 2, 4, 8 and 16 candles ahead with ridge regression, with an error band from its own test.',
      inApp: 'Neural Net tab → AI Prediction',
      tags: ['forecast', 'prediction', 'ridge regression', 'target price'],
      body: [
        { p: 'Fitted on the last 500 candles of the page\'s timeframe with a purged 75/25 split. It reports how often its direction was right on the test part, and the size of its typical error, which becomes the shaded band.' },
        { warn: 'A forecast line is a statistical average, not a promise. Read the error band: if it spans both up and down, the model is saying "unclear".' },
      ],
    },
    {
      id: 'rl-policy',
      title: 'RL policy (reinforcement learning)',
      summary:
        'A small Q-learning agent that learns when to be long or flat from past returns after costs. Trained on demand.',
      inApp: 'Charts → overlay "RL policy" (manual train button)',
      tags: ['reinforcement learning', 'q-learning', 'DQN', 'policy'],
      body: [
        { p: 'It learns a value for "long" and "flat" in each market state, paying a cost each time it switches, and is compared with simply buying and holding on a test period it did not see.' },
        { warn: 'Experimental: it is trained only when you press the button, and it forgets when you switch markets or reload.' },
      ],
    },
    {
      id: 'liquidation-heatmap-model',
      title: 'Liquidation heatmap (estimate)',
      summary:
        'Estimates where leveraged positions would be force-closed, from price, volume, open interest, funding and an assumed mix of leverage.',
      inApp: 'Analysis tab → Liquidity Heatmap; Neural Net tab',
      tags: ['liquidation', 'heatmap', 'leverage', 'clusters'],
      body: [
        { p: 'Each candle\'s volume is treated as positions opened at that price with a spread of leverages (presets weight them differently, up to 100×). Each leverage implies a liquidation price; positions still "alive" are added to a heat map. Brighter bands are larger estimated clusters.' },
        { warn: 'This is a model, not exchange data: exchanges do not publish where positions are. Treat bands as areas of interest, not exact levels.' },
      ],
    },
    {
      id: 'server-bot',
      title: 'Server bot (Binance Futures testnet)',
      summary:
        'A separate program that trades on Binance\'s Futures **testnet** (practice money) around the clock and records every trade and reason to a database.',
      inApp: 'Self Learning tab → Binance account panel and Server bot card',
      tags: ['bot', 'binance', 'testnet', 'auto trade', 'walk-forward'],
      body: [
        { p: 'It decides on every closed **4-hour** candle for 24 futures markets and runs several **strategies** side by side. Only **F1** (a long-only trend breakout: close above EMA 300 and the 20-candle high, 3 ATR stop, trailing exit) places demo orders, risking 0.75% of the account per trade. **C6** (F1 entries filtered by a GBDT model), **F1X** (F1 with a slower exit), **C2** (a short-side mirror for bear markets) and the **neural model** only paper-trade (“shadow”), so every idea is still measured. A daily-loss halt, a drawdown kill switch and a cap on total open risk apply to all real trades. **Honest note**: the earlier 5-minute explore setup lost $745 over 107 trades, about half of it fees.' },
        { p: '**Strategy health**: each strategy has research bands. A live one whose rolling 30-trade result or drawdown leaves its bands trades at half risk (probation) or drops to paper only; it goes live again only after 30 good new paper trades. The Strategies card also shows each record as **independent decisions**: when one BTC move triggers entries on many markets, those trades ride the same move, so trades decided on the same candle or the same day count as one. Its 95% range uses that count, which is why a strategy with 40 trades on 5 days can still be “unproven”; no range is shown before it has traded on at least 10 separate days, because with fewer the range would look more certain than it is. (The health rules themselves still count trades one by one.)' },
        { p: '**Strategy ledger**: every strategy’s closed real and paper trades are kept as its own $10,000 paper portfolio (0.75% risked per trade), with results for longs and shorts and the cost of a trade taken apart: exchange fees, slippage and **funding** (each market’s real 8-hourly rate over the time the trade was held). The whole record is then re-scored under three cost profiles: **moderate** (the bot’s own assumption, 0.05% fee + 0.02% slippage per market order), **conservative** (0.05% + 0.05%, no cheaper maker fills) and **stress** (0.05% + 0.15% and double funding). A strategy that is only positive under moderate costs has no room for worse fills: on Nov 7 the model’s paper trades made +0.03R per trade at moderate costs, about 0 at conservative and −0.07R under stress, while the trend strategies, with stops 3 ATR away, lose only ~0.03R per trade to costs.' },
        { p: '**Strategy audit** (Nov 7, 2026): every strategy was re-run with the bot’s own code over each market’s whole 4-hour history (2017–2026, 24 markets) at three cost levels with real funding, and judged by rules fixed before the run. Trades are grouped by entry day, week or month, whichever gives the widest range, because trend trades held for weeks share one market move. Results at conservative costs: **F1** +0.155R per trade (95% range +0.05 to +0.26, 3,607 trades) — **keep**, but its last two years are much weaker (2025 ≈ 0, 2026 +0.07R); **F1X** +0.174R and **C6** +0.188R — **keep**, with the warning that they were designed after their test period had been seen; **C2** +0.036R and −0.19R on its holdout — **watch**; the **model** −0.044R over 24,955 walk-forward trades, positive on 2 of 24 markets — a **retire** candidate (it already trades on paper only). The bot’s live entries matched the backtest exactly for F1, F1X and C6. Caveat for all: the 24 markets were picked in 2026, so coins that collapsed are missing, which flatters long-only strategies. Nothing is switched automatically.' },
        { p: '**Market context**: every 15 minutes the bot also describes the market, without trading on it. **BTC** on 15-minute, 1-hour and 4-hour candles: direction (close against EMA 50/200 and the slope of EMA 50), 20-candle change, RSI, trend efficiency (net move ÷ total movement: 1 is a straight line, near 0 is chop) and volatility (ATR % and where it ranks in the last 500 candles). A **regime** in one of seven classes — strong / weak bullish, sideways, weak / strong bearish, high volatility, uncertain — from fixed, round thresholds on BTC’s 4-hour state, confirmed on 1 hour (when the two disagree it says “uncertain” instead of guessing). Each coin’s **correlation with BTC** is measured on returns (about 2 days of 15-minute, 7 days of 1-hour and 30 days of 4-hour candles) with its beta, and a correlation that differs significantly from the window before (99% Fisher test) is marked: coins are not assumed to follow BTC. **Gold** (XAU/USD via XAUUSDT) is read separately with the dollar index and Treasury yields (the free stand-in for interest-rate expectations); when BTC and gold point opposite ways that is shown as information, not turned into a signal. One snapshot per 4-hour candle is kept so strategies and news events can later be judged by the regime they happened in.' },
        { p: '**Economic news record**: every hour the bot saves the US releases it follows — NFP, CPI, PPI, FOMC decisions, Fed chair speeches, jobless claims, GDP, unemployment, retail sales, PCE — and high-impact events elsewhere. The forecast and previous value come from the same Forex Factory calendar the News tab shows; the actual (and any revision of the previous number) from the agencies’ own calendar, so a surprise is actual − forecast in the indicator’s units, never labelled good or bad. With a free FRED key it also fills in US release dates since 2019 and every FOMC decision (hike, cut or hold). For each release it measures how BTC, ETH and gold moved 15 minutes, 1 hour, 4 hours and 24 hours later, and how big that was compared with their usual move over the same time in the 30 days before. **Limits**: past consensus forecasts are not available for free, so older releases have no surprise; gold’s reaction exists only since its perpetual listed; a reaction says the market moved, not why.' },
        { p: '**Planned trades**: on every closed candle the bot writes its plan for each market: the side, entry, stop-loss and take-profit, the calibrated win chance, expected value and fee cost, and what became of it (a real trade, a paper/shadow trade, or skipped, with the reasons). Each plan is also sized with the bot’s own sizing code twice, on the demo account and on a small real-money account ($100 by default): position size, margin, the dollars lost if the stop is hit, and fees. With $100, a BTC trade at 0.5–1% risk is smaller than Binance’s minimum order (0.001 BTC), so the preview says Binance would refuse it.' },
        { p: '**Is it on track?** The Self Learning tab judges the bot by its own record since the 4-hour setup started: whether a stop-out costs about −1R, whether its win chances match what actually happens (real and shadow trades; about 385 are needed for a ±5% read), and whether real trades have an edge (mean R with a 95% range; a 0.17R edge needs roughly 200 or more trades). It also estimates how many days each answer needs at the pace so far. Trades decided on the same candle are counted together: when BTC drops, shorts on every market win at once, so 40 such trades are worth about one independent outcome, not 40. The panel shows both numbers (for example “468 outcomes on 29 candles ≈ 86 independent”), and every range and day estimate uses the independent count, so one market-wide day cannot fake an edge.' },
        { p: '**Walk-forward test**: its model is trained on about a month of 5-minute candles (two years when it runs on 4-hour candles) in rolling blocks and tested on the block after each. In **gated** mode it trades only if that test shows an edge (60+ test trades, positive expectancy and profit factor, and recent blocks profitable). In **explore** mode it trades its best signal even without proof, to gather real fills.' },
        { p: '**Where it runs**: on GitHub Actions, free and non-stop, with no server or PC needed. Each run keeps the bot going for 5 h 40 min and then starts the next one (an hourly safety net restarts the chain if it ever breaks). Every 15 seconds it manages any open trade and refreshes the account mirror, and it decides once on each newly closed 4-hour candle. Every trade uses at least **$100 of margin** (never more than double the normal 0.75% risk). Exchange-side stop and take-profit orders protect a position during a hand-over.' },
        { p: '**Account mirror**: on every run the bot reads your Binance futures account (wallet balance, unrealized PNL, margin balance, available balance, open positions, open orders and recent fills) and saves it, so the Self Learning tab shows the same figures as the Binance panel.' },
        { warn: 'Your exchange keys live only on the server running the bot, never in the website. It uses testnet by default and refuses the real exchange unless that is explicitly enabled.' },
      ],
    },
  ],
}
