// npm run ml-skill — plan step 2: does the model pick sides better than "every
// coin follows BTC's trend"? Read-only research on cached public Binance data
// (scripts/research-data.ts); writes docs/research/ml-skill-<date>.md.
//
// The model is replayed with the bot's own walk-forward (walkforward.ts, the
// live bracket and EV bar, every fold trained only on bars before it). Every
// rule trades the same bracket from the same bars with the same costs and
// funding (src/research/skill.ts). Averages are per trade with cluster-robust
// 95% ranges (entry day / week / month, whichever is widest).
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { indicators } from '../src/bot/features.ts'
import { walkForward } from '../src/bot/walkforward.ts'
import { regimeSeries } from '../src/context/market.ts'
import { summarize } from '../src/research/audit.ts'
import type { Summary } from '../src/research/audit.ts'
import { bracketTrade, standalone, trendSides } from '../src/research/skill.ts'
import { MODERATE, ML_WF, ROOT, STEP, SYMBOLS, load, log, sortFund } from './research-data.ts'

interface Row {
  sym: string
  t: number
  side: 1 | -1
  r: number
}
interface Paired {
  sym: string
  t: number
  ml: Row
  /** Same bar: the BTC EMA(50) side, BTC EMA(200), the coin's own EMA(50), and the coin-flip expectation (mean of long and short). */
  btc50: number | null
  btc200: number | null
  own50: number | null
  flip: number
  btcSide50: 1 | -1 | 0
}

const { bars, fund } = await load()
const btc = bars.BTCUSDT
const regime = regimeSeries(btc)
const regAt = (t: number) => regime.get(t - STEP) ?? 'uncertain'
const H = ML_WF.bracket.horizon
const rules: Record<string, Row[]> = { ml: [], btc50: [], btc200: [], own50: [], long: [], short: [] }
const pairs: Paired[] = []
let from = Infinity
let to = 0

for (const sym of SYMBOLS) {
  const b = bars[sym]
  if (b.length < ML_WF.trainBars + ML_WF.testBars) {
    log(sym, 'too short, skipped')
    continue
  }
  const t0 = Date.now()
  const ind = indicators(b)
  const f = sortFund(fund[sym])
  const s50 = trendSides(b, btc, 50)
  const s200 = trendSides(b, btc, 200)
  const own = trendSides(b, b, 50)
  const trade = (i: number, s: 1 | -1) => bracketTrade(b, ind, i, s, ML_WF.bracket, MODERATE, f, STEP)
  const row = (x: { t: number; side: 1 | -1; r: number }): Row => ({ sym, t: x.t, side: x.side, r: x.r })
  // The model: the bot's walk-forward decisions, re-scored with funding.
  for (const w of walkForward(b, ML_WF).trades) {
    const m = trade(w.i, w.side)
    if (!m) continue
    rules.ml.push(row(m))
    const other = (s: 1 | -1 | 0) => (s ? (trade(w.i, s)?.r ?? null) : null)
    const L = trade(w.i, 1)
    const S = trade(w.i, -1)
    pairs.push({ sym, t: m.t, ml: row(m), btc50: other(s50[w.i]), btc200: other(s200[w.i]), own50: other(own[w.i]), flip: ((L?.r ?? 0) + (S?.r ?? 0)) / 2, btcSide50: s50[w.i] })
  }
  // The baselines, traded on their own over the same test bars.
  const a = ML_WF.trainBars
  const z = b.length - H
  from = Math.min(from, b[a].t)
  to = Math.max(to, b[z - 1].t)
  const run = (name: string, side: (i: number) => 1 | -1 | 0) => rules[name].push(...standalone(b, ind, side, a, z, ML_WF.bracket, MODERATE, f, STEP).map(row))
  run('btc50', (i) => s50[i])
  run('btc200', (i) => s200[i])
  run('own50', (i) => own[i])
  run('long', () => 1)
  run('short', () => -1)
  log(sym, `${rules.ml.filter((x) => x.sym === sym).length} model trades from ${new Date(b[a].t).toISOString().slice(0, 10)} in ${Math.round((Date.now() - t0) / 1000)} s`)
}

// ---- report --------------------------------------------------------------------
const f3 = (v: number | null | undefined) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(3))
const rng = (s: Summary) => (s.lo == null ? 'too few' : `${f3(s.lo)} … ${f3(s.hi)}`)
const line = (name: string, s: Summary) =>
  `| ${name} | ${s.n} | ${f3(s.mean)} | ${rng(s)} | ${(s.win * 100).toFixed(0)}% | ${s.pf == null ? '—' : s.pf.toFixed(2)} | ${s.totalR.toFixed(0)} | ${s.maxDdR.toFixed(0)} |`
const HEAD = '| Rule | Trades | Mean R | 95% range | Win | PF | Total R | Max DD R |\n|---|---|---|---|---|---|---|---|'
const NAMES: Record<string, string> = {
  ml: '**Model (walk-forward)**',
  btc50: 'Follow BTC: above / below its EMA(50)',
  btc200: 'Follow BTC: above / below its EMA(200)',
  own50: "Coin's own trend: EMA(50)",
  long: 'Always long',
  short: 'Always short',
}
const sum = (rs: Row[]) => summarize(rs.map((x) => ({ t: x.t, r: x.r })))
const diff = (ps: Paired[], k: 'btc50' | 'btc200' | 'own50' | 'flip') =>
  summarize(ps.filter((p) => p[k] != null).map((p) => ({ t: p.t, r: p.ml.r - (p[k] as number) })))
const year = (t: number) => new Date(t).getUTCFullYear()
const out: string[] = []
const p = (s = '') => out.push(s)

p(`# Model skill vs simple trend rules (${new Date().toISOString().slice(0, 10)})`)
p()
p(`Plan step 2. ${SYMBOLS.length} markets, 4h, test bars ${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)} (each market's first ${ML_WF.trainBars} bars only train). Every rule trades the model's bracket — stop ${ML_WF.bracket.slAtr} ATR, target ${ML_WF.bracket.tpAtr} ATR, exit after ${H} bars — from the signal bar's close, costs taker ${MODERATE.taker * 100}% / maker ${MODERATE.maker * 100}% / slippage ${MODERATE.slip * 100}% (the bot's own), plus the real funding paid or received. One trade at a time per market. Ranges are cluster-robust (entry day / week / month, the widest).`)
p()
p('## 1. Each rule on its own')
p()
p(HEAD)
for (const k of Object.keys(NAMES)) p(line(NAMES[k], sum(rules[k])))
p()
p('The model also skips bars (EV below 0.1R); the rules trade whenever they are free.')
p()
p("## 2. Same bars: the model's side vs a rule's side")
p()
p("On every bar where the model traded, the same bracket on the rule's side. Difference = model − rule (above zero: the model chose better).")
p()
p('| Compared with | Pairs | Model − rule (R/trade) | 95% range |\n|---|---|---|---|')
for (const [k, name] of [['btc50', 'Follow BTC EMA(50)'], ['btc200', 'Follow BTC EMA(200)'], ['own50', "Coin's own EMA(50)"], ['flip', 'Coin flip (mean of long and short)']] as const) {
  const s = diff(pairs, k)
  p(`| ${name} | ${s.n} | ${f3(s.mean)} | ${rng(s)} |`)
}
const agree = pairs.filter((x) => x.btcSide50 && x.ml.side === x.btcSide50)
const dis = pairs.filter((x) => x.btcSide50 && x.ml.side !== x.btcSide50)
p()
p(`The model took BTC's EMA(50) side on **${((agree.length / (agree.length + dis.length)) * 100).toFixed(0)}%** of its trades.`)
p()
p('| Model trades | Trades | Mean R | 95% range |\n|---|---|---|---|')
p(`| With BTC's trend | ${agree.length} | ${f3(sum(agree.map((x) => x.ml)).mean)} | ${rng(sum(agree.map((x) => x.ml)))} |`)
p(`| Against BTC's trend | ${dis.length} | ${f3(sum(dis.map((x) => x.ml)).mean)} | ${rng(sum(dis.map((x) => x.ml)))} |`)
p(`| Long | ${rules.ml.filter((x) => x.side > 0).length} | ${f3(sum(rules.ml.filter((x) => x.side > 0)).mean)} | ${rng(sum(rules.ml.filter((x) => x.side > 0)))} |`)
p(`| Short | ${rules.ml.filter((x) => x.side < 0).length} | ${f3(sum(rules.ml.filter((x) => x.side < 0)).mean)} | ${rng(sum(rules.ml.filter((x) => x.side < 0)))} |`)
p()
p('## 3. By year')
p()
p('| Year | Model trades | Model R | BTC EMA(50) alone R | Model − BTC EMA(50), same bars | 95% range |\n|---|---|---|---|---|---|')
const years = [...new Set(rules.ml.map((x) => year(x.t)))].sort()
for (const y of years) {
  const d = diff(pairs.filter((x) => year(x.t) === y), 'btc50')
  p(`| ${y} | ${rules.ml.filter((x) => year(x.t) === y).length} | ${f3(sum(rules.ml.filter((x) => year(x.t) === y)).mean)} | ${f3(sum(rules.btc50.filter((x) => year(x.t) === y)).mean)} | ${f3(d.mean)} | ${rng(d)} |`)
}
p()
p("## 4. By BTC's market regime at entry (7 classes, src/context/market.ts)")
p()
p('| Regime | Model trades | Model R | BTC EMA(50) alone R | Model − BTC EMA(50), same bars | 95% range |\n|---|---|---|---|---|---|')
const regs = [...new Set(rules.ml.map((x) => regAt(x.t)))].sort()
for (const g of regs) {
  const d = diff(pairs.filter((x) => regAt(x.t) === g), 'btc50')
  p(`| ${g} | ${rules.ml.filter((x) => regAt(x.t) === g).length} | ${f3(sum(rules.ml.filter((x) => regAt(x.t) === g)).mean)} | ${f3(sum(rules.btc50.filter((x) => regAt(x.t) === g)).mean)} | ${f3(d.mean)} | ${rng(d)} |`)
}
p()
p('## 5. The last 30 days vs before')
p()
const cut = to - 30 * 86_400_000
p('| Period | Model trades | Model R | 95% range | Model − BTC EMA(50) | 95% range |\n|---|---|---|---|---|---|')
for (const [name, keep] of [['Before', (t: number) => t < cut], ['Last 30 days', (t: number) => t >= cut]] as const) {
  const m = sum(rules.ml.filter((x) => keep(x.t)))
  const d = diff(pairs.filter((x) => keep(x.t)), 'btc50')
  p(`| ${name} | ${m.n} | ${f3(m.mean)} | ${rng(m)} | ${f3(d.mean)} | ${rng(d)} |`)
}
p()
p('## Limits')
p()
p('- The walk-forward model is the bot\'s model as the gate tests it: refitted every 250 bars on the 2,000 before. The live model also retrains hourly, adds its own paper trades and corrects its probabilities online; those parts cannot be replayed over years and are not in this test.')
p('- 4h bars: a bar touching both stop and target counts as the stop (as in the labels).')
p('- The trend rules were fixed before the run (EMA 50 and 200, no tuning). Trades on the same candle across markets are not independent; the ranges account for that by clustering.')
const md = out.join('\n') + '\n'
const file = resolve(ROOT, `../docs/research/ml-skill-${new Date().toISOString().slice(0, 10)}.md`)
writeFileSync(file, md)
console.log(md)
log('wrote', file)
