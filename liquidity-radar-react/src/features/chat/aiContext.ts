// What Radar AI is allowed to know.
//
// Everything the assistant says about live markets has to come from here. The
// model is explicitly told this block is its only source of fact, which is the
// difference between an assistant that reads your terminal and one that makes
// up a plausible price — and a made-up price in a trading tool is worse than
// no answer at all.
//
// It is written as compact plain text rather than JSON on purpose. The same
// facts cost noticeably fewer tokens this way, and models follow a short
// labelled block more reliably than a deep object.
import { state } from '../../services/store'
import { COINS } from '../../constants/market'
import { INSTRUMENTS, instrumentOf, isInstrument } from '../../constants/instruments'
import { baseOf, coinMeta } from '../../utils/coins'
import { pfmt, cfmt } from '../../utils/format'
import { signalData } from '../signals/signals'
import { latestNews } from '../news/newsFeed'
import { aiComposite, calcATR, forecastFrom } from '../../utils/indicators'
import { getMLState } from '../ml/store'

type Any = any

const n2 = (v: unknown): string => {
  const x = Number(v)
  return isFinite(x) ? pfmt(x) : '—'
}
const pct = (v: unknown): string => {
  const x = Number(v)
  return isFinite(x) ? (x > 0 ? '+' : '') + x.toFixed(2) + '%' : '—'
}

/** The market on screen, with whatever the terminal has computed for it. */
function activeMarket(): string {
  const sym = String(state.symbol || '')
  const meta = coinMeta(sym)
  const inst = instrumentOf(sym)
  const t = state.tickers[sym] as Any
  const lines: string[] = []
  lines.push(
    `ACTIVE MARKET: ${meta.name} (${sym}) — ${inst ? inst.cls + ', priced by Yahoo' : 'crypto, Binance spot'}`,
  )
  if (t) {
    lines.push(
      `price ${n2(t.last)} | 24h ${pct(t.pct)}` +
        (t.high != null ? ` | range ${n2(t.low)}–${n2(t.high)}` : '') +
        (t.qvol ? ` | volume ${cfmt(t.qvol)}` : ' | volume not reported by this venue'),
    )
  } else {
    lines.push('price: not loaded yet')
  }
  lines.push(`chart timeframe: ${state.tf || '15m'}`)

  const candles = state.candles || []
  if (candles.length >= 30) {
    const closes = candles.map((c) => c.c)
    const a = aiComposite(candles as Any, closes, candles.map((c) => c.v) as Any) as Any
    const atr = calcATR(candles as Any, 14)
    lines.push(
      `indicators (${state.tf || '15m'}): RSI(14) ${a.rsi.toFixed(1)} | MACD hist ${a.macd.hist > 0 ? 'positive' : 'negative'} (${a.macd.hist.toFixed(4)}) | EMA20 ${n2(a.e20)} price ${a.last > a.e20 ? 'above' : 'below'} it | Bollinger %B ${a.bb.pctB.toFixed(0)}% | volume ${String(a.vt).toLowerCase()} | ATR(14) ${n2(atr)}`,
    )
    lines.push(`composite score ${a.score > 0 ? '+' : ''}${a.score} (${a.label})`)
    const fc = forecastFrom(closes) as Any
    if (fc && fc.rows) {
      lines.push(
        `linear-regression bias ${fc.bias}: 1h ~${n2(fc.rows[0].pred)}, 24h ~${n2(fc.rows[3].pred)} (projection from recent closes, not a forecast the terminal stands behind)`,
      )
    }
  }

  // Derivatives only exist for perpetuals; say so rather than omitting silently.
  const fr = state.fr as Any
  const oi = state.oi as Any
  if (fr && fr.lastFundingRate != null) {
    const rate = Number(fr.lastFundingRate)
    lines.push(
      `funding ${(rate * 100).toFixed(4)}% (${rate > 0 ? 'longs pay shorts — crowd leans long' : rate < 0 ? 'shorts pay longs — crowd leans short' : 'flat'})` +
        (oi && oi.openInterest != null ? ` | open interest ${cfmt(Number(oi.openInterest))}` : ''),
    )
  } else if (isInstrument(sym)) {
    lines.push('no funding, open interest, order book or trade tape exists for this market')
  }
  return lines.join('\n')
}

/** The scanner's read across every market it sweeps. */
function scanner(): string {
  if (!signalData.length) return 'SCANNER: warming up, no sweep completed yet.'
  const rows = signalData.slice(0, 12).map((s: Any) => {
    const label = instrumentOf(s.sym) ? s.sym : baseOf(s.sym)
    const bits = [
      `${label} ${s.master.type} ${s.score > 0 ? '+' : ''}${s.score}`,
      s.conv ? `${s.conv.tier.toLowerCase()} ${s.conv.agree}/${s.conv.of}TF` : '',
      s.t ? n2(s.t.last) : '',
      s.plan ? `plan entry ${n2(s.plan.entry)} stop ${n2(s.plan.stop)} T1 ${n2(s.plan.t1)} T2 ${n2(s.plan.t2)} RR ${s.plan.rr.toFixed(1)}` : '',
      s.neural ? `neural P(up) ${Math.round(s.neural.pUp * 100)}% @ ${(s.neural.accuracy * 100).toFixed(1)}% holdout` : '',
      s.whaleText || '',
      s.reasons && s.reasons.length ? s.reasons.slice(0, 2).join('; ') : '',
    ].filter(Boolean)
    return '- ' + bits.join(' | ')
  })
  return (
    `SCANNER (${signalData.length} markets, 1h/4h/1d, refreshed every 2 min):\n` + rows.join('\n')
  )
}

/** The direction model's read on the charted market, when one is trained. */
function mlRead(): string {
  const m = getMLState()
  if (m.status === 'ready' && m.trained && m.prediction) {
    return `DIRECTION MODEL (${m.symbol} ${m.tf}): ${m.prediction.direction} at ${(m.prediction.confidence * 100).toFixed(0)}% confidence, holdout accuracy ${(m.trained.backtestAccuracy * 100).toFixed(1)}% over ${m.trained.backtestN} bars.`
  }
  if (m.status === 'training') return 'DIRECTION MODEL: currently training.'
  if (m.status === 'insufficient-data') return 'DIRECTION MODEL: not enough history for this market.'
  return 'DIRECTION MODEL: not trained for this market yet (it trains when the ML panel or Neural net page is open).'
}

/** Cross-venue prices, which only exist for crypto. */
function venues(): string {
  const rows = (state.crossEx as Any[]) || []
  const live = rows.filter((r) => r && r.last != null)
  if (!live.length) return ''
  const sorted = live.slice().sort((a, b) => b.last - a.last)
  const hi = sorted[0]
  const lo = sorted[sorted.length - 1]
  const gapBps = lo.last ? ((hi.last - lo.last) / lo.last) * 1e4 : 0
  return `VENUES: ${live.length} live. High ${hi.name} ${n2(hi.last)}, low ${lo.name} ${n2(lo.last)}, spread ${gapBps.toFixed(1)} bps.`
}

/** The terminal's own wire — this is the "news from our radar" the user reads. */
function news(limit = 8): string {
  const items = latestNews() || []
  if (!items.length) return ''
  const out = items.slice(0, limit).map((x) => {
    const mins = Math.max(0, Math.round((Date.now() - x.time) / 60000))
    const age = mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`
    const coins = x.coins && x.coins.length ? ` [${x.coins.slice(0, 4).join(',')}]` : ''
    return `- ${x.title} (${x.src}, ${age}, sentiment ${x.sent})${coins}`
  })
  return 'RADAR NEWS WIRE (most recent first):\n' + out.join('\n')
}

/** What can be charted at all, so the model never claims a market is missing. */
function universe(): string {
  const cls: Record<string, string[]> = {}
  for (const i of Object.values(INSTRUMENTS)) {
    if (!cls[i.cls]) cls[i.cls] = []
    if (cls[i.cls].length < 10) cls[i.cls].push(i.sym)
  }
  const parts = Object.entries(cls).map(([k, v]) => `${k}: ${v.join(', ')}`)
  return (
    'COVERAGE: every Binance USDT pair (~400, including ' +
    Object.keys(COINS).slice(0, 12).join(', ') +
    '), plus ' +
    parts.join(' | ') +
    '. Any other listed stock or ETF can be found through search. The user can open any of these by asking, or by typing it into the search bar.'
  )
}

/**
 * Everything the assistant is allowed to treat as live fact, as one block.
 *
 * Deliberately rebuilt per message rather than cached: the whole point is that
 * it reflects the terminal *now*, and a price that is two minutes stale is the
 * kind of wrong that looks right.
 */
export function buildMarketContext(): string {
  const blocks = [
    `Local time ${new Date().toLocaleString()}.`,
    activeMarket(),
    mlRead(),
    scanner(),
    venues(),
    news(),
    universe(),
  ].filter(Boolean)
  return blocks.join('\n\n')
}
