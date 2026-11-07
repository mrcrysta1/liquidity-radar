// News trading intelligence (research plan P5): which economic releases move
// BTC and gold, how the bot's strategies did around them, and how sure we can
// be. Pure (tested in scripts/test-engines.mjs); serverBot.ts loadNewsIntel
// fetches econ_events, econ_reactions, the market regime per 4h bar and the
// closed real and paper trades.
//
// Rules that keep it honest:
//   - an "event" is one release time: NFP, the unemployment rate and earnings
//     at 8:30 are one event, so every rate and range is counted per event
//   - a trade belongs to an event only if it was entered from the release to
//     24 h after it; whether it was news-driven needs evidence (attribute())
//   - win chances are shrunk toward the strategy's overall win rate (a beta
//     prior worth 20 trades), with a 95% interval, and every number carries
//     its sample size and a reliability label; a historical win rate is not
//     the chance that the next trade wins
//   - a reaction says the market moved, not why

export interface NewsEvent {
  time: number
  category: string
  title: string
  source: string
  impact: string | null
  forecast: number | null
  actual: number | null
  previous: number | null
  revisedPrevious: number | null
  surprise: number | null
  decision: string | null
  unit: string | null
}

export interface ReactionRow {
  time: number
  asset: string
  horizon: number
  ret: number
  z: number | null
  range: number | null
}

export interface NewsTrade {
  key: string
  strategy: string
  kind: 'real' | 'shadow'
  symbol: string
  side: 1 | -1
  entryTime: number
  r: number
}

export const CATEGORY_LABEL: Record<string, string> = {
  nfp: 'NFP (jobs report)',
  cpi: 'CPI (inflation)',
  ppi: 'PPI (producer prices)',
  fomc: 'FOMC / rate decision',
  'fed-speech': 'Fed chair speeches',
  claims: 'Jobless claims',
  gdp: 'GDP',
  unemployment: 'Unemployment rate',
  retail: 'Retail sales',
  pce: 'PCE / income',
  political: 'Political / geopolitical',
}

export const HORIZONS = [15, 60, 240, 1440]
/** The categories the bot follows (radar-worker/src/news/events.ts TRACKED). */
export const TRACKED_NEWS = ['nfp', 'cpi', 'ppi', 'fomc', 'fed-speech', 'claims', 'gdp', 'unemployment', 'retail', 'pce', 'political']
const H = 3_600_000

/** One event per category and release time; the rows of a release merged (forecast/actual from whichever row has them). */
export function groupEvents(rows: NewsEvent[]): NewsEvent[] {
  const m = new Map<string, NewsEvent>()
  for (const r of rows) {
    const k = r.category + '|' + r.time
    const e = m.get(k)
    if (!e) m.set(k, { ...r })
    else {
      // Prefer the row that carries numbers (the headline indicator usually has a forecast).
      if (e.surprise == null && r.surprise != null) Object.assign(e, { title: r.title, forecast: r.forecast, actual: r.actual, previous: r.previous, revisedPrevious: r.revisedPrevious, surprise: r.surprise, unit: r.unit })
      e.decision ??= r.decision
      e.impact ??= r.impact
    }
  }
  return [...m.values()].sort((a, b) => a.time - b.time)
}

export type Reliability = 'none' | 'anecdotal' | 'weak' | 'moderate' | 'usable'
export function reliability(independent: number): Reliability {
  return independent <= 0 ? 'none' : independent < 5 ? 'anecdotal' : independent < 20 ? 'weak' : independent < 50 ? 'moderate' : 'usable'
}

export interface Stat {
  n: number
  mean: number | null
  lo: number | null
  hi: number | null
}

/** Mean with a 95% interval; `groups` (event times) make it cluster-robust. No interval under 5 groups. */
export function meanCI(xs: Array<{ v: number; g: number }>): Stat {
  const n = xs.length
  if (!n) return { n, mean: null, lo: null, hi: null }
  const mean = xs.reduce((a, x) => a + x.v, 0) / n
  const by = new Map<number, number>()
  for (const x of xs) by.set(x.g, (by.get(x.g) ?? 0) + x.v - mean)
  const G = by.size
  if (G < 5) return { n, mean, lo: null, hi: null }
  let s = 0
  for (const v of by.values()) s += v * v
  const se = Math.sqrt((s / n ** 2) * (G / (G - 1)))
  return { n, mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se }
}

export interface CategoryReaction {
  category: string
  events: number
  /** Per asset and horizon: mean |return| %, mean signed return %, mean |z|, share of events with |z| ≥ 2, share up. */
  assets: Record<string, Record<number, { n: number; absRet: Stat; ret: Stat; absZ: number | null; bigShare: number | null; upShare: number | null }>>
  /** Events with a known surprise: correlation of surprise with BTC's 1 h return (null under 8 events). */
  surpriseCorr: number | null
}

export function categoryReactions(events: NewsEvent[], reactions: ReactionRow[]): CategoryReaction[] {
  const byTime = new Map<number, ReactionRow[]>()
  for (const r of reactions) {
    const a = byTime.get(r.time)
    if (a) a.push(r)
    else byTime.set(r.time, [r])
  }
  const cats = new Map<string, NewsEvent[]>()
  for (const e of events) {
    const a = cats.get(e.category)
    if (a) a.push(e)
    else cats.set(e.category, [e])
  }
  const out: CategoryReaction[] = []
  for (const [category, evs] of cats) {
    const assets: CategoryReaction['assets'] = {}
    for (const e of evs) {
      for (const r of byTime.get(e.time) ?? []) {
        if (r.asset === 'none') continue
        const a = (assets[r.asset] ??= {})
        const cell = (a[r.horizon] ??= { n: 0, absRet: { n: 0, mean: null, lo: null, hi: null }, ret: { n: 0, mean: null, lo: null, hi: null }, absZ: null, bigShare: null, upShare: null })
        cell.n++
      }
    }
    for (const asset of Object.keys(assets)) {
      for (const h of Object.keys(assets[asset]).map(Number)) {
        const rows = evs.map((e) => (byTime.get(e.time) ?? []).find((r) => r.asset === asset && r.horizon === h)).filter((r): r is ReactionRow => !!r)
        const zs = rows.filter((r) => r.z != null).map((r) => Math.abs(r.z!))
        assets[asset][h] = {
          n: rows.length,
          absRet: meanCI(rows.map((r) => ({ v: Math.abs(r.ret), g: r.time }))),
          ret: meanCI(rows.map((r) => ({ v: r.ret, g: r.time }))),
          absZ: zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : null,
          bigShare: zs.length ? zs.filter((z) => z >= 2).length / zs.length : null,
          upShare: rows.length ? rows.filter((r) => r.ret > 0).length / rows.length : null,
        }
      }
    }
    const pairs = evs
      .filter((e) => e.surprise != null)
      .map((e) => [e.surprise!, (byTime.get(e.time) ?? []).find((r) => r.asset === 'BTCUSDT' && r.horizon === 60)?.ret] as const)
      .filter((p): p is readonly [number, number] => p[1] != null)
    out.push({ category, events: evs.length, assets, surpriseCorr: pairs.length >= 8 ? pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1])) : null })
  }
  return out.sort((a, b) => (b.assets.BTCUSDT?.[60]?.absZ ?? -1) - (a.assets.BTCUSDT?.[60]?.absZ ?? -1))
}

function pearson(x: number[], y: number[]): number | null {
  const n = x.length
  const mx = x.reduce((a, b) => a + b, 0) / n
  const my = y.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null
}

// ---- attribution --------------------------------------------------------------------

export type Attribution = 'news' | 'trend' | 'btc' | 'mixed' | 'none'
export const ATTRIBUTION_LABEL: Record<Attribution, string> = {
  news: 'News-driven',
  trend: 'Market-trend-driven',
  btc: 'BTC-correlation-driven',
  mixed: 'Mixed influence',
  none: 'No identified news relationship',
}

export interface Context4h {
  /** Close of the 4h bar, ms. */
  time: number
  regime: string
  btcDir4h: string | null
}

/**
 * Why a trade happened, with evidence. News needs all three: entered within
 * 4 h after a tracked release, the market really moved (BTC |z| ≥ 2 at 1 h —
 * or gold's, for a gold trade), and the trade went with that move. Trend: a
 * trend-following strategy entering in the direction of a trending regime.
 * BTC: an alt entered in the direction BTC's 4h trend was moving. Without the
 * market context recorded at the time, only news can be judged.
 */
export function attribute(t: NewsTrade, events: NewsEvent[], reactions: ReactionRow[], ctx: Context4h[]): { kind: Attribution; why: string; event: NewsEvent | null } {
  const near = events.filter((e) => t.entryTime >= e.time && t.entryTime <= e.time + 4 * H).sort((a, b) => b.time - a.time)
  let newsWhy = ''
  let event: NewsEvent | null = null
  for (const e of near) {
    const asset = t.symbol === 'XAUUSDT' ? 'XAUUSDT' : 'BTCUSDT'
    const r = reactions.find((x) => x.time === e.time && x.asset === asset && x.horizon === 60)
    if (!r || r.z == null) {
      newsWhy ||= `entered ${hours(t.entryTime - e.time)} after ${e.title}, but its market reaction is not measured`
      continue
    }
    if (Math.abs(r.z) < 2) {
      newsWhy ||= `entered ${hours(t.entryTime - e.time)} after ${e.title}, but ${asset.replace('USDT', '')} moved only ${r.z.toFixed(1)}σ — no evidence the news drove it`
      continue
    }
    if (Math.sign(r.ret) !== t.side) {
      newsWhy ||= `entered against the ${r.ret > 0 ? 'rise' : 'drop'} after ${e.title}`
      continue
    }
    event = e
    newsWhy = `entered ${hours(t.entryTime - e.time)} after ${e.title}, with the ${r.z.toFixed(1)}σ ${r.ret > 0 ? 'rise' : 'drop'} in ${asset.replace('USDT', '')}`
    break
  }
  const c = [...ctx].reverse().find((x) => x.time <= t.entryTime + 60_000)
  const trendStrat = /^(f1|f1x|c6|c2)$/.test(t.strategy)
  const regimeDir = c?.regime.includes('bull') ? 1 : c?.regime.includes('bear') ? -1 : 0
  const trend = trendStrat && c && regimeDir === t.side ? `${t.strategy.toUpperCase()} follows trends and entered with the ${c.regime} regime` : ''
  const btcDir = c?.btcDir4h === 'up' ? 1 : c?.btcDir4h === 'down' ? -1 : 0
  const btc = !trend && c && t.symbol !== 'BTCUSDT' && t.symbol !== 'XAUUSDT' && btcDir === t.side ? `entered ${t.side > 0 ? 'long' : 'short'} while BTC's 4h trend was ${c.btcDir4h}` : ''
  if (event && (trend || btc)) return { kind: 'mixed', why: `${newsWhy}; also ${trend || btc}`, event }
  if (event) return { kind: 'news', why: newsWhy, event }
  if (trend) return { kind: 'trend', why: trend, event: null }
  if (btc) return { kind: 'btc', why: btc, event: null }
  return { kind: 'none', why: newsWhy || (c ? 'no release, trend or BTC move explains it' : 'no release nearby; market context not recorded then'), event: null }
}

const hours = (ms: number) => (ms < H ? `${Math.round(ms / 60_000)} min` : `${(ms / H).toFixed(1)} h`)

// ---- strategy results around events ---------------------------------------------------

export interface WinChance {
  /** Shrunk estimate and its 95% interval. */
  p: number
  lo: number
  hi: number
  raw: number | null
}

/** Beta-binomial: prior centred on the strategy's overall win rate, worth `k` trades. */
export function winChance(wins: number, n: number, base: number, k = 20): WinChance {
  const a = wins + base * k
  const b = n - wins + (1 - base) * k
  const p = a / (a + b)
  const sd = Math.sqrt((p * (1 - p)) / (a + b + 1))
  return { p, lo: Math.max(0, p - 1.96 * sd), hi: Math.min(1, p + 1.96 * sd), raw: n ? wins / n : null }
}

export interface CategoryPerf {
  category: string
  events: number
  /** Events with at least one associated trade (the independent count). */
  eventsWithTrades: number
  trades: number
  wins: number
  losses: number
  avgWin: number | null
  avgLoss: number | null
  expectancy: Stat
  pf: number | null
  maxDdR: number
  long: { n: number; mean: number | null }
  short: { n: number; mean: number | null }
  win: WinChance
  reliability: Reliability
  btc1h: number | null
  gold1h: number | null
}

/** Trades entered from a release to 24 h after it, per category (a trade near two releases counts for each). */
export function categoryPerformance(events: NewsEvent[], trades: NewsTrade[], reactions: ReactionRow[]): CategoryPerf[] {
  const base = trades.length ? trades.filter((t) => t.r > 0).length / trades.length : 0.5
  const cats = [...new Set(events.map((e) => e.category))]
  const out: CategoryPerf[] = []
  for (const category of cats) {
    const evs = events.filter((e) => e.category === category)
    const assoc: Array<{ t: NewsTrade; g: number }> = []
    for (const e of evs) for (const t of trades) if (t.entryTime >= e.time && t.entryTime <= e.time + 24 * H) assoc.push({ t, g: e.time })
    const rs = assoc.map((x) => x.t.r)
    const wins = rs.filter((r) => r > 0)
    const losses = rs.filter((r) => r <= 0)
    let cum = 0
    let peak = 0
    let dd = 0
    for (const x of [...assoc].sort((a, b) => a.t.entryTime - b.t.entryTime)) {
      cum += x.t.r
      peak = Math.max(peak, cum)
      dd = Math.max(dd, peak - cum)
    }
    const side = (s: 1 | -1) => {
      const v = assoc.filter((x) => x.t.side === s).map((x) => x.t.r)
      return { n: v.length, mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
    }
    const absMean = (asset: string) => {
      const v = evs.map((e) => reactions.find((r) => r.time === e.time && r.asset === asset && r.horizon === 60)).filter((r): r is ReactionRow => !!r).map((r) => Math.abs(r.ret))
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
    }
    const withTrades = new Set(assoc.map((x) => x.g)).size
    const gl = -losses.reduce((a, b) => a + b, 0)
    out.push({
      category,
      events: evs.length,
      eventsWithTrades: withTrades,
      trades: assoc.length,
      wins: wins.length,
      losses: losses.length,
      avgWin: wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null,
      avgLoss: losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null,
      expectancy: meanCI(assoc.map((x) => ({ v: x.t.r, g: x.g }))),
      pf: gl > 0 ? wins.reduce((a, b) => a + b, 0) / gl : null,
      maxDdR: dd,
      long: side(1),
      short: side(-1),
      win: winChance(wins.length, assoc.length, base),
      reliability: reliability(withTrades),
      btc1h: absMean('BTCUSDT'),
      gold1h: absMean('XAUUSDT'),
    })
  }
  return out.sort((a, b) => (b.expectancy.mean ?? -9) - (a.expectancy.mean ?? -9))
}

// ---- comparable events --------------------------------------------------------------------

export interface Comparable {
  event: NewsEvent
  regime: string | null
  btc1h: ReactionRow | null
  gold1h: ReactionRow | null
  /** Same surprise sign as the event being compared (null when either is unknown). */
  sameSurprise: boolean | null
  sameRegime: boolean | null
}

/** Past events of the same category, most similar first (same regime, then same surprise sign, then newest). */
export function comparables(target: NewsEvent, events: NewsEvent[], reactions: ReactionRow[], ctx: Context4h[], regimeNow: string | null, limit = 8): Comparable[] {
  const regimeAt = (t: number) => [...ctx].reverse().find((c) => c.time <= t)?.regime ?? null
  const past = events.filter((e) => e.category === target.category && e.time < target.time && e.time !== target.time)
  const rows = past.map((e) => {
    const regime = regimeAt(e.time)
    return {
      event: e,
      regime,
      btc1h: reactions.find((r) => r.time === e.time && r.asset === 'BTCUSDT' && r.horizon === 60) ?? null,
      gold1h: reactions.find((r) => r.time === e.time && r.asset === 'XAUUSDT' && r.horizon === 60) ?? null,
      sameSurprise: target.surprise != null && e.surprise != null ? Math.sign(target.surprise) === Math.sign(e.surprise) : null,
      sameRegime: regimeNow && regime ? regimeNow === regime : null,
    }
  })
  const score = (c: Comparable) => (c.sameRegime ? 2 : 0) + (c.sameSurprise ? 1 : 0)
  return rows.sort((a, b) => score(b) - score(a) || b.event.time - a.event.time).slice(0, limit)
}
