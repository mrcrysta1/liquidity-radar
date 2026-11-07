// Market context from the server bot (radar-worker/src/context/, bot_state
// 'context:latest'): BTC on 15m / 1h / 4h, the 7-class regime, every coin's
// measured correlation with BTC, gold with the dollar index and Treasury
// yields. Pure (tested in scripts/test-engines.mjs): turns the stored value
// into what the "Market context" card shows; unusable parts are dropped.

export type Dir = 'up' | 'down' | 'flat'
export const TFS = ['15m', '1h', '4h'] as const
export type Tf = (typeof TFS)[number]

export interface TfView {
  dir: Dir
  close: number
  roc20: number
  rsi14: number
  er30: number
  atrPct: number
  atrRank: number
  volRatio: number
}

export interface CorrView {
  r: number | null
  prev: number | null
  beta: number | null
  changed: boolean
  group: 'strong' | 'moderate' | 'independent' | null
}

export interface DailyView {
  last: number
  change5: number
  change20: number
  dir: Dir
}

export interface ContextView {
  t: number
  regime: string
  why: string
  btc: Partial<Record<Tf, TfView>>
  /** Coins by 4h correlation with BTC, strongest first. */
  coins: Array<{ symbol: string; corr: Partial<Record<Tf, CorrView>> }>
  changes: Array<{ symbol: string; tf: string; from: number; to: number }>
  gold: {
    h1: TfView | null
    h4: TfView | null
    levels: { prevDayHigh: number; prevDayLow: number; high20d: number; low20d: number } | null
    dxy: DailyView | null
    bill13w: DailyView | null
    yield10y: DailyView | null
    goldDxyCorr: number | null
    btcGoldCorr: number | null
  }
  btcVsGold: 'same' | 'opposite' | 'mixed' | null
  errors: string[]
}

type Raw = Record<string, unknown>
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null)
const dir = (v: unknown): Dir | null => (v === 'up' || v === 'down' || v === 'flat' ? v : null)
const REGIMES = ['strong-bull', 'weak-bull', 'sideways', 'weak-bear', 'strong-bear', 'high-volatility', 'uncertain']

function tf(v: unknown): TfView | null {
  const x = obj(v)
  const d = dir(x?.dir)
  const close = num(x?.close)
  if (!x || !d || close == null) return null
  return { dir: d, close, roc20: num(x.roc20) ?? 0, rsi14: num(x.rsi14) ?? 50, er30: num(x.er30) ?? 0, atrPct: num(x.atrPct) ?? 0, atrRank: num(x.atrRank) ?? 0, volRatio: num(x.volRatio) ?? 1 }
}

function daily(v: unknown): DailyView | null {
  const x = obj(v)
  const d = dir(x?.dir)
  const last = num(x?.last)
  return x && d && last != null ? { last, change5: num(x.change5) ?? 0, change20: num(x.change20) ?? 0, dir: d } : null
}

function corr(v: unknown): CorrView | null {
  const x = obj(v)
  if (!x) return null
  const g = x.group
  return { r: num(x.r), prev: num(x.prev), beta: num(x.beta), changed: x.changed === true, group: g === 'strong' || g === 'moderate' || g === 'independent' ? g : null }
}

/** bot_state value → view; null when it is not a context snapshot. */
export function normalizeContext(value: unknown): ContextView | null {
  const v = obj(typeof value === 'string' ? safeParse(value) : value)
  const reg = obj(v?.regime)
  if (!v || !reg || !REGIMES.includes(String(reg.regime))) return null
  const b = obj(v.btc) ?? {}
  const btc: ContextView['btc'] = {}
  for (const k of TFS) {
    const s = tf(b[k])
    if (s) btc[k] = s
  }
  const coins: ContextView['coins'] = []
  for (const [symbol, c] of Object.entries(obj(v.corr) ?? {})) {
    const o = obj(c) ?? {}
    const out: Partial<Record<Tf, CorrView>> = {}
    for (const k of TFS) {
      const cv = corr(o[k])
      if (cv) out[k] = cv
    }
    coins.push({ symbol, corr: out })
  }
  coins.sort((a, z) => (z.corr['4h']?.r ?? -2) - (a.corr['4h']?.r ?? -2) || a.symbol.localeCompare(z.symbol))
  const g = obj(v.gold) ?? {}
  const lv = obj(g.levels)
  const levels = lv && [lv.prevDayHigh, lv.prevDayLow, lv.high20d, lv.low20d].every((x) => num(x) != null)
    ? { prevDayHigh: Number(lv.prevDayHigh), prevDayLow: Number(lv.prevDayLow), high20d: Number(lv.high20d), low20d: Number(lv.low20d) }
    : null
  const changes = (Array.isArray(v.changes) ? v.changes : [])
    .map((x) => obj(x))
    .filter((x): x is Raw => !!x && typeof x.symbol === 'string' && num(x.from) != null && num(x.to) != null)
    .map((x) => ({ symbol: String(x.symbol), tf: String(x.tf ?? ''), from: Number(x.from), to: Number(x.to) }))
  const bvg = v.btcVsGold
  return {
    t: num(v.t) ?? 0,
    regime: String(reg.regime),
    why: typeof reg.why === 'string' ? reg.why : '',
    btc,
    coins,
    changes,
    gold: {
      h1: tf(g.h1),
      h4: tf(g.h4),
      levels,
      dxy: daily(g.dxy),
      bill13w: daily(g.bill13w),
      yield10y: daily(g.yield10y),
      goldDxyCorr: num(g.goldDxyCorr),
      btcGoldCorr: num(g.btcGoldCorr),
    },
    btcVsGold: bvg === 'same' || bvg === 'opposite' || bvg === 'mixed' ? bvg : null,
    errors: Array.isArray(v.errors) ? v.errors.filter((x): x is string => typeof x === 'string') : [],
  }
}

/** Correlation counts by group on a timeframe. */
export function corrGroups(coins: ContextView['coins'], k: Tf): { strong: number; moderate: number; independent: number } {
  const out = { strong: 0, moderate: 0, independent: 0 }
  for (const c of coins) {
    const g = c.corr[k]?.group
    if (g) out[g]++
  }
  return out
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
