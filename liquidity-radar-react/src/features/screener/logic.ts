// Screener maths: per-coin technical snapshot, the TradingView-style
// "Technical rating", filters, presets and sorting. Pure — no DOM, network or
// clock — so scripts/test-engines.mjs runs it directly under Node.
//
// The indicator values come from the chart's own indicator maths
// (features/charts/indicators/math.ts), so a screener RSI matches the RSI pane
// on the chart for the same daily candles.
import type { CandleFlat } from '../../services/market'
import {
  atr,
  awesome,
  cci,
  dmi,
  ema,
  macd,
  momentum,
  rsi,
  sma,
  stochastic,
  williamsR,
} from '../charts/indicators/math.ts'
import type { Series } from '../charts/indicators/math.ts'

// ---- Technical snapshot -----------------------------------------------------

export type MacdState = 'bull' | 'bear'
export type Rating = 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell'

export interface Votes {
  buy: number
  sell: number
  neutral: number
}

export interface TechSnapshot {
  rsi: number | null
  macd: number | null
  macdSignal: number | null
  /** MACD line above (bull) or below (bear) its signal line. */
  macdState: MacdState | null
  ema20: number | null
  ema50: number | null
  ema200: number | null
  /** ATR(14) as a percentage of the last close. */
  atrPct: number | null
  /** Close-to-close change over 7 / 30 daily bars, in %. */
  perf1W: number | null
  perf1M: number | null
  maVotes: Votes
  oscVotes: Votes
  /** -1 (every vote sell) … +1 (every vote buy); null when nothing could vote. */
  score: number | null
  rating: Rating | null
}

const last = (s: Series, back = 0): number | null => {
  const v = s[s.length - 1 - back]
  return v == null || !Number.isFinite(v) ? null : v
}

/** A vote: +1 buy, -1 sell, 0 neutral, null = not enough data to vote. */
type Vote = 1 | -1 | 0 | null

function tally(votes: Vote[]): Votes {
  const t: Votes = { buy: 0, sell: 0, neutral: 0 }
  for (const v of votes) {
    if (v === 1) t.buy++
    else if (v === -1) t.sell++
    else if (v === 0) t.neutral++
  }
  return t
}

/** (buy − sell) / votes cast, in [-1, 1]; null when no vote was cast. */
export function groupScore(v: Votes): number | null {
  const n = v.buy + v.sell + v.neutral
  return n ? (v.buy - v.sell) / n : null
}

/**
 * The summary rating, modelled on TradingView's "Technical rating":
 *
 *  MOVING AVERAGES group — SMA and EMA at 10, 20, 30, 50, 100 and 200 bars.
 *    Each votes BUY when the close is above it, SELL when below.
 *  OSCILLATORS group — each votes BUY / SELL / NEUTRAL:
 *    RSI(14)          BUY < 30 and rising,  SELL > 70 and falling
 *    Stochastic %K    BUY < 20 and %K > %D, SELL > 80 and %K < %D
 *    CCI(20)          BUY < -100 and rising, SELL > 100 and falling
 *    ADX(14) / DI     BUY ADX > 20 and +DI > -DI, SELL ADX > 20 and -DI > +DI
 *    Awesome osc.     BUY > 0 and rising,   SELL < 0 and falling
 *    Momentum(10)     BUY rising,           SELL falling
 *    MACD(12,26,9)    BUY line > signal,    SELL line < signal
 *    Williams %R(14)  BUY < -80 and rising, SELL > -20 and falling
 *
 *  Each group scores (buy − sell) / votes, in [-1, 1]. The summary is the mean
 *  of the groups that could vote, mapped by ratingOf():
 *    > 0.5 Strong buy · > 0.1 Buy · ≥ -0.1 Neutral · ≥ -0.5 Sell · else Strong sell
 *  (TradingView's published thresholds.) An indicator without enough history
 *  for its period (a newly listed coin has no 200-day MA) simply does not vote.
 */
export function ratingOf(score: number | null): Rating | null {
  if (score == null || !Number.isFinite(score)) return null
  if (score > 0.5) return 'strong_buy'
  if (score > 0.1) return 'buy'
  if (score >= -0.1) return 'neutral'
  if (score >= -0.5) return 'sell'
  return 'strong_sell'
}

export const RATING_LABEL: Record<Rating, string> = {
  strong_buy: 'Strong buy',
  buy: 'Buy',
  neutral: 'Neutral',
  sell: 'Sell',
  strong_sell: 'Strong sell',
}

/** Rating order for sorting and "at least" comparisons (higher = more bullish). */
export const RATING_RANK: Record<Rating, number> = {
  strong_sell: -2,
  sell: -1,
  neutral: 0,
  buy: 1,
  strong_buy: 2,
}

const MA_LENGTHS = [10, 20, 30, 50, 100, 200]

function maVote(close: number, ma: number | null): Vote {
  if (ma == null) return null
  return close > ma ? 1 : close < ma ? -1 : 0
}

/** Oscillator votes in the order documented on ratingOf(). Exported for tests. */
export function oscillatorVotes(c: CandleFlat[]): Vote[] {
  const close = c.map((x) => x.c)
  const rising = (s: Series) => {
    const a = last(s)
    const b = last(s, 1)
    return a == null || b == null ? null : a > b ? true : a < b ? false : null
  }
  const votes: Vote[] = []

  const r = rsi(close, 14)
  const rv = last(r)
  const rUp = rising(r)
  votes.push(rv == null ? null : rv < 30 && rUp === true ? 1 : rv > 70 && rUp === false ? -1 : 0)

  const st = stochastic(c, 14, 3)
  const k = last(st.k)
  const d = last(st.d)
  votes.push(k == null || d == null ? null : k < 20 && k > d ? 1 : k > 80 && k < d ? -1 : 0)

  const cc = cci(c, 20)
  const cv = last(cc)
  const cUp = rising(cc)
  votes.push(cv == null ? null : cv < -100 && cUp === true ? 1 : cv > 100 && cUp === false ? -1 : 0)

  const dm = dmi(c, 14, 14)
  const adx = last(dm.adx)
  const pdi = last(dm.plus)
  const mdi = last(dm.minus)
  votes.push(
    adx == null || pdi == null || mdi == null
      ? null
      : adx > 20 && pdi > mdi
        ? 1
        : adx > 20 && mdi > pdi
          ? -1
          : 0,
  )

  const ao = awesome(c)
  const av = last(ao)
  const aUp = rising(ao)
  votes.push(av == null ? null : av > 0 && aUp === true ? 1 : av < 0 && aUp === false ? -1 : 0)

  const mo = momentum(close, 10)
  const mUp = rising(mo)
  votes.push(last(mo) == null ? null : mUp === true ? 1 : mUp === false ? -1 : 0)

  const m = macd(close)
  const ml = last(m.line)
  const ms = last(m.signal)
  votes.push(ml == null || ms == null ? null : ml > ms ? 1 : ml < ms ? -1 : 0)

  const w = williamsR(c, 14)
  const wv = last(w)
  const wUp = rising(w)
  votes.push(wv == null ? null : wv < -80 && wUp === true ? 1 : wv > -20 && wUp === false ? -1 : 0)

  return votes
}

const pctBack = (close: number[], bars: number): number | null => {
  const n = close.length
  if (n <= bars) return null
  const then = close[n - 1 - bars]
  return then ? (close[n - 1] / then - 1) * 100 : null
}

/** Everything the screener shows for one coin, from its daily candles (oldest first). */
export function computeTech(c: CandleFlat[]): TechSnapshot {
  const close = c.map((x) => x.c)
  const px = close.length ? close[close.length - 1] : NaN

  const maVotesList: Vote[] = []
  for (const len of MA_LENGTHS) {
    maVotesList.push(maVote(px, last(sma(close, len))))
    maVotesList.push(maVote(px, last(ema(close, len))))
  }
  const maVotes = tally(maVotesList)
  const oscVotes = tally(c.length ? oscillatorVotes(c) : [])
  const groups = [groupScore(maVotes), groupScore(oscVotes)].filter((x): x is number => x != null)
  const score = groups.length ? groups.reduce((a, b) => a + b, 0) / groups.length : null

  const m = macd(close)
  const ml = last(m.line)
  const ms = last(m.signal)
  const a = last(atr(c, 14))

  return {
    rsi: last(rsi(close, 14)),
    macd: ml,
    macdSignal: ms,
    macdState: ml == null || ms == null ? null : ml >= ms ? 'bull' : 'bear',
    ema20: last(ema(close, 20)),
    ema50: last(ema(close, 50)),
    ema200: last(ema(close, 200)),
    atrPct: a != null && px ? (a / px) * 100 : null,
    perf1W: pctBack(close, 7),
    perf1M: pctBack(close, 30),
    maVotes,
    oscVotes,
    score,
    rating: ratingOf(score),
  }
}

/** Price vs one EMA: 'above' / 'below', or null when the EMA is not available. */
export function emaRelation(price: number, ma: number | null): 'above' | 'below' | null {
  if (ma == null || !Number.isFinite(price)) return null
  return price >= ma ? 'above' : 'below'
}

// ---- Rows, filters, presets, sorting -----------------------------------------

export interface ScreenerRow {
  sym: string
  base: string
  name: string
  price: number
  /** 24h change, %. */
  pct: number
  /** 24h change in price units. */
  chg: number
  /** 24h quote (USDT) volume. */
  vol: number
  mcap: number | null
  tech: TechSnapshot | null
}

/** The absolute 24h change implied by the last price and its 24h %. */
export function absChange(last: number, pct: number): number {
  const d = 100 + pct
  return d ? (last * pct) / d : 0
}

export type RatingFilter = 'any' | 'buy_up' | 'sell_down' | Rating

export interface ScreenerFilters {
  q: string
  /** Minimum 24h volume in USDT; 0 = no limit. */
  minVol: number
  chgMin: number | null
  chgMax: number | null
  rsiMin: number | null
  rsiMax: number | null
  rating: RatingFilter
}

export type SortKey =
  | 'sym'
  | 'price'
  | 'pct'
  | 'chg'
  | 'vol'
  | 'mcap'
  | 'rsi'
  | 'macd'
  | 'ema'
  | 'atr'
  | 'perf1W'
  | 'perf1M'
  | 'rating'

export interface ScreenerSort {
  key: SortKey
  dir: 'asc' | 'desc'
}

export type PresetId = 'gainers' | 'losers' | 'active' | 'oversold' | 'overbought' | 'strongbuy'

export interface ScreenerPrefs {
  filters: ScreenerFilters
  sort: ScreenerSort
  preset: PresetId | null
}

export const EMPTY_FILTERS: ScreenerFilters = {
  q: '',
  minVol: 0,
  chgMin: null,
  chgMax: null,
  rsiMin: null,
  rsiMax: null,
  rating: 'any',
}

export const DEFAULT_SORT: ScreenerSort = { key: 'vol', dir: 'desc' }

export const PRESETS: Array<{
  id: PresetId
  label: string
  filters: Partial<ScreenerFilters>
  sort: ScreenerSort
}> = [
  { id: 'gainers', label: 'Top gainers', filters: { chgMin: 0 }, sort: { key: 'pct', dir: 'desc' } },
  { id: 'losers', label: 'Top losers', filters: { chgMax: 0 }, sort: { key: 'pct', dir: 'asc' } },
  { id: 'active', label: 'Most active', filters: {}, sort: { key: 'vol', dir: 'desc' } },
  { id: 'oversold', label: 'Oversold', filters: { rsiMax: 30 }, sort: { key: 'rsi', dir: 'asc' } },
  { id: 'overbought', label: 'Overbought', filters: { rsiMin: 70 }, sort: { key: 'rsi', dir: 'desc' } },
  {
    id: 'strongbuy',
    label: 'Strong buy',
    filters: { rating: 'strong_buy' },
    sort: { key: 'rating', dir: 'desc' },
  },
]

/** A preset starts from clean filters (the search text is kept). */
export function applyPreset(prefs: ScreenerPrefs, id: PresetId): ScreenerPrefs {
  const p = PRESETS.find((x) => x.id === id)
  if (!p) return prefs
  return { filters: { ...EMPTY_FILTERS, q: prefs.filters.q, ...p.filters }, sort: p.sort, preset: id }
}

/** True when a filter needs indicator values (so rows still computing are left out). */
export function needsTech(f: ScreenerFilters): boolean {
  return f.rsiMin != null || f.rsiMax != null || f.rating !== 'any'
}

function ratingPasses(r: Rating | null, f: RatingFilter): boolean {
  if (f === 'any') return true
  if (r == null) return false
  if (f === 'buy_up') return RATING_RANK[r] >= 1
  if (f === 'sell_down') return RATING_RANK[r] <= -1
  return r === f
}

/** Rows that pass every filter. Rows without indicators fail indicator filters. */
export function filterRows(rows: ScreenerRow[], f: ScreenerFilters): ScreenerRow[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter((r) => {
    if (q && !r.base.toLowerCase().includes(q) && !r.name.toLowerCase().includes(q) && !r.sym.toLowerCase().includes(q))
      return false
    if (f.minVol > 0 && !(r.vol >= f.minVol)) return false
    if (f.chgMin != null && !(r.pct >= f.chgMin)) return false
    if (f.chgMax != null && !(r.pct <= f.chgMax)) return false
    if (f.rsiMin != null || f.rsiMax != null) {
      const v = r.tech?.rsi
      if (v == null) return false
      if (f.rsiMin != null && v < f.rsiMin) return false
      if (f.rsiMax != null && v > f.rsiMax) return false
    }
    return ratingPasses(r.tech?.rating ?? null, f.rating)
  })
}

/** EMA alignment score: +1 for each of EMA20/50/200 the price is above, -1 below. */
export function emaScore(r: ScreenerRow): number | null {
  const t = r.tech
  if (!t) return null
  const rel = [t.ema20, t.ema50, t.ema200].map((m) => emaRelation(r.price, m))
  if (rel.every((x) => x == null)) return null
  return rel.reduce((s, x) => s + (x === 'above' ? 1 : x === 'below' ? -1 : 0), 0)
}

/** The value a column sorts by; null sorts last in either direction. */
export function sortValue(r: ScreenerRow, key: SortKey): number | string | null {
  switch (key) {
    case 'sym':
      return r.base
    case 'price':
      return r.price
    case 'pct':
      return r.pct
    case 'chg':
      return r.chg
    case 'vol':
      return r.vol
    case 'mcap':
      return r.mcap
    case 'rsi':
      return r.tech?.rsi ?? null
    case 'macd':
      // Normalised by price so coins of different price scales compare.
      return r.tech?.macd != null && r.tech.macdSignal != null && r.price
        ? ((r.tech.macd - r.tech.macdSignal) / r.price) * 100
        : null
    case 'ema':
      return emaScore(r)
    case 'atr':
      return r.tech?.atrPct ?? null
    case 'perf1W':
      return r.tech?.perf1W ?? null
    case 'perf1M':
      return r.tech?.perf1M ?? null
    case 'rating':
      return r.tech?.score ?? null
  }
}

/** Stable sort by one column; missing values always go to the bottom. */
export function sortRows(rows: ScreenerRow[], s: ScreenerSort): ScreenerRow[] {
  const sign = s.dir === 'asc' ? 1 : -1
  return rows
    .map((r, i) => ({ r, i, v: sortValue(r, s.key) }))
    .sort((a, b) => {
      const an = a.v == null || (typeof a.v === 'number' && !Number.isFinite(a.v))
      const bn = b.v == null || (typeof b.v === 'number' && !Number.isFinite(b.v))
      if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1
      const c =
        typeof a.v === 'string' && typeof b.v === 'string'
          ? a.v.localeCompare(b.v)
          : (a.v as number) - (b.v as number)
      return c ? c * sign : a.i - b.i
    })
    .map((x) => x.r)
}

/** Clicking a header: same column flips direction, a new one starts descending (names ascending). */
export function nextSort(cur: ScreenerSort, key: SortKey): ScreenerSort {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: key === 'sym' ? 'asc' : 'desc' }
}

const SORT_KEYS: SortKey[] = ['sym', 'price', 'pct', 'chg', 'vol', 'mcap', 'rsi', 'macd', 'ema', 'atr', 'perf1W', 'perf1M', 'rating']
const RATING_FILTERS: RatingFilter[] = ['any', 'buy_up', 'sell_down', 'strong_buy', 'buy', 'neutral', 'sell', 'strong_sell']

const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** Whatever came back from storage, made safe to use (unknown fields fall back to defaults). */
export function sanitizePrefs(raw: unknown): ScreenerPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const f = (o.filters && typeof o.filters === 'object' ? o.filters : {}) as Record<string, unknown>
  const s = (o.sort && typeof o.sort === 'object' ? o.sort : {}) as Record<string, unknown>
  const filters: ScreenerFilters = {
    q: typeof f.q === 'string' ? f.q.slice(0, 40) : '',
    minVol: Math.max(0, numOrNull(f.minVol) ?? 0),
    chgMin: numOrNull(f.chgMin),
    chgMax: numOrNull(f.chgMax),
    rsiMin: numOrNull(f.rsiMin),
    rsiMax: numOrNull(f.rsiMax),
    rating: RATING_FILTERS.includes(f.rating as RatingFilter) ? (f.rating as RatingFilter) : 'any',
  }
  const sort: ScreenerSort = {
    key: SORT_KEYS.includes(s.key as SortKey) ? (s.key as SortKey) : DEFAULT_SORT.key,
    dir: s.dir === 'asc' || s.dir === 'desc' ? s.dir : DEFAULT_SORT.dir,
  }
  const preset = PRESETS.some((p) => p.id === o.preset) ? (o.preset as PresetId) : null
  return { filters, sort, preset }
}
