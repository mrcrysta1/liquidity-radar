// Fetches a handful of candle sets for the active symbol across several
// timeframes and scores each with the same RSI/MACD/EMA-trend read already
// used elsewhere (utils/indicators), so a trader can see whether timeframes
// agree without switching between them one at a time.
import { jget } from '../../api/client'
import { calcRSI, calcMACD, emaArr } from '../../utils/indicators'
import { state } from '../../services/store'
import { BASE_MS, tfDef } from '../../services/timeframe'
import { getTimeframe, subscribeTimeframe } from '../charts/timeframes'
import { poll } from '../../services/pollScheduler'

export type Verdict = 'bull' | 'bear' | 'neutral'

export interface ConfluenceRow {
  tf: string
  verdict: Verdict
  rsi: number
  macdHist: number
  trendPct: number
  loading: boolean
}

// Native Binance REST intervals only — the app's custom resampled
// timeframes (5s, 45m, 3h…) don't exist server-side, so the confluence set
// is picked from this list regardless of what the chart itself is showing.
const NATIVE_TFS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d']
const KLINE_URL = 'https://api.binance.com/api/v3/klines'

/**
 * Classic MTF confirmation looks at the active chart timeframe plus the
 * next few *higher* ones — not a fixed 5m/15m/1h/4h regardless of what's on
 * screen. Maps the chart's (possibly custom/resampled) timeframe to its
 * actual duration, then takes the current-or-next-native interval and three
 * above it.
 */
function timeframesFor(chartTf: string): string[] {
  const def = tfDef(chartTf)
  const chartMs = (BASE_MS[def.base] || 60000) * def.factor
  const candidates = NATIVE_TFS.filter((tf) => (BASE_MS[tf] || 0) >= chartMs)
  const picked = candidates.slice(0, 4)
  while (picked.length < 4) {
    const next = NATIVE_TFS[NATIVE_TFS.indexOf(picked[picked.length - 1] || '1d') + 1]
    if (!next || picked.includes(next)) break
    picked.push(next)
  }
  return picked.length ? picked : ['5m', '15m', '1h', '4h']
}

let TFS = timeframesFor(state.tf)

let rows: ConfluenceRow[] = TFS.map((tf) => ({
  tf,
  verdict: 'neutral',
  rsi: 50,
  macdHist: 0,
  trendPct: 0,
  loading: true,
}))
let symbol = state.symbol

type Listener = () => void
const listeners: Listener[] = []
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}
export function onConfluenceChange(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

export function getConfluenceRows(): ConfluenceRow[] {
  return rows
}

function score(closes: number[]): { verdict: Verdict; rsi: number; macdHist: number; trendPct: number } {
  const rsi = calcRSI(closes)
  const macd = calcMACD(closes)
  const e20 = emaArr(closes, 20)
  const last = closes[closes.length - 1]
  const trendPct = ((last / e20[e20.length - 1] - 1) * 100) || 0
  // Simple, explainable majority vote rather than a black-box composite:
  // each signal casts one vote, so the reason a TF reads bullish/bearish is
  // visible at a glance (RSI side, MACD histogram side, price vs EMA20).
  let bullVotes = 0
  let bearVotes = 0
  if (rsi > 55) bullVotes++
  else if (rsi < 45) bearVotes++
  if (macd.hist > 0) bullVotes++
  else if (macd.hist < 0) bearVotes++
  if (trendPct > 0.05) bullVotes++
  else if (trendPct < -0.05) bearVotes++
  const verdict: Verdict = bullVotes > bearVotes ? 'bull' : bearVotes > bullVotes ? 'bear' : 'neutral'
  return { verdict, rsi, macdHist: macd.hist, trendPct }
}

async function loadOne(sym: string, tf: string): Promise<void> {
  try {
    const data = (await jget(
      `${KLINE_URL}?symbol=${sym}&interval=${tf}&limit=120`,
    )) as unknown[][]
    if (sym !== symbol) return // symbol changed mid-flight; drop the stale response
    const closes = data.map((k) => Number(k[4]))
    if (closes.length < 30) return
    const s = score(closes)
    const row = rows.find((r) => r.tf === tf)
    if (row) {
      row.verdict = s.verdict
      row.rsi = s.rsi
      row.macdHist = s.macdHist
      row.trendPct = s.trendPct
      row.loading = false
    }
    emit()
  } catch (e) {
    console.warn('confluence', tf, e)
  }
}

let started = false
const REFRESH_MS = 30_000

export function startConfluence(): void {
  if (started) return
  started = true
  refreshAll()
  poll(refreshAll, REFRESH_MS)
  let lastTf = getTimeframe()
  subscribeTimeframe(() => {
    const tf = getTimeframe()
    if (tf === lastTf) return
    lastTf = tf
    resetForTf(tf)
  })
}

export function resetConfluence(sym: string): void {
  symbol = sym
  rows = TFS.map((tf) => ({ tf, verdict: 'neutral', rsi: 50, macdHist: 0, trendPct: 0, loading: true }))
  emit()
  refreshAll()
}

function resetForTf(chartTf: string): void {
  TFS = timeframesFor(chartTf)
  rows = TFS.map((tf) => ({ tf, verdict: 'neutral', rsi: 50, macdHist: 0, trendPct: 0, loading: true }))
  emit()
  refreshAll()
}

function refreshAll(): void {
  const sym = symbol
  TFS.forEach((tf) => loadOne(sym, tf))
}

/** Overall read: majority verdict across the rows that have loaded. */
export function confluenceSummary(): Verdict {
  const loaded = rows.filter((r) => !r.loading)
  if (!loaded.length) return 'neutral'
  const bulls = loaded.filter((r) => r.verdict === 'bull').length
  const bears = loaded.filter((r) => r.verdict === 'bear').length
  return bulls > bears ? 'bull' : bears > bulls ? 'bear' : 'neutral'
}
