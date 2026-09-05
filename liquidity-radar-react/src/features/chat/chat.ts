// Radar AI chat brain + chat widget wiring. Faithful extraction of the engine's
// chat stack: ctx loader/cache, chip/coinBrief/IND_EXPLAIN helpers, the
// generateReply rule engine (including the inherited quirk where the
// conversation/economics section only runs when the prompt mentions
// pump/moon/mooning), and the chat DOM send/append wiring. The engine only
// imports pushMsg for the welcome message.
import { COINS, TOP16 } from '../../constants/market'
import { esc, pfmt, cfmt, nfmt, timeAgo } from '../../utils/format'
import { baseOf, findCoin } from '../../utils/coins'
import { aiComposite, forecastFrom } from '../../utils/indicators'
import { jget, jget2 } from '../../api/client'
import { $ } from '../../utils/dom'
import { state } from '../../services/store'
import { signalData } from '../signals'
import { detectPatterns, generateSignalSummary } from '../aiScanner'
import { fetchFromXoomar } from '../analysis/calendar'
import { fngColor } from '../snapshots'
import type { AIScore, CandleLike, Forecast } from '../../types/market'

interface CtxData {
  closes: number[]
  candles: CandleLike[]
  ai: AIScore
  fc: Forecast
}
interface CtxEntry { ts: number; data: CtxData }
interface FgLike { value: string; classification: string }
interface LiqLike { lz: { lo: number; hi: number }; sz: { lo: number; hi: number }; oiN: number }
interface WhaleTape { maker?: boolean; usd: number; price: number; qty: number; time: number }
interface TickerLike { last: number; pct: number; qvol: number; low: number; high: number }
interface TfBreak { tf: string; type: string }

async function loadCtx(base: string): Promise<CtxData> {
  const sym = COINS[base] ? COINS[base].sym : base + 'USDT'
  const c = state.ctxCache[base] as CtxEntry | null | undefined
  if (c && Date.now() - c.ts < 60000) return c.data
  const data = (await jget('https://api.binance.com/api/v3/klines?symbol=' + sym + '&interval=15m&limit=120')) as Array<Array<number | string>>
  const candles = data.map((k) => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))
  const closes = candles.map((x) => x.c)
  const out: CtxData = {
    closes,
    candles,
    ai: aiComposite(candles, closes, candles.map((x) => x.v as number)),
    fc: forecastFrom(closes),
  }
  state.ctxCache[base] = { ts: Date.now(), data: out }
  return out
}
async function safeCtx(base: string): Promise<CtxData> {
  if (COINS[base] && COINS[base].sym === state.symbol && state.candles.length >= 30) {
    const closes = state.candles.map((c) => c.c)
    return {
      closes,
      candles: state.candles,
      ai: (state._ai as AIScore | null | undefined) || aiComposite(state.candles, closes, state.candles.map((c) => c.v as number)),
      fc: forecastFrom(closes),
    }
  }
  return await loadCtx(base)
}
async function ensureAnalysis(base: string): Promise<void> {
  if (base === baseOf(state.symbol) && state._liq) return
  await safeCtx(base)
}

function chip(txt: string | number, cls?: string): string { return '<span class="kv ' + (cls || '') + '">' + txt + '</span>' }

function coinBrief(base: string, d: CtxData): string {
  const meta = COINS[base] || { name: base, icon: '🪙' }
  const t = state.tickers[(COINS[base] || {}).sym] as TickerLike | undefined
  const a = d.ai
  const fc = d.fc
  let s = '<b>' + (meta.icon || '') + ' ' + esc(meta.name || base) + ' (' + base + ')</b><br>'
  if (t) s += 'Live: ' + chip('$' + pfmt(t.last)) + ' · 24h ' + chip((t.pct > 0 ? '+' : '') + t.pct.toFixed(2) + '%', t.pct >= 0 ? 'hl-g' : 'hl-r') + ' · Vol ' + chip(cfmt(t.qvol)) + '<br>24h range: ' + chip(pfmt(t.low) + ' – ' + pfmt(t.high)) + '<br><br>'
  s += '<b>Indicators (15m):</b><br>• RSI(14): <span class="' + (a.rsi > 70 ? 'hl-r' : a.rsi < 30 ? 'hl-g' : '') + '">' + a.rsi.toFixed(1) + '</span> ' + (a.rsi > 70 ? '— overbought' : a.rsi < 30 ? '— oversold' : '— neutral zone') + '<br>'
  s += '• MACD(12,26,9): histogram <span class="' + (a.macd.hist > 0 ? 'hl-g' : 'hl-r') + '">' + (a.macd.hist > 0 ? 'positive — bullish momentum' : 'negative — bearish momentum') + '</span><br>'
  s += '• EMA(20): price trading <b>' + (a.last > a.e20 ? 'above ✅' : 'below ⛔') + '</b> (' + pfmt(a.e20) + ')<br>'
  s += '• Bollinger %B: ' + a.bb.pctB.toFixed(0) + '% of band<br>'
  s += '• Volume: ' + a.vt.toLowerCase() + '<br><br>'
  s += '<b>AI composite:</b> <span class="' + (a.score > 15 ? 'hl-g' : a.score < -15 ? 'hl-r' : 'hl-a') + '">' + (a.score > 0 ? '+' : '') + a.score + ' — ' + a.label + '</span><br>'
  const fcCol = fc.bias.indexOf('UP') === 0 ? 'hl-g' : 'hl-r'
  s += '<b>ML bias (linreg):</b> <span class="' + fcCol + '">' + fc.bias + '</span> · 1H target ~' + chip('$' + pfmt(fc.rows[0].pred)) + ', 24H ~' + chip('$' + pfmt(fc.rows[3].pred))
  return s
}

const IND_EXPLAIN: Record<string, string | null> = {
  rsi: '<b>RSI — Relative Strength Index (14)</b><br>Momentum oscillator built from average gains vs losses over 14 bars. Reads 0–100.<br>• <span class="hl-r">&gt;70 overbought</span> — hot, pullback risk<br>• <span class="hl-g">&lt;30 oversold</span> — washed out, bounce risk<br>• 40–60 = chop/noise. Best used as confluence, never solo.',
  macd: '<b>MACD (12,26,9)</b><br>Difference between fast EMA(12) and slow EMA(26), plus a 9-period signal line of that difference.<br>• Histogram <span class="hl-g">&gt; 0</span>: bullish momentum expanding<br>• Histogram <span class="hl-r">&lt; 0</span>: bearish momentum<br>• Crossovers flag regime shifts; divergence with price is the highest-value signal.',
  ema: '<b>EMA — Exponential Moving Average (20)</b><br>A weighted mean that reacts faster than SMA because recent bars count more. Price above EMA20 = short-term uptrend bias; below = downtrend bias. Traders stack EMA20/50/200 as dynamic support/resistance.',
  sma: '<b>SMA — Simple Moving Average</b><br>The flat arithmetic mean of the last N closes. Slower but smoother than EMA. The SMA50/SMA200 "golden cross / death cross" is the classic long-cycle regime signal.',
  bollinger: '<b>Bollinger Bands (20, 2σ)</b><br>A moving-average envelope at ±2 standard deviations — ~95% of price action lands inside.<br>• Touching the upper band = stretched (not automatically a sell)<br>• Squeeze (narrow bands) precedes volatility expansion<br>• %B tells you exactly where price sits within the band.',
  bb: null,
  atr: '<b>ATR — Average True Range</b><br>The mean bar range including gaps. A pure volatility gauge — used for stop sizing (e.g., a 2×ATR trailing stop) rather than direction.',
}
IND_EXPLAIN.bb = IND_EXPLAIN.bollinger

export async function generateReply(raw: string): Promise<string> {
  const text = ' ' + raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + ' '
  const has = function (w: string): boolean { return new RegExp('\\b' + w.replace(/ /g, '\\s+') + '\\b').test(text) }
  let coin: string | null = null

  if (/^(hi|hello|hey|yo|sup|gm|good morning)\s/.test(text) || has('help') || has('what can you do') || has('commands')) {
    return 'I\'m <b>Radar AI</b>, your microstructure co-pilot. Try me with:<br><br>• Any coin — <i>"analyze solana"</i>, <i>"pepe price"</i>, <i>"should I buy trump?"</i><br>• Indicators — <i>"explain rsi"</i>, <i>"current macd"</i>, <i>"bollinger squeeze?"</i><br>• Derivatives — <i>"funding rate"</i>, <i>"open interest"</i>, <i>"liquidation zones"</i><br>• Flow — <i>"whale activity"</i>, <i>"support and resistance"</i>, <i>"breakout levels"</i><br>• Signals — <i>"show signals"</i>, <i>"best signal"</i>, <i>"scan the market"</i><br>• Economics — <i>"what is inflation?"</i>, <i>"fed rates"</i>, <i>"nfp impact"</i><br>• Crypto basics — <i>"what is bitcoin?"</i>, <i>"explain defi"</i>, <i>"layer 2 scaling"</i><br>• Trading — <i>"position sizing"</i>, <i>"stop loss"</i>, <i>"take profit strategy"</i><br>• News — <i>"show news"</i>, <i>"forex events"</i>, <i>"what is happening today?"</i><br>• Conversation — <i>"tell me a joke"</i>, <i>"how to trade?"</i><br><br>I scan 10 coins every 2 min, detect patterns, track whale flow, and auto-learn from predictions.'
  }
  if (has('thank')) return 'Anytime — Radar never sleeps.'
  if ((has('what did i ask') || has('history') || has('remember') || has('repeat that') || has('what were we')) && state.mem.topics.length) {
    const last = state.mem.topics[state.mem.topics.length - 1]
    return 'From memory, your last question was: <i>"' + esc(String(last)) + '"</i>'
      + (state.mem.lastCoin ? '. We last focused on <b>' + esc(state.mem.lastCoin) + '</b>' : '.')
      + (state.mem.topics.length > 1 ? ('<br><br>Earlier: ' + state.mem.topics.slice(0, -1).map(function (t) { return '&bull; ' + esc(String(t)) }).join('<br>')) : '')
  }

  if (has('signal') || has('scanner') || has('show signal')) {
    const top3 = signalData.slice(0, 3)
    if (!top3.length) return 'Signal scanner is warming up — give me 30 seconds and ask again.'
    let s = '<b>Multi-Timeframe Signal Scanner — Top 3:</b><br><br>'
    top3.forEach(function (sig) {
      const type = sig.master.type
      const cls = type === 'BUY' ? 'hl-g' : type === 'SELL' ? 'hl-r' : 'hl-a'
      const tfStr = sig.master.breakdown.map(function (b: TfBreak) { return b.tf + ':' + b.type }).join(' ')
      s += '&bull; <b>' + baseOf(sig.sym) + '</b>: <span class="' + cls + '">' + type + '</span> (' + (sig.score > 0 ? '+' : '') + sig.score + ')<br>'
      s += '&nbsp;&nbsp;' + tfStr + '<br>'
      if (sig.whaleText) s += '&nbsp;&nbsp;<span style="color:var(--muted)">' + esc(sig.whaleText) + '</span><br>'
    })
    s += '<br>Each signal covers 15m, 1H, 4H, 1D timeframes weighted into a Master signal. Whale flow and auto-learning included.'
    return s
  }

  if (has('pattern') || has('patterns')) {
    const patBase = coin || baseOf(state.symbol)
    try {
      return safeCtx(patBase).then(function (ctx) {
        const patterns = detectPatterns(ctx.closes, state.candles.map((c) => c.v as number))
        let s = '<b>Multi-TF Pattern Scan — ' + patBase + '</b><br><br>'
        if (!patterns.length) s += 'No notable patterns detected right now — market may be in consolidation.'
        else patterns.forEach(function (p) {
          const icon = p.type === 'bullish' ? '[BULL]' : '[BEAR]'
          const cls = p.type === 'bullish' ? 'hl-g' : 'hl-r'
          s += '<span class="' + cls + '">' + icon + ' ' + p.text + '</span> (strength: ' + p.strength + '%)<br>'
        })
        const sig = signalData.find(function (x) { return x.sym === patBase + 'USDT' })
        if (sig) {
          s += '<br><b>Multi-TF signal:</b> '
          sig.master.breakdown.forEach(function (b: TfBreak) {
            const cls2 = b.type === 'BUY' ? 'hl-g' : b.type === 'SELL' ? 'hl-r' : 'hl-a'
            s += b.tf + '=<span class="' + cls2 + '">' + b.type + '</span> '
          })
          s += '<br>Master: <b>' + sig.master.type + ' (' + (sig.score > 0 ? '+' : '') + sig.score + ')</b>'
          if (sig.whaleText) s += '<br>Whale: ' + esc(sig.whaleText)
        }
        s += '<br><br>Patterns combine RSI divergence, MACD crossovers, Bollinger band position, volume spikes, and swing structure across 15m/1H/4H/1D.'
        return s
      })
    } catch (e) { return 'Pattern scan unavailable right now.' }
  }

  if (has('meme') || has('meme coin') || has('dog coin') || has('show meme')) {
    let s = '<b>Meme Coin Universe — Live:</b><br><br>'
    const memes = ['PEPE', 'WIF', 'FLOKI', 'SHIB', 'BONK', 'DOGE', 'TRUMP']
    memes.forEach(function (k) {
      const t = state.tickers[COINS[k] ? COINS[k].sym : k + 'USDT']
      if (t) s += '&bull; <b>' + k + '</b> ' + chip('$' + pfmt(t.last)) + chip((t.pct > 0 ? '+' : '') + t.pct.toFixed(2) + '%', t.pct >= 0 ? 'hl-g' : 'hl-r') + ' vol ' + chip(cfmt(t.qvol)) + '<br>'
    })
    s += '<br>Full meme scanner on the <b>Market tab</b> — 20+ meme coins with signals.'
    return s
  }

  if (has('elon') || has('musk')) {
    let s = '🚀 <b>Elon Musk watchlist</b> — his posts historically move:<br>'
    for (const k of ['DOGE', 'FLOKI', 'SHIB']) {
      const t = state.tickers[COINS[k].sym]
      let extra = ''
      try { const d = await safeCtx(k); extra = ' · RSI ' + d.ai.rsi.toFixed(0) } catch (e) { /* ignore */ }
      s += '• <b>' + COINS[k].icon + ' ' + k + '</b> ' + (t ? chip('$' + pfmt(t.last)) + chip((t.pct > 0 ? '+' : '') + t.pct.toFixed(2) + '%', t.pct >= 0 ? 'hl-g' : 'hl-r') : '') + extra + '<br>'
    }
    s += '<br>DOGE is the canonical "Elon coin"; FLOKI and SHIB ride the same dog-themed beta. One tweet ≠ due diligence — size accordingly.'
    return s
  }

  if (has('fear') || has('greed') || has('sentiment')) {
    if (state.fg) {
      const fg = state.fg as FgLike
      const v = parseInt(fg.value, 10)
      let interp
      if (v < 25) interp = '<span class="hl-r">Extreme Fear</span> — capitulation vibes. Historically decent accumulation zones, terrible for leverage longs.'
      else if (v < 45) interp = '<span class="hl-a">Fear</span> — cautious tape. Watch whether price holds higher lows while sentiment stays soft.'
      else if (v <= 55) interp = 'Gray zone — pure neutral. Structure and flow matter more than sentiment here.'
      else if (v < 75) interp = '<span class="hl-g">Greed</span> — risk appetite building. Momentum strategies tend to keep working until they don\'t.'
      else interp = '<span class="hl-g">Extreme Greed</span> — euphoria readings cluster near local tops. Tighten stops, trim into strength.'
      return '😱/🤑 <b>Fear &amp; Greed Index: <span style="color:' + fngColor(v) + '">' + v + ' — ' + fg.classification.toUpperCase() + '</span></b><br><br>' + interp + '<br><br>The full gauge lives on the <b>Radar tab</b> 🎯'
    }
    return 'Sentiment feed is unreachable right now — check the gauge widget later. General rule: extreme fear favors staged accumulation, extreme greed favors trimming.'
  }

  const indMatch = ['rsi', 'macd', 'bollinger', 'ema', 'sma', 'atr'].find(has)
  coin = findCoin(text)
  const followUp = has('it') || has('its') || has('that') || has('this') || has('the coin') || has('same') || has('again')
  if (!coin && followUp && state.mem.lastCoin) coin = state.mem.lastCoin
  if (coin) state.mem.lastCoin = coin

  if (indMatch) {
    let s = IND_EXPLAIN[indMatch] as string
    const focus = coin || baseOf(state.symbol)
    try {
      const d = (coin || (state.candles.length < 30)) ? await safeCtx(focus) : { ai: state._ai as AIScore | undefined }
      if (d && d.ai) {
        const a = d.ai
        s += '<br><br><b>Live read — ' + focus + ' (15m):</b><br>'
        if (indMatch === 'rsi') s += 'RSI = ' + chip(a.rsi.toFixed(1)) + ' → ' + (a.rsi > 70 ? '<span class="hl-r">overbought</span>' : a.rsi < 30 ? '<span class="hl-g">oversold</span>' : 'neutral')
        else if (indMatch === 'macd') { const last = a.last; s += 'Histogram = ' + chip((a.macd.hist > 0 ? '+' : '') + a.macd.hist.toFixed(last > 100 ? 2 : 6)) + ' → ' + (a.macd.hist > 0 ? '<span class="hl-g">bullish</span>' : '<span class="hl-r">bearish</span>') }
        else if (indMatch === 'ema' || indMatch === 'sma') s += 'EMA20 = ' + chip('$' + pfmt(a.e20)) + ', price ' + pfmt(a.last) + ' → trading <b>' + (a.last > a.e20 ? 'above' : 'below') + '</b>'
        else if (indMatch === 'bollinger' || indMatch === 'bb') s += '%B = ' + chip(a.bb.pctB.toFixed(0) + '%') + ' → ' + (a.bb.pctB > 80 ? 'stretched upper' : a.bb.pctB < 20 ? 'stretched lower' : 'mid-range')
        else s += 'ATR(14×15m) context available on the Analysis tab'
      }
    } catch (e) { /* ignore */ }
    return s
  }

  if (has('funding')) {
    if (state.fr && !coin) {
      const fr = state.fr as { lastFundingRate?: string; nextFundingTime?: number }
      const rate = parseFloat(fr.lastFundingRate || '')
      if (isFinite(rate)) {
        return '💸 <b>' + baseOf(state.symbol) + ' perpetual funding:</b> ' + chip((rate * 100).toFixed(4) + '%') + ' ' + (rate > 0 ? '— <span class="hl-g">longs pay shorts</span> (crowd leans long)' : rate < 0 ? '— <span class="hl-r">shorts pay longs</span> (crowd leans short)' : '— flat') + '<br>Annualized ≈ ' + chip((rate * 3 * 365 * 100).toFixed(1) + '%') + (fr.nextFundingTime ? ' · next payout ~<span class="hl-c">' + new Date(fr.nextFundingTime).toUTCString().slice(17, 22) + ' UTC</span>' : '') + '.<br><br>Persistently positive funding = crowded long side = fuel for long squeezes.'
      }
    }
    return '💸 Funding = periodic payments between perp longs &amp; shorts anchoring futures to spot.<br>• Positive → longs pay (crowded long side)<br>• Negative → shorts pay (crowded short side)<br>Live rates sit on the Radar metrics strip — ask again while viewing any chart.'
  }
  if (has('oi') || has('open interest')) {
    if (state.oi && state.fr && !coin) {
      const mark = parseFloat((state.fr as { markPrice?: string }).markPrice || '')
      const oiN = isFinite(mark) ? parseFloat((state.oi as { openInterest?: string }).openInterest || '') * mark : NaN
      if (isFinite(oiN)) {
        return '🧊 <b>' + baseOf(state.symbol) + ' open interest:</b> ' + chip(cfmt(oiN)) + ' across ' + chip(nfmt(parseFloat((state.oi as { openInterest?: string }).openInterest || '')) + ' contracts') + '<br><br>OI rising + price rising = fresh longs confirming trend. OI falling into a rally = short covering (weaker hands). OI is also the fuel gauge for liquidation cascades.'
      }
    }
    return '🧊 Open Interest = total value of outstanding derivative contracts. Rising OI validates trends; collapsing OI signals deleveraging. The live figure is in the Radar metrics strip.'
  }
  if (has('liquidation') || has('liquidated') || has('liq zones')) {
    const base = coin || baseOf(state.symbol)
    try {
      await ensureAnalysis(base)
      const L = (base === baseOf(state.symbol) && state._liq) ? (state._liq as LiqLike) : null
      if (L) return '💥 <b>' + base + ' liquidation clusters (heuristic):</b><br>• Long liqs: ' + chip('$' + pfmt(L.lz.lo) + ' – $' + pfmt(L.lz.hi)) + ' <span class="hl-g">below swing low</span><br>• Short liqs: ' + chip('$' + pfmt(L.sz.lo) + ' – $' + pfmt(L.sz.hi)) + ' <span class="hl-r">above swing high</span><br>• Open interest at play: ' + chip(cfmt(L.oiN)) + '<br><br>Price gravitates toward dense liquidation pools ("liquidity magnets"). Full breakdown: <b>Analysis tab</b>.'
    } catch (e) { /* ignore */ }
    return '💥 Liquidation = forced closure when margin can\'t cover losses. Clusters form where over-leveraged positions sit; price often wicks into them before reversing. See the Analysis tab for estimated zones on the active symbol.'
  }
  if (has('leverage')) {
    return '[BAL] <b>Leverage reality check:</b><br>• 10x → ~9.5% adverse move liquidates you<br>• 25x → ~3.8%<br>• 50x → ~1.9% (one bad candle)<br>Crypto 15m volatility alone can exceed those numbers on alts. Pros use low leverage with wide ATR-sized stops — not max leverage plus hope.'
  }

  if (has('support') || has('resistance') || has('breakout') || has('levels')) {
    const base = coin || baseOf(state.symbol)
    try {
      let sr: { res: number; sup: number }
      if (base === baseOf(state.symbol) && state._sr) sr = state._sr as { res: number; sup: number }
      else {
        const d = await safeCtx(base)
        const w = d.candles.slice(-96)
        sr = { res: Math.max.apply(null, w.map((c) => c.h)), sup: Math.min.apply(null, w.map((c) => c.l)) }
      }
      const px = state.tickers[(COINS[base] || {}).sym]
      const last = px ? px.last : (state._ai as AIScore | undefined) ? (state._ai as AIScore).last : null
      return '[LVL] <b>' + base + ' key levels (96x15m structure):</b><br>• Resistance: <span class="hl-r">' + chip('$' + pfmt(sr.res)) + '</span>' + (last ? ' (+' + ((sr.res / last - 1) * 100).toFixed(2) + '%)' : '') + '<br>• Support: <span class="hl-g">' + chip('$' + pfmt(sr.sup)) + '</span>' + (last ? ' (' + ((sr.sup / last - 1) * 100).toFixed(2) + '%)' : '') + '<br><br><b>Breakout playbook:</b> wait for a 15m candle to <i>close</i> beyond the level with expanding volume — wicks through don\'t count. Failed breakdowns that reclaim support are among the highest-probability reversals there are.'
    } catch (e) { /* ignore */ }
    return '[S/R] Support/resistance are zones where pending orders historically absorb flow. Real breakouts need candle-close confirmation + volume expansion. Load a chart on the Radar tab and ask again for exact numbers.'
  }

  if (has('best performer') || has('top gainer') || has('biggest gainer') || has('worst performer') || has('biggest loser')) {
    const ts = TOP16.map((k) => ({ k, t: state.tickers[COINS[k].sym] })).filter((x) => x.t)
    if (!ts.length) return 'Market snapshot still loading — give me a few seconds and ask again.'
    ts.sort((a, b) => b.t.pct - a.t.pct)
    if (has('worst') || has('loser')) {
      const w = ts[ts.length - 1]
      return '📉 Worst of the tracked 16: <b>' + COINS[w.k].icon + ' ' + w.k + '</b> ' + chip(w.t.pct.toFixed(2) + '%', 'hl-r') + ' at ' + chip('$' + pfmt(w.t.last)) + '. Rotation day.'
    }
    const b = ts[0]
    let out = '[GAIN] Today\'s leader of the tracked 16: <b>' + COINS[b.k].icon + ' ' + b.k + '</b> ' + chip('+' + b.t.pct.toFixed(2) + '%', 'hl-g') + ' at ' + chip('$' + pfmt(b.t.last)) + ' · vol ' + chip(cfmt(b.t.qvol))
    if (ts.length >= 2) out += '<br><br>Runner-up: ' + ts[1].k + ' (' + ts[1].t.pct.toFixed(2) + '%). Say <i>"analyze ' + b.k.toLowerCase() + '"</i> for the full workup.'; else out += '<br><br>Say <i>"analyze ' + b.k.toLowerCase() + '"</i> for the full workup.'
    return out
  }

  if (has('whale') || has('block trade') || has('smart money') || has('onchain') || has('on chain')) {
    const w = state.whales as WhaleTape[]
    let s = '[W] <b>Whale radar — ' + baseOf(state.symbol) + '</b><br>'
    if (w.length) {
      const buys = w.filter((x) => !x.maker)
      const sell = w.filter((x) => x.maker)
      const buyUsd = buys.reduce((a, x) => a + x.usd, 0)
      const sellUsd = sell.reduce((a, x) => a + x.usd, 0)
      s += w.length + ' block trades ≥$50k in recent tape.<br>• Buy-side flow: <span class="hl-g">' + cfmt(buyUsd) + '</span> (' + buys.length + ' prints)<br>• Sell-side flow: <span class="hl-r">' + cfmt(sellUsd) + '</span> (' + sell.length + ' prints)<br>• Largest print: ' + chip(cfmt(Math.max.apply(null, w.map((x) => x.usd)))) + ' ' + (w[0].maker ? 'SELL' : 'BUY') + ' ' + timeAgo(w[0].time) + '<br><br>Net read: <b>' + (buyUsd > sellUsd ? '<span class="hl-g">accumulative tilt</span>' : '<span class="hl-r">distribution tilt</span>') + '</b>. Live feed on the Radar tab refreshes every 10s.'
    } else {
      s += 'No ≥$50k prints detected recently — either a quiet book or you\'re early. The tracker rescans every 10 seconds.<br><br>Note: this watches exchange tape flow. True on-chain whale wallets need blockchain indexing — different discipline, same paranoia.'
    }
    return s
  }
  if (has('gas') || has('gwei')) {
    return '[GAS] <b>Gas / Gwei 101:</b><br>Gwei = a tiny fraction of ETH (1 ETH = 10^9 gwei) pricing Ethereum computation. Gas spikes with mempool congestion — NFT mints, airdrop claims, on-chain liquidation cascades. High gas ≠ bullish; it means urgent demand for blockspace. For perp traders it matters mostly during DeFi liquidation waves.'
  }

  if (has('defi') || has('dex') || has('lending') || has('yield') || has('staking') || has('tvl') || has('dao') || has('liquidity mining')) {
    return '[DEFI] <b>DeFi quick glossary:</b><br>• <b>DEX</b> — on-chain AMM swaps (Uniswap etc.); no orderbook, pools price assets<br>• <b>Lending</b> — supply collateral, borrow against it (Aave, Compound)<br>• <b>Yield farming</b> — earning tokens for providing liquidity; APYs inversely correlate with sustainability<br>• <b>Staking</b> — securing PoS networks for emission rewards<br>• <b>TVL</b> — total value locked; the sector\'s core health metric<br>• <b>DAO</b> — token-voted governance over a treasury<br><br>This terminal tracks the derivatives layer — where DeFi tokens like UNI, AAVE &amp; MKR play the same whale games as everything else.'
  }

  if (has('should i buy') || has('should i sell') || has('long') || has('short') || has('entry') || has('trade plan') || ((has('buy') || has('sell')) && !coin)) {
    const base = coin || baseOf(state.symbol)
    try {
      const d = await safeCtx(base)
      const a = d.ai
      const fc = d.fc || forecastFrom(d.closes)
      const px = state.tickers[(COINS[base] || {}).sym]
      const dir = a.score > 15 ? 'LONG bias' : a.score < -15 ? 'SHORT bias' : 'NO-TRADE / wait'
      const cls = a.score > 15 ? 'hl-g' : a.score < -15 ? 'hl-r' : 'hl-a'
      const patStr = generateSignalSummary(base, a, fc)
      return '<b>' + base + ' tactical read:</b> ' + (px ? 'spot ' + chip('$' + pfmt(px.last)) : '') + '<br>• AI composite: <span class="' + cls + '">' + (a.score > 0 ? '+' : '') + a.score + ' (' + a.label + ')</span><br>• Trend: price ' + (a.last > a.e20 ? '<span class="hl-g">above</span>' : '<span class="hl-r">below</span>') + ' EMA20 &middot; MACD ' + (a.macd.hist > 0 ? '<span class="hl-g">positive</span>' : '<span class="hl-r">negative</span>') + ' &middot; volume ' + a.vt.toLowerCase() + '<br>• ML projection: <span class="' + cls + '">' + fc.bias + '</span> (1H ~ $' + pfmt(fc.rows[0].pred) + ')<br><br>' + patStr + '<br><br><span class="hl-a">Not financial advice — markets can invalidate any model instantly.</span>'
    } catch (e) {
      return 'Couldn\'t pull live context for that one — try again shortly. Standing disclaimer: I provide analysis frameworks, not financial advice.'
    }
  }

  if (has('buy') || has('sell')) {
    const base = coin || baseOf(state.symbol)
    try {
      const d = await safeCtx(base)
      return coinBrief(base, d) + '<br><br><span class="hl-a">⚠ Analysis only — never financial advice.</span>'
    } catch (e) { /* ignore */ }
  }

  if (has('pump') || has('mooning') || has('moon') || has('to the moon')) {
    // === CONVERSATION ===
    if (/^(how are you|how r u|hru|you good|you ok)\s/.test(text) || has('how are you')) {
      return 'Running at full strength — all streams connected, scanner humming. What do you need?'
    }
    if (/^(who made you|who built you|who created you|who are you|what are you|your name)/.test(text) || has('who made you') || has('your name')) {
      return '<b>Liquidity Radar v5.0</b> — built by <b>Zain</b> as a self-contained crypto microstructure terminal. I run entirely in your browser with live Binance data. No backend, no API keys, no nonsense.'
    }
    if (has('tell me a joke') || has('joke') || has('funny')) {
      const jokes = ['Why did the trader bring a ladder to the bar? Because the drinks were on the house and the charts were going to the moon.<br><br>...I\'ll stick to analyzing candles.', 'What\'s a crypto trader\'s favorite exercise? Jumping to conclusions.<br><br>...and then getting rekt.', 'Why don\'t traders trust atoms? Because they make up everything — including your portfolio value.<br><br>I prefer data.']
      return jokes[Math.floor(Math.random() * jokes.length)]
    }
    if (has('best time') || has('when to trade') || has('trading hours')) {
      return '<b>Best crypto trading windows:</b><br>• US market open (13:30-14:00 UTC) — highest volatility<br>• London session overlap (07:00-09:00 UTC) — EUR/GBP pairs + BTC spillover<br>• Asian session open (00:00-02:00 UTC) — JPY pairs, sometimes BTC dumps<br>• 24/7 nature means there\'s always a session — but liquidity clusters around banking hours. Weekends are thinner and easier to whipsaw.'
    }
    if (has('position sizing') || has('how much to') || has('risk per trade') || has('risk management')) {
      return '<b>Position Sizing 101:</b><br>• Never risk more than 1-2% of total capital on a single trade<br>• Position size = (Account x Risk%) / (Entry - Stop Loss)<br>• Example: $10K account, 1% risk, $100 stop = $1,000 / $100 = 10 units<br>• Kelly criterion for the advanced: f* = (bp - q) / b<br>Most blowups come from sizing too large, not from bad analysis.'
    }
    if (has('stop loss') || has('sl') || has('where to put stop')) {
      return '<b>Stop Loss placement:</b><br>• Below last swing low (longs) / above last swing high (shorts)<br>• ATR-based: entry ± 1.5x ATR(14)<br>• Structure-based: below support zone with buffer<br>• Never use round numbers (everyone else does too)<br><br>The stop is where your thesis is <i>wrong</i>, not where it hurts. If it\'s too tight, you get stopped out by noise. Too wide, and one trade ruins your month.'
    }

    // === ECONOMICS & MACRO ===
    if (has('inflation') || has('cpi') || has('consumer price')) {
      return '<b>Inflation / CPI explained:</b><br>• CPI measures average price change of a consumer basket<br>• Rising CPI = prices going up = USD purchasing power declining<br>• Fed raises rates to fight inflation = risk assets sell off (usually)<br>• Falling CPI = rate cut expectations = risk-on (usually)<br><br>Crypto correlation: BTC tends to rally when CPI comes in soft (rate cut bets) and dump on hot CPI (tightening fears). Not 1:1, but the first 30 minutes after CPI print are pure volatility.'
    }
    if (has('federal reserve') || has('fed rate') || has('interest rate') || has('rate cut') || has('rate hike')) {
      return '<b>The Federal Reserve / Interest Rates:</b><br>• Fed funds rate = what banks charge each other overnight<br>• Higher rates = borrowing costs up = stocks/bonds reprice = crypto correlation varies<br>• Rate cuts = liquidity expectations = risk assets tend to rally<br>• "Higher for longer" = the market\'s worst nightmare in 2023-24<br><br>Crypto impact: BTC was born in a ZIRP (zero interest rate) world. True stress test came with rates at 5.25%. Watch FOMC statements and dot plots — they move everything.'
    }
    if (has('quantitative easing') || has('qe') || has('quantitative tightening') || has('qt') || has('money printing')) {
      return '<b>QE vs QT — The Liquidity Machine:</b><br>• QE: Fed buys bonds, injects money into system = "money printing" = risk assets moon<br>• QT: Fed lets bonds mature off balance sheet = drains liquidity = headwind for risk<br>• QE started March 2020 → BTC went from $5K to $69K<br>• QT started mid-2022 → BTC dropped from $47K to $15K<br><br>Crypto is essentially a liquidity beta play. When the money printer goes brrr, crypto benefits first and most.'
    }
    if (has('gdp') || has('gross domestic product')) {
      return '<b>GDP — Gross Domestic Product:</b><br>• Total value of goods/services produced in a country<br>• Rising GDP = economy growing = generally risk-on<br>• Falling GDP / negative = recession fears = flight to safety<br>• Crypto correlation: indirect. GDP growth supports risk appetite, but crypto is more driven by liquidity and monetary policy than by GDP itself.'
    }
    if (has('non farm') || has('nfp') || has('payroll') || has('jobs report')) {
      return '<b>Non-Farm Payrolls (NFP):</b><br>• Released first Friday of each month<br>• Counts new jobs added excluding agriculture<br>• Strong jobs = economy hot = Fed keeps rates high = USD strong = BTC weak<br>• Weak jobs = economy cooling = Fed may cut = USD weak = BTC strong<br><br>First 5 minutes after NFP release are pure chaos. Wait for the dust to settle.'
    }
    if (has('recession') || has('economic downturn')) {
      return '<b>Recession in Crypto Context:</b><br>• Recession = two consecutive quarters of negative GDP growth<br>• Historically, BTC drops 70-80% from ATH during macro recessions<br>• BUT recovery is also faster than traditional assets<br>• The "money printer will save us" trade has historically worked<br><br>Key indicator: yield curve inversion (2Y > 10Y Treasury). When it un-inverts, recession historically follows within 6-18 months.'
    }

    // === CRYPTO BASICS ===
    if (has('what is bitcoin') || has('explain bitcoin') || has('about bitcoin') || has('tell me about btc')) {
      return '<b>Bitcoin (BTC) — The Original:</b><br>• Created 2009 by Satoshi Nakamoto (pseudonymous)<br>• First decentralized digital currency — no middleman<br>• Fixed supply: 21M coins (deflationary by design)<br>• Proof-of-work mining secures the network<br>• Block time: ~10 minutes, halving every 4 years<br><br>Current price and analysis: try <i>"analyze btc"</i> for live data.'
    }
    if (has('what is ethereum') || has('explain ethereum') || has('about eth')) {
      return '<b>Ethereum (ETH) — The World Computer:</b><br>• Created 2015 by Vitalik Buterin<br>• Smart contract platform — runs dApps, DeFi, NFTs, tokens<br>• Transitioned to Proof-of-Stake (The Merge, Sept 2022)<br>• EIP-1559 burns base fee — deflationary pressure<br>• Gas fees = cost of computation on Ethereum<br><br>ETH is the collateral layer of DeFi. Everything runs on top of it.'
    }
    if (has('what is blockchain') || has('explain blockchain')) {
      return '<b>Blockchain — Distributed Ledger 101:</b><br>• Chain of blocks, each containing verified transactions<br>• Every node holds a copy = no single point of failure<br>• Immutability: once confirmed, altering a block requires 51% of network hash<br>• Consensus mechanisms: PoW (Bitcoin) or PoS (Ethereum)<br><br>It\'s not magic — it\'s an agreed-upon way to maintain a shared truth without trusting a middleman.'
    }
    if (has('what is an nft') || has('explain nft')) {
      return '<b>NFTs — Non-Fungible Tokens:</b><br>• Unique tokens on a blockchain representing ownership<br>• "Non-fungible" = one-of-one, not interchangeable like ETH<br>• Use cases: digital art, collectibles, game items, membership passes<br>• Most speculation was in JPEGs during 2021-22 mania<br><br>The tech has utility (provenance, royalties, ticketing) even if most profile-picture projects went to zero.'
    }
    if (has('what is defi') || has('explain defi')) {
      return '<b>DeFi — Decentralized Finance:</b><br>• Financial services built on smart contracts, no banks<br>• Lending (Aave/Compound), swaps (Uniswap), derivatives (dYdX)<br>• TVL (Total Value Locked) = health metric of the sector<br>• Yield farming: earn tokens by providing liquidity<br><br>DeFi is how crypto earns its "financial system replacement" narrative. Most of it runs on Ethereum.'
    }
    if (has('what is solana') || has('about sol')) {
      return '<b>Solana (SOL) — High-Performance L1:</b><br>• PoH (Proof of History) + PoS = extremely fast<br>• 65,000 TPS theoretical, ~4,000 actual<br>• Near-zero fees (fractions of a cent)<br>• Has had multiple outages — reliability is its Achilles heel<br><br>Solana is Ethereum\'s main competitor for speed-sensitive applications. The "Ethereum killer" narrative comes and goes.'
    }
    if (has('layer 2') || has('l2') || has('scaling solution')) {
      return '<b>Layer 2 Scaling Solutions:</b><br>• Ethereum L2s: Arbitrum, Optimism, Base, zkSync<br>• Off-chain execution, on-chain settlement = faster + cheaper<br>• Rollups batch transactions and post compressed data to L1<br>• ZK-rollups vs Optimistic rollups: different tradeoffs in proof generation<br><br>L2s are how Ethereum scales without compromising decentralization.'
    }
    if (has('altcoin') || has('alt season') || has('altcoin season')) {
      return '<b>Altcoins / Alt Season:</b><br>• Everything that isn\'t Bitcoin = altcoin<br>• "Alt season" = capital rotates from BTC into alts (usually after BTC stabilizes near ATH)<br>• BTC dominance chart is the alt season indicator<br>• Alt season playbook: BTC moons → BTC consolidates → ETH follows → large caps → mid → small caps → everything bleeds back to BTC<br><br>Alt seasons make people rich and then destroy them. Know where you are in the cycle.'
    }

    // === TRADING CONCEPTS ===
    if (has('what is leverage') || has('explain leverage')) {
      return '<b>Leverage — Amplified Exposure:</b><br>• 10x leverage: $1,000 controls $10,000 worth<br>• Your PnL is multiplied by 10x, but so are losses<br>• Liquidation happens when losses eat your margin<br>• At 10x: a ~10% adverse move wipes you out<br>• At 50x: a ~2% adverse move wipes you out<br><br>Leverage is a tool for capital efficiency, not a money multiplier. Most leveraged traders lose. The house (exchange) always wins.'
    }
    if (has('margin call') || has('margin')) {
      return '<b>Margin Call — The Warning Bell:</b><br>• When your account equity falls below maintenance margin<br>• Exchange demands you deposit more funds or they liquidate<br>• On Binance: margin ratio below 1.1 triggers auto-liquidation<br><br>Prevention: use stop losses, reduce leverage, don\'t over-allocate. A margin call is the exchange telling you "your trade is wrong and I\'m closing it for you."'
    }
    if (has('what is short') || has('short selling') || has('shorting')) {
      return '<b>Short Selling — Profiting From Drops:</b><br>• Borrow an asset, sell it high, buy it back low, return it<br>• In futures: open a short position = same economic exposure<br>• Risk: theoretically unlimited upside = unlimited loss potential<br>• Short squeezes: when shorts are forced to buy back, accelerating the rally<br><br>Famous squeeze: GameStop 2021. In crypto: short squeezes happen when funding is heavily negative and price starts rising.'
    }
    if (has('liquidation cascade') || has('cascade')) {
      return '<b>Liquidation Cascades — The Domino Effect:</b><br>• Price drops → overleveraged longs get liquidated → their forced sells push price lower → more longs liquidated → repeat<br>• Creates violent V-shaped moves (both directions)<br>• Most common when OI is high and funding is positive<br><br>This is why I track liquidation zones on the Analysis tab. Dense liquidation clusters act as magnets for price.'
    }
    if (has('take profit') || has('when to take profit') || has('tp')) {
      return '<b>Take Profit Strategy:</b><br>• Scale out in portions, not all at once<br>• First target: 1:1 risk-reward (take 50%)<br>• Second target: move stop to breakeven, let rest run<br>• Trail with ATR: stop moves 1.5x ATR behind price<br>• Key: have a plan BEFORE entry, not after<br><br>The hardest part isn\'t getting in — it\'s selling at the right time. Most traders give back gains by holding too long.'
    }

    // === ON-CHAIN & NETWORK ===
    if (has('what is tvl') || has('explain tvl')) {
      return '<b>TVL — Total Value Locked:</b><br>• Sum of assets deposited in DeFi protocols<br>• Higher TVL = more capital trusting the protocols<br>• Aave, Lido, MakerDAO typically lead<br>• TVL/Market Cap ratio indicates DeFi utilization<br><br>TVL rising + token price rising = healthy growth. TVL rising + price flat = value hasn\'t been priced in yet.'
    }
    if (has('what are gas fees') || has('gas fees explained')) {
      return '<b>Gas Fees — Transaction Cost:</b><br>• Fee paid to process transactions on blockchain<br>• Ethereum: measured in gwei (1 gwei = 0.000000001 ETH)<br>• High demand = high gas = expensive transactions<br>• L2s (Arbitrum, Base) reduce gas by 10-100x<br><br>Gas is the "toll booth" of blockchain. During NFT mints or market crashes, gas can spike 100x.'
    }
    if (has('proof of work') || has('pow') || has('proof of stake') || has('pos') || has('mining') || has('staking explained')) {
      return '<b>PoW vs PoS — Consensus Mechanisms:</b><br>• PoW: miners compete to solve puzzles, winner adds block (Bitcoin, pre-merge ETH)<br>• PoS: validators stake coins, random selection adds block (Ethereum, Solana)<br>• PoW: energy-intensive but battle-tested, very secure<br>• PoS: energy-efficient, faster, but newer and more centralized<br><br>BTC will always be PoW. ETH switched to PoS. The debate is philosophical, not technical.'
    }

    // === NEWS & EVENTS ===
    if (has('news') || has('breaking') || has('what is happening') || has('what is going on')) {
      try {
        const newsData = (await jget('https://cryptocurrency.cv/api/news')) as { data?: Array<{ title?: string; source?: string; date?: string }> } | null
        if (newsData && newsData.data && newsData.data.length) {
          let s = '<b>Latest Crypto News:</b><br><br>'
          newsData.data.slice(0, 6).forEach(function (n, i) {
            s += (i + 1) + '. <b>' + esc(n.title || '') + '</b><br><span style="color:var(--dim);font-size:11px">' + esc(n.source || '') + ' · ' + esc(n.date || '') + '</span><br><br>'
          })
          s += 'Source: cryptocurrency.cv — updates in real time.'
          return s
        }
      } catch (e) { /* ignore */ }
      return 'News feed temporarily unavailable. Try the <b>News tab</b> for live updates.'
    }
    if (has('forex') || has('forex event') || has('macro event') || has('economic calendar') || has('this week event')) {
      let calData: Array<{ impact?: string; title?: string; country?: string; date?: string; time?: string }> | null = null
      try {
        calData = (await jget2('https://nfs.faireconomy.media/ff_calendar_thisweek.json', { to: 10000, retries: 1, dedup: true })) as Array<{ impact?: string; title?: string; country?: string; date?: string; time?: string }> | null
        if (!calData || !calData.length) throw new Error('empty')
      } catch (e1) {
        try { calData = (await fetchFromXoomar()) as unknown as Array<{ impact?: string; title?: string; country?: string; date?: string; time?: string }> } catch (e2) { /* ignore */ }
      }
      if (calData && calData.length) {
        let s = '<b>This Week\'s Macro Events:</b><br><br>'
        const important = calData.filter(function (e) { return e.impact === 'High' })
        if (important.length) {
          important.slice(0, 6).forEach(function (e, i) {
            s += '<span style="color:' + (e.impact === 'High' ? 'var(--amber)' : 'var(--dim)') + '">[IMPACT: ' + e.impact + ']</span> <b>' + esc(e.title || '') + '</b><br>' + esc(e.country || '') + ' · ' + esc(e.date || '') + ' ' + esc(e.time || '') + '<br><br>'
          })
        } else {
          calData.slice(0, 6).forEach(function (e, i) {
            s += esc(e.title || '') + ' — ' + esc(e.country || '') + ' · ' + esc(e.date || '') + '<br>'
          })
        }
        s += 'Source: economic calendar — High impact events move crypto via USD correlation.'
        return s
      }
      return 'Forex calendar temporarily unavailable.'
    }
    if (has('crypto today') || has('market today') || has('what is happening in crypto')) {
      try {
        const newsData2 = (await jget('https://cryptocurrency.cv/api/news')) as { data?: Array<{ title?: string }> } | null
        const fg = state.fg as FgLike | null
        const fgText = fg ? 'Fear &amp; Greed: ' + fg.value + ' (' + fg.classification + ')' : 'sentiment unavailable'
        let s = '<b>Crypto Market Overview — Today:</b><br><br>'
        s += 'Sentiment: <b>' + fgText + '</b><br><br>'
        const top5 = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT']
        top5.forEach(function (sym2) {
          const t = state.tickers[sym2]
          if (t) s += '&bull; <b>' + baseOf(sym2) + '</b>: ' + chip('$' + pfmt(t.last)) + ' ' + chip((t.pct > 0 ? '+' : '') + t.pct.toFixed(2) + '%', t.pct >= 0 ? 'hl-g' : 'hl-r') + '<br>'
        })
        if (newsData2 && newsData2.data && newsData2.data.length) {
          s += '<br><b>Headlines:</b><br>'
          newsData2.data.slice(0, 3).forEach(function (n) {
            s += '&bull; ' + esc(n.title || '') + '<br>'
          })
        }
        return s
      } catch (e) { /* ignore */ }
      return 'Market overview temporarily unavailable. Check the Radar tab for live prices.'
    }
    if (has('opinion') || has('your opinion') || has('what do you think')) {
      if (coin) {
        const t2 = state.tickers[COINS[coin].sym]
        if (t2) {
          let dir = t2.pct > 2 ? 'bullish momentum' : 'cautiously positive'
          if (t2.pct < -2) dir = 'bearish pressure'
          if (t2.pct > -0.5 && t2.pct < 0.5) dir = 'consolidation zone — no clear bias'
          return '<b>' + coin + ' opinion:</b> Currently in ' + dir + ' (' + (t2.pct > 0 ? '+' : '') + t2.pct.toFixed(2) + '% today). For a real view, say <i>"analyze ' + coin.toLowerCase() + '"</i> and check the multi-TF signals, whale flow, and verdict. Don\'t trade on opinions — trade on confluence.'
        }
      }
      return 'Give me a coin name and I\'ll share a data-driven view. "Opinion" without data is just a guess.'
    }

    // === MARKET PHILOSOPHY ===
    if (has('how to trade') || has('trading strategy') || has('how to make money')) {
      return '<b>Framework for Trading:</b><br>1. <b>Plan:</b> Define entry, stop, target BEFORE the trade<br>2. <b>Edge:</b> What is your statistical advantage? (momentum, mean reversion, breakout)<br>3. <b>Size:</b> Risk 1-2% max per trade<br>4. <b>Execute:</b> Follow the plan, no emotional overrides<br>5. <b>Review:</b> Journal every trade — patterns emerge<br><br>The market doesn\'t care about your entry. It will humble anyone who trades on feelings instead of process.'
    }
    if (has('what is an edge') || has('trading edge')) {
      return '<b>Trading Edge — The Whole Game:</b><br>• An edge = a repeatable statistical advantage<br>• Without an edge, you\'re gambling with extra steps<br>• Edges decay over time as others discover them<br>• Building an edge: backtest → paper trade → small live → scale<br><br>My signal scanner is one such edge: multi-TF confluence + whale flow + auto-learning. Use it as input, not as gospel.'
    }

    // === FLOW & MACRO QUERY (when user asks about the market broadly) ===
    if (has('scan the market') || has('scan market') || has('market scan')) {
      if (signalData.length) {
        let s = '<b>Market Scan — Top Signals:</b><br><br>'
        signalData.slice(0, 5).forEach(function (sig) {
          const type = sig.master.type
          const cls = type === 'BUY' ? 'hl-g' : type === 'SELL' ? 'hl-r' : 'hl-a'
          s += '&bull; <b>' + baseOf(sig.sym) + '</b>: <span class="' + cls + '">' + type + '</span> (' + (sig.score > 0 ? '+' : '') + sig.score + ')<br>'
          if (sig.whaleText) s += '&nbsp;&nbsp;' + esc(sig.whaleText) + '<br>'
        })
        s += '<br>Full scanner on the <b>Signals tab</b>.'
        return s
      }
      return 'Scanner warming up — ask again in 30 seconds.'
    }
    if (has('best signal') || has('strongest signal') || has('top signal')) {
      if (signalData.length) {
        const top = signalData[0]
        const type2 = top.master.type
        const cls2 = type2 === 'BUY' ? 'hl-g' : type2 === 'SELL' ? 'hl-r' : 'hl-a'
        return '<b>Strongest Signal Right Now:</b><br><br>&bull; <b>' + baseOf(top.sym) + '</b>: <span class="' + cls2 + '">' + type2 + '</span> (' + (top.score > 0 ? '+' : '') + top.score + ')<br>' + top.master.breakdown.map(function (b: TfBreak) { return b.tf + ': ' + b.type }).join(' | ') + '<br>' + (top.whaleText ? esc(top.whaleText) + '<br>' : '') + '<br>Check the <b>Signals tab</b> for full multi-TF breakdown.'
      }
      return 'Scanner still warming up.'
    }
    if (has('whales doing') || has('whale activity') || has('smart money doing')) {
      if (signalData.length) {
        const whaleSignals = signalData.filter(function (s) { return s.whaleText && s.whaleText.indexOf('balanced') === -1 })
        if (whaleSignals.length) {
          let s = '<b>Whale Activity Across Scanner Coins:</b><br><br>'
          whaleSignals.slice(0, 5).forEach(function (s2) {
            s += '&bull; <b>' + baseOf(s2.sym) + '</b>: ' + esc(s2.whaleText) + '<br>'
          })
          return s
        }
        return 'Whale flow is balanced across scanner coins right now — no strong accumulation or distribution signals.'
      }
      return 'Whale data loading. Ask again shortly.'
    }

    if (coin) {
      const t = state.tickers[COINS[coin].sym]
      if (t) return '🌙 ' + COINS[coin].icon + ' <b>' + coin + '</b> is ' + (t.pct > 5 ? '<span class="hl-g">pumping +' + t.pct.toFixed(1) + '%</span> right now' : t.pct > 0 ? 'up ' + t.pct.toFixed(2) + '% — drifting, not mooning' : t.pct > -5 ? 'flat-ish (' + t.pct.toFixed(2) + '%) — rocket still on the pad' : '<span class="hl-r">dumping ' + t.pct.toFixed(1) + '% today</span> — more lunar debris than launch') + '. Chasing green candles after +10% is how bags get made (the wrong kind). Ask <i>"analyze ' + coin.toLowerCase() + '"</i> first.'
    }
    return '🌙 "To the moon" energy is fun; portfolio math is survival. Name a coin and I\'ll tell you whether it\'s actually moving or just trending on X.'
    if (has('dump') || has('crash') || has('rekt') || has('rug')) {
      const t = state.tickers[state.symbol]
      return '💀 Dump/rekt checklist:<br>• Is 24h change worse than −8%? ' + (t && t.pct < -8 ? '<span class="hl-r">Yes — active flush on ' + baseOf(state.symbol) + '</span>' : 'Not currently on the active chart') + '<br>• Volume spike + close back inside range = capitulation wick, sometimes a gift<br>• No-bid slow bleed = worse than violent dumps<br><br>Anti-rekt protocol: hard stops pre-placed, no averaging into falling knives without a thesis, never leverage a meme. <span class="hl-a">Survive first, profit second.</span>'
    }
    if (has('hodl') || has('diamond hands')) {
      return '💎🙌 <b>HODL doctrine:</b> fine for spot BTC/ETH with a multi-year horizon and money you don\'t need. Fatal when applied to leveraged positions or low-liquidity memes — those need exits because they can go structurally to zero. HODL is a strategy for assets, not an excuse for absent risk management.'
    }
    if (has('ath') || has('all time high')) {
      const cc = coin as string
      const t = state.tickers[cc ? COINS[cc].sym : state.symbol] as TickerLike
      return '[ATH] <b>All-time high</b> = the highest price ever printed. Psychologically massive — old bagholders sell into it, breakout traders buy through it.' + (t ? '<br><br>' + (cc || baseOf(state.symbol)) + ' 24h high: ' + chip('$' + pfmt(t.high)) + ' — current ' + chip('$' + pfmt(t.last)) + ' sits ' + (((t.last / t.high) - 1) * 100).toFixed(2) + '% from it. (Full ATH history needs longer lookbacks than this terminal\'s feeds.)' : '')
    }
    if (has('atl') || has('all time low')) {
      return '[ATL] All-time lows mark maximum pessimism. Some become generational entries; others become delistings. The tell: does volume dry up at the lows (seller exhaustion) or keep accelerating (no floor yet)?'
    }
    if (has('bull run') || has('bull market') || has('bullish cycle')) {
      const v = state.fg ? parseInt((state.fg as FgLike).value, 10) : null
      return '[BULL] <b>Bull run dashboard:</b><br>• Sentiment: ' + (v != null ? 'Fear &amp; Greed at <span style="color:' + fngColor(v) + '">' + v + ' (' + (state.fg as FgLike).classification + ')</span>' : 'unavailable') + '<br>• Breadth: check advancers vs decliners on the Market tab<br>• Structure test: are 15m pullbacks holding above prior highs?<br><br>Textbook bulls: price above rising EMA20/50, funding positive-but-not-extreme, alt breadth expanding. Extreme greed + vertical candles = late-stage, not early-stage.'
    }
    if (has('bear market') || has('bearish cycle') || (has('bear') && !coin)) {
      return '[BEAR] Bear-market tells: lower highs stacking on higher timeframes, rallies sold within days, funding pinned negative while OI decays, blue chips bleeding slower than alts. Survival kit: smaller size, fewer trades, stablecoin yield starts outcompeting delta. Every bear in history has been someone\'s buying opportunity eventually.'
    }
    if (has('dip') || has('buy the dip')) {
      const a = state._ai as AIScore | undefined
      const base = coin || baseOf(state.symbol)
      let extra = ''
      if (a && !coin) {
        const ri = (a as AIScore).rsi
        extra = '<br><br>Active chart (' + base + '): RSI ' + ri.toFixed(0) + ' — ' + (ri < 35 ? '<span class="hl-g">technically dipped into value zone</span>' : ri > 65 ? 'this isn\'t a dip, it\'s a summit' : 'mid-range, not a dip by oscillator standards') + '.'
      }
      return '🩸 <b>"Buy the dip"</b> only works with definitions:<br>1. Dip to <i>what</i>? Prior resistance-turned-support or a measured level — not just "red"<br>2. Confirmation: selling volume exhausting while price holds the level<br>3. Invalidation pre-defined — if the level breaks, the dip was actually a trend change' + extra + '<br><br>Catching knives without levels is called donating.'
    }

    if (coin) {
      const cc = coin as string
      try {
        const d = await safeCtx(cc)
        return coinBrief(cc, d)
      } catch (e) {
        const t = state.tickers[COINS[cc].sym] as TickerLike
        if (t) return COINS[cc].icon + ' <b>' + cc + '</b>: ' + chip('$' + pfmt(t.last)) + ' · 24h ' + chip((t.pct > 0 ? '+' : '') + t.pct.toFixed(2) + '%', t.pct >= 0 ? 'hl-g' : 'hl-r') + ' (deeper analytics temporarily unavailable)'
        return 'I recognize <b>' + cc + '</b> but couldn\'t reach the API just now.'
      }
    }

    if (has('price') || has('chart') || has('analysis') || has('market') || has('crypto')) {
      const t = state.tickers[state.symbol]
      return 'You\'re looking for specifics — give me a ticker! Try <i>"bitcoin"</i>, <i>"solana"</i>, <i>"trump coin"</i>, <i>"wif"</i>… or ask for <i>"best performer today"</i>.' + (t ? ' Meanwhile: ' + baseOf(state.symbol) + ' is ' + chip('$' + pfmt(t.last)) + ' ' + chip((t.pct > 0 ? '+' : '') + t.pct.toFixed(2) + '%', t.pct >= 0 ? 'hl-g' : 'hl-r') + '.' : '')
    }
  }

  return 'I didn\'t catch that. I\'m sharpest on:<br>• <b>Coins</b> — btc, eth, sol, doge, pepe, trump, wif + 20 more (nicknames &amp; typos welcome)<br>• <b>Indicators</b> — rsi, macd, bollinger, ema, atr<br>• <b>Microstructure</b> — whales, funding, open interest, liquidations, support/resistance<br>• <b>Patterns</b> — rsi divergence, macd crossover, bb squeeze, volume spike<br>• <b>Signals</b> — "show signals", "best signal", "scan the market"<br>• <b>Economics</b> — inflation, fed rates, gdp, nfp, quantitative easing<br>• <b>Crypto basics</b> — bitcoin, ethereum, blockchain, defi, layer 2, nfts<br>• <b>Trading</b> — position sizing, stop loss, take profit, leverage, margin<br>• <b>News</b> — "show news", "forex events", "what is happening today"<br>• <b>Conversation</b> — greetings, jokes, opinions on any coin<br><br>Rephrase and fire again.'
}

const chatLog = $('chatLog')!
const chatForm = $('chatForm')!
const chatInput = $('chatInput') as HTMLInputElement
const sendBtn = $('sendBtn') as HTMLButtonElement
export function pushMsg(html: string, who: string): HTMLElement {
  const div = document.createElement('div')
  div.className = 'msg ' + who
  if (who === 'user') div.textContent = html
  else div.innerHTML = html
  chatLog.appendChild(div)
  chatLog.scrollTop = chatLog.scrollHeight
  return div
}
let chatBusy = false
async function sendChat(text: string): Promise<void> {
  if (!text.trim() || chatBusy) return
  chatBusy = true
  sendBtn.disabled = true
  pushMsg(text, 'user')
  chatInput.value = ''
  const typing = pushMsg('<span class="typing"><i></i><i></i><i></i></span>', 'ai')
  try {
    await new Promise((r) => setTimeout(r, 420))
    const reply = await generateReply(text)
    typing.innerHTML = reply
    state.mem.topics.push(text)
    if (state.mem.topics.length > 6) state.mem.topics.shift()
  } catch (e) {
    typing.innerHTML = 'Connection hiccup — try again in a moment.'
  }
  chatLog.scrollTop = chatLog.scrollHeight
  chatBusy = false
  sendBtn.disabled = false
}
chatForm.addEventListener('submit', (e) => { e.preventDefault(); sendChat(chatInput.value) })
document.querySelectorAll('#chatChips .chip').forEach((c) => c.addEventListener('click', () => sendChat((c as HTMLElement).dataset.q as string)))