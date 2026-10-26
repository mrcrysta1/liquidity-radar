// Offline, out-of-sample evaluation of the trading model — no keys, no orders,
// public market data only (cached in .cache/, gitignored).
//
//   npm run eval                                          # current model (mlp), production settings
//   npm run eval -- --model mlp --symbols BTCUSDT,ETHUSDT --months 6
//   npm run eval -- compare --champion mlp --challenger base-rate --months 6
//
// Options (defaults = the live bot as .github/workflows/trading-bot.yml runs it):
//   --symbols A,B       BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XAUUSDT
//   --months N          6   months of history ending at --end (training + testing)
//   --end YYYY-MM-DD    today 00:00 UTC (pin it to reproduce a run exactly)
//   --interval          5m
//   --sl / --tp / --horizon   9 / 18 / 96   bracket in ATRs and bars
//   --min-ev            any (live: calibrated EV must still be > 0)
//   --train-bars        2000      --test-bars 250 (a fresh model per test block)
//   --embargo           12 bars between the last training label and the test block
//   --source            futures | spot (klines the features and fills are taken from)
//   --no-funding        leave funding payments out of net R
//   --boot N            2000 bootstrap resamples (compare)
//   --folds             print the per-fold table
//   --out file.json     default .cache/eval-results/<mode>-<time>.json
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INTERVAL_MS } from '../src/bot/data.ts'
import { DEFAULT_SETUP } from '../src/bot/setup.ts'
import { PREDICTORS } from '../src/bot/predictor.ts'
import { DEFAULT_WF, baselines, calibration, compareModels, labelBars, summarize, walkForwardEval } from '../src/bot/walkforward.ts'
import type { Calibration, EvalConfig, ModelEval, Summary, SymbolData } from '../src/bot/walkforward.ts'
import { fundingHistory, gaps, klines } from './eval-data.ts'
import type { Source } from './eval-data.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv: string[]) {
  const pos: string[] = []
  const o: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) pos.push(a)
    else if (a.includes('=')) o[a.slice(2, a.indexOf('='))] = a.slice(a.indexOf('=') + 1)
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o[a.slice(2)] = argv[++i]
    else o[a.slice(2)] = true
  }
  return { pos, o }
}

const { pos, o } = parseArgs(process.argv.slice(2))
const str = (k: string, d: string) => (typeof o[k] === 'string' ? (o[k] as string) : d)
const num = (k: string, d: number) => {
  const v = Number(str(k, String(d)))
  if (!Number.isFinite(v)) throw new Error(`--${k} must be a number`)
  return v
}

const mode = pos[0] === 'compare' ? 'compare' : 'eval'
const interval = str('interval', '5m')
const stepMs = INTERVAL_MS[interval]
if (!stepMs) throw new Error('--interval must be one of ' + Object.keys(INTERVAL_MS).join(', '))
const symbols = str('symbols', 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XAUUSDT').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const monthsN = num('months', 6)
const endDay = str('end', new Date().toISOString().slice(0, 10))
const end = Date.parse(endDay + 'T00:00:00Z')
if (!Number.isFinite(end)) throw new Error('--end must be YYYY-MM-DD')
const startD = new Date(end)
startD.setUTCMonth(startD.getUTCMonth() - monthsN)
const start = startD.getTime()
const source = str('source', 'futures') as Source
const withFunding = !o['no-funding'] && source === 'futures'
const minEvArg = str('min-ev', 'any')
const cfg: EvalConfig = {
  wf: {
    ...DEFAULT_WF,
    bracket: { slAtr: num('sl', 9), tpAtr: num('tp', 18), horizon: Math.max(1, Math.round(num('horizon', 96))) },
    minEvR: minEvArg === 'any' ? -1e9 : Number(minEvArg),
    trainBars: num('train-bars', DEFAULT_WF.trainBars),
    testBars: num('test-bars', DEFAULT_WF.testBars),
  },
  setup: DEFAULT_SETUP,
  embargoBars: num('embargo', 12),
  stepMs,
}
const cacheDir = resolve(str('cache', join(ROOT, '.cache', 'binance')))

const factory = (name: string) => {
  const make = PREDICTORS[name]
  if (!make) throw new Error(`unknown model "${name}" — known: ${Object.keys(PREDICTORS).join(', ')}`)
  return () => make(cfg.wf)
}

// ---- data ---------------------------------------------------------------------

const d = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ')
console.log(`data: ${source} ${interval} klines${withFunding ? ' + funding' : ''}, ${d(start)} → ${d(end)} UTC, cache ${cacheDir}`)
const data: SymbolData[] = []
const dataInfo: Record<string, unknown>[] = []
for (const s of symbols) {
  const bars = await klines(s, interval, start, end, cacheDir, source)
  if (bars.length < 400) {
    console.log(`  ${s}: only ${bars.length} bars — skipped`)
    continue
  }
  const funding = withFunding ? await fundingHistory(s, start, end, cacheDir) : []
  const sd = labelBars(s, bars, cfg, funding)
  data.push(sd)
  const g = gaps(bars, stepMs)
  dataInfo.push({ symbol: s, bars: bars.length, from: bars[0].t, to: bars[bars.length - 1].t, missingBars: g, funding: funding.length, rows: sd.rows.length, eligible: sd.rows.filter((r) => r.eligible).length })
  console.log(`  ${s}: ${bars.length} bars ${d(bars[0].t)} → ${d(bars[bars.length - 1].t)}, ${g} missing, ${funding.length} funding events, ${sd.rows.filter((r) => r.eligible).length}/${sd.rows.length} bars pass R:R/cost rules`)
}
if (!data.length) throw new Error('no data')

// ---- printing -------------------------------------------------------------------

const f = (v: number, p = 3) => (Number.isFinite(v) ? v.toFixed(p) : v > 0 ? 'inf' : '-')
const pc = (v: number) => (v * 100).toFixed(1) + '%'
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
const lpad = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s)
const HEAD = ['', 'trades', 'L/S', 'hit', 'avgR gross', 'exp R net', 'cost R', 'fund R', 'total R', 'PF', 'maxDD R', 'Sh/trade', 'Sh daily']
const W = [22, 7, 10, 7, 11, 10, 8, 8, 9, 6, 9, 9, 9]
const line = (cells: string[]) => console.log(cells.map((c, i) => (i ? lpad(c, W[i]) : pad(c, W[i]))).join(' '))
const row = (label: string, s: Summary) =>
  line([label, String(s.trades), `${s.longTrades}/${s.shortTrades}`, pc(s.hitRate), f(s.avgRGross), f(s.expectancyR), f(s.avgCostR), f(s.avgFundingR), f(s.totalR, 1), f(s.profitFactor, 2), f(s.maxDrawdownR, 1), f(s.sharpeTrade), f(s.sharpeDaily, 2)])
const calLine = (name: string, c: Calibration) =>
  console.log(`  ${pad(name, 12)} Brier ${f(c.brier, 4)} (base-rate ref ${f(c.brierRef, 4)}, skill ${f(c.skill * 100, 2)}%) · log loss ${f(c.logLoss, 4)} · win base rate ${pc(c.baseRate)} · n ${c.n}`)
const bins = (c: Calibration) => {
  console.log('  reliability:  p bin      n     mean p   actual')
  for (const b of c.bins) console.log(`                ${b.lo.toFixed(1)}-${b.hi.toFixed(1)} ${lpad(String(b.n), 7)}  ${lpad(pc(b.meanP), 7)}  ${lpad(pc(b.winRate), 7)}`)
}

function modelTable(m: ModelEval) {
  line(HEAD)
  for (const s of data) row(`${m.name} ${s.symbol}`, summarize(m.trades.filter((t) => t.symbol === s.symbol)))
  row(`${m.name} ALL`, summarize(m.trades))
}

const foldJson = (m: ModelEval) => m.folds.map((x) => ({ ...x }))
const evalJson = (m: ModelEval) => ({
  name: m.name,
  overall: summarize(m.trades),
  perSymbol: Object.fromEntries(data.map((s) => [s.symbol, summarize(m.trades.filter((t) => t.symbol === s.symbol))])),
  calibration: calibration(m.calib),
  freeBars: m.free,
  folds: foldJson(m),
  trades: m.trades,
})

function printFolds(m: ModelEval) {
  console.log(`\nper fold (${m.name}):`)
  console.log('  symbol    fold  test from          fitted  trades  exp R net  total R   Brier')
  for (const x of m.folds)
    console.log(`  ${pad(x.symbol, 9)} ${lpad(String(x.k), 4)}  ${d(x.testFrom)}  ${pad(x.fitted ? 'yes' : 'NO', 6)} ${lpad(String(x.summary.trades), 6)}  ${lpad(f(x.summary.expectancyR), 9)}  ${lpad(f(x.summary.totalR, 1), 7)}  ${x.brier == null ? '-' : f(x.brier, 4)}`)
}

const t0 = Date.now()
const outFile = resolve(str('out', join(ROOT, '.cache', 'eval-results', `${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)))
const meta = { mode, generatedAt: new Date().toISOString(), argv: process.argv.slice(2), symbols, interval, source, funding: withFunding, start, end, config: cfg, data: dataInfo }

if (mode === 'eval') {
  const name = str('model', 'mlp')
  console.log(`\nwalk-forward: ${name} · bracket ${cfg.wf.bracket.slAtr}/${cfg.wf.bracket.tpAtr} ATR, ${cfg.wf.bracket.horizon} bars · train ${cfg.wf.trainBars} / test ${cfg.wf.testBars} bars · purge ${cfg.wf.bracket.horizon} + embargo ${cfg.embargoBars} bars`)
  const m = walkForwardEval(name, factory(name), data, cfg)
  const ref = name === 'base-rate' ? null : walkForwardEval('base-rate', factory('base-rate'), data, cfg)
  const base = baselines(m, cfg)
  const fitted = m.folds.filter((x) => x.fitted).length
  console.log(`${fitted}/${m.folds.length} folds fitted · ${m.free} free bars the rules allowed · ${Math.round((Date.now() - t0) / 1000)}s\n`)
  modelTable(m)
  if (ref) row('base-rate ALL', summarize(ref.trades))
  row('momentum ALL', base.momentum)
  row('no-trade', base.noTrade)
  const r = base.random
  console.log(
    `random (${r.runs} runs, entry p ${f(r.entryProb, 4)}): ${f(r.meanTrades, 0)} trades, exp ${f(r.meanExpectancyR)}R net [5–95%: ${f(r.p05)} … ${f(r.p95)}], total ${f(r.meanTotalR, 1)}R · ${pc(r.shareBeatingModel)} of runs ≥ the model`,
  )
  console.log('\ncalibration (every test bar, both sides; win = R > 0 before costs):')
  const cal = calibration(m.calib)
  calLine(name, cal)
  if (ref) calLine('base-rate', calibration(ref.calib))
  bins(cal)
  if (o.folds) printFolds(m)
  const s = summarize(m.trades)
  console.log(
    `\nverdict: ${s.trades ? (s.expectancyR > 0 ? `positive expectancy ${f(s.expectancyR)}R/trade after costs over ${s.trades} trades` : `NO edge after costs: ${f(s.expectancyR)}R/trade over ${s.trades} trades`) : 'no trades taken'}` +
      `; Brier skill vs base rate ${f(cal.skill * 100, 2)}%`,
  )
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, JSON.stringify({ ...meta, model: evalJson(m), reference: ref ? evalJson(ref) : null, baselines: base }, null, 1))
} else {
  const a = str('champion', str('a', 'mlp'))
  const b = str('challenger', str('b', 'base-rate'))
  console.log(`\ncompare (walk-forward, same folds and rules): champion ${a} vs challenger ${b}`)
  const res = compareModels({ name: a, factory: factory(a) }, { name: b, factory: factory(b) }, data, cfg, { nBoot: num('boot', 2000) })
  console.log(`${Math.round((Date.now() - t0) / 1000)}s\n`)
  modelTable(res.evals.champion)
  modelTable(res.evals.challenger)
  console.log('')
  calLine(a, res.champion.calibration)
  calLine(b, res.challenger.calibration)
  const x = res.diff
  console.log(
    `\nchallenger − champion: ${f(x.expectancyDiff)}R/trade, 95% CI [${f(x.ci[0])}, ${f(x.ci[1])}], P(better) ${pc(x.pBetter)} · total ${f(x.totalRDiff, 1)}R [${f(x.totalRci[0], 1)}, ${f(x.totalRci[1], 1)}] · ${x.blocks} day blocks, ${x.nBoot} resamples`,
  )
  console.log(`verdict: ${res.promote ? 'PROMOTE challenger' : 'keep champion'} — ${res.reason}`)
  if (o.folds) {
    printFolds(res.evals.champion)
    printFolds(res.evals.challenger)
  }
  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(
    outFile,
    JSON.stringify({ ...meta, champion: evalJson(res.evals.champion), challenger: evalJson(res.evals.challenger), diff: res.diff, promote: res.promote, reason: res.reason }, null, 1),
  )
}
console.log(`\nresults: ${outFile}`)
