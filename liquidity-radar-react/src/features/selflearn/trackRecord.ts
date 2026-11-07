// The public track record (components/neural/TrackRecord.tsx): the demo
// account over time and every strategy's result with its uncertainty and
// audit verdict. Pure (tested in scripts/test-engines.mjs). Honest by
// construction: losses stay in, ranges are shown, and too-small samples say so.

export const TRACK_HASH = '#track-record'

export interface EquitySummary {
  from: number
  to: number
  start: number
  now: number
  changePct: number
  /** Worst fall from a running peak, % of that peak. */
  maxDdPct: number
  /** Normalised to the first value (1 = start), at most `points` long. */
  curve: number[]
}

/** Hourly equity rows (any order) → summary; null with fewer than 2 rows. */
export function equitySummary(rows: Array<{ t: number; equity: number }>, points = 300): EquitySummary | null {
  const s = rows.filter((r) => Number.isFinite(r.t) && r.equity > 0).sort((a, b) => a.t - b.t)
  if (s.length < 2) return null
  let peak = s[0].equity
  let dd = 0
  for (const r of s) {
    peak = Math.max(peak, r.equity)
    dd = Math.max(dd, (peak - r.equity) / peak)
  }
  const step = Math.max(1, Math.ceil(s.length / points))
  const curve = s.filter((_, i) => i % step === 0 || i === s.length - 1).map((r) => r.equity / s[0].equity)
  return { from: s[0].t, to: s[s.length - 1].t, start: s[0].equity, now: s[s.length - 1].equity, changePct: (s[s.length - 1].equity / s[0].equity - 1) * 100, maxDdPct: dd * 100, curve }
}

export interface StrategyLine {
  id: string
  trades: number
  real: number
  eff: number
  avgR: number | null
  totalR: number
  win: number
  /** At conservative costs over the whole history (audit), and its verdict. */
  historyR: number | null
  verdict: string | null
  note: string
}

/** Live ledger rows + the audit → one line per strategy, with an honest note on what the sample can say. */
export function strategyLines(
  ledger: Array<{ id: string; real: number; shadow: number; eff: number; recorded: { avgR: number | null; totalR: number; win: number } }>,
  audit: Array<{ id: string; verdict: string; profiles: { conservative: { mean: number | null } } }>,
): StrategyLine[] {
  const a = new Map(audit.map((x) => [x.id, x]))
  const ids = [...new Set([...ledger.map((l) => l.id), ...audit.map((x) => x.id)])].sort()
  return ids.map((id) => {
    const l = ledger.find((x) => x.id === id)
    const au = a.get(id)
    const trades = l ? l.real + l.shadow : 0
    const eff = l?.eff ?? 0
    const note = !trades ? 'no trades since the current setup started' : eff < 30 ? `only ~${eff} independent decisions so far: too few to judge` : eff < 100 ? 'a first read, not proof' : 'enough for a reliable read'
    return {
      id,
      trades,
      real: l?.real ?? 0,
      eff,
      avgR: l?.recorded.avgR ?? null,
      totalR: l?.recorded.totalR ?? 0,
      win: l?.recorded.win ?? 0,
      historyR: au?.profiles.conservative.mean ?? null,
      verdict: au?.verdict ?? null,
      note,
    }
  })
}
