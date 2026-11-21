// npm run f1-filter — option 2: an ML filter on F1's entries (take / skip).
// Read-only research on cached public Binance data; writes
// docs/research/f1-filter-<date>.md. The bot does not use any of this.
//
// Fixed before the first run:
//   - Trades: F1's own historical entries on 24 markets (the bot's code), net
//     of conservative costs (0.10% per leg) and real funding.
//   - Label: the trade made money (net R > 0). Take a trade when the model's
//     probability is at least the training win rate (C6's rule).
//   - Inputs (16): ML2's 12 (coin, BTC, breadth, relative, funding) + 4 about
//     the breakout (src/research/f1filter.ts).
//   - Models: F1L logistic (L2, λ = 10, scaled), F1G GBDT (C6's defaults).
//     Benchmark: C6 as it runs (its own inputs, src/bot/c6.ts).
//   - Walk-forward: refit every half-year on trades closed ≥ 7 days before it
//     (expanding window, at least 300 trades).
//   - Design: half-years before 2025; the better of F1L / F1G by "taken −
//     skipped" mean R is chosen. Holdout: 2025-01-01 on, run once.
//   - Pass (holdout): (1) taken mean R > F1's; (2) taken − skipped range above
//     zero; (3) skipped mean R ≤ 0; (4) return / drawdown of taken ≥ F1's;
//     and (0) in design too, (1) and (3) hold. C6 on the same trades is shown.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { F1_STRATEGY } from '../src/bot/strategies.ts'
import { indicators } from '../src/bot/features.ts'
import { fitGbdt, gbdtLogit } from '../src/bot/models/gbdt.ts'
import { applyScaler, fitScaler } from '../src/bot/mlp.ts'
import { sigmoid } from '../src/bot/models/common.ts'
import { c6Rows } from '../src/bot/c6.ts'
import { PROFILES, btcRegimes, netR } from '../src/research/audit.ts'
import { ML2_INPUTS, fitLogit, logitProb, ml2Inputs } from '../src/research/ml2.ts'
import { F1_INPUTS, ema300, f1Inputs, filterReport, halfYears, walkFilter } from '../src/research/f1filter.ts'
import type { FilterReport, FilterRow } from '../src/research/f1filter.ts'
import { MODERATE, ROOT, STEP, SYMBOLS, c6Verdicts, load, log, ruleTrades, sortFund } from './research-data.ts'

const HOLDOUT = Date.UTC(2025, 0, 1)
const EMBARGO = 7 * 86_400_000
const MIN_ROWS = 300
const CONS = PROFILES[1]

const { bars, fund } = await load()
const F = Object.fromEntries(SYMBOLS.map((s) => [s, sortFund(fund[s])]))
const btc = bars.BTCUSDT
const reg = btcRegimes(btc)
const X2 = ml2Inputs(bars, F, STEP)
const f1 = SYMBOLS.flatMap((sym) => ruleTrades('f1', F1_STRATEGY, sym, bars[sym], btc, fund[sym], reg))
log(f1.length, 'F1 trades')
const c6 = c6Verdicts(f1, SYMBOLS.flatMap((sym) => c6Rows(sym, bars[sym], fund[sym], sym === 'BTCUSDT' ? undefined : btc, MODERATE, STEP)))

interface Row extends FilterRow {
  sym: string
  c6: boolean | undefined
}
const rows: Row[] = []
for (const sym of SYMBOLS) {
  const b = bars[sym]
  const at = new Map(b.map((x, k) => [x.t, k]))
  const atr = indicators(b).atr
  const e = ema300(b)
  for (const t of f1.filter((x) => x.symbol === sym)) {
    const i = at.get(t.t - STEP)
    if (i == null) continue
    const a = X2[sym][i]
    const c = f1Inputs(b, atr, e, i)
    if (!a || !c) continue
    rows.push({ sym, t: t.t, tExit: t.tExit, r: netR(t, CONS), x: [...a, ...c], c6: c6.get(sym + ':' + t.t) })
  }
}
rows.sort((a, b) => a.t - b.t)
log(rows.length, 'F1 trades with all inputs, from', new Date(rows[0].t).toISOString().slice(0, 10))

const label = (r: FilterRow) => (r.r > 0 ? 1 : 0)
const models = {
  F1L: (tr: FilterRow[]) => {
    const sc = fitScaler(tr.map((r) => r.x))
    const m = fitLogit(tr.map((r) => applyScaler(sc, r.x)), tr.map(label), 10)
    return (x: number[]) => logitProb(m, applyScaler(sc, x))
  },
  F1G: (tr: FilterRow[]) => {
    const g = fitGbdt(tr.map((r) => r.x), tr.map(label), { seed: 7 })
    return (x: number[]) => sigmoid(gbdtLogit(g, x))
  },
}
type Id = keyof typeof models
const NAMES: Record<Id, string> = { F1L: 'Logistic filter', F1G: 'GBDT filter' }
const starts = halfYears(rows[0].t, rows.at(-1)!.t)
const designStarts = starts.filter((s) => s < HOLDOUT)
const holdStarts = starts.filter((s) => s >= HOLDOUT)

const judge = (id: Id, st: number[], keep: (r: Row) => boolean) => {
  const v = walkFilter(rows, models[id], st, EMBARGO, MIN_ROWS)
  return rows.filter((r) => v.has(r) && keep(r)).map((r) => ({ t: r.t, r: r.r, take: v.get(r)!, row: r }))
}
const inDesign = (r: Row) => r.t < HOLDOUT
const inHold = (r: Row) => r.t >= HOLDOUT
const D = Object.fromEntries((Object.keys(models) as Id[]).map((id) => [id, judge(id, designStarts, inDesign)])) as Record<Id, ReturnType<typeof judge>>
const dRep = Object.fromEntries((Object.keys(models) as Id[]).map((id) => [id, filterReport(D[id])])) as Record<Id, FilterReport>
const chosen = (Object.keys(models) as Id[]).sort((a, b) => (dRep[b].gap.mean ?? -9) - (dRep[a].gap.mean ?? -9))[0]
log('chosen on design:', chosen)
const H = judge(chosen, holdStarts, inHold)
const h = filterReport(H)
const c6Rep = (xs: Array<{ row: Row }>) => filterReport(xs.filter((x) => x.row.c6 != null).map((x) => ({ t: x.row.t, r: x.row.r, take: x.row.c6! })))
const hC6 = c6Rep(H)
const dC6 = c6Rep(D[chosen])

const crit: Array<[string, boolean, string]> = [
  ['0. Design: taken mean > F1 and skipped mean ≤ 0', (dRep[chosen].taken.mean ?? -9) > (dRep[chosen].all.mean ?? 9) && (dRep[chosen].skipped.mean ?? 9) <= 0, `taken ${f3(dRep[chosen].taken.mean)} vs F1 ${f3(dRep[chosen].all.mean)}; skipped ${f3(dRep[chosen].skipped.mean)}`],
  ['1. Taken mean R above F1 alone', (h.taken.mean ?? -9) > (h.all.mean ?? 9), `${f3(h.taken.mean)} vs ${f3(h.all.mean)}`],
  ['2. Taken − skipped, range above zero', h.gap.lo != null && h.gap.lo > 0, `${f3(h.gap.mean)} (${f3(h.gap.lo)} … ${f3(h.gap.hi)})`],
  ['3. Skipped trades not profitable (mean ≤ 0)', (h.skipped.mean ?? 9) <= 0, `${f3(h.skipped.mean)} over ${h.skipped.n} trades`],
  ['4. Return / drawdown of taken ≥ F1 alone', (h.retDd.taken ?? -9) >= (h.retDd.all ?? 9), `${f2(h.retDd.taken)} vs ${f2(h.retDd.all)}`],
]
const passed = crit.every(([, ok]) => ok)

function f3(v: number | null | undefined) {
  return v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(3)
}
function f2(v: number | null | undefined) {
  return v == null ? '—' : v.toFixed(2)
}
const rng = (lo: number | null, hi: number | null) => (lo == null ? 'too few' : `${f3(lo)} … ${f3(hi)}`)
const line = (name: string, r: FilterReport) =>
  `| ${name} | ${r.all.n} | ${(r.takenShare * 100).toFixed(0)}% | ${f3(r.all.mean)} | ${f3(r.taken.mean)} (${rng(r.taken.lo, r.taken.hi)}) | ${f3(r.skipped.mean)} (${rng(r.skipped.lo, r.skipped.hi)}) | ${f3(r.gap.mean)} (${rng(r.gap.lo, r.gap.hi)}) | ${r.all.totalR.toFixed(0)} / ${r.taken.totalR.toFixed(0)} | ${f2(r.retDd.all)} / ${f2(r.retDd.taken)} |`
const HEAD = '| Filter | F1 trades | Taken | F1 alone R | Taken R (95%) | Skipped R (95%) | Taken − skipped (95%) | Total R F1 / taken | Return÷DD F1 / taken |\n|---|---|---|---|---|---|---|---|---|'

const out: string[] = []
const p = (s = '') => out.push(s)
p(`# ML filter on F1's entries (${new Date().toISOString().slice(0, 10)})`)
p()
p(`Option 2. ${rows.length} F1 trades on ${SYMBOLS.length} markets (${new Date(rows[0].t).toISOString().slice(0, 10)} → ${new Date(rows.at(-1)!.t).toISOString().slice(0, 10)}), net of 0.10% per leg and real funding. The filter only takes or skips F1's own entries; F1's entries and exits are unchanged. Inputs (${ML2_INPUTS.length + F1_INPUTS.length}): ${[...ML2_INPUTS, ...F1_INPUTS].join(', ')}. Refit every half-year on trades closed at least 7 days before; take when the probability is at least the training win rate. Design: half-years before 2025 (choose one model); holdout 2025-01-01 on, run once. Ranges 95%, clustered by day / week / month.`)
p()
p(`## Verdict: **${passed ? 'PASSED — eligible for paper trading as a new filter, on the owner\'s approval' : 'NOT PASSED — the filter does not go further'}**`)
p()
p('| Criterion | Pass | Value |\n|---|---|---|')
for (const [n, ok, v] of crit) p(`| ${n} | ${ok ? 'yes' : '**no**'} | ${v} |`)
p()
p('## Design (before 2025)')
p()
p(HEAD)
for (const id of Object.keys(models) as Id[]) p(line(NAMES[id], dRep[id]))
p(line('C6 (as it runs), same trades', dC6))
p()
p(`Chosen: **${NAMES[chosen]}** (larger taken − skipped gap in design).`)
p()
p('## Holdout (2025-01-01 on), run once')
p()
p(HEAD)
p(line(NAMES[chosen], h))
p(line('C6 (as it runs), same trades', hC6))
p()
p('## Limits')
p()
p('- F1 trades are few per half-year; ranges are wide. The taken − skipped range treats the two groups as independent (they share market days), so it is approximate.')
p('- Survivorship (today\'s 24 coins); funding before ~2019-09 is a default rate; 4h candles.')
p('- C6\'s holdout is not independent evidence (C6 was designed after 2025 was seen).')
const md = out.join('\n') + '\n'
const file = resolve(ROOT, `../docs/research/f1-filter-${new Date().toISOString().slice(0, 10)}.md`)
writeFileSync(file, md)
console.log(md)
log('wrote', file)
