// Order flow & liquidity concepts — what the app's order-book, flow,
// positioning and structure panels measure, and where to find them.
// Numbers quoted here (thresholds, weights, defaults) come from the code:
// charts/sidePanels/metrics.ts, analysis/liqHeatmap, charts/volumeProfile.ts,
// analysis/oiDivergence.ts, analysis/confluence.ts, whales/*, delta/*.
import type { LearnSection } from './types'

export const CONCEPTS: LearnSection = {
  id: 'order-flow',
  title: 'Order flow & liquidity concepts',
  intro:
    'Price moves because orders meet: resting limit orders provide liquidity and market orders consume it. These entries explain the order book, trade flow, derivatives positioning and market-structure ideas the app shows. All of them describe what is happening or has happened — they are context for decisions, not predictions.',
  entries: [
    // ------------------------------------------------------------ Order book
    {
      id: 'order-book',
      title: 'Order book & depth',
      summary:
        'The live list of resting buy orders (bids) and sell orders (asks) at each price. “Depth” is how much size sits in the book near the current price.',
      body: [
        { p: 'Bids are limit orders to buy below the current price; asks are limit orders to sell above it. The highest bid and lowest ask are the **best bid** and **best ask**; the **mid price** is halfway between them. A market order fills against these resting orders, best price first.' },
        {
          list: [
            'Thick book (lots of size near mid): large orders move price little.',
            'Thin book: even modest orders push price through several levels.',
            'Depth changes constantly — orders are added, cancelled and filled every second.',
          ],
        },
        { tip: 'Read the book together with the trade flow: a level that keeps getting hit but does not break tells you more than the size shown on it.' },
        { warn: 'The book only shows one exchange, and orders can be pulled at any moment. Displayed size is intent, not commitment.' },
      ],
      inApp: 'Radar or Charts → chart side panel → Order book tab',
      tags: ['order book', 'depth', 'bids', 'asks', 'level 2', 'dom', 'mid price'],
    },
    {
      id: 'spread',
      title: 'Bid/ask spread (basis points)',
      summary:
        'The gap between the best ask and the best bid. It is the cost of crossing the book instantly, and the app shows it in basis points.',
      body: [
        { p: 'A basis point (bp) is 0.01%. The app measures the spread relative to the mid price so it can be compared across coins of any price.' },
        { formula: 'Spread (bps) = (best ask − best bid) / mid × 10,000' },
        {
          list: [
            'Under 1 bp: very liquid (major pairs on large exchanges).',
            'Several bps or more: thinner market — market orders cost noticeably more.',
            'A spread that suddenly widens often means market makers are pulling quotes ahead of volatility.',
          ],
        },
        { tip: 'In the Liquidity score, 0 bps scores 100 and 5 bps scores 0 for the spread component.' },
        { warn: 'The spread is only the cost of the first unit. Larger orders also pay slippage through deeper levels.' },
      ],
      inApp: 'Charts → side panel → Order book / Liquidity tabs; Radar → Cross-Exchange Radar (Spread column)',
      tags: ['spread', 'bid ask spread', 'basis points', 'bps', 'transaction cost'],
    },
    {
      id: 'depth-slippage',
      title: 'Depth ±1% and slippage',
      summary:
        'Depth ±1% is the dollar value of orders resting within 1% of the mid price. Slippage is how much worse than mid a market order fills because it eats through several levels.',
      body: [
        { p: 'The app sums price × size for every bid within 1% below mid and every ask within 1% above it. It then “walks the book” to simulate market buys and sells of **$10k, $100k and $1M** and reports the average fill distance from mid in bps.' },
        { formula: 'Depth±1% = Σ(price × size) for levels within mid ± 1%\nSlippage (bps) = |avg fill price − mid| / mid × 10,000' },
        {
          list: [
            'Larger depth = less price impact for the same order size.',
            'If a size cannot be filled from the loaded book, the app marks it as not fillable rather than inventing a number.',
            'Compare buy and sell slippage: a big difference means one side of the book is much thinner.',
          ],
        },
        { tip: 'Check the slippage for your actual order size before trading a small-cap coin — the quoted price may not be the price you get.' },
        { warn: 'This is a snapshot of one exchange’s visible book; hidden orders, other venues and fast cancellations change real fills.' },
      ],
      inApp: 'Charts → side panel → Order book tab (depth and slippage table)',
      tags: ['depth', 'slippage', 'market impact', 'liquidity', 'fill price'],
    },
    {
      id: 'order-book-walls',
      title: 'Order book walls',
      summary:
        'Unusually large orders resting at one price. They can act as short-term support (bid walls) or resistance (ask walls).',
      body: [
        { p: 'The app flags a level as a wall when its size is at least **5×** the average level size **on its own side** of the book, and ranks walls by that multiple.' },
        {
          list: [
            'Bid wall below price: buyers willing to absorb selling there.',
            'Ask wall above price: sellers willing to absorb buying there.',
            'A wall that is eaten through (filled) often leads to a fast move past it.',
          ],
        },
        { tip: 'Watch what happens when price reaches the wall: if it holds and trades are absorbed, it is real; if it vanishes as price approaches, it was likely a bluff.' },
        { warn: 'Walls can be spoofed — placed to influence others and cancelled before they fill. Never assume a wall will still be there when price arrives.' },
      ],
      inApp: 'Charts → side panel → Order book tab (walls list)',
      tags: ['wall', 'bid wall', 'ask wall', 'large order', 'spoofing'],
    },
    {
      id: 'order-book-imbalance',
      title: 'Order book imbalance',
      summary:
        'Whether more resting size sits on the bid side or the ask side near the price, from −100% (all asks) to +100% (all bids).',
      body: [
        { p: 'The app compares bid and ask dollar depth within a band around mid (±1% by default; the gauge can switch to ±0.5% or ±2%). Readings within ±8% are labelled **Balanced**.' },
        { formula: 'Imbalance = (bid depth − ask depth) / (bid depth + ask depth)' },
        {
          list: [
            'Bid-heavy (positive): more resting buy interest below price.',
            'Ask-heavy (negative): more resting sell interest above price.',
            'Sudden flips in imbalance often come from large orders being added or pulled.',
          ],
        },
        { tip: 'Treat imbalance as context: it is more useful when it agrees with trade flow (delta) than on its own.' },
        { warn: 'Resting orders are not executed trades. **Spoofing** (fake size that gets cancelled) can fake an imbalance, and **absorption** — a large passive order quietly filling aggressive trades — can mean the “heavy” side is the one being sold into. A bid-heavy book can still fall.' },
      ],
      inApp: 'Radar → chart → Panes → Book imbalance (gauge); Charts → side panel → Order book tab',
      tags: ['imbalance', 'book pressure', 'bid ask ratio', 'spoofing', 'absorption'],
    },
    {
      id: 'liquidity-score',
      title: 'Liquidity score (0–100)',
      summary:
        'One number summarising how easy it is to trade a market without moving price, built from five visible components.',
      body: [
        { p: 'The app scores each component 0–100 and takes a fixed weighted average. Each component shows its own reason so the score can be checked rather than trusted blindly.' },
        {
          list: [
            '**Spread** (weight 0.25): 0 bps = 100, 5 bps = 0.',
            '**Depth ±1%** (0.30): log scale of dollars resting within 1% of mid; $100M = 100.',
            '**Slippage $100k** (0.20): cost of a $100k market buy; 0 bps = 100, 10 bps = 0; 0 if the book cannot fill it.',
            '**Bid/ask balance** (0.10): 100 minus the absolute imbalance %.',
            '**24h volume** (0.15): log scale of 24h quote volume; $10B = 100.',
          ],
        },
        { formula: 'Score = 0.25·Spread + 0.30·Depth + 0.20·Slippage + 0.10·Balance + 0.15·Volume' },
        { tip: 'Use it to compare coins: lower scores mean wider stops, smaller size and more care with market orders.' },
        { warn: 'A heuristic from one exchange’s public data. It describes the book right now and can change within minutes, especially around news.' },
      ],
      inApp: 'Charts → side panel → Liquidity tab; Dashboard → Liquidity tile',
      tags: ['liquidity score', 'liquidity', 'market quality', 'tradability'],
    },
    {
      id: 'order-types-fees',
      title: 'Market vs limit orders, maker vs taker, fees',
      summary:
        'A limit order rests in the book at your price; a market order fills immediately at the best available prices. Makers add liquidity, takers remove it, and fees usually differ.',
      body: [
        { p: 'A **limit order** that does not fill immediately rests in the book — you are a **maker**, adding liquidity. A **market order** (or a limit order priced through the book) fills at once against resting orders — you are a **taker**, removing liquidity. Exchanges usually charge takers more than makers.' },
        {
          list: [
            'Market order: certain fill, uncertain price (spread + slippage).',
            'Limit order: certain price, uncertain fill — price may never reach it.',
            'Round-trip cost = entry fee + exit fee + spread + slippage; on short-term trades it adds up quickly.',
          ],
        },
        { tip: 'For small targets, compare your expected move with your round-trip cost before entering — a 0.2% target with 0.1% total fees gives away half the edge.' },
        { warn: 'Stop-loss orders usually execute as market orders, so in fast or thin markets they can fill well past the stop price.' },
      ],
      tags: ['market order', 'limit order', 'maker', 'taker', 'fees', 'commission'],
    },
    // ------------------------------------------------------------ Trade flow
    {
      id: 'trade-tape',
      title: 'Trade tape & aggressor side',
      summary:
        'The tape is the stream of executed trades. Each trade has an aggressor — the side that used a market order to cross the spread.',
      body: [
        { p: 'Every trade has a buyer and a seller, so “more buyers than sellers” is meaningless. What matters is **who initiated**: if the taker bought (lifting the ask), it is an aggressive buy; if the taker sold (hitting the bid), an aggressive sell. The app reads this from Binance’s trade stream, where the `isBuyerMaker` flag marks a taker sell.' },
        {
          list: [
            'Clusters of aggressive buys lifting the ask show urgency to buy.',
            'Large aggressive trades are often institutional or liquidation flow.',
            'Aggressive buying that fails to move price can mean a large seller is absorbing it.',
          ],
        },
        { tip: 'The Analysis tab’s Order Flow card splits the last 1,000 trades into buy vs sell volume and counts large prints (≥ $25K) separately from retail-sized ones.' },
        { warn: 'One exchange’s tape is only part of the market. Large orders are often split into many small trades, so size alone undercounts big players.' },
      ],
      inApp: 'Analysis → Order Flow card',
      tags: ['tape', 'time and sales', 'aggressor', 'taker', 'trade flow', 'prints'],
    },
    {
      id: 'volume-delta-cvd',
      title: 'Volume delta & CVD (cumulative volume delta)',
      summary:
        'Delta is aggressive buy volume minus aggressive sell volume in a bar. CVD adds up the deltas over time to show the running balance of buying versus selling pressure.',
      body: [
        { p: 'The app builds delta bars from the live trade stream, aligned with the chart’s candles, and keeps a running CVD over the loaded window. It also flags **CVD divergence**: when price makes a new high (or low) late in the last 40 bars but CVD does not confirm it.' },
        { formula: 'Delta = taker buy volume − taker sell volume\nCVD = Σ Delta' },
        {
          list: [
            'Price up with CVD up: buying pressure is driving the move.',
            'Price at a new high while CVD makes a lower high: bearish divergence — buyers are not keeping up.',
            'Price at a new low while CVD makes a higher low: bullish divergence — selling is drying up.',
            'Big positive delta with no price progress: possible absorption by passive sellers.',
          ],
        },
        { tip: 'Turn on the Delta (CVD) pane and watch the badge next to it for the running CVD and any divergence flag.' },
        { warn: 'Delta here is a single venue’s tape since the page started collecting — not exchange-wide net flow. Its starting point is arbitrary, so watch its direction, not its level.' },
      ],
      inApp: 'Radar / Charts → chart → Panes → Delta (CVD)',
      tags: ['delta', 'cvd', 'cumulative volume delta', 'order flow', 'divergence', 'buy sell pressure'],
    },
    {
      id: 'footprint',
      title: 'Footprint chart',
      summary:
        'A candle chart that prints buy and sell volume at each price row inside every bar, showing where within the bar the trading happened.',
      body: [
        { p: 'True footprints need tick-by-tick data. The app’s **Volume footprint** style works from candles, so it is an estimate: each bar’s volume is spread across its range (weighted toward the close) and split into buy/sell by where the close sits in the range. The style is labelled as an estimate in the picker.' },
        {
          list: [
            'Rows with heavy selling at the top of a bar can show sellers defending a high.',
            'Heavy volume at a price that price then leaves quickly marks an important level.',
            'Imbalances between buy and sell on adjacent rows are what footprint traders look for.',
          ],
        },
        { tip: 'Zoom in: numbers are printed inside the bars only when there is enough room.' },
        { warn: 'Because the app’s version is modelled from OHLCV, it shows the shape of activity, not the real per-price trades.' },
      ],
      inApp: 'Charts → chart style picker → Volume footprint',
      tags: ['footprint', 'order flow chart', 'bid ask volume', 'cluster chart'],
    },
    {
      id: 'tpo-market-profile',
      title: 'TPO / Market profile',
      summary:
        'Time Price Opportunity: each time period that trades at a price adds a letter there, so the profile shows where price spent the most time.',
      body: [
        { p: 'In the app’s **Time price opportunity** style, every bar in a session (a UTC day) adds a letter to each price bucket it traded through, stacked from the session start. Wide rows are prices the market accepted; thin tails are prices it rejected quickly.' },
        {
          list: [
            'The widest row is the time-based point of control — the session’s “fairest” price.',
            'A bell-shaped profile suggests balance (range); a long thin profile suggests a trend day.',
            'Single prints (thin areas) are often revisited later.',
          ],
        },
        { tip: 'Compare today’s profile with yesterday’s: opening outside the prior value area hints at a directional day.' },
        { warn: 'TPO measures time, not volume. A price can have many letters but little real size traded there.' },
      ],
      inApp: 'Charts → chart style picker → Time price opportunity',
      tags: ['tpo', 'market profile', 'time price opportunity', 'auction'],
    },
    {
      id: 'volume-profile',
      title: 'Volume profile: POC, VAH, VAL & value area',
      summary:
        'A sideways histogram of how much volume traded at each price over a window. It shows which prices the market accepted and which it rushed through.',
      body: [
        { p: 'The app builds the profile from candles: each bar’s volume is spread evenly over the rows its high–low range touches, coloured as buying on up-bars and selling on down-bars. Defaults: a **24-hour** lookback, **48** rows and a **70%** value area (rows and value area % are adjustable).' },
        {
          list: [
            '**POC** (point of control): the single price row with the most volume — a magnet and pivot.',
            '**Value area**: the range around the POC holding 70% of the volume.',
            '**VAH / VAL**: the value area high and low. Price returning inside value often rotates toward the POC.',
            '**Low-volume nodes**: thin rows price tends to move through quickly.',
          ],
        },
        { diagram: 'volume-profile', caption: 'POC at the widest row; VAH and VAL bound the 70% value area.' },
        { tip: 'Acceptance above VAH (several closes there) suggests the market is building value higher; a quick rejection back inside suggests a failed breakout.' },
        { warn: 'Built from candle volume, so the per-price split is an approximation; it also depends heavily on the lookback window you choose.' },
      ],
      inApp: 'Radar / Charts → chart → Panes → Volume profile; Analysis → Volume Profile card',
      tags: ['volume profile', 'poc', 'vah', 'val', 'value area', 'point of control', 'hvn', 'lvn'],
    },
    {
      id: 'session-volume-profile',
      title: 'Session volume profile',
      summary:
        'A volume profile drawn separately for each session, so you can see how value moves from one day to the next.',
      body: [
        { p: 'The app’s **Session volume profile** chart style draws a volume-by-price histogram and its point of control for each UTC-day session, with a divider between sessions. Like the footprint, it is modelled from candles and labelled as an estimate.' },
        {
          list: [
            'Session POCs moving higher day after day: value is migrating up (uptrend).',
            'Overlapping value areas: balance/range.',
            'An untested prior-session POC is a common reaction level.',
          ],
        },
        { tip: 'Mark yesterday’s POC, VAH and VAL before today’s session — they are common reference levels for intraday traders.' },
        { warn: 'Session boundaries are UTC days; crypto trades 24/7, so a “session” is a convention, not a market open and close.' },
      ],
      inApp: 'Charts → chart style picker → Session volume profile',
      tags: ['session profile', 'daily profile', 'svp', 'volume profile'],
    },
    {
      id: 'vwap-anchored',
      title: 'VWAP & anchored VWAP',
      summary:
        'VWAP is the volume-weighted average price since a starting point. Anchored VWAP is the same calculation started from a chosen event instead of the session open.',
      body: [
        { p: 'VWAP answers “what is the average price everyone who traded since X has paid?”. The app’s VWAP indicator anchors at the start of each UTC day. Traders also anchor VWAP to swing highs/lows, listings or news events to see the average entry of participants since then.' },
        { formula: 'VWAP = Σ(typical price × volume) / Σ(volume)   since the anchor' },
        {
          list: [
            'Price above VWAP: the average participant since the anchor is in profit — buyers in control.',
            'Price below VWAP: the average participant is underwater — sellers in control.',
            'Reclaiming or losing VWAP after a test is a common intraday signal.',
          ],
        },
        { tip: 'Anchor at the low that started a rally: if price later returns to that anchored VWAP, it is the rally’s average cost — often defended.' },
        { warn: 'The app currently offers session VWAP only; anchored VWAP from a custom point is described here as a concept.' },
      ],
      inApp: 'Charts → Indicators → VWAP (session)',
      tags: ['vwap', 'anchored vwap', 'avwap', 'volume weighted average price'],
    },

    // ------------------------------------------------------------ Liquidations
    {
      id: 'liquidations',
      title: 'Liquidations & liquidation cascades',
      summary:
        'A liquidation is a leveraged position the exchange closes by force because margin ran out. A cascade is a chain of them, each forced order pushing price into the next.',
      body: [
        { p: 'A **long liquidation** is a forced sell; a **short liquidation** is a forced buy. Because they are market orders, they hit the book hard. When many positions share similar liquidation prices, one wave can push price into the next cluster — a cascade — producing long wicks and sudden spikes.' },
        {
          list: [
            'Large long liquidations during a drop: leverage is being flushed; selling can exhaust once it is done.',
            'Large short liquidations during a rally: a short squeeze.',
            'Cascades often reverse partly once forced orders stop.',
          ],
        },
        { tip: 'The app streams all Binance USD-M forced orders live; a burst on your coin is a warning that moves may be exaggerated.' },
        { warn: 'Exchanges may throttle or batch liquidation reports, so the feed is a lower bound, not the full total. It also covers one exchange only.' },
      ],
      inApp: 'Radar → Live Liquidations; Dashboard → Liquidations tile; Analysis → stats row',
      tags: ['liquidation', 'cascade', 'forced order', 'margin call', 'squeeze', 'rekt'],
    },
    {
      id: 'liquidation-heatmap',
      title: 'Liquidation heatmap (estimated)',
      summary:
        'A map of where leveraged positions would probably be liquidated, drawn as bright bands at price levels. In the app it is a model, not real exchange position data.',
      body: [
        { p: 'Nobody outside an exchange knows where real positions sit. The app **estimates** them: every bar is assumed to open new leveraged positions across its range, in proportion to its traded value and to rising open interest. Each leverage tier implies a liquidation price — long at `price × (1 − 1/L)`, short at `price × (1 + 1/L)`. Those levels accumulate as bands and fade or are wiped out when price trades through them.' },
        {
          list: [
            '**Leverage mix**: three models — retail-heavy (10–100×), balanced (5–50×) or low-leverage (3–10×) — chosen in the Leverage view.',
            '**Funding** tilts the assumed long/short split: positive funding means more longs (capped between 20% and 80%).',
            'Bright bands above price: estimated short liquidations; below: estimated long liquidations.',
            'Price is often drawn toward large clusters, because forced orders there add fuel to a move.',
          ],
        },
        { tip: 'Use the Key Liquidity Zones and Liquidation Levels cards on the Analysis tab — they read the same model as the heatmap.' },
        { warn: 'This is a **model built from price, volume, open interest, funding and an assumed leverage mix**. It is not exchange position data, and different models give different maps. Treat bands as areas of interest, not guaranteed targets.' },
      ],
      inApp: 'Analysis → Liquidity Heatmap (views: Heatmap, Liquidity, Leverage, FVG)',
      tags: ['liquidation heatmap', 'liq map', 'liquidation levels', 'leverage', 'clusters'],
    },

    // ------------------------------------------------------------ Structure
    {
      id: 'liquidity-sweep',
      title: 'Liquidity sweep / stop hunt',
      summary:
        'A quick move beyond an obvious high or low that triggers the stop orders resting there, then reverses back into the range.',
      body: [
        { p: 'Stops and breakout orders cluster just beyond obvious swing highs and lows. When price pokes through, those orders fill — giving large players the liquidity to enter in the opposite direction. The result is a wick beyond the level and a close back inside.' },
        {
          list: [
            'Wick above a clear high then a close back below: possible bearish sweep.',
            'Wick below a clear low then a close back above: possible bullish sweep.',
            'A sweep followed by a break of structure the other way is a stronger reversal signal.',
          ],
        },
        { diagram: 'liquidity-sweep', caption: 'Price takes out the prior low, triggers stops, and closes back above it.' },
        { tip: 'The Analysis tab’s AI Analysis card points out estimated liquidity clusters above or below price as possible sweep targets.' },
        { warn: 'Not every break is a sweep — sometimes the level breaks and the trend continues. Wait for the close back inside before calling it.' },
      ],
      inApp: 'Analysis → AI Analysis and Key Liquidity Zones',
      tags: ['sweep', 'stop hunt', 'liquidity grab', 'stop run', 'fakeout', 'spring', 'upthrust'],
    },
    {
      id: 'fair-value-gap',
      title: 'Fair value gap (FVG)',
      summary:
        'A three-candle pattern where the first and third candles do not overlap, leaving a price gap that was traded through in a single direction.',
      body: [
        { p: 'In a bullish FVG, candle 3’s low is above candle 1’s high; in a bearish FVG, candle 3’s high is below candle 1’s low. The middle candle moved so fast that one side barely traded. The app marks FVGs that have **not yet been traded back through**.' },
        { formula: 'Bullish FVG: low(3) > high(1)  → gap = high(1) … low(3)\nBearish FVG: high(3) < low(1)  → gap = high(3) … low(1)' },
        {
          list: [
            'Price often returns to “fill” part or all of a gap.',
            'An unfilled bullish FVG below price can act as support; a bearish one above, as resistance.',
            'Gaps in the direction of the larger trend are generally more respected.',
          ],
        },
        { diagram: 'fvg', caption: 'Candles 1 and 3 do not overlap; the space between them is the gap.' },
        { tip: 'Combine with structure: an FVG left by the move that broke structure is a common pullback entry area.' },
        { warn: 'On low timeframes FVGs appear constantly. Many are filled straight through without any reaction.' },
      ],
      inApp: 'Analysis → Liquidity Heatmap → FVG view',
      tags: ['fvg', 'fair value gap', 'imbalance', 'inefficiency', 'gap'],
    },
    {
      id: 'order-blocks',
      title: 'Order blocks',
      summary:
        'The last opposite-coloured candle (or small range) before a strong move that breaks structure — an area where large orders are thought to have been placed.',
      body: [
        { p: 'A bullish order block is the last down-candle before a strong rally; a bearish order block is the last up-candle before a strong drop. The idea is that unfilled orders remain there, so price may react when it returns.' },
        {
          list: [
            'Stronger when the move away left a fair value gap and broke structure.',
            'A first return to the block is the classic reaction point; each later test weakens it.',
            'A close through the block invalidates it.',
          ],
        },
        { tip: 'The app does not draw order blocks automatically; its Analysis “Order Blocks” shortcut opens the FVG view, which shows the imbalances such blocks usually leave behind.' },
        { warn: 'Order blocks are a discretionary idea with no single agreed definition — two traders often mark different blocks on the same chart.' },
      ],
      inApp: 'Analysis → Order Blocks shortcut (opens the heatmap’s FVG view)',
      tags: ['order block', 'ob', 'smart money', 'smc', 'supply', 'demand'],
    },
    {
      id: 'market-structure',
      title: 'Market structure: swings, BOS & CHoCH',
      summary:
        'Market structure is the sequence of swing highs and lows. A break of structure (BOS) continues the trend; a change of character (CHoCH) is the first break against it.',
      body: [
        { p: 'The app finds swing highs and lows with **3** bars of confirmation on each side, labels them **HH / HL / LH / LL** (higher high, higher low, lower high, lower low), and records an event when a candle **closes** through the last confirmed swing. It is a **BOS** if the break continues the current direction and a **CHoCH** if it flips it.' },
        {
          list: [
            'HH + HL sequence: uptrend. LH + LL sequence: downtrend.',
            'Bullish BOS: close above the last swing high in an uptrend — continuation.',
            'Bearish CHoCH: in an uptrend, the first close below the last swing low — warning of a possible reversal.',
          ],
        },
        { diagram: 'bos-choch', caption: 'Higher highs break structure (BOS); the first lower low is the change of character (CHoCH).' },
        { tip: 'Use a CHoCH as a warning, then wait for a new lower high and a bearish BOS to confirm a real trend change.' },
        { warn: 'A swing is only known 3 bars after it prints, so events always arrive slightly late. On low timeframes, structure breaks are frequent and noisy.' },
      ],
      inApp: 'Charts → side panel → Structure tab',
      tags: ['market structure', 'bos', 'choch', 'break of structure', 'change of character', 'swing high', 'swing low', 'hh', 'hl', 'lh', 'll'],
    },
    {
      id: 'support-resistance',
      title: 'Support & resistance',
      summary:
        'Support is a price area where buying has repeatedly stopped declines; resistance is where selling has repeatedly stopped rallies.',
      body: [
        { p: 'Levels form where many participants have reasons to act: prior swing highs and lows, high-volume prices, round numbers, liquidation clusters. The app’s Structure tab uses the last confirmed swing high as resistance and the last swing low as support, showing their distance from the current price.' },
        {
          list: [
            'The more times a level is tested and holds, the more traders watch it — but each test also uses up resting orders.',
            'A broken resistance often becomes support on a retest (and vice versa) — a “role reversal”.',
            'Think in zones, not exact prices.',
          ],
        },
        { diagram: 'support-resistance', caption: 'Price bounces off support, breaks resistance, then retests it as support.' },
        { tip: 'Place stops beyond the zone, not exactly on the line, where most other stops are clustered.' },
        { warn: 'Levels break. Repeated tests in quick succession often weaken a level rather than strengthen it.' },
      ],
      inApp: 'Charts → side panel → Structure tab; Radar → Key Levels card',
      tags: ['support', 'resistance', 'key levels', 'sr', 'role reversal', 'flip'],
    },

    // ------------------------------------------------------------ Derivatives positioning
    {
      id: 'funding-rate',
      title: 'Funding rate',
      summary:
        'A periodic payment between long and short holders of perpetual futures that keeps the contract price close to spot.',
      body: [
        { p: 'On Binance perpetuals funding is paid every 8 hours. **Positive** funding: longs pay shorts (the contract trades rich — longs are crowded). **Negative** funding: shorts pay longs. The app shows the current 8-hour rate, its annualised value (rate × 3 × 365) and the time to the next payment.' },
        {
          list: [
            'Around +0.01% per 8h is the usual neutral level.',
            'The app treats **±0.05% per 8h** (roughly ±55% a year) as extreme and raises a squeeze-risk alert.',
            'Very positive funding + rising price: crowded longs — vulnerable to a long squeeze if price stalls.',
            'Very negative funding: crowded shorts — vulnerable to a short squeeze on strength.',
          ],
        },
        { tip: 'Funding is a cost of holding: a leveraged position held through several high-funding periods can lose a meaningful amount even if price does not move.' },
        { warn: 'Extreme funding can persist for days in strong trends. It signals crowding, not timing.' },
      ],
      inApp: 'Charts → side panel → Futures tab; Radar → funding alert banner; Radar → Cross-Exchange Radar (Funding column)',
      tags: ['funding', 'funding rate', 'perpetual', 'perp', 'crowded trade'],
    },
    {
      id: 'open-interest',
      title: 'Open interest',
      summary:
        'The total number (or value) of futures contracts currently open. It rises when new positions are opened and falls when positions are closed.',
      body: [
        { p: 'Every contract has a long and a short side, so open interest counts positions, not direction. The app loads Binance’s hourly open-interest history and compares the latest value with the value 4 hours earlier.' },
        {
          list: [
            'Rising OI: new money and leverage entering the market.',
            'Falling OI: positions closing — voluntarily or by liquidation.',
            'Very high OI relative to its history: lots of leverage, which raises the chance of sharp moves either way.',
          ],
        },
        { tip: 'OI is most useful combined with price — see the OI + price regimes entry.' },
        { warn: 'OI alone says nothing about whether longs or shorts are winning; and it is one exchange’s figure, not the whole market.' },
      ],
      inApp: 'Charts → side panel → Futures tab',
      tags: ['open interest', 'oi', 'futures', 'leverage', 'positions'],
    },
    {
      id: 'oi-price-regimes',
      title: 'OI + price regimes (four quadrants)',
      summary:
        'Reading open interest together with price shows whether a move is driven by new positions or by positions closing.',
      body: [
        { p: 'The app compares the last 4 hours of price change and OI change. Moves smaller than **0.15%** count as flat, to avoid reading meaning into noise. The four quadrants:' },
        {
          list: [
            '**Price ↑ · OI ↑ — New longs**: fresh longs fund the rally; trend has support, but a crowd to liquidate below it.',
            '**Price ↓ · OI ↑ — New shorts**: fresh shorts press the drop; squeeze risk grows if price reclaims.',
            '**Price ↑ · OI ↓ — Short covering**: shorts buying back rather than new demand; such rallies tend to fade once covering ends.',
            '**Price ↓ · OI ↓ — Long capitulation (long liquidation)**: longs closing or forced out; selling can exhaust once leverage is flushed.',
          ],
        },
        { tip: 'The app raises an alert banner on the Radar when the two “divergence” quadrants appear — a rally on falling OI or a drop on falling OI.' },
        { warn: 'These are heuristics from public data, not predictions. A 4-hour window can flip quickly in choppy markets.' },
      ],
      inApp: 'Charts → side panel → Futures tab (regime box); Radar → divergence alert banner',
      tags: ['open interest', 'oi divergence', 'short covering', 'long liquidation', 'capitulation', 'regime', 'quadrant'],
    },
    {
      id: 'long-short-ratio',
      title: 'Long/short ratio',
      summary:
        'The share of trader accounts holding long positions versus short positions on an exchange.',
      body: [
        { p: 'The app shows Binance’s global long/short **account** ratio — the number of accounts net long divided by those net short — with the long % and short % beside it.' },
        {
          list: [
            'Ratio above 1: more accounts long than short; below 1: more short.',
            'Extreme readings show where the crowd (mostly retail) is leaning.',
            'Some traders read extremes as contrarian: when almost everyone is long, there are few buyers left.',
          ],
        },
        { tip: 'Combine with funding and OI: a high ratio, positive funding and rising OI together point to a crowded long side.' },
        { warn: 'It counts accounts, not position size — one large short can outweigh thousands of small longs. A high ratio is not a sell signal by itself.' },
      ],
      inApp: 'Charts → side panel → Futures tab (Long / short)',
      tags: ['long short ratio', 'ls ratio', 'positioning', 'sentiment', 'crowd'],
    },
    {
      id: 'basis-premium',
      title: 'Basis, perpetual premium & cross-exchange spread',
      summary:
        'Basis is the gap between a futures price and spot. Cross-exchange spread is the gap between the same coin’s price on different exchanges.',
      body: [
        { p: 'The app shows the perpetual’s **basis** as mark price versus index price, in bps. A positive basis (premium) means the perpetual trades above spot — usually with positive funding. Its **Cross-Exchange Radar** lists live prices, volume, spread and funding from several exchanges and reports the price gap (highest vs lowest, in bps) and the funding dispersion between them.' },
        { formula: 'Basis (bps) = (mark − index) / index × 10,000\nCross-venue gap (bps) = (highest − lowest) / lowest × 10,000' },
        {
          list: [
            'Large positive premium: leveraged buyers are paying up — often frothy.',
            'Negative basis (discount): futures sellers are more aggressive than spot.',
            'The app flags a “discrepancy signal” when the cross-venue gap is above 10 bps.',
          ],
        },
        { tip: 'An outlier venue is often the one with lower liquidity or a deposit/withdrawal problem, not free money.' },
        { warn: 'Arbitrage is rarely as easy as the gap looks: fees, transfer time, withdrawal limits and slippage often eat it entirely. Check fees and withdrawal status first.' },
      ],
      inApp: 'Charts → side panel → Futures tab (Basis); Radar → Cross-Exchange Radar',
      tags: ['basis', 'premium', 'mark price', 'index price', 'arbitrage', 'cross exchange', 'spread'],
    },
    {
      id: 'whale-tracking',
      title: 'Whale tracking & large trades',
      summary:
        'Highlighting unusually large trades, which can come from institutions, funds or liquidations and often move price.',
      body: [
        { p: 'The app rebuilds individual taker orders from Binance trade data and shows the large ones. The Radar’s **Whale Order Tracker** lists prints of **$50,000** or more. The chart’s **Whale bubbles** scale the default threshold to the coin’s 24h volume — about 1/20,000 of a day’s turnover (around $100k on BTC, $50k on ETH), kept between $10k and $1M — with bubble size proportional to the order’s value.' },
        {
          list: [
            'Clusters of large buys at a level: someone is accumulating or defending it.',
            'Large sells into a rally: distribution or profit-taking.',
            'A big print that moves price little: it was absorbed by the other side.',
          ],
        },
        { tip: 'Look at whether large prints line up with structure levels — a whale buying a support retest is more informative than one in the middle of a range.' },
        { warn: 'Big players usually split orders to hide them, and a large print can be a forced liquidation or one side of a hedge. Size alone does not tell you intent.' },
      ],
      inApp: 'Radar → Whale Order Tracker; Radar / Charts → chart → Panes → Whale bubbles',
      tags: ['whale', 'large trade', 'block trade', 'big orders', 'smart money'],
    },

    // ------------------------------------------------------------ Context
    {
      id: 'mtf-confluence',
      title: 'Multi-timeframe confluence',
      summary:
        'Checking whether several timeframes agree on direction. Agreement across timeframes generally gives a cleaner read than one timeframe alone.',
      body: [
        { p: 'The app takes the chart’s timeframe (or the next native one) plus the next three higher timeframes. On each it casts three votes: **RSI** above 55 (bull) or below 45 (bear), **MACD histogram** above or below zero, and **close vs EMA20** (above/below by more than 0.05%). The majority sets that timeframe’s verdict, and the majority of timeframes sets the overall bias.' },
        {
          list: [
            'All timeframes bullish: strong alignment — pullbacks on the lower timeframe may be buying opportunities.',
            'Higher timeframes bearish, lower ones bullish: likely a bounce inside a downtrend.',
            'Mixed verdicts: no clear edge; ranges are likely.',
          ],
        },
        { tip: 'Let the highest timeframe set direction and the lowest choose timing.' },
        { warn: 'The votes are built on lagging indicators, so alignment often comes after much of the move has happened.' },
      ],
      inApp: 'Radar → Multi-Timeframe Analysis; Analysis → Multi-Timeframe Analysis; chart → Panes → MTF confluence',
      tags: ['confluence', 'multi timeframe', 'mtf', 'top down analysis', 'alignment'],
    },
    {
      id: 'fear-greed',
      title: 'Fear & Greed index',
      summary:
        'A 0–100 sentiment score for the crypto market, from extreme fear to extreme greed.',
      body: [
        { p: 'The app shows the Crypto Fear & Greed Index from alternative.me, which blends volatility, momentum/volume, social media, dominance and trend data into one daily number.' },
        {
          list: [
            '0–24: Extreme Fear · 25–39: Fear · 40–59: Neutral · 60–74: Greed · 75–100: Extreme Greed.',
            'Extreme fear has often appeared near market lows; extreme greed near local tops.',
            'Many traders use it contrarian: cautious when greed is extreme, interested when fear is extreme.',
          ],
        },
        { tip: 'Watch the change over days rather than one reading — a fast swing from greed to fear says more than a single value.' },
        { warn: 'It updates once a day, covers the whole market (Bitcoin-heavy) and can stay extreme for weeks. It is not a timing tool.' },
      ],
      inApp: 'Radar → Fear & Greed Index; Dashboard → Sentiment tile',
      tags: ['fear and greed', 'sentiment', 'fng', 'market mood'],
    },
    {
      id: 'economic-calendar',
      title: 'Economic calendar impact (High / Medium / Low)',
      summary:
        'A schedule of macroeconomic releases (inflation, jobs, interest-rate decisions) with an expected impact rating.',
      body: [
        { p: 'Events are rated by how much they usually move markets. The app’s calendar can be filtered by impact — **High**, **Medium**, **Low** — plus holidays, and highlights the next upcoming event.' },
        {
          list: [
            '**High**: e.g. CPI inflation, central-bank rate decisions, US jobs report — can move crypto sharply within minutes.',
            '**Medium**: secondary data; moves are usually smaller.',
            '**Low**: rarely market-moving on their own.',
          ],
        },
        { tip: 'Spreads widen and liquidity thins just before high-impact releases. Many traders reduce size or avoid new entries in the minutes around them.' },
        { warn: 'The actual reaction depends on the surprise versus expectations, not on the rating — a “high” event that matches forecasts can pass quietly.' },
      ],
      inApp: 'News → Economic Calendar',
      tags: ['economic calendar', 'macro', 'cpi', 'fomc', 'news events', 'impact'],
    },
  ],
}
