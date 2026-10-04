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
        { p: 'It decides on every closed **5-minute** candle for BTC and Gold (XAUUSDT perpetual) and, in the current testing setup, takes the better side whenever it is flat (no expected-value bar). It places a market entry with an exchange-side stop and a take-profit, sizes each trade to risk 0.5% of the account (notional capped at 1× the account on 5m, at least $100 margin), and stops opening trades for the day after a 3% loss and for good at 15% below its peak. **Honest note**: on 5-minute candles the round-trip fees (~0.14%) are bigger than a typical stop, so a month-long walk-forward lost on every test block (BTC −0.9R, gold −5.6R per trade). It is a practice setting to watch the bot trade, not a profitable one.' },
        { p: '**Walk-forward test**: its model is trained on about a month of 5-minute candles (two years when it runs on 4-hour candles) in rolling blocks and tested on the block after each. In **gated** mode it trades only if that test shows an edge (60+ test trades, positive expectancy and profit factor, and recent blocks profitable). In **explore** mode it trades its best signal even without proof, to gather real fills.' },
        { p: '**Where it runs**: on GitHub Actions, free and non-stop, with no server or PC needed. Each run keeps the bot going for 5 h 40 min and then starts the next one (an hourly safety net restarts the chain if it ever breaks). Every 15 seconds it manages any open trade and refreshes the account mirror, and it decides once on each newly closed 4-hour candle. Every trade uses at least **$100 of margin** (never more than double the normal 0.5% risk). Exchange-side stop and take-profit orders protect a position during a hand-over.' },
        { p: '**Account mirror**: on every run the bot reads your Binance futures account (wallet balance, unrealized PNL, margin balance, available balance, open positions, open orders and recent fills) and saves it, so the Self Learning tab shows the same figures as the Binance panel.' },
        { warn: 'Your exchange keys live only on the server running the bot, never in the website. It uses testnet by default and refuses the real exchange unless that is explicitly enabled.' },
      ],
    },
  ],
}
