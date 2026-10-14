// Indicator glossary — one entry per indicator in the chart's Indicators menu
// (src/features/charts/indicators/registry.ts), in the registry's group order.
// Defaults quoted here are the registry's defaults; keep them in sync.
import type { LearnSection } from './types'

const SCANNER = 'also scored by the Signal Scanner'

export const INDICATORS: LearnSection = {
  id: 'indicators',
  title: 'Indicator glossary',
  intro:
    'Indicators are calculations on past price and volume, drawn on or under the chart. None of them predicts the future on its own — each restates what price already did in a different form. Use them alongside market structure, volume and a clear risk plan, not as stand-alone buy or sell buttons.',
  entries: [
    // ------------------------------------------------------------ Moving averages
    {
      id: 'sma',
      title: 'SMA — Simple Moving Average',
      summary:
        'The plain average of the last N closes. It smooths out noise so the general direction of price is easier to see.',
      body: [
        { p: 'An SMA adds up the last N prices and divides by N, giving every bar equal weight. The app’s default length is **20**.' },
        { formula: 'SMA(N) = (P1 + P2 + … + PN) / N' },
        {
          list: [
            'Price holding above a rising SMA suggests an uptrend; below a falling SMA, a downtrend.',
            'A flat SMA with price crossing it back and forth means a range, not a trend.',
            'Common lengths: 20 (short-term), 50 (medium), 200 (long-term trend).',
          ],
        },
        { tip: 'Look at the slope of the SMA rather than every single cross — the slope tells you the trend, crosses are often noise.' },
        { warn: 'An SMA lags: it only turns after price has already turned, and an old price dropping out of the window can move it even when nothing new happened.' },
      ],
      inApp: 'Charts → Indicators → SMA',
      tags: ['moving average', 'simple moving average', 'ma', 'trend'],
    },
    {
      id: 'ema',
      title: 'EMA — Exponential Moving Average',
      summary:
        'A moving average that gives more weight to recent prices, so it reacts faster than an SMA of the same length.',
      body: [
        { p: 'The EMA blends each new price with the previous EMA value, so recent bars count most and old bars fade out gradually. The app’s default length is **20**.' },
        { formula: 'k = 2 / (N + 1)\nEMA = P × k + EMA(prev) × (1 − k)' },
        {
          list: [
            'Close above a rising EMA20 = short-term bullish bias; below a falling EMA20 = bearish bias.',
            'In strong trends price often pulls back to the EMA and bounces from it.',
            'Two EMAs crossing (e.g. 9 over 21) is a common trend-change signal — see EMA Cross.',
          ],
        },
        { tip: 'The Signal Scanner uses **close vs EMA20** as one of its trend votes, so the EMA20 on your chart shows the same read the scanner sees.' },
        { warn: 'Faster reaction also means more false turns in sideways markets — an EMA whipsaws more than an SMA.' },
      ],
      inApp: 'Charts → Indicators → EMA; ' + SCANNER,
      tags: ['exponential moving average', 'ema20', 'moving average', 'trend'],
    },
    {
      id: 'wma',
      title: 'WMA — Weighted Moving Average',
      summary:
        'A moving average where weights fall in a straight line from the newest bar to the oldest.',
      body: [
        { p: 'The newest bar gets weight N, the one before N−1, and so on down to 1. It sits between the SMA and EMA in responsiveness. Default length **20**.' },
        { formula: 'WMA = (N·P1 + (N−1)·P2 + … + 1·PN) / (N(N+1)/2)' },
        {
          list: [
            'Read it like any moving average: slope shows trend direction, price above/below shows bias.',
            'It turns earlier than an SMA of the same length.',
          ],
        },
        { tip: 'The WMA is the building block of the Hull MA; on its own it is a reasonable middle ground between SMA and EMA.' },
        { warn: 'Still a lagging average — it confirms moves, it does not anticipate them.' },
      ],
      inApp: 'Charts → Indicators → WMA',
      tags: ['weighted moving average', 'linear weighted', 'lwma'],
    },
    {
      id: 'vwap',
      title: 'VWAP — Volume-Weighted Average Price (session)',
      summary:
        'The average price traded today, weighted by volume. It shows the “fair” price where most business has been done this session.',
      body: [
        { p: 'Each bar’s typical price (high + low + close) / 3 is weighted by its volume and accumulated through the session. The app resets VWAP at each **UTC day** boundary. It has no length setting.' },
        { formula: 'TP = (H + L + C) / 3\nVWAP = Σ(TP × Volume) / Σ(Volume)   (since session start)' },
        {
          list: [
            'Price above VWAP: buyers have been in control on average today; below: sellers.',
            'Intraday traders often treat VWAP as dynamic support/resistance and a mean to revert to.',
            'A strong trend day keeps price on one side of VWAP for most of the session.',
          ],
        },
        { tip: 'VWAP matters most on intraday timeframes (1m–1h); on daily or weekly charts a session VWAP is nearly meaningless.' },
        { warn: 'Early in the session VWAP is built on very few bars and jumps around; it becomes stable only as volume accumulates.' },
      ],
      inApp: 'Charts → Indicators → VWAP (session)',
      tags: ['volume weighted average price', 'session vwap', 'fair price', 'intraday'],
    },
    {
      id: 'hma',
      title: 'HMA — Hull Moving Average',
      summary:
        'A fast, smooth moving average designed to cut most of the lag of ordinary averages.',
      body: [
        { p: 'The Hull MA combines two WMAs to cancel lag, then smooths the result with a short WMA of length √N. Default length **20**.' },
        { formula: 'HMA(N) = WMA( 2·WMA(N/2) − WMA(N), √N )' },
        {
          list: [
            'HMA turning up = short-term momentum turning bullish; turning down = bearish.',
            'Because it hugs price closely, its colour/slope change is often used as an early trend signal.',
          ],
        },
        { tip: 'Use the HMA slope as a trend filter on a higher timeframe and take entries on a lower one.' },
        { warn: 'Less lag means it overshoots: after sharp moves it can swing past price and flip direction on noise.' },
      ],
      inApp: 'Charts → Indicators → Hull MA',
      tags: ['hull moving average', 'hull', 'low lag'],
    },
    {
      id: 'vwma',
      title: 'VWMA — Volume-Weighted Moving Average',
      summary:
        'A moving average where bars with more volume count more. Price moves on heavy volume pull it harder.',
      body: [
        { p: 'Unlike session VWAP, the VWMA uses a rolling window of N bars (default **20**) and never resets.' },
        { formula: 'VWMA(N) = Σ(P × V) / Σ(V)   over the last N bars' },
        {
          list: [
            'VWMA above the SMA of the same length: recent volume came on higher prices (buying participation).',
            'VWMA below the SMA: volume came on lower prices (selling participation).',
          ],
        },
        { tip: 'Plot an SMA 20 and a VWMA 20 together — the gap between them tells you whether volume supports the move.' },
        { warn: 'One huge-volume bar (news spike, liquidation cascade) can drag the VWMA for the whole window.' },
      ],
      inApp: 'Charts → Indicators → VWMA',
      tags: ['volume weighted moving average', 'vwma'],
    },
    {
      id: 'rma',
      title: 'RMA — Running (Smoothed) Moving Average',
      summary:
        'Wilder’s smoothed average, a slow EMA used inside RSI, ATR and ADX.',
      body: [
        { p: 'The RMA (also called SMMA) is an EMA with smoothing factor 1/N instead of 2/(N+1), so it reacts more slowly. Default length **14**.' },
        { formula: 'RMA = (RMA(prev) × (N − 1) + P) / N' },
        {
          list: [
            'Read like any moving average, but expect slower turns.',
            'An RMA of length N behaves roughly like an EMA of length 2N − 1.',
          ],
        },
        { tip: 'Useful when you want a smooth trend line that ignores short spikes.' },
        { warn: 'Very slow to react — in fast markets it can lag price by many bars.' },
      ],
      inApp: 'Charts → Indicators → RMA (SMMA)',
      tags: ['smma', 'smoothed moving average', 'wilder', 'running moving average'],
    },
    {
      id: 'ribbon',
      title: 'EMA Ribbon',
      summary:
        'Eight EMAs of increasing length drawn together. When they fan out the trend is strong; when they tangle, the market is undecided.',
      body: [
        { p: 'The app draws 8 EMAs starting at length **20** and adding **5** each time (20, 25, 30 … 55). Both the first length and the step can be changed.' },
        { formula: 'EMA(start + i × step),  i = 0 … 7' },
        {
          list: [
            'Ribbon fanned out and sloping up, price above it: healthy uptrend.',
            'Ribbon fanned out and sloping down, price below it: healthy downtrend.',
            'Lines twisting through each other: range or trend change in progress.',
          ],
        },
        { tip: 'Pullbacks into the ribbon that hold without the lines crossing are the classic trend-continuation spot.' },
        { warn: 'In choppy markets the ribbon is just a tangle — it gives no edge until it separates again.' },
      ],
      inApp: 'Charts → Indicators → EMA Ribbon',
      tags: ['moving average ribbon', 'ema ribbon', 'trend strength'],
    },
    {
      id: 'linreg',
      title: 'Linear Regression',
      summary:
        'The end point of a best-fit straight line through the last N closes, drawn bar by bar as a smooth curve.',
      body: [
        { p: 'At every bar the app fits a least-squares line through the previous N prices (default **50**) and plots where that line ends. It follows trend with little lag.' },
        { formula: 'y = a + b·x  (least squares over N bars)\nLinReg = a + b·(N − 1)' },
        {
          list: [
            'Rising line: prices over the window have trended up; falling: down.',
            'Price far from the line suggests a stretched move that may revert.',
          ],
        },
        { tip: 'Compare its slope on two lengths (e.g. 20 and 50) to see whether short-term and longer-term trend agree.' },
        { warn: 'It assumes a straight-line trend; at turning points it extrapolates the old direction and overshoots.' },
      ],
      inApp: 'Charts → Indicators → Linear Regression',
      tags: ['linear regression', 'linreg', 'least squares', 'regression line'],
    },
    {
      id: 'emacross',
      title: 'EMA Cross (signals)',
      summary:
        'A fast and a slow EMA with arrows where they cross: a golden cross when the fast crosses above, a death cross when it crosses below.',
      body: [
        { p: 'The app plots EMA **9** (short) and EMA **21** (long) and marks each cross with an arrow on the chart.' },
        { formula: 'Golden cross: EMA(9) crosses above EMA(21)\nDeath cross: EMA(9) crosses below EMA(21)' },
        {
          list: [
            'Up arrow (golden cross): short-term momentum turned up.',
            'Down arrow (death cross): short-term momentum turned down.',
            'Crosses in the direction of the higher-timeframe trend are more meaningful.',
          ],
        },
        { tip: 'Filter crosses with a longer trend line (e.g. only take golden crosses while price is above a 200 SMA).' },
        { warn: 'In sideways markets the two EMAs cross over and over, producing a string of losing signals.' },
      ],
      inApp: 'Charts → Indicators → EMA Cross (signals)',
      tags: ['golden cross', 'death cross', 'moving average crossover', 'ma cross'],
    },

    // ------------------------------------------------------------ Bands & channels
    {
      id: 'bb',
      title: 'Bollinger Bands',
      summary:
        'A moving average with bands a set number of standard deviations above and below it. The bands widen when price is volatile and narrow when it is quiet.',
      body: [
        { p: 'The middle line (basis) is an SMA of length **20**; the upper and lower bands sit **2** standard deviations away. Roughly 95% of closes fall inside the bands in a normal distribution — markets are not normal, so treat that as a rough guide.' },
        { formula: 'Basis = SMA(20)\nUpper = Basis + 2 × σ(20)\nLower = Basis − 2 × σ(20)' },
        {
          list: [
            'Close above the upper band: strong push or overextension; below the lower band: strong selling or oversold.',
            'In a strong trend price can “walk the band” for many bars — that is strength, not a reversal signal.',
            'A squeeze (very narrow bands) means low volatility, which often comes before a large move.',
          ],
        },
        { diagram: 'bollinger-squeeze', caption: 'Bands contract in a quiet market, then expand as price breaks out.' },
        { tip: 'The Signal Scanner reads where price sits inside the 20/2 bands as **%B** — see Bollinger %B for the scale.' },
        { warn: 'A squeeze tells you a move is likely, not which way. Touching a band is not by itself a buy or sell signal.' },
      ],
      inApp: 'Charts → Indicators → Bollinger Bands; ' + SCANNER + ' (as %B)',
      tags: ['bollinger', 'bb', 'standard deviation', 'squeeze', 'volatility bands'],
    },
    {
      id: 'keltner',
      title: 'Keltner Channels',
      summary:
        'An EMA with bands set a multiple of ATR away. Smoother than Bollinger Bands because they use average range rather than standard deviation.',
      body: [
        { p: 'The app draws an EMA of length **20** as the middle, with bands **2 × ATR(20)** above and below.' },
        { formula: 'Mid = EMA(20)\nUpper = Mid + 2 × ATR(20)\nLower = Mid − 2 × ATR(20)' },
        {
          list: [
            'Closes outside the channel signal unusually strong momentum in that direction.',
            'In a trend, pullbacks to the middle EMA are common entry areas.',
            'Bollinger Bands moving inside Keltner Channels is the classic “TTM squeeze” low-volatility setup.',
          ],
        },
        { tip: 'Combine with Bollinger Bands: when BB contracts inside Keltner, watch for the breakout.' },
        { warn: 'Breakouts outside the channel fail often in ranges; confirm with volume or structure.' },
      ],
      inApp: 'Charts → Indicators → Keltner Channels',
      tags: ['keltner', 'atr channel', 'ttm squeeze'],
    },
    {
      id: 'supertrend',
      title: 'Supertrend',
      summary:
        'A trailing line that sits below price in an uptrend and above it in a downtrend, flipping sides when price closes through it.',
      body: [
        { p: 'Supertrend builds bands at a multiple of ATR around the bar midpoint and keeps only the side that trails price. Defaults: ATR length **10**, multiplier **3**.' },
        { formula: 'Upper = (H + L)/2 + 3 × ATR(10)\nLower = (H + L)/2 − 3 × ATR(10)\nLine trails price and flips on a close through it' },
        {
          list: [
            'Line below price: uptrend; line above price: downtrend.',
            'A flip of the line is the trend-change signal.',
            'The line can be used as a trailing stop level.',
          ],
        },
        { tip: 'A larger multiplier gives fewer, later flips; a smaller one reacts faster but whipsaws more.' },
        { warn: 'In sideways markets Supertrend flips back and forth, each flip a small loss if traded mechanically.' },
      ],
      inApp: 'Charts → Indicators → Supertrend',
      tags: ['supertrend', 'trailing stop', 'atr trend'],
    },
    {
      id: 'donchian',
      title: 'Donchian Channels',
      summary:
        'The highest high and lowest low of the last N bars, with a middle line halfway between.',
      body: [
        { p: 'Default length **20**. The upper band is the 20-bar high, the lower band the 20-bar low.' },
        { formula: 'Upper = highest high(20)\nLower = lowest low(20)\nBasis = (Upper + Lower) / 2' },
        {
          list: [
            'Price making a new upper band = a new 20-bar high (breakout); lower band = new 20-bar low.',
            'A flat channel = range; a stair-stepping channel = trend.',
          ],
        },
        { tip: 'This is the basis of the classic “Turtle” breakout system — use it to define breakouts objectively.' },
        { warn: 'Many breakouts of a 20-bar high immediately reverse; without a filter most channel breaks are false.' },
      ],
      inApp: 'Charts → Indicators → Donchian Channels',
      tags: ['donchian', 'price channel', 'breakout', 'turtle'],
    },

    // ------------------------------------------------------------ Trend
    {
      id: 'ichimoku',
      title: 'Ichimoku Cloud',
      summary:
        'A complete trend system with five lines and a shaded “cloud” that shows trend, momentum and support/resistance at a glance.',
      body: [
        { p: 'Defaults are the classic **9 / 26 / 52** with displacement **26**. The cloud is the area between Span A and Span B, shifted 26 bars forward.' },
        { formula: 'Conversion = (HH9 + LL9) / 2\nBase = (HH26 + LL26) / 2\nSpan A = (Conversion + Base) / 2  (shifted +26)\nSpan B = (HH52 + LL52) / 2  (shifted +26)\nLagging = Close shifted −26' },
        {
          list: [
            'Price above the cloud: bullish; below: bearish; inside: no clear trend.',
            'Green cloud (Span A above B) leans bullish; red cloud leans bearish.',
            'Conversion crossing above Base is a bullish signal, strongest when above the cloud.',
            'A thick cloud is stronger support/resistance than a thin one.',
          ],
        },
        { tip: 'Start with the simplest read — price vs cloud — before using the line crosses.' },
        { warn: 'Ichimoku was designed for daily charts; on very low timeframes it is noisy and the forward-shifted cloud can mislead.' },
      ],
      inApp: 'Charts → Indicators → Ichimoku Cloud',
      tags: ['ichimoku', 'kumo', 'tenkan', 'kijun', 'senkou', 'chikou', 'cloud'],
    },
    {
      id: 'psar',
      title: 'Parabolic SAR',
      summary:
        'Dots that trail price and accelerate toward it as a trend continues. When price touches the dots they flip to the other side.',
      body: [
        { p: 'SAR means “stop and reverse”. Defaults: start **0.02**, increment **0.02**, maximum **0.2**. The acceleration factor grows each time the trend makes a new extreme.' },
        { formula: 'SAR(next) = SAR + AF × (EP − SAR)\nAF starts at 0.02, +0.02 per new extreme, capped at 0.2' },
        {
          list: [
            'Dots below price: uptrend; dots above price: downtrend.',
            'A flip of the dots marks a possible trend change.',
            'Dots can be used as a trailing stop.',
          ],
        },
        { tip: 'Use it to manage exits in a trend you are already in, rather than to choose entries.' },
        { warn: 'In ranges the dots flip constantly; Parabolic SAR only works well in clearly trending markets.' },
      ],
      inApp: 'Charts → Indicators → Parabolic SAR',
      tags: ['parabolic sar', 'psar', 'stop and reverse', 'trailing stop'],
    },
    {
      id: 'pivots',
      title: 'Pivot High/Low',
      summary:
        'Marks swing highs and lows: bars whose high (or low) is the most extreme of the bars on both sides.',
      body: [
        { p: 'A pivot high needs **5** bars to the left and **5** to the right with lower highs (defaults). The app marks each pivot with an arrow and draws a step line at the last pivot high and low.' },
        { formula: 'Pivot high at bar i: H(i) > H of the 5 bars before and the 5 bars after' },
        {
          list: [
            'The last pivot high is nearby resistance; the last pivot low is nearby support.',
            'Higher pivot highs and lows = uptrend; lower ones = downtrend.',
            'A close through the last pivot is a structure break.',
          ],
        },
        { tip: 'Use pivots to place stops just beyond the last swing rather than at an arbitrary distance.' },
        { warn: 'A pivot is only confirmed after the right-hand bars close — with 5 right bars it appears 5 bars late, and it is never available on the newest bars.' },
      ],
      inApp: 'Charts → Indicators → Pivot High/Low',
      tags: ['pivot', 'swing high', 'swing low', 'fractal', 'market structure'],
    },
    {
      id: 'adx',
      title: 'ADX / DMI — Average Directional Index',
      summary:
        'Measures how strong a trend is (ADX) and which side is winning (+DI vs −DI). It does not tell you direction by itself.',
      body: [
        { p: '+DI and −DI compare today’s upward and downward range extension, smoothed over **14** bars. ADX is a **14**-bar smoothed measure of how far apart they are. The app draws a guide at **25**.' },
        { formula: '+DI = 100 × RMA(+DM) / ATR\n−DI = 100 × RMA(−DM) / ATR\nDX = 100 × |+DI − −DI| / (+DI + −DI)\nADX = RMA(DX)' },
        {
          list: [
            'ADX above 25: trending market; below ~20: weak trend or range.',
            '+DI above −DI: buyers dominate; −DI above +DI: sellers dominate.',
            'A rising ADX means the trend is strengthening, whichever direction it is.',
          ],
        },
        { tip: 'Use ADX to decide which tools to use: trend-following when ADX is high, range/oscillator tactics when it is low.' },
        { warn: 'ADX lags heavily and peaks after the trend is mature; a falling ADX from high levels does not mean a reversal, only weakening.' },
      ],
      inApp: 'Charts → Indicators → ADX / DMI',
      tags: ['adx', 'dmi', 'directional movement', 'trend strength', '+di', '-di'],
    },
    {
      id: 'aroon',
      title: 'Aroon',
      summary:
        'Shows how recently the highest high and the lowest low of the window happened. Recent highs mean an uptrend; recent lows, a downtrend.',
      body: [
        { p: 'Default length **14**. Aroon Up is 100 when the high was made this bar and falls toward 0 as it ages. Guides at **30** and **70**.' },
        { formula: 'Aroon Up = 100 × (N − bars since N-bar high) / N\nAroon Down = 100 × (N − bars since N-bar low) / N' },
        {
          list: [
            'Up above 70 and Down below 30: strong uptrend.',
            'Down above 70 and Up below 30: strong downtrend.',
            'Up crossing above Down: possible start of an uptrend.',
          ],
        },
        { tip: 'Both lines low at the same time = no recent extremes, which usually means consolidation.' },
        { warn: 'Aroon only counts time since extremes, not size of moves — a tiny new high scores the same as a big one.' },
      ],
      inApp: 'Charts → Indicators → Aroon',
      tags: ['aroon', 'trend age', 'aroon up', 'aroon down'],
    },
    {
      id: 'vortex',
      title: 'Vortex Indicator',
      summary:
        'Two lines, VI+ and VI−, that compare upward and downward price movement to spot trend starts.',
      body: [
        { p: 'Default period **14**, with a guide at **1**. VI+ measures how far today’s high reaches beyond yesterday’s low; VI− the reverse, both scaled by true range.' },
        { formula: 'VM+ = |H − L(prev)|,  VM− = |L − H(prev)|\nVI+ = Σ VM+(N) / Σ TR(N)\nVI− = Σ VM−(N) / Σ TR(N)' },
        {
          list: [
            'VI+ crossing above VI−: bullish trend may be starting.',
            'VI− crossing above VI+: bearish trend may be starting.',
            'A wide gap between the lines means a strong trend.',
          ],
        },
        { tip: 'Take Vortex crosses only when price structure (a break of the last swing) agrees.' },
        { warn: 'In ranges the two lines intertwine and crosses are frequent and unreliable.' },
      ],
      inApp: 'Charts → Indicators → Vortex',
      tags: ['vortex', 'vi+', 'vi-', 'trend start'],
    },

    // ------------------------------------------------------------ Oscillators
    {
      id: 'rsi',
      title: 'RSI — Relative Strength Index',
      summary:
        'A 0–100 gauge of recent gains versus losses. High readings mean price has risen fast; low readings mean it has fallen fast.',
      body: [
        { p: 'RSI compares the average up-move to the average down-move over **14** bars (Wilder smoothing). The app draws guides at **30** and **70**.' },
        { formula: 'RS = RMA(gains, 14) / RMA(losses, 14)\nRSI = 100 − 100 / (1 + RS)' },
        {
          list: [
            'Above 70: overbought — strong buying, possibly stretched. Below 30: oversold.',
            'In strong trends RSI can stay above 70 (or below 30) for a long time.',
            'Bearish divergence: price makes a higher high while RSI makes a lower high — momentum is fading.',
            'Bullish divergence: price makes a lower low while RSI makes a higher low.',
          ],
        },
        { diagram: 'rsi-divergence', caption: 'Price makes a new high, RSI does not: bearish divergence.' },
        { tip: 'The Signal Scanner scores RSI(14) and RSI divergence on 1H, 4H and 1D; check whether the same read shows on more than one timeframe.' },
        { warn: '“Overbought” is not “sell”. Shorting every reading above 70 in an uptrend is one of the most common beginner losses. Divergences can also repeat several times before price turns.' },
      ],
      inApp: 'Charts → Indicators → RSI; ' + SCANNER,
      tags: ['rsi', 'relative strength index', 'overbought', 'oversold', 'divergence', 'momentum'],
    },
    {
      id: 'macd',
      title: 'MACD — Moving Average Convergence Divergence',
      summary:
        'The gap between a fast and a slow EMA, with a signal line and a histogram. It shows trend direction and whether momentum is growing or shrinking.',
      body: [
        { p: 'Defaults **12 / 26 / 9**. The MACD line is EMA12 minus EMA26; the signal line is a 9-period EMA of that; the histogram is the difference between them. Guide at **0**.' },
        { formula: 'MACD = EMA(12) − EMA(26)\nSignal = EMA(MACD, 9)\nHistogram = MACD − Signal' },
        {
          list: [
            'MACD crossing above the signal (histogram turns positive): bullish momentum shift.',
            'MACD crossing below the signal (histogram turns negative): bearish momentum shift.',
            'MACD above zero: the fast EMA is above the slow one — an uptrend bias.',
            'Shrinking histogram bars: momentum is fading even if price still moves.',
          ],
        },
        { diagram: 'macd-cross', caption: 'MACD crosses its signal line; the histogram flips sign.' },
        { tip: 'The Signal Scanner scores the MACD(12,26,9) histogram cross and trend. Crosses on the same side as the zero line (bullish crosses above zero) tend to be cleaner.' },
        { warn: 'MACD is built from moving averages, so it lags. In flat markets it hovers around zero and crosses repeatedly.' },
      ],
      inApp: 'Charts → Indicators → MACD; ' + SCANNER,
      tags: ['macd', 'histogram', 'signal line', 'crossover', 'momentum'],
    },
    {
      id: 'stoch',
      title: 'Stochastic Oscillator',
      summary:
        'Shows where the close sits within the recent high–low range, from 0 (at the low) to 100 (at the high).',
      body: [
        { p: '%K uses a **14**-bar range; %D is a **3**-bar average of %K. Guides at **20** and **80**.' },
        { formula: '%K = 100 × (C − LL14) / (HH14 − LL14)\n%D = SMA(%K, 3)' },
        {
          list: [
            'Above 80: closing near the top of the range (overbought); below 20: near the bottom (oversold).',
            '%K crossing above %D below 20: possible bullish turn.',
            '%K crossing below %D above 80: possible bearish turn.',
          ],
        },
        { tip: 'Stochastic works best in ranges; in trends, use oversold readings only in an uptrend (and vice versa).' },
        { warn: 'Very sensitive — it can pin at extremes through an entire trend and gives many early signals.' },
      ],
      inApp: 'Charts → Indicators → Stochastic',
      tags: ['stochastic', 'stoch', '%k', '%d', 'overbought', 'oversold'],
    },
    {
      id: 'cci',
      title: 'CCI — Commodity Channel Index',
      summary:
        'Measures how far the typical price is from its average, scaled by its usual deviation.',
      body: [
        { p: 'Default length **20**, guides at **±100**. The 0.015 constant makes most readings fall between −100 and +100.' },
        { formula: 'TP = (H + L + C) / 3\nCCI = (TP − SMA(TP, 20)) / (0.015 × mean deviation)' },
        {
          list: [
            'Above +100: unusually strong; below −100: unusually weak.',
            'Crossing back inside ±100 from outside can signal the move is losing steam.',
            'Divergences between CCI and price warn of fading momentum.',
          ],
        },
        { tip: 'Some traders use a move above +100 as a trend-start signal rather than as overbought — decide which reading you use and test it.' },
        { warn: 'CCI has no upper or lower bound, so “extreme” levels vary by asset and volatility.' },
      ],
      inApp: 'Charts → Indicators → CCI',
      tags: ['cci', 'commodity channel index', 'deviation'],
    },
    {
      id: 'willr',
      title: 'Williams %R',
      summary:
        'An inverted stochastic: 0 means the close is at the top of the recent range, −100 at the bottom.',
      body: [
        { p: 'Default length **14**, guides at **−20** and **−80**.' },
        { formula: '%R = −100 × (HH14 − C) / (HH14 − LL14)' },
        {
          list: [
            'Above −20: overbought (closing near the highs).',
            'Below −80: oversold (closing near the lows).',
            'Moving back out of an extreme zone can mark a short-term turn.',
          ],
        },
        { tip: 'Wait for %R to leave the extreme zone instead of acting the moment it enters it.' },
        { warn: 'Like the stochastic, it can stay at extremes for a long time during a strong trend.' },
      ],
      inApp: 'Charts → Indicators → Williams %R',
      tags: ['williams %r', 'williams r', 'percent r', 'overbought', 'oversold'],
    },
    {
      id: 'roc',
      title: 'ROC — Rate of Change',
      summary:
        'The percentage change in price compared with N bars ago.',
      body: [
        { p: 'Default length **12**, guide at **0**.' },
        { formula: 'ROC = 100 × (C − C[12]) / C[12]' },
        {
          list: [
            'Above 0: price is higher than 12 bars ago; below 0: lower.',
            'ROC crossing zero marks a momentum shift.',
            'Peaks in ROC that get smaller while price rises show slowing momentum.',
          ],
        },
        { tip: 'Compare ROC across coins with the same setting to see which is moving fastest.' },
        { warn: 'ROC jumps when the bar 12 periods ago drops out of the window, even if current price is flat.' },
      ],
      inApp: 'Charts → Indicators → Rate of Change',
      tags: ['roc', 'rate of change', 'momentum', 'percent change'],
    },
    {
      id: 'atr',
      title: 'ATR — Average True Range',
      summary:
        'The average size of a bar’s full range, including gaps. It measures volatility, not direction.',
      body: [
        { p: 'True range is the largest of high−low, |high − previous close| and |low − previous close|. ATR is its **14**-bar Wilder average, in price units.' },
        { formula: 'TR = max(H − L, |H − C(prev)|, |L − C(prev)|)\nATR = RMA(TR, 14)' },
        {
          list: [
            'Rising ATR: bars are getting bigger — volatility expanding.',
            'Falling ATR: bars shrinking — quiet market, often before a breakout.',
            'ATR says nothing about direction: it rises in sharp sell-offs and in sharp rallies.',
          ],
        },
        { tip: 'Size stops in ATR multiples (e.g. 1.5–2 × ATR beyond entry) so the stop fits the market’s current noise. The Signal Scanner’s trade plans use ATR(14): a 1.5 × ATR stop with 1.5 × and 3 × ATR targets.' },
        { warn: 'ATR is in price units, so you cannot compare it across coins with different prices — divide by price for a percentage.' },
      ],
      inApp: 'Charts → Indicators → ATR; also used by the Signal Scanner for stops and targets',
      tags: ['atr', 'average true range', 'volatility', 'stop loss'],
    },
    {
      id: 'stochrsi',
      title: 'Stoch RSI',
      summary:
        'A stochastic applied to RSI instead of price. It shows where RSI sits within its own recent range and moves much faster than RSI.',
      body: [
        { p: 'Defaults: RSI length **14**, stochastic length **14**, K smoothing **3**, D smoothing **3**. Guides at **20** and **80**.' },
        { formula: 'StochRSI = (RSI − min RSI14) / (max RSI14 − min RSI14)\nK = SMA(StochRSI × 100, 3)\nD = SMA(K, 3)' },
        {
          list: [
            'Above 80: RSI is at the top of its recent range; below 20: at the bottom.',
            'K crossing D in an extreme zone is the usual timing signal.',
          ],
        },
        { tip: 'Use it for timing entries in the direction of a trend you have already identified with slower tools.' },
        { warn: 'Very noisy — it hits 0 and 100 often. On its own it produces many false signals.' },
      ],
      inApp: 'Charts → Indicators → Stoch RSI',
      tags: ['stoch rsi', 'stochastic rsi', 'stochrsi'],
    },
    {
      id: 'ao',
      title: 'Awesome Oscillator',
      summary:
        'The difference between a 5-bar and a 34-bar average of the bar midpoint, drawn as a histogram.',
      body: [
        { p: 'Fixed lengths **5** and **34** on (high + low) / 2. Bars are coloured by whether they are rising or falling versus the previous bar. Guide at **0**.' },
        { formula: 'AO = SMA(HL2, 5) − SMA(HL2, 34)' },
        {
          list: [
            'AO crossing above zero: short-term momentum above long-term — bullish.',
            'AO crossing below zero: bearish.',
            'Colour change in the histogram shows momentum accelerating or slowing.',
          ],
        },
        { tip: 'The “saucer” setup — two falling bars followed by a rising bar above zero — is a common continuation signal.' },
        { warn: 'Based on simple averages, so it lags and gives repeated zero crosses in ranges.' },
      ],
      inApp: 'Charts → Indicators → Awesome Oscillator',
      tags: ['awesome oscillator', 'ao', 'bill williams', 'saucer'],
    },
    {
      id: 'mom',
      title: 'Momentum',
      summary:
        'The plain price difference between now and N bars ago.',
      body: [
        { p: 'Default length **10**, guide at **0**. It is the same idea as Rate of Change, but in price units instead of percent.' },
        { formula: 'MOM = C − C[10]' },
        {
          list: [
            'Above 0: price higher than 10 bars ago; below 0: lower.',
            'Momentum falling while price still rises: the move is slowing.',
          ],
        },
        { tip: 'Watch for zero-line crosses that agree with the larger trend.' },
        { warn: 'In price units, so values are not comparable between coins; very sensitive to single bars.' },
      ],
      inApp: 'Charts → Indicators → Momentum',
      tags: ['momentum', 'mom'],
    },
    {
      id: 'trix',
      title: 'TRIX',
      summary:
        'The rate of change of a triple-smoothed EMA. The heavy smoothing filters out small moves.',
      body: [
        { p: 'Default length **18**. The app computes it on the log of the close and scales it by 10,000. Guide at **0**.' },
        { formula: 'E3 = EMA(EMA(EMA(ln C, 18), 18), 18)\nTRIX = 10000 × (E3 − E3[1])' },
        {
          list: [
            'Above 0: the smoothed trend is rising; below 0: falling.',
            'Zero-line crosses mark trend changes.',
            'Divergence with price warns that the trend is weakening.',
          ],
        },
        { tip: 'Good for spotting the bigger trend on noisy low timeframes.' },
        { warn: 'Triple smoothing makes it very slow — signals often come well after the turn.' },
      ],
      inApp: 'Charts → Indicators → TRIX',
      tags: ['trix', 'triple exponential', 'triple ema'],
    },
    {
      id: 'uo',
      title: 'Ultimate Oscillator',
      summary:
        'Combines buying pressure over three time windows into one 0–100 value, to reduce the false signals of single-window oscillators.',
      body: [
        { p: 'Defaults **7 / 14 / 28**, weighted 4 : 2 : 1. Guides at **30** and **70**.' },
        { formula: 'BP = C − min(L, C(prev)),  TR = max(H, C(prev)) − min(L, C(prev))\nAvgN = ΣBP(N) / ΣTR(N)\nUO = 100 × (4·Avg7 + 2·Avg14 + Avg28) / 7' },
        {
          list: [
            'Above 70: overbought; below 30: oversold.',
            'The original buy signal is a bullish divergence with the low under 30, followed by a break above the divergence high.',
          ],
        },
        { tip: 'Most useful for its divergences rather than raw overbought/oversold readings.' },
        { warn: 'Still a range-bound oscillator — in strong trends it stays at extremes.' },
      ],
      inApp: 'Charts → Indicators → Ultimate Oscillator',
      tags: ['ultimate oscillator', 'uo', 'larry williams'],
    },
    {
      id: 'cmo',
      title: 'CMO — Chande Momentum Oscillator',
      summary:
        'Compares the sum of up-moves with the sum of down-moves, from −100 to +100.',
      body: [
        { p: 'Default length **9**, guides at **±50**. Unlike RSI it uses raw sums, not smoothed averages, so it reacts faster.' },
        { formula: 'CMO = 100 × (ΣUp − ΣDown) / (ΣUp + ΣDown)   over 9 bars' },
        {
          list: [
            'Above +50: strong upward momentum (overbought); below −50: strong downward (oversold).',
            'Zero-line crosses show which side has had more movement.',
          ],
        },
        { tip: 'The absolute value of CMO is a quick trend-strength gauge: high = trending, near 0 = choppy.' },
        { warn: 'Short default length makes it jumpy; one large bar can swing it from one extreme to the other.' },
      ],
      inApp: 'Charts → Indicators → Chande Momentum',
      tags: ['cmo', 'chande momentum oscillator', 'chande'],
    },
    {
      id: 'tsi',
      title: 'TSI — True Strength Index',
      summary:
        'A double-smoothed momentum oscillator with a signal line, swinging around zero.',
      body: [
        { p: 'Defaults: long **25**, short **13**, signal **13**. Guide at **0**.' },
        { formula: 'm = C − C(prev)\nTSI = 100 × EMA(EMA(m, 25), 13) / EMA(EMA(|m|, 25), 13)\nSignal = EMA(TSI, 13)' },
        {
          list: [
            'TSI above 0: upward momentum; below 0: downward.',
            'TSI crossing its signal line is the main trigger.',
            'Divergence with price shows weakening trend.',
          ],
        },
        { tip: 'The double smoothing gives cleaner crosses than MACD in many markets — but check it on your timeframe.' },
        { warn: 'Smoothing means lag; crosses come after the turn has started.' },
      ],
      inApp: 'Charts → Indicators → True Strength Index',
      tags: ['tsi', 'true strength index'],
    },
    {
      id: 'zscore',
      title: 'Z-Score',
      summary:
        'How many standard deviations price is from its moving average. It shows how stretched price is in statistical terms.',
      body: [
        { p: 'Default length **20**, guides at **−2, 0, +2**.' },
        { formula: 'Z = (C − SMA(20)) / σ(20)' },
        {
          list: [
            'Above +2: price is unusually far above its average; below −2: far below.',
            'Around 0: price is at its average.',
            'Mean-reversion traders fade extremes; trend traders read them as strength.',
          ],
        },
        { tip: 'Z-Score of +2 is the same thing as touching the upper 20/2 Bollinger Band — use whichever view you find clearer.' },
        { warn: 'Crypto returns have fat tails: moves of 3–5 standard deviations happen far more often than a normal distribution would suggest.' },
      ],
      inApp: 'Charts → Indicators → Z-Score',
      tags: ['z-score', 'zscore', 'standard deviation', 'mean reversion'],
    },

    // ------------------------------------------------------------ Volatility
    {
      id: 'bbpct',
      title: 'Bollinger %B',
      summary:
        'Shows where price sits relative to the Bollinger Bands: 0 at the lower band, 1 at the upper band.',
      body: [
        { p: 'Uses the same **20** length and **2** standard deviations as the bands. Guides at **0** and **1**. Values above 1 or below 0 mean price closed outside the bands.' },
        { formula: '%B = (C − Lower) / (Upper − Lower)' },
        {
          list: [
            'Above 1: closed above the upper band; below 0: below the lower band.',
            '0.5: price is at the middle band (the 20 SMA).',
            'In uptrends %B tends to stay above 0.5; in downtrends below it.',
          ],
        },
        { tip: 'This is the exact read the Signal Scanner and the Radar metric “Bollinger %B (20, 2σ)” use.' },
        { warn: 'Like the bands, a reading above 1 can be the start of a strong trend, not a reversal.' },
      ],
      inApp: 'Charts → Indicators → Bollinger %B; ' + SCANNER,
      tags: ['%b', 'percent b', 'bollinger percent', 'bollinger %b'],
    },
    {
      id: 'bbw',
      title: 'Bollinger Bandwidth',
      summary:
        'The width of the Bollinger Bands relative to the middle line. Low values flag a squeeze; high values, a volatile market.',
      body: [
        { p: 'Same **20 / 2** settings as Bollinger Bands.' },
        { formula: 'BBW = (Upper − Lower) / Basis' },
        {
          list: [
            'Bandwidth at a multi-week low: a squeeze — volatility is compressed.',
            'Bandwidth rising sharply: a breakout or volatile move is under way.',
            'Very high bandwidth often marks the late, exhausted part of a move.',
          ],
        },
        { diagram: 'bollinger-squeeze', caption: 'Bandwidth falls into the squeeze and expands on the breakout.' },
        { tip: 'Compare the current bandwidth with its own history on the same coin and timeframe — there is no universal “low” number.' },
        { warn: 'Bandwidth gives no direction. A squeeze can break either way, and the first move out is sometimes a fake.' },
      ],
      inApp: 'Charts → Indicators → Bollinger Bandwidth',
      tags: ['bandwidth', 'bbw', 'squeeze', 'volatility'],
    },
    {
      id: 'chop',
      title: 'Choppiness Index',
      summary:
        'A 0–100 measure of whether the market is trending (low values) or moving sideways (high values).',
      body: [
        { p: 'Default length **14**, guides at **38.2** and **61.8**. It compares the sum of true ranges with the net high–low range: a lot of movement that goes nowhere is “choppy”.' },
        { formula: 'CHOP = 100 × log10( ΣTR(14) / (HH14 − LL14) ) / log10(14)' },
        {
          list: [
            'Above 61.8: choppy, range-bound market.',
            'Below 38.2: strong directional trend.',
            'Long periods of high CHOP often precede a breakout.',
          ],
        },
        { tip: 'Use it as a filter: avoid trend-following signals when CHOP is high.' },
        { warn: 'It says nothing about direction and can fall during both rallies and sell-offs.' },
      ],
      inApp: 'Charts → Indicators → Choppiness Index',
      tags: ['choppiness', 'chop', 'range', 'trend filter'],
    },
    {
      id: 'hv',
      title: 'Historical Volatility',
      summary:
        'The annualised standard deviation of log returns, in percent. It measures how much price has actually been moving.',
      body: [
        { p: 'Default length **10** bars, annualised with **365** periods per year (right for daily bars — set it to match your timeframe, e.g. 8760 for 1-hour bars on a 24/7 market).' },
        { formula: 'r = ln(C / C(prev))\nHV = 100 × σ(r, 10) × √365' },
        {
          list: [
            'Rising HV: the market is getting more volatile.',
            'Very low HV relative to its history: quiet market, often before a large move.',
          ],
        },
        { tip: 'Use HV to scale position size: when volatility doubles, the same position carries roughly twice the risk.' },
        { warn: 'If “Periods / year” does not match the chart timeframe, the percentage is wrong. It also looks only backward.' },
      ],
      inApp: 'Charts → Indicators → Historical Volatility',
      tags: ['historical volatility', 'hv', 'realized volatility', 'standard deviation'],
    },

    // ------------------------------------------------------------ Volume
    {
      id: 'volume',
      title: 'Volume',
      summary:
        'How much of the asset traded in each bar. It shows how much participation stands behind a price move.',
      body: [
        { p: 'A histogram of each bar’s traded volume, in its own pane. No settings.' },
        { formula: 'Volume = units traded in the bar' },
        {
          list: [
            'Breakouts on rising volume are more convincing than on falling volume.',
            'A trend that continues on shrinking volume is losing participation.',
            'A volume spike at a high or low can mark capitulation or exhaustion.',
          ],
        },
        { tip: 'The Signal Scanner scores the volume trend, and the Radar “Volume Trend” metric compares the last 10 bars with the 10 before — the same idea you can check by eye here.' },
        { warn: 'Volume here is from one exchange’s feed, not the whole market, and wash trading can inflate figures on some coins.' },
      ],
      inApp: 'Charts → Indicators → Volume; ' + SCANNER + ' (volume trend)',
      tags: ['volume', 'participation', 'histogram'],
    },
    {
      id: 'obv',
      title: 'OBV — On-Balance Volume',
      summary:
        'A running total that adds the bar’s volume on up-closes and subtracts it on down-closes.',
      body: [
        { p: 'OBV turns volume into a cumulative line. Its absolute level means nothing; its direction does. No settings.' },
        { formula: 'OBV = OBV(prev) + V   if C > C(prev)\nOBV = OBV(prev) − V   if C < C(prev)' },
        {
          list: [
            'OBV rising with price: volume confirms the uptrend.',
            'Price making new highs while OBV does not: bearish divergence — weak participation.',
            'OBV breaking out before price can hint at accumulation.',
          ],
        },
        { tip: 'Draw trend lines on OBV itself — a break of the OBV trend line is a useful early warning.' },
        { warn: 'A whole bar’s volume is counted as buying or selling based only on the close, which is a crude approximation.' },
      ],
      inApp: 'Charts → Indicators → OBV',
      tags: ['obv', 'on balance volume', 'accumulation', 'distribution'],
    },
    {
      id: 'mfi',
      title: 'MFI — Money Flow Index',
      summary:
        'A volume-weighted RSI: it compares money flowing in on up-bars with money flowing out on down-bars, from 0 to 100.',
      body: [
        { p: 'Default length **14**, guides at **20** and **80**.' },
        { formula: 'TP = (H + L + C) / 3,  MF = TP × V\nRatio = ΣMF(TP up) / ΣMF(TP down)\nMFI = 100 − 100 / (1 + Ratio)' },
        {
          list: [
            'Above 80: overbought on heavy buying; below 20: oversold on heavy selling.',
            'Divergence between MFI and price is often more meaningful than with RSI, because volume is included.',
          ],
        },
        { tip: 'Compare MFI with RSI: if RSI is high but MFI is not, the move lacks volume support.' },
        { warn: 'Same trend-pinning problem as RSI — extremes can last a long time in strong moves.' },
      ],
      inApp: 'Charts → Indicators → Money Flow Index',
      tags: ['mfi', 'money flow index', 'volume rsi'],
    },
    {
      id: 'cmf',
      title: 'CMF — Chaikin Money Flow',
      summary:
        'Measures buying versus selling pressure from where each bar closes within its range, weighted by volume.',
      body: [
        { p: 'Default length **20**, guide at **0**. A close near the bar’s high counts as buying pressure; near the low, selling pressure.' },
        { formula: 'MFM = ((C − L) − (H − C)) / (H − L)\nCMF = Σ(MFM × V, 20) / Σ(V, 20)' },
        {
          list: [
            'Above 0: closes have been near the highs on volume — accumulation.',
            'Below 0: closes near the lows — distribution.',
            'CMF staying positive through a pullback suggests buyers are still active.',
          ],
        },
        { tip: 'Use CMF to confirm breakouts: a breakout with CMF above zero has more support.' },
        { warn: 'It ignores gaps and only looks at where the bar closed, so it can misread volatile bars.' },
      ],
      inApp: 'Charts → Indicators → Chaikin Money Flow',
      tags: ['cmf', 'chaikin money flow', 'accumulation', 'distribution'],
    },
  ],
}
