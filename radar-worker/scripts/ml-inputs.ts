// npm run ml-inputs — plan step 3: what each of the model's 18 inputs is worth,
// out of sample. Read-only research on cached public Binance data; writes
// docs/research/ml-inputs-<date>.md. Method in src/research/inputs.ts.
//
// The models are the walk-forward's own (same folds, same seeds as
// walkforward.ts), so this measures the inputs of the model the gate tests.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FEATURES, indicators, outcomeAt } from '../src/bot/features.ts'
import { fitModel } from '../src/bot/walkforward.ts'
import { regimeSeries } from '../src/context/market.ts'
import { summarize } from '../src/research/audit.ts'
import type { Summary } from '../src/research/audit.ts'
import { INPUT_GROUPS, correlations, folds, permutationLoss, rankIc, sideLogLoss, testRows } from '../src/research/inputs.ts'
import type { TestRow } from '../src/research/inputs.ts'
import { ML_WF, ROOT, SYMBOLS, load, log } from './research-data.ts'

interface FoldResult {
  sym: string
  /** Middle of the test block. */
  t: number
  regime: string
  n: number
  /** Log loss of the model and of the training base rate on the test rows (both sides). */
  llModel: number
  llBase: number
  perm: number[]
  group: Record<string, number>
  icLong: Array<number | null>
  icShort: Array<number | null>
}

const { bars } = await load()
const regime = regimeSeries(bars.BTCUSDT)
const res: FoldResult[] = []
const sample: number[][] = []
const recent: number[][] = []
const older: number[][] = []
const lastT = Math.max(...SYMBOLS.map((s) => bars[s].at(-1)?.t ?? 0))
const cut = lastT - 30 * 86_400_000
const k = ML_WF.bracket
const colOf = (name: string) => FEATURES.indexOf(name as (typeof FEATURES)[number])

for (const sym of SYMBOLS) {
  const b = bars[sym]
  if (b.length < ML_WF.trainBars + ML_WF.testBars) continue
  const t0 = Date.now()
  const ind = indicators(b)
  folds(b.length, ML_WF).forEach((f, fold) => {
    // The same model the walk-forward fits for this fold (same rows, same seed).
    const m = fitModel(b, ind, f.trainFrom, f.trainTo, ML_WF, (ML_WF.mlp.seed ?? 0) + 100 + fold)
    if (!m) return
    const rows: TestRow[] = testRows(b, ind, f, k)
    if (rows.length < 20) return
    // A model with no inputs: the training win rate per side.
    let wl = 0, nl = 0, ws = 0, ns = 0
    for (let i = f.trainFrom; i < f.trainTo; i++) {
      const L = outcomeAt(b, ind, i, 1, k)
      const S = outcomeAt(b, ind, i, -1, k)
      if (L) (nl++, (wl += L.r > 0 ? 1 : 0))
      if (S) (ns++, (ws += S.r > 0 ? 1 : 0))
    }
    const pl = Math.min(1 - 1e-6, Math.max(1e-6, wl / Math.max(1, nl)))
    const ps = Math.min(1 - 1e-6, Math.max(1e-6, ws / Math.max(1, ns)))
    let llBase = 0
    let nb = 0
    for (const r of rows) {
      if (r.long != null) (llBase -= r.long > 0 ? Math.log(pl) : Math.log(1 - pl), nb++)
      if (r.short != null) (llBase -= r.short > 0 ? Math.log(ps) : Math.log(1 - ps), nb++)
    }
    const seed = 7 + fold * 31 + sym.length
    const perm = FEATURES.map((_, c) => permutationLoss(m, rows, [c], seed).delta)
    const group: Record<string, number> = {}
    for (const [g, names] of Object.entries(INPUT_GROUPS)) group[g] = permutationLoss(m, rows, names.map(colOf), seed).delta
    // Model log loss on the rows (the permutation's base).
    const xs = rows.map((r) => r.x)
    const a = sideLogLoss(m.long, xs, rows.map((r) => r.long))
    const s = sideLogLoss(m.short, xs, rows.map((r) => r.short))
    const mid = rows[Math.floor(rows.length / 2)].t
    res.push({
      sym,
      t: mid,
      regime: regime.get(rows[0].t) ?? 'uncertain',
      n: a.n + s.n,
      llModel: (a.ll * a.n + s.ll * s.n) / Math.max(1, a.n + s.n),
      llBase: llBase / Math.max(1, nb),
      perm,
      group,
      icLong: FEATURES.map((_, c) => rankIc(rows, c, 'long')),
      icShort: FEATURES.map((_, c) => rankIc(rows, c, 'short')),
    })
    rows.forEach((r, j) => {
      if (j % 5 === 0) sample.push(r.x)
      ;(r.t >= cut ? recent : older).push(r.x)
    })
  })
  log(sym, `${res.filter((r) => r.sym === sym).length} folds in ${Math.round((Date.now() - t0) / 1000)} s`)
}

// ---- report --------------------------------------------------------------------
const f4 = (v: number | null | undefined) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(4))
const rng = (s: Summary) => (s.lo == null ? 'too few' : `${f4(s.lo)} … ${f4(s.hi)}`)
/** Per-fold values, clustered by the fold's time (folds of different markets in the same weeks move together). */
const over = (rs: FoldResult[], v: (r: FoldResult) => number | null) =>
  summarize(rs.filter((r) => v(r) != null).map((r) => ({ t: r.t, r: v(r) as number })))
const out: string[] = []
const p = (s = '') => out.push(s)
const from = Math.min(...res.map((r) => r.t))
const to = Math.max(...res.map((r) => r.t))

p(`# The model's 18 inputs, out of sample (${new Date().toISOString().slice(0, 10)})`)
p()
p(`Plan step 3. ${new Set(res.map((r) => r.sym)).size} markets, 4h, ${res.length} walk-forward test blocks (${ML_WF.testBars} bars each, ${new Date(from).toISOString().slice(0, 7)} → ${new Date(to).toISOString().slice(0, 7)}), ${res.reduce((a, r) => a + r.n, 0)} labelled outcomes (both sides of every test bar). Each block is scored by the model the walk-forward trained on the ${ML_WF.trainBars} bars before it (same folds and seeds as walkforward.ts); nothing from a test block is used to train or tune. Labels: does the bracket (stop ${k.slAtr} ATR, target ${k.tpAtr} ATR, ${k.horizon} bars) make money before costs — the model's own target.`)
p()
p('## 1. Do the inputs together beat no inputs?')
p()
const gain = over(res, (r) => r.llBase - r.llModel)
p(`Log loss of the model vs a model with no inputs (the training win rate per side), per test block: **${f4(gain.mean)}** better (95% ${rng(gain)}; positive = the model is better). Model ${f4(over(res, (r) => r.llModel).mean)} vs no inputs ${f4(over(res, (r) => r.llBase).mean)}. Blocks where the model was better: ${((res.filter((r) => r.llModel < r.llBase).length / res.length) * 100).toFixed(0)}%.`)
p()
p('## 2. Each input: shuffled out of sample')
p()
p('How much worse the log loss gets when one input is shuffled across a test block (3 shuffles, both sides). Positive = the model uses it and it helps on new data; about zero = no use; negative = it hurts (the model learned noise from it). Rank IC: Spearman correlation of the input with the bracket result on the test rows, no model involved; "same sign" = share of blocks agreeing with the overall sign.')
p()
p('| Input | Loss when shuffled | 95% range | Rank IC long | Rank IC short | Same sign (long) | Verdict |\n|---|---|---|---|---|---|---|')
const verdictOf = (s: Summary) => (s.lo != null && s.lo > 0 ? 'useful' : s.hi != null && s.hi < 0 ? 'hurts' : (s.mean ?? 0) > 0 ? 'weak, not proven' : 'no use')
const rowsOut = FEATURES.map((name, c) => {
  const s = over(res, (r) => r.perm[c])
  const il = over(res, (r) => r.icLong[c])
  const is = over(res, (r) => r.icShort[c])
  const sign = Math.sign(il.mean ?? 0)
  const same = res.filter((r) => r.icLong[c] != null && Math.sign(r.icLong[c] as number) === sign).length / Math.max(1, res.filter((r) => r.icLong[c] != null).length)
  return { name, s, il, is, same, v: verdictOf(s) }
})
for (const r of [...rowsOut].sort((a, b) => (b.s.mean ?? 0) - (a.s.mean ?? 0)))
  p(`| ${r.name} | ${f4(r.s.mean)} | ${rng(r.s)} | ${f4(r.il.mean)} | ${f4(r.is.mean)} | ${(r.same * 100).toFixed(0)}% | ${r.v} |`)
p()
p('## 3. Groups of inputs shuffled together')
p()
p('Related inputs can stand in for each other, so one shuffled alone may look useless while the group matters.')
p()
p('| Group | Inputs | Loss when shuffled | 95% range | Verdict |\n|---|---|---|---|---|')
for (const [g, names] of Object.entries(INPUT_GROUPS)) {
  const s = over(res, (r) => r.group[g])
  p(`| ${g} | ${names.join(', ')} | ${f4(s.mean)} | ${rng(s)} | ${verdictOf(s)} |`)
}
p()
p('## 4. Redundant inputs (|correlation| ≥ 0.7 on test rows)')
p()
const cor = correlations(sample)
p(cor.length ? '| Input | Input | Correlation |\n|---|---|---|\n' + cor.map((c) => `| ${c.a} | ${c.b} | ${c.r.toFixed(2)} |`).join('\n') : 'None.')
p()
p('## 5. Is it stable? Loss when shuffled, by period')
p()
const periods: Array<[string, (t: number) => boolean]> = [
  ['2020–2021', (t) => t < Date.UTC(2022, 0, 1)],
  ['2022', (t) => t >= Date.UTC(2022, 0, 1) && t < Date.UTC(2023, 0, 1)],
  ['2023–2024', (t) => t >= Date.UTC(2023, 0, 1) && t < Date.UTC(2025, 0, 1)],
  ['2025–2026', (t) => t >= Date.UTC(2025, 0, 1)],
]
p(`| Input | ${periods.map(([n]) => n).join(' | ')} |\n|---|${periods.map(() => '---').join('|')}|`)
for (const [c, name] of FEATURES.entries()) p(`| ${name} | ${periods.map(([, keep]) => f4(over(res.filter((r) => keep(r.t)), (r) => r.perm[c]).mean)).join(' | ')} |`)
p()
p(`Model vs no inputs by period: ${periods.map(([n, keep]) => `${n} ${f4(over(res.filter((r) => keep(r.t)), (r) => r.llBase - r.llModel).mean)}`).join(' · ')}.`)
p()
p("## 6. By BTC's regime at the start of the block")
p()
p('| Regime | Blocks | Model vs no inputs | Top input when shuffled |\n|---|---|---|---|')
for (const g of [...new Set(res.map((r) => r.regime))].sort()) {
  const rs = res.filter((r) => r.regime === g)
  const top = FEATURES.map((name, c) => [name, over(rs, (r) => r.perm[c]).mean ?? 0] as const).sort((a, b) => b[1] - a[1])[0]
  p(`| ${g} | ${rs.length} | ${f4(over(rs, (r) => r.llBase - r.llModel).mean)} | ${top[0]} (${f4(top[1])}) |`)
}
p()
p('## 7. The last 30 days vs history (input drift)')
p()
p('Mean of each input over the last 30 days, in standard deviations of its history (all markets). Large values: the market looks unlike what the model was trained on.')
p()
p('| Input | Shift (SD) |\n|---|---|')
const drift = FEATURES.map((name, c) => {
  const h = older.map((x) => x[c])
  const m = h.reduce((a, v) => a + v, 0) / h.length
  const sd = Math.sqrt(h.reduce((a, v) => a + (v - m) ** 2, 0) / h.length) || 1
  const rm = recent.reduce((a, x) => a + x[c], 0) / Math.max(1, recent.length)
  return [name, (rm - m) / sd] as const
}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
for (const [name, z] of drift) p(`| ${name} | ${z >= 0 ? '+' : ''}${z.toFixed(2)} |`)
p()
p('## Limits')
p()
p("- Shuffling measures what the trained model uses; an input the model ignores but that holds information shows up only in the rank IC column.")
p('- Log loss differences are small numbers by nature (the outcome is close to a coin flip); the ranges say whether they are real.')
p("- The live model also retrains hourly on its own paper trades and corrects probabilities online; those parts are not replayed here.")
const md = out.join('\n') + '\n'
const file = resolve(ROOT, `../docs/research/ml-inputs-${new Date().toISOString().slice(0, 10)}.md`)
writeFileSync(file, md)
console.log(md)
log('wrote', file)
