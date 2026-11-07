// Market evidence for the News tab's economic calendar: how BTC (and gold)
// moved after a past release, and the last releases of the same kind. Pure
// (tested in scripts/test-engines.mjs); the rows come from the server bot's
// econ_events / econ_reactions / market_context (radar-worker/src/news/),
// loaded by serverBot.ts loadCalendarEvidence / loadReleaseHistory.

/** The bot's categories (radar-worker/src/news/events.ts RULES — keep in step). */
const RULES: Array<[RegExp, string]> = [
  [/non-?farm (employment change|payrolls)|employment situation/i, 'nfp'],
  [/fomc (meeting )?minutes/i, 'fomc-minutes'],
  [/federal funds rate|fomc (statement|press conference|decision)|fomc press release|interest rate decision|fomc rate decision/i, 'fomc'],
  [/powell|fed chair/i, 'fed-speech'],
  [/\bcpi\b|consumer price/i, 'cpi'],
  [/\bppi\b|producer price/i, 'ppi'],
  [/unemployment claims|jobless claims|unemployment insurance/i, 'claims'],
  [/unemployment rate/i, 'unemployment'],
  [/\bgdp\b|gross domestic product/i, 'gdp'],
  [/retail sales/i, 'retail'],
  [/\bpce\b|personal income|personal consumption/i, 'pce'],
]

/** The study's category for a US calendar row, or null (not followed). */
export function releaseCategory(title: string, currency: string): string | null {
  if (currency !== 'USD') return null
  for (const [re, c] of RULES) if (re.test(title)) return c
  return null
}

export interface Move {
  ret: number
  z: number | null
}

/** BTC's and gold's 1 h reaction by release time (ms). */
export type ReactionMap = Map<number, { btc: Move | null; gold: Move | null }>

export function reactionMap(rows: Array<{ time: number; asset: string; ret: number; z: number | null }>): ReactionMap {
  const m: ReactionMap = new Map()
  for (const r of rows) {
    if (r.asset !== 'BTCUSDT' && r.asset !== 'XAUUSDT') continue
    const v = m.get(r.time) ?? { btc: null, gold: null }
    v[r.asset === 'BTCUSDT' ? 'btc' : 'gold'] = { ret: r.ret, z: r.z }
    m.set(r.time, v)
  }
  return m
}

/** The reaction for a calendar row: the release time within 5 minutes (feeds round differently). */
export function reactionFor(m: ReactionMap, ts: number): { btc: Move | null; gold: Move | null } | null {
  for (const d of [0, -60_000, 60_000, -120_000, 120_000, -300_000, 300_000]) {
    const v = m.get(ts + d)
    if (v) return v
  }
  return null
}

export interface HistoryRow {
  time: number
  title: string
  surprise: number | null
  decision: string | null
  btc: Move | null
  gold: Move | null
  regime: string | null
}

/**
 * Past releases of a category, newest first, one per release time (the row
 * with a surprise preferred), with the 1 h reactions and the regime then.
 */
export function releaseHistory(
  events: Array<{ time: number; title: string; surprise: number | null; decision: string | null }>,
  reactions: ReactionMap,
  regimes: Array<{ time: number; regime: string }>,
  before: number,
  limit = 12,
): HistoryRow[] {
  const by = new Map<number, (typeof events)[number]>()
  for (const e of events) {
    if (e.time >= before) continue
    const cur = by.get(e.time)
    if (!cur || (cur.surprise == null && e.surprise != null)) by.set(e.time, { ...e, decision: e.decision ?? cur?.decision ?? null })
  }
  const reg = [...regimes].sort((a, b) => a.time - b.time)
  const regimeAt = (t: number) => {
    let r: string | null = null
    for (const x of reg) {
      if (x.time > t) break
      r = x.regime
    }
    return r
  }
  return [...by.values()]
    .sort((a, b) => b.time - a.time)
    .slice(0, limit)
    .map((e) => ({ ...e, btc: reactions.get(e.time)?.btc ?? null, gold: reactions.get(e.time)?.gold ?? null, regime: regimeAt(e.time) }))
}

/** A short summary of a history: how often BTC rose, and how big its moves were. */
export function historySummary(h: HistoryRow[]): { n: number; up: number; avgAbs: number | null; big: number } {
  const m = h.map((x) => x.btc).filter((x): x is Move => !!x)
  return {
    n: m.length,
    up: m.filter((x) => x.ret > 0).length,
    avgAbs: m.length ? m.reduce((a, x) => a + Math.abs(x.ret), 0) / m.length : null,
    big: m.filter((x) => x.z != null && Math.abs(x.z) >= 2).length,
  }
}
