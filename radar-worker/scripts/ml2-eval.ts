// npm run ml2-eval — ML2 research, stage B (docs/research/ml2-plan-2026-11-21.md).
// Read-only research on cached public Binance data; writes
// docs/research/ml2-eval-<date>.md. The bot does not use any of this.
//
// Fixed before the first run (the plan, plus these details):
//   - Target: the bot model's bracket (stop 1.5 ATR, target 2.25 ATR, 12 bars),
//     win = result > 0 before costs, long and short separately.
//   - Inputs: the 12 of src/research/ml2.ts. Models pooled over all coins:
//     M0 constant (training win rate), M1 logistic L2 (λ = 10, scaled inputs),
//     M2 MLP 12→6→1 (the bot's MLP settings, L2 ×5), M3 GBDT (C6's defaults).
//   - Walk-forward: 250-bar test blocks, aligned so one starts on 2025-01-01;
//     train on the 2 years before, ending 24 bars (12 purge + 12 embargo)
//     before the block; training rows every 3rd bar (overlapping labels).
//   - Design: blocks before 2025-01-01. Selection: among M1–M3 with a design
//     log-loss gain over M0 above zero, the highest design R per trade at the
//     bot's costs; if none gains, the highest log-loss gain. Holdout
//     (2025-01-01 on): run once, for M0 and the chosen model only.
//   - Trading: EV = p·(avg win − cost) − (1 − p)·(avg loss + cost) per side,
//     trade the better side if EV ≥ 0.1R, one trade at a time per coin, net of
//     the bot's costs + real funding, and again at 0.10% per side.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { costR, indicators, outcomeAt } from '../src/bot/features.ts'
import type { Bar, Costs, Ind } from '../src/bot/features.ts'
import { applyScaler, fitScaler, predict, train } from '../src/bot/mlp.ts'
import { fitGbdt, gbdtLogit } from '../src/bot/models/gbdt.ts'
import { sigmoid } from '../src/bot/models/common.ts'
import { regimeSeries } from '../src/context/market.ts'
import { summarize } from '../src/research/audit.ts'
import type { Summary } from '../src/research/audit.ts'
import { bracketTrade, trendSides } from '../src/research/skill.ts'
import { ML2_INPUTS, fitLogit, logitProb, ml2Inputs } from '../src/research/ml2.ts'
import { MODERATE, ML_WF, ROOT, STEP, SYMBOLS, load, log, sortFund } from './research-data.ts'

const K = ML_WF.bracket
const CONSERVATIVE: Costs = { taker: 0.001, maker: 0.001, slip: 0, tpMaker: false }
const BLOCK = 250 * STEP
const TRAIN = 730 * 86_400_000
const GAP = 24 * STEP
const HOLDOUT = Date.UTC(2025, 0, 1)
const MIN_EV = ML_WF.minEvR
type Id = 'M0' | 'M1' | 'M2' | 'M3'
const NAMES: Record<Id, string> = { M0: 'M0 constant', M1: 'M1 logistic', M2: 'M2 small MLP', M3: 'M3 GBDT' }

interface Row {
  sym: string
  i: number
  t: number
  x: number[]
  long: number | null
  short: number | null
}

const { bars, fund } = await load()
const F = Object.fromEntries(SYMBOLS.map((s) => [s, sortFund(fund[s])]))
const X = ml2Inputs(bars, F, STEP)
const IND: Record<string, Ind> = Object.fromEntries(SYMBOLS.map((s) => [s, indicators(bars[s])]))
const btc200 = Object.fromEntries(SYMBOLS.map((s) => [s, trendSides(bars[s], bars.BTCUSDT, 200)]))
const regime = regimeSeries(bars.BTCUSDT)
const rows: Row[] = []
for (const s of SYMBOLS)
  X[s].forEach((x, i) => {
    if (!x) return
    const L = outcomeAt(bars[s], IND[s], i, 1, K)
    const S = outcomeAt(bars[s], IND[s], i, -1, K)
    if (!L && !S) return
    rows.push({ sym: s, i, t: bars[s][i].t, x, long: L?.r ?? null, short: S?.r ?? null })
  })
rows.sort((a, b) => a.t - b.t)
log(rows.length, 'rows,', new Date(rows[0].t).toISOString().slice(0, 10), '→', new Date(rows.at(-1)!.t).toISOString().slice(0, 10))

// ---- models ------------------------------------------------------------------
interface SideFit {
  p: (x: number[]) => number
  winR: number
  lossR: number
}
function fitSide(id: Id, tr: Row[], side: 'long' | 'short', seed: number): SideFit {
  const ok = tr.filter((r) => r[side] != null)
  const y = ok.map((r) => ((r[side] as number) > 0 ? 1 : 0))
  const res = ok.map((r) => r[side] as number)
  const wins = res.filter((v) => v > 0)
  const losses = res.filter((v) => v <= 0)
  const winR = wins.reduce((a, v) => a + v, 0) / Math.max(1, wins.length)
  const lossR = -losses.reduce((a, v) => a + v, 0) / Math.max(1, losses.length) || 1
  const base = y.reduce((a: number, v) => a + v, 0) / Math.max(1, y.length)
  if (id === 'M0') return { p: () => base, winR, lossR }
  const sc = fitScaler(ok.map((r) => r.x))
  const Xs = ok.map((r) => applyScaler(sc, r.x))
  if (id === 'M1') {
    const m = fitLogit(Xs, y, 10)
    return { p: (x) => logitProb(m, applyScaler(sc, x)), winR, lossR }
  }
  if (id === 'M2') {
    const w = train(Xs, y, { ...ML_WF.mlp, l2: ML_WF.mlp.l2 * 5, seed })
    return { p: (x) => predict(w, applyScaler(sc, x)), winR, lossR }
  }
  const g = fitGbdt(ok.map((r) => r.x), y, { seed: 7 })
  return { p: (x) => sigmoid(gbdtLogit(g, x)), winR, lossR }
}

// ---- walk-forward --------------------------------------------------------------
interface Scored {
  row: Row
  pl: number
  ps: number
  evl: number
  evs: number
}
const clamp = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p))
const starts: number[] = []
for (let s = HOLDOUT; s - BLOCK >= rows[0].t + TRAIN; s -= BLOCK) starts.unshift(s - BLOCK)
for (let s = HOLDOUT; s <= rows.at(-1)!.t; s += BLOCK) starts.push(s)

function run(ids: Id[], blocks: number[]): Record<Id, Scored[]> {
  const out = Object.fromEntries(ids.map((id) => [id, [] as Scored[]])) as Record<Id, Scored[]>
  blocks.forEach((start, bi) => {
    const t0 = Date.now()
    const tr = rows.filter((r) => r.t >= start - GAP - TRAIN && r.t < start - GAP && r.i % 3 === 0)
    const te = rows.filter((r) => r.t >= start && r.t < start + BLOCK)
    if (tr.length < 1000 || !te.length) return
    for (const id of ids) {
      const L = fitSide(id, tr, 'long', 100 + bi)
      const S = fitSide(id, tr, 'short', 200 + bi)
      for (const r of te) {
        const b = bars[r.sym][r.i]
        const dist = K.slAtr * IND[r.sym].atr[r.i]
        const wc = costR(b.c, dist, MODERATE, 'tp')
        const lc = costR(b.c, dist, MODERATE, 'sl')
        const pl = clamp(L.p(r.x))
        const ps = clamp(S.p(r.x))
        out[id].push({ row: r, pl, ps, evl: pl * (L.winR - wc) - (1 - pl) * (L.lossR + lc), evs: ps * (S.winR - wc) - (1 - ps) * (S.lossR + lc) })
      }
    }
    log(`block ${new Date(start).toISOString().slice(0, 10)}: ${tr.length} train rows, ${te.length} test rows, ${ids.join('/')} in ${Math.round((Date.now() - t0) / 1000)} s`)
  })
  return out
}

// ---- scoring -------------------------------------------------------------------
interface Trade {
  sym: string
  t: number
  side: 1 | -1
  r: number
  rCons: number
  btc: number | null
  flip: number
}
/** Log-loss contribution of each labelled outcome. */
function lossRows(sc: Scored[]): Array<{ t: number; ll: number; p: number; y: number }> {
  const out: Array<{ t: number; ll: number; p: number; y: number }> = []
  for (const s of sc)
    for (const [p, r] of [[s.pl, s.row.long], [s.ps, s.row.short]] as const) {
      if (r == null) continue
      const y = r > 0 ? 1 : 0
      out.push({ t: s.row.t, ll: -(y ? Math.log(p) : Math.log(1 - p)), p, y })
    }
  return out
}
function trades(sc: Scored[]): Trade[] {
  const out: Trade[] = []
  const freeAt = new Map<string, number>()
  for (const s of [...sc].sort((a, b) => a.row.t - b.row.t)) {
    const { sym, i } = s.row
    if (i < (freeAt.get(sym) ?? 0)) continue
    const side: 1 | -1 = s.evl >= s.evs ? 1 : -1
    if (Math.max(s.evl, s.evs) < MIN_EV) continue
    const b: Bar[] = bars[sym]
    const tr = bracketTrade(b, IND[sym], i, side, K, MODERATE, F[sym], STEP)
    if (!tr) continue
    const cons = bracketTrade(b, IND[sym], i, side, K, CONSERVATIVE, F[sym], STEP)!
    const bs = btc200[sym][i]
    const L = bracketTrade(b, IND[sym], i, 1, K, MODERATE, F[sym], STEP)
    const S = bracketTrade(b, IND[sym], i, -1, K, MODERATE, F[sym], STEP)
    out.push({ sym, t: tr.t, side, r: tr.r, rCons: cons.r, btc: bs ? (bs > 0 ? L : S)?.r ?? null : null, flip: ((L?.r ?? 0) + (S?.r ?? 0)) / 2 })
    freeAt.set(sym, tr.end + 1)
  }
  return out
}
/** "Follow BTC EMA(200)" traded on its own over the same test rows. */
function btcRule(sc: Scored[]): Array<{ t: number; r: number }> {
  const out: Array<{ t: number; r: number }> = []
  const freeAt = new Map<string, number>()
  for (const s of [...sc].sort((a, b) => a.row.t - b.row.t)) {
    const { sym, i } = s.row
    const side = btc200[sym][i]
    if (!side || i < (freeAt.get(sym) ?? 0)) continue
    const tr = bracketTrade(bars[sym], IND[sym], i, side, K, MODERATE, F[sym], STEP)
    if (!tr) continue
    out.push({ t: tr.t, r: tr.r })
    freeAt.set(sym, tr.end + 1)
  }
  return out
}

const f3 = (v: number | null | undefined) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(3))
const f4 = (v: number | null | undefined) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(4))
const rng = (s: Summary, f = f3) => (s.lo == null ? 'too few' : `${f(s.lo)} … ${f(s.hi)}`)
const sumR = (xs: Array<{ t: number; r: number }>) => summarize(xs)
function evaluate(sc: Scored[], base: Scored[]) {
  const ll = lossRows(sc)
  const ll0 = lossRows(base)
  const gain = summarize(ll.map((x, k) => ({ t: x.t, r: ll0[k].ll - x.ll })))
  const brier = ll.reduce((a, x) => a + (x.p - x.y) ** 2, 0) / ll.length
  const tr = trades(sc)
  return {
    ll: ll.reduce((a, x) => a + x.ll, 0) / ll.length,
    gain,
    brier,
    tr,
    r: sumR(tr.map((x) => ({ t: x.t, r: x.r }))),
    cons: sumR(tr.map((x) => ({ t: x.t, r: x.rCons }))),
    vsBtc: sumR(tr.filter((x) => x.btc != null).map((x) => ({ t: x.t, r: x.r - (x.btc as number) }))),
    vsFlip: sumR(tr.map((x) => ({ t: x.t, r: x.r - x.flip }))),
  }
}

// ---- design ---------------------------------------------------------------------
const design = starts.filter((s) => s < HOLDOUT)
const hold = starts.filter((s) => s >= HOLDOUT)
log(`design: ${design.length} blocks from ${new Date(design[0]).toISOString().slice(0, 10)}; holdout: ${hold.length} blocks`)
const D = run(['M0', 'M1', 'M2', 'M3'], design)
const dEval = Object.fromEntries((['M0', 'M1', 'M2', 'M3'] as Id[]).map((id) => [id, evaluate(D[id], D.M0)])) as Record<Id, ReturnType<typeof evaluate>>
const cands = (['M1', 'M2', 'M3'] as Id[]).filter((id) => (dEval[id].gain.mean ?? 0) > 0)
const chosen: Id = cands.length
  ? cands.sort((a, b) => (dEval[b].r.mean ?? -9) - (dEval[a].r.mean ?? -9))[0]
  : (['M1', 'M2', 'M3'] as Id[]).sort((a, b) => (dEval[b].gain.mean ?? -9) - (dEval[a].gain.mean ?? -9))[0]
log('chosen on design:', chosen)

// ---- holdout, once ----------------------------------------------------------------
const Hh = run(['M0', chosen], hold)
const h = evaluate(Hh[chosen], Hh.M0)
const hBtc = sumR(btcRule(Hh.M0))

// ---- criteria ---------------------------------------------------------------------
const group = (t: number) => {
  const g = regime.get(t - STEP) ?? regime.get(t) ?? 'uncertain'
  return g.endsWith('bull') ? 'bull' : g.endsWith('bear') ? 'bear' : 'sideways / other'
}
const groups = ['bull', 'bear', 'sideways / other'].map((g) => [g, sumR(h.tr.filter((x) => group(x.t) === g).map((x) => ({ t: x.t, r: x.r })))] as const)
const months = new Map<string, number>()
for (const x of h.tr) months.set(new Date(x.t).toISOString().slice(0, 7), (months.get(new Date(x.t).toISOString().slice(0, 7)) ?? 0) + x.r)
const total = h.tr.reduce((a, x) => a + x.r, 0)
const topMonth = Math.max(0, ...months.values())
const longs = sumR(h.tr.filter((x) => x.side > 0).map((x) => ({ t: x.t, r: x.r })))
const shorts = sumR(h.tr.filter((x) => x.side < 0).map((x) => ({ t: x.t, r: x.r })))
const lr = lossRows(Hh[chosen])
const dec = Array.from({ length: 10 }, (_, d) => lr.filter((x) => Math.min(9, Math.floor(x.p * 10)) === d))
  .map((xs, d) => ({ d, n: xs.length, p: xs.reduce((a, x) => a + x.p, 0) / Math.max(1, xs.length), w: xs.reduce((a, x) => a + x.y, 0) / Math.max(1, xs.length) }))
const calOk = dec.filter((x) => x.n >= 200).every((x) => Math.abs(x.p - x.w) <= 0.05)
const crit: Array<[string, boolean, string]> = [
  ['1. Beats knowing nothing (log loss vs M0, range above 0)', h.gain.lo != null && h.gain.lo > 0, `${f4(h.gain.mean)} (${rng(h.gain, f4)})`],
  ['2. Beats following BTC EMA(200), same candles, range above 0', h.vsBtc.lo != null && h.vsBtc.lo > 0, `${f3(h.vsBtc.mean)} R/trade (${rng(h.vsBtc)})`],
  ['3. Profitable at bot costs, not below zero at 0.10%/side', (h.r.mean ?? 0) > 0 && (h.cons.mean ?? -1) >= 0, `${f3(h.r.mean)} / ${f3(h.cons.mean)} R/trade`],
  ['4a. Not clearly negative in bull, bear or sideways', groups.every(([, s]) => !(s.hi != null && s.hi < 0)), groups.map(([g, s]) => `${g} ${f3(s.mean)} (${s.n})`).join(', ')],
  ['4b. No month over 40% of the total R', total > 0 && topMonth / total <= 0.4, total > 0 ? `top month ${((topMonth / total) * 100).toFixed(0)}% of ${total.toFixed(1)}R` : `total ${total.toFixed(1)}R`],
  ['5. Longs and shorts not clearly negative', !(longs.hi != null && longs.hi < 0) && !(shorts.hi != null && shorts.hi < 0), `long ${f3(longs.mean)} (${longs.n}), short ${f3(shorts.mean)} (${shorts.n})`],
  ['6. Calibrated within 5 points per decile (n ≥ 200)', calOk, dec.filter((x) => x.n >= 200).map((x) => `${(x.p * 100).toFixed(0)}→${(x.w * 100).toFixed(0)}`).join(' ')],
]
const passed = crit.every(([, ok]) => ok)

// ---- report -----------------------------------------------------------------------
const out: string[] = []
const p = (s = '') => out.push(s)
p(`# ML2 research — evaluation (${new Date().toISOString().slice(0, 10)})`)
p()
p(`Stage B of docs/research/ml2-plan-2026-11-21.md. ${SYMBOLS.length} markets, 4h, ${rows.length} rows. Inputs: ${ML2_INPUTS.join(', ')}. Design: ${design.length} blocks of 250 bars from ${new Date(design[0]).toISOString().slice(0, 10)} to 2024-12-31; holdout: ${hold.length} blocks from 2025-01-01 to ${new Date(rows.at(-1)!.t).toISOString().slice(0, 10)}, run once. Training: the 2 years before each block, ending 24 bars before it, every 3rd bar. Trades: the bot's EV rule (≥ ${MIN_EV}R), one at a time per coin, costs taker ${MODERATE.taker * 100}% / maker ${MODERATE.maker * 100}% / slippage ${MODERATE.slip * 100}% plus real funding; conservative 0.10% per side. Ranges: 95%, clustered by day / week / month (widest).`)
p()
p(`## Verdict: **${passed ? 'PASSED — eligible for a paper-only stage C, on the owner\'s approval' : 'NOT PASSED — ML2 stops here as planned'}**`)
p()
p('| Criterion (holdout) | Pass | Value |\n|---|---|---|')
for (const [name, ok, v] of crit) p(`| ${name} | ${ok ? 'yes' : '**no**'} | ${v} |`)
p()
p('## 1. Design period (2019–2024): the four models')
p()
p('| Model | Log loss | Gain vs M0 | 95% range | Brier | Trades | R/trade | 95% range | vs BTC EMA(200), same candles | 95% range | vs coin flip |\n|---|---|---|---|---|---|---|---|---|---|---|')
for (const id of ['M0', 'M1', 'M2', 'M3'] as Id[]) {
  const e = dEval[id]
  p(`| ${NAMES[id]} | ${e.ll.toFixed(4)} | ${id === 'M0' ? '—' : f4(e.gain.mean)} | ${id === 'M0' ? '—' : rng(e.gain, f4)} | ${e.brier.toFixed(4)} | ${e.r.n} | ${f3(e.r.mean)} | ${rng(e.r)} | ${f3(e.vsBtc.mean)} | ${rng(e.vsBtc)} | ${f3(e.vsFlip.mean)} |`)
}
p()
p(`Follow BTC EMA(200) alone over the design rows: ${f3(sumR(btcRule(D.M0)).mean)} R/trade (${rng(sumR(btcRule(D.M0)))}).`)
p()
p(`Chosen by the fixed rule: **${NAMES[chosen]}** (${cands.length ? `highest design R/trade among ${cands.join(', ')}, the models with a log-loss gain over M0` : 'no model gained over M0 in design; highest log-loss gain'}).`)
p()
p(`## 2. Holdout (2025-01-01 on): ${NAMES[chosen]}`)
p()
p('| Measure | Value | 95% range |\n|---|---|---|')
p(`| Log loss (M0 ${evaluate(Hh.M0, Hh.M0).ll.toFixed(4)}) | ${h.ll.toFixed(4)} | |`)
p(`| Gain vs M0 | ${f4(h.gain.mean)} | ${rng(h.gain, f4)} |`)
p(`| Trades | ${h.r.n} | |`)
p(`| R/trade, bot costs | ${f3(h.r.mean)} | ${rng(h.r)} |`)
p(`| R/trade, 0.10% per side | ${f3(h.cons.mean)} | ${rng(h.cons)} |`)
p(`| Win rate / profit factor / max drawdown | ${(h.r.win * 100).toFixed(0)}% / ${h.r.pf?.toFixed(2) ?? '—'} / ${h.r.maxDdR.toFixed(1)}R | |`)
p(`| Model − BTC EMA(200), same candles | ${f3(h.vsBtc.mean)} | ${rng(h.vsBtc)} |`)
p(`| Model − coin flip, same candles | ${f3(h.vsFlip.mean)} | ${rng(h.vsFlip)} |`)
p(`| Follow BTC EMA(200) alone | ${f3(hBtc.mean)} | ${rng(hBtc)} |`)
p()
p('By year:')
p()
p('| Year | Trades | R/trade |\n|---|---|---|')
for (const y of [...new Set(h.tr.map((x) => new Date(x.t).getUTCFullYear()))].sort()) {
  const s = sumR(h.tr.filter((x) => new Date(x.t).getUTCFullYear() === y).map((x) => ({ t: x.t, r: x.r })))
  p(`| ${y} | ${s.n} | ${f3(s.mean)} (${rng(s)}) |`)
}
p()
p('Calibration (predicted vs real win rate, both sides):')
p()
p('| Decile | Outcomes | Predicted | Real |\n|---|---|---|---|')
for (const x of dec.filter((x) => x.n)) p(`| ${x.d * 10}–${x.d * 10 + 10}% | ${x.n} | ${(x.p * 100).toFixed(1)}% | ${(x.w * 100).toFixed(1)}% |`)
p()
p('## Limits')
p()
p('- Survivorship: the 24 coins are today\'s list. Funding before ~2019-09 is a default rate. Open interest is not available as free history.')
p('- 4h candles: a candle touching both stop and target counts as the stop; entries at the next candle\'s open (as the labels).')
p('- Three models on one target and one input set; the holdout was run once, for the chosen model only.')
const md = out.join('\n') + '\n'
const file = resolve(ROOT, `../docs/research/ml2-eval-${new Date().toISOString().slice(0, 10)}.md`)
writeFileSync(file, md)
console.log(md)
log('wrote', file)
