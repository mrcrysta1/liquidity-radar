// Getting started, risk management, the technology behind the app, and what
// changed recently. Update WHATS_NEW (newest first) whenever a feature ships.
import type { LearnSection } from './types'

export const START: LearnSection = {
  id: 'start',
  title: 'How Liquidity Radar works',
  intro:
    'Liquidity Radar reads live market data in your browser, measures it with indicators and order-flow tools, and runs models that are tested before they are trusted. Here is what each part of the app is for.',
  entries: [
    {
      id: 'tour',
      title: 'A tour of the app',
      summary: 'What every tab is for, in one line each.',
      tags: ['tabs', 'navigation', 'overview', 'help'],
      body: [
        {
          list: [
            '**Dashboard**: a snapshot of everything: price, top signals, liquidity, movers, venues, liquidations, sentiment, headlines.',
            '**Radar**: one market in depth: price, funding, open interest, long/short ratio, the live chart, key levels and quick stats.',
            '**Charts**: the full charting workspace: 40+ indicators, drawing tools, chart types (footprint, TPO, range bars), multi-chart layouts, replay.',
            '**Signals**: the scanner across 19 markets and three timeframes, with trade plans and a graded win rate.',
            '**Analysis**: the liquidation heatmap, volume profile, order flow, liquidation levels and Fibonacci zones.',
            '**Neural Net**: the models\' live predictions, AI insights and market sentiment.',
            '**Self Learning**: the server bot, with a status bar (running, live strategies, open positions, today) and sub-tabs: Overview, Strategies, Market & News, Model, Journal, and the in-browser paper engine.',
            '**Market**, **Bubbles**, **News**: the wider market, a visual map of movers, and news with sentiment plus the economic calendar.',
            '**Settings**: data sources, appearance, and this Learning library.',
          ],
        },
        { tip: 'Press **/** to search for a coin, or ask the AI assistant (bottom right) to take you somewhere.' },
      ],
    },
    {
      id: 'ai-assistant',
      title: 'The AI assistant',
      summary: 'Ask about any market or concept, or tell it where to go: it reads the live data the app shows and can open coins, tabs and guides for you.',
      inApp: 'The chat button, bottom right (or press T)',
      tags: ['assistant', 'chat', 'ai', 'help', 'radar ai'],
      body: [
        { list: [
          '**Go somewhere**: "open SOL", "show me the ETH chart", "take me to signals", "open the guide for fvg". These work instantly.',
          '**Ask about a market**: "analyze BTC", "which coins look strongest right now?". Answers use the live prices, indicators, scanner and news the app has at that moment.',
          '**Learn**: "teach me order flow", "what is a fair value gap?". It explains in plain words, then offers the matching guide in this library.',
        ] },
        { p: 'Answers can end with buttons such as **Open SOL chart** or **Learn: RSI**. The conversation is kept when you reload; **Clear** starts a new one.' },
        { p: 'It is powered by a language model (Llama 3.3 via Groq) given the app’s live data with each question. When the model is not available, a built-in analyst answers instead and says so.' },
        { warn: 'It analyses; it does not advise. It never promises a price or an outcome, and you remain responsible for your trades.' },
      ],
    },
    {
      id: 'data-sources',
      title: 'Where the data comes from',
      summary: 'Public exchange and market APIs, read directly by your browser. Nothing requires an account.',
      inApp: 'Settings → Data sources (live status of every source)',
      tags: ['data', 'api', 'binance', 'sources'],
      body: [
        { p: 'Prices, candles, order books and trades come mainly from **Binance** (spot and futures), with other exchanges for cross-venue prices, CoinGecko for market-wide numbers, Binance’s gold perpetual (XAUUSDT) for live spot gold (XAUUSD), Yahoo Finance for the other metals, forex and indices, RSS feeds for news, and Forex Factory for the economic calendar.' },
        { warn: 'Free public data can be delayed or rate-limited. Settings → Data sources shows which source is healthy right now.' },
      ],
    },
  ],
}

export const RISK: LearnSection = {
  id: 'risk',
  title: 'Risk & trade management',
  intro: 'The part that decides whether a trader survives. Every signal and model in this app is framed in these terms.',
  entries: [
    {
      id: 'r-multiple',
      title: 'R: measuring trades in units of risk',
      summary: 'One "R" is the amount you lose if the stop is hit. A trade that makes twice that is +2R.',
      tags: ['R multiple', 'risk reward', 'RR'],
      body: [
        { diagram: 'r-multiple', caption: 'Entry, stop (−1R) and two targets (+1R, +2R).' },
        { formula: '1R = |entry − stop|\nresult in R = (exit − entry) ÷ 1R   (sign flipped for shorts)' },
        { tip: 'Thinking in R lets you compare trades on different coins and sizes fairly.' },
      ],
    },
    {
      id: 'expectancy',
      title: 'Win rate, risk-to-reward and expectancy',
      summary: 'Whether a strategy makes money depends on win rate and payoff together, after costs.',
      tags: ['expectancy', 'win rate', 'profit factor', 'edge'],
      body: [
        { formula: 'expectancy (R per trade) = win rate × average win − loss rate × average loss − costs\nbreak-even win rate for a 1 : 2 trade ≈ 33% (before fees)' },
        { p: '**Profit factor** = gross wins ÷ gross losses. Above 1 makes money; the app\'s bots look for well above 1 on data the model has not seen.' },
        { warn: 'A small number of trades proves very little. That is why the app\'s "edge proven" checks require results beyond what luck could produce.' },
      ],
    },
    {
      id: 'position-sizing',
      title: 'Position sizing and ATR stops',
      summary: 'Size each trade so that hitting the stop costs a fixed small part of your account.',
      tags: ['position size', 'ATR', 'stop loss', 'risk per trade'],
      body: [
        { formula: 'position size = (account × risk %) ÷ |entry − stop|\nATR stop: stop = entry ∓ 1.5 × ATR(14)' },
        { p: 'ATR (average true range) measures how much the market normally moves, so an ATR-based stop is wide in wild markets and tight in calm ones. The app\'s plans and bots use 1.5 ATR stops.' },
        { tip: 'Many traders risk 0.5–1% per trade. The server bot risks 0.75%.' },
      ],
    },
    {
      id: 'fees-leverage',
      title: 'Fees, slippage and leverage',
      summary: 'Costs are paid on every trade, win or lose. Leverage multiplies both results and costs.',
      tags: ['fees', 'leverage', 'slippage', 'liquidation'],
      body: [
        { p: 'Taker fees on futures are around 0.04–0.05% per side. On short timeframes, where stops are close, fees can eat a large share of each trade: this is why the app\'s models subtract costs in R before deciding.' },
        { warn: 'With leverage, a move against you can liquidate the position before your stop. Keep leverage low enough that the stop is always hit first.' },
      ],
    },
  ],
}

export const TECH: LearnSection = {
  id: 'tech',
  title: 'Technology used',
  intro: 'What the app is built with, and why.',
  entries: [
    {
      id: 'stack',
      title: 'The stack',
      summary: 'A fast web app that does its heavy work in your browser, with a few small server pieces.',
      tags: ['react', 'vite', 'typescript', 'tensorflow', 'supabase', 'vercel'],
      body: [
        {
          list: [
            '**React 19 + TypeScript + Vite**: the interface, type-checked and built for fast loading.',
            '**TradingView Lightweight Charts**: the price charts; custom series add footprint, TPO and range bars.',
            '**TensorFlow.js**: the neural direction model and RL policy, trained in your browser.',
            '**Web Workers**: heavy model training runs in a background thread so scrolling never freezes.',
            '**Exchange APIs and WebSockets**: live prices, order books, trades and liquidations, straight from the source.',
            '**Vercel**: hosting, plus small serverless functions (an AI chat proxy and a fetch proxy for feeds that block browsers).',
            '**Groq (Llama 3.3)**: the language model behind the AI assistant, given live market context with every question.',
            '**Supabase (Postgres)**: accounts, saved settings, and the server bot\'s trade records.',
            '**Node.js worker (radar-worker)**: the 24/7 whale-trade collector and the testnet trading bot.',
            '**Service worker (PWA)**: install the app and open it instantly, with a cached shell.',
          ],
        },
      ],
    },
    {
      id: 'honest-testing',
      title: 'How models are tested here',
      summary: 'Every model is scored on data it never saw, against a simple baseline, with a bar that luck alone rarely clears.',
      tags: ['backtest', 'holdout', 'walk-forward', 'overfitting', 'leakage'],
      body: [
        {
          list: [
            '**Time-ordered splits**: train on the past, test on what came after, never the other way round.',
            '**Purge gaps**: training samples whose answers fall inside the test period are dropped.',
            '**Baselines**: accuracy is compared with simply always guessing the common direction.',
            '**Costs included**: trading results are in R after fees.',
            '**Chance bars**: a result must beat what luck could produce (one-sided 95%) before the app calls it an edge.',
          ],
        },
        { warn: 'Passing these checks on past data still does not guarantee future results. Markets change.' },
      ],
    },
  ],
}

/** Newest first. Add a line here whenever a feature ships. */
export const WHATS_NEW: Array<{ date: string; items: string[] }> = [
  {
    date: '2026-11-07',
    items: [
      'A five-step tour for first-time visitors; take it again any time from Settings → Learning (“Take the tour”).',
      'Phones: wide tables on the Self Learning tab keep their first column pinned while the rest scrolls.',
      'Faster, steadier bot data: cards that need the same records share one request (10-second cache), and a failed request is retried once before a card shows an error.',
      'Release alerts to your chat webhook (Discord or Slack, BOT_ALERT_WEBHOOK): a heads-up up to an hour before a high-impact US release with the forecast and how far BTC usually moved, then the result with BTC’s move since.',
      'News tab calendar: a BTC 1h column shows how BTC moved after each past US release, and clicking a release lists its last 12 occurrences with the surprise, BTC’s and gold’s move and the regime then.',
      'Signals cards now show the evidence behind them: the scanner’s graded record on that market and conviction tier, and the server bot’s own signal on the same coin with its audit verdict.',
      'Self Learning is now split into sub-tabs (Overview, Strategies, Market & News, Model, Journal, Browser engine) under a bot status bar; only the open sub-tab loads its data, so the page opens faster.',
      'Two experimental strategies paper-trade beside the others: X1 (F1 only while BTC is above its EMA 300) and X2 (F1 only on a volume surge). The strategy audit now also checks whether a filter really removes worse trades — for C6, X1 and X2 it is not proven yet.',
      'Daily & weekly report on the Self Learning tab (and to the chat webhook when set): releases and reactions, regime, strategies, the model, errors, anomalies and what to look at, plus this week against last.',
      'Model calibration study on the Self Learning tab: the model’s win chances checked daily against six alternatives, replayed in time order without look-ahead, longs and shorts apart (a report only).',
      'News trading intelligence on the Self Learning tab: which releases move BTC, ETH and gold, how each strategy did around them (counted per release, with ranges and an evidence label), why each trade is or is not news-driven, and the next release next to comparable past ones.',
      'The bot now keeps a record of US economic releases (NFP, CPI, PPI, FOMC, claims, GDP and more) with forecast, actual and revisions, and measures how BTC, ETH and gold reacted after 15 min, 1 h, 4 h and 24 h.',
      'Market context card on the Self Learning tab: BTC on 15m / 1h / 4h, a 7-class market regime with its reason, every coin’s measured correlation with BTC (changes flagged), and gold with the dollar index and Treasury yields — refreshed by the bot every 15 minutes.',
      'Strategy audit card on the Self Learning tab: every strategy re-run on each market’s whole history at three cost levels, by year and BTC regime, with a keep / watch / retire verdict from fixed rules (a report only; nothing is switched automatically). Full report: docs/research/strategy-audit-2026-11-07.md.',
      'New Strategy ledger on the Self Learning tab: each strategy as its own paper portfolio, longs vs shorts, fees, slippage and real funding per trade, and every trade re-scored under moderate, conservative and stress costs.',
      'Strategies card: each strategy’s record is also shown as independent decisions (trades on the same candle or day count as one), with a 95% range for its average result.',
      '"Is it on track?" now counts the model’s real trades in every mode (it missed them in hybrid mode).',
      '"Is it on track?" now counts independent outcomes: trades decided on the same candle move together and count roughly as one, so a single market-wide day can no longer make the bot look proven (or broken).',
    ],
  },
  {
    date: '2026-11-01',
    items: [
      'The testnet bot takes demo trades again: explore mode on 4-hour candles, entering when the expected value is at least +0.1R after fees, without waiting for the walk-forward test that no market had passed yet.',
      'New "Planned trades" card on the Self Learning tab: for every market, the trade the bot planned on its latest candle (long or short, entry, stop-loss, take-profit, win chance, expected value), whether it became a real trade, a paper trade or was skipped and why, and how it would be sized on the demo account and on a small $100 real account (position, margin, risk, fees, or why Binance would refuse it).',
    ],
  },
  {
    date: '2026-10-31',
    items: [
      'The testnet bot now trades 4-hour candles in gated mode: a market trades only while its model passes the walk-forward test. At the switch none passed yet (BTC was closest), so it paper-trades and learns from shadow trades until one does. The 5-minute explore setup lost $745 over 107 trades, half of it fees.',
      'Fixed the bot freezing at startup on a Binance testnet error (-4067), which had stopped it trading since Oct 30.',
      'New "Is it on track?" panel on the Self Learning tab: are its win chances honest, is there a real edge, do stops cost about 1R, and how many more trades each answer needs.',
    ],
  },
  {
    date: '2026-10-04',
    items: [
      'Self Learning now trains and trades two markets only: BTC (BTCUSDT.P) and Gold (XAUUSDT.P, which follows spot XAUUSD), on Binance futures prices.',
      'Self Learning page cleaned up: the server bot’s trades and activity moved into the Binance account panel, the backtest lab folds away under Advanced, and the deep-network internals panel was removed.',
      'Trading self-test: one click on GitHub opens and closes a small random Demo trade and checks it end to end.',
      'Gold is now real spot gold (XAUUSD) everywhere: ticker, Top Coins, futures table, bubbles, signals and charts. It replaces the PAXG token and streams live from Binance’s gold perpetual (funding and open interest included).',
      'The site asks search engines not to index it (noindex, nofollow) and blocks other crawlers.',
      'The testnet bot now trades 5-minute candles and takes a trade whenever it is flat (a testing setup: fees make 5m trading lose on average; the daily 3% and 15% drawdown limits cap it).',
      'The testnet bot now runs non-stop on GitHub (runs of 5 h 40 min that start each other, plus an hourly safety net), so it stays connected; every trade uses at least $100 margin.',
      'Market and Bubbles tabs redesigned to match the rest of the app: page header with live stats, quick-jump chips, clearer section headers, and glass-style bubbles with coin logos.',
    ],
  },
  {
    date: '2026-10-03',
    items: [
      'Testnet bot now runs 24/7 for free on GitHub Actions (every 15 minutes), no PC needed.',
      'Self Learning tab: live mirror of the Binance Demo account (balance, PNL, positions, orders, fills), as the bot sees it.',
      'AI assistant can now open coins, tabs and Learning guides ("open SOL", "take me to signals"), teaches with links to the guide, and remembers the conversation.',
      'Learning library in Settings, with a downloadable PDF.',
      'Signals: win rate now graded on real stop/target outcomes; each indicator learns its own weight.',
      'Signals: fixed RSI momentum signs, real MACD crosses, working RSI divergence, correct forecast horizons.',
      'Neural read counts only when it beats always-guessing by more than chance.',
      'Self-learning: "Edge proven" needs results beyond luck, on test and live trades; entries at the live price.',
      'Model training moved to a background thread: no more scroll freezes.',
    ],
  },
  {
    date: '2026-10-02',
    items: [
      'Header redesign: ticker in the top row, coin search behind the search button (press /).',
      'Readable text sizes across every tab; faster first paint; smoother animations.',
    ],
  },
]
