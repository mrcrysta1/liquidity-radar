// npm run audit — the strategy audit (research plan P2). Re-runs every
// strategy the bot has (F1, F1X, C2, C6 and the model) with the bot's own code
// over each market's whole 4h history, re-prices every trade under moderate,
// conservative and stress costs with real funding, and judges each one by the
// fixed rules in src/research/audit.ts. Nothing about the bot changes: the
// report only says keep / watch / retire and why.
//
//   node scripts/audit.ts [--no-ml] [--publish] [--refresh]
//
// Data: public Binance klines and funding (cached in .scratch/audit for a day).
// --publish stores the report in bot_state 'audit:latest' for the website
// (needs DATABASE_URL); with DATABASE_URL it also compares the bot's recorded
// entries since 2026-11-01 with the backtest's on the same bars.
// Writes .scratch/audit/report.json and docs/research/strategy-audit-<date>.md.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Bar } from '../src/bot/features.ts'
import { costR, indicators, outcomeAt } from '../src/bot/features.ts'
import { closedBars, fundingRates, INTERVAL_MS } from '../src/bot/data.ts'
import type { Funding } from '../src/bot/data.ts'
import { F1, trendBacktest } from '../src/bot/strategy.ts'
import { STRATEGIES, ruleBacktest } from '../src/bot/strategies.ts'
import type { RuleStrategy } from '../src/bot/strategies.ts'
import { c6Rows, c6Verdict, fitC6, fundingR } from '../src/bot/c6.ts'
import type { C6Row } from '../src/bot/c6.ts'
import { DEFAULT_WF, walkForward } from '../src/bot/walkforward.ts'
import { connect } from '../src/db.ts'
import { BotStore } from '../src/bot/store.ts'
import { PROFILES, VERDICT_RULES, breakdown, btcRegimes, netR, regimeAt, summarize, verdict } from '../src/research/audit.ts'
import type { AuditTrade, Summary } from '../src/research/audit.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = resolve(ROOT, '.scratch/audit')
const args = new Set(process.argv.slice(2))
if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'))
const STEP = INTERVAL_MS['4h']
const SYMBOLS = 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,AAVEUSDT,ADAUSDT,ARBUSDT,AVAXUSDT,BCHUSDT,DOTUSDT,ETCUSDT,INJUSDT,NEARUSDT,UNIUSDT,APTUSDT,ATOMUSDT,DOGEUSDT,FILUSDT,LINKUSDT,LTCUSDT,OPUSDT,SUIUSDT,TRXUSDT,XRPUSDT'.split(',')
/** The bot's model bracket and EV bar (.github/workflows/trading-bot.yml). */
const ML_WF = { ...DEFAULT_WF, bracket: { slAtr: 1.5, tpAtr: 2.25, horizon: 12 }, minEvR: 0.1 }
const MODERATE = { taker: 0.0005, maker: 0.0002, slip: 0.0002, tpMaker: true }

/**
 * Where each strategy's design data ends. F1's holdout (Feb 2026 on) was
 * sealed while it was built; C6, F1X and C2 (research rounds 2–3) and the
 * model's bracket sweep (2026-10-28) came after that holdout had been seen, so
 * no period of theirs is untouched: their holdout is reported but flagged.
 */
const HOLDOUT_FROM = Date.UTC(2026, 1, 1)
const SEEN_HOLDOUT: Record<string, boolean> = { f1: false, f1x: true, c2: true, c6: true, ml: true, x1: true, x2: true }
const LIVE_FROM = Date.UTC(2026, 10, 1)

async function cached<T>(name: string, get: () => Promise<T>): Promise<T> {
  const p = resolve(CACHE, name + '.json')
  if (!args.has('--refresh') && existsSync(p) && Date.now() - statSync(p).mtimeMs < 86_400_000) return JSON.parse(readFileSync(p, 'utf8')) as T
  const v = await get()
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(p, JSON.stringify(v))
  return v
}

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function load() {
  const bars: Record<string, Bar[]> = {}
  const fund: Record<string, Funding[]> = {}
  for (const s of SYMBOLS) {
    bars[s] = await cached(`bars-${s}-4h`, () => closedBars(s, '4h', 40_000))
    fund[s] = await cached(`funding-${s}`, () => fundingRates(s, Date.UTC(2019, 0, 1)).catch(() => []))
    log(s, bars[s].length, 'bars from', new Date(bars[s][0]?.t ?? 0).toISOString().slice(0, 10), '·', fund[s].length, 'funding rows')
  }
  return { bars, fund }
}

function sortFund(f: Funding[]) {
  return [...f].sort((a, b) => a.t - b.t)
}

/** A rule strategy on one market, as audit trades. */
function ruleTrades(id: string, s: RuleStrategy, sym: string, b: Bar[], btc: Bar[], fund: Funding[], reg: Map<number, string>): AuditTrade[] {
  return ruleBacktest(s, b, { BTCUSDT: btc }).map((x) => {
    const t = b[x.i + 1].t
    const tExit = x.why === 'signal' ? (b[x.exitBar + 1]?.t ?? b[x.exitBar].t + STEP) : b[x.exitBar].t + STEP
    return { strategy: id, symbol: sym, side: x.side, t, tExit, entry: x.entry, exit: x.exit, dist: x.dist, r: x.r, exitWhy: x.why, fundLongR: fundingR(fund, t, tExit, x.entry, x.dist), regime: regimeAt(reg, t, STEP) }
  })
}

/** Pooled conservative mean of F1-family parameter sets (sensitivity). */
function neighbourShare(bars: Record<string, Bar[]>, fund: Record<string, Funding[]>, centre: { entryLen: number; exitLen: number; slAtr: number }): { share: number; grid: Array<{ p: string; mean: number; n: number }> } {
  const grid: Array<{ p: string; mean: number; n: number }> = []
  for (const entryLen of [15, 20, 30]) {
    for (const exitLen of [5, 10, 15]) {
      for (const slAtr of [2, 3, 4]) {
        const p = { ...F1, entryLen, exitLen, slAtr }
        let sum = 0
        let n = 0
        for (const sym of SYMBOLS) {
          const b = bars[sym]
          for (const x of trendBacktest(b, p)) {
            const t = b[x.i + 1].t
            const tExit = x.why === 'signal' ? (b[x.exitBar + 1]?.t ?? b[x.exitBar].t + STEP) : b[x.exitBar].t + STEP
            const tr: AuditTrade = { strategy: 'grid', symbol: sym, side: 1, t, tExit, entry: x.entry, exit: x.exit, dist: x.dist, r: x.r, exitWhy: x.why, fundLongR: fundingR(fund[sym], t, tExit, x.entry, x.dist), regime: '' }
            sum += netR(tr, PROFILES[1])
            n++
          }
        }
        grid.push({ p: `entry ${entryLen} / exit ${exitLen} / stop ${slAtr} ATR`, mean: n ? sum / n : 0, n })
      }
    }
  }
  const self = `entry ${centre.entryLen} / exit ${centre.exitLen} / stop ${centre.slAtr} ATR`
  const others = grid.filter((g) => g.p !== self)
  return { share: others.filter((g) => g.mean > 0).length / others.length, grid }
}

/** C6: F1's trades on every market, each half-year filtered by a GBDT trained only on trades closed before it (as the bot retrains every 182 days). */
function c6Trades(f1: AuditTrade[], rows: C6Row[]): AuditTrade[] {
  const byKey = new Map(rows.map((r) => [r.sym + ':' + r.tEntry, r]))
  const out: AuditTrade[] = []
  for (let y = 2020; y <= 2026; y++) {
    for (const h of [0, 6]) {
      const from = Date.UTC(y, h, 1)
      const to = Date.UTC(y, h + 6, 1)
      const m = fitC6(rows, from)
      if (!m) continue
      for (const t of f1) {
        if (t.t < from || t.t >= to) continue
        const row = byKey.get(t.symbol + ':' + t.t)
        if (row && c6Verdict(m, row.x).take) out.push({ ...t, strategy: 'c6' })
      }
    }
  }
  return out
}

/** The model's walk-forward on one market (every fold trained on the past only), as audit trades. */
function mlTrades(sym: string, b: Bar[], fund: Funding[], reg: Map<number, string>): AuditTrade[] {
  const ind = indicators(b)
  const out: AuditTrade[] = []
  for (const w of walkForward(b, ML_WF).trades) {
    const o = outcomeAt(b, ind, w.i, w.side, ML_WF.bracket)
    if (!o) continue
    const entry = b[w.i].c
    const dist = ML_WF.bracket.slAtr * ind.atr[w.i]
    const t = b[w.i].t + STEP
    const tExit = b[o.end].t + STEP
    // Gross R from the recorded net: the walk-forward charged the bot's own (moderate) costs.
    const r = w.r + costR(entry, dist, MODERATE, o.exit)
    out.push({ strategy: 'ml', symbol: sym, side: w.side, t, tExit, entry, exit: entry + w.side * r * dist, dist, r, exitWhy: o.exit, fundLongR: fundingR(fund, t, tExit, entry, dist), regime: regimeAt(reg, t, STEP) })
  }
  return out
}

interface StrategyReport {
  id: string
  name: string
  trades: number
  markets: number
  first: number | null
  profiles: Record<string, Summary>
  dev: Summary
  holdout: Summary
  holdoutSeen: boolean
  live: Summary
  years: Record<string, Summary>
  regimes: Record<string, Summary>
  sides: Record<string, Summary>
  exits: Record<string, number>
  byMarket: Array<{ symbol: string; n: number; mean: number | null; totalR: number }>
  marketsPositive: number
  topMarketShare: number | null
  neighbours: number | null
  costPerTrade: number
  flags: string[]
  verdict: 'keep' | 'watch' | 'retire'
  why: string[]
  replication?: { matched: number; backtestOnly: number; liveOnly: number; liveOnlyEntries: string[] }
  /** For a filtered F1 (C6, X1, X2): F1's trades it skips vs keeps (conservative), and its entries F1 does not take. */
  filter?: { skipped: Summary; kept: Summary; newEntries: number; helps: boolean }
}

/** Does a filter on F1 remove worse trades? Proven only if the skipped trades' 95% range is below F1's mean. */
function filterCheck(r: StrategyReport, f1: AuditTrade[], own: AuditTrade[]): void {
  const cons = (x: AuditTrade) => ({ t: x.t, r: netR(x, PROFILES[1]) })
  const keep = new Set(own.map((x) => x.symbol + ':' + x.t))
  const base = new Set(f1.map((x) => x.symbol + ':' + x.t))
  const skipped = summarize(f1.filter((x) => !keep.has(x.symbol + ':' + x.t)).map(cons))
  const kept = summarize(f1.filter((x) => keep.has(x.symbol + ':' + x.t)).map(cons))
  const f1Mean = summarize(f1.map(cons)).mean ?? 0
  const helps = skipped.hi != null && skipped.hi < f1Mean
  r.filter = { skipped, kept, newEntries: own.filter((x) => !base.has(x.symbol + ':' + x.t)).length, helps }
  const f = (v: number | null) => (v == null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(3) + 'R')
  r.flags.push(
    helps
      ? `Filter helps: the ${skipped.n} F1 trades it skips averaged ${f(skipped.mean)} (95% up to ${f(skipped.hi)}), below F1's ${f(f1Mean)}.`
      : `Filter not proven: the ${skipped.n} F1 trades it skips averaged ${f(skipped.mean)} (95% ${f(skipped.lo)} to ${f(skipped.hi)}) — not clearly worse than F1's ${f(f1Mean)}.` +
          (r.filter.newEntries ? ` ${r.filter.newEntries} of its entries are ones F1 does not take (a skipped entry frees the market for a later one), which is where much of any difference comes from.` : ''),
  )
}

function report(id: string, name: string, ts: AuditTrade[], neighbours: number | null): StrategyReport {
  const cons = (x: AuditTrade) => netR(x, PROFILES[1])
  const pt = (xs: AuditTrade[], p = PROFILES[1]) => xs.map((x) => ({ t: x.t, r: netR(x, p) }))
  const profiles = Object.fromEntries(PROFILES.map((p) => [p.id, summarize(pt(ts, p))]))
  const dev = summarize(pt(ts.filter((x) => x.t < HOLDOUT_FROM)))
  const holdout = summarize(pt(ts.filter((x) => x.t >= HOLDOUT_FROM)))
  const live = summarize(pt(ts.filter((x) => x.t >= LIVE_FROM)))
  const years = breakdown(ts, (x) => String(new Date(x.t).getUTCFullYear()), cons)
  const regimes = breakdown(ts, (x) => x.regime, cons)
  const sides = breakdown(ts, (x) => (x.side > 0 ? 'long' : 'short'), cons)
  const mk = breakdown(ts, (x) => x.symbol, cons)
  const byMarket = Object.entries(mk).map(([symbol, s]) => ({ symbol, n: s.n, mean: s.mean, totalR: s.totalR })).sort((a, b) => b.totalR - a.totalR)
  const total = profiles.conservative.totalR
  const topMarketShare = total > 0 && byMarket.length ? byMarket[0].totalR / total : null
  const exits: Record<string, number> = {}
  for (const x of ts) exits[x.exitWhy] = (exits[x.exitWhy] ?? 0) + 1
  const v = verdict({ conservative: profiles.conservative, stress: profiles.stress, holdout, years, neighbours })
  const flags: string[] = []
  if (id === 'ml') flags.push('Tested as the walk-forward base model (MLP on the bar features, retrained every 250 bars, one trade per market at a time, EV ≥ 0.1R). The live model also learns from its shadow trades and recalibrates, which this replay does not include.')
  if (SEEN_HOLDOUT[id]) flags.push('No untouched test period: designed or tuned after the Feb 2026+ holdout had been seen. Only trades from its go-live on are truly new evidence.')
  if ((profiles.moderate.mean ?? 0) > 0 && (profiles.stress.mean ?? 0) <= 0) flags.push('Cost-sensitive: positive at moderate costs, not under stress — little room for worse fills.')
  if (topMarketShare != null && topMarketShare > 0.5) flags.push(`Concentrated: ${byMarket[0].symbol} makes ${Math.round(topMarketShare * 100)}% of the total R.`)
  const marketsPositive = byMarket.filter((m) => (m.mean ?? 0) > 0).length
  if (byMarket.length && marketsPositive / byMarket.length < 0.5) flags.push(`Only ${marketsPositive} of ${byMarket.length} markets positive.`)
  const goodRegimes = Object.entries(regimes).filter(([k, s]) => k !== 'unknown' && s.n >= 30 && (s.mean ?? 0) > 0).map(([k]) => k)
  const badRegimes = Object.entries(regimes).filter(([k, s]) => k !== 'unknown' && s.n >= 30 && (s.mean ?? 0) <= 0).map(([k]) => k)
  if (badRegimes.length) flags.push(`Loses in: ${badRegimes.join(', ')}${goodRegimes.length ? ` (earns in ${goodRegimes.join(', ')})` : ''}.`)
  const recent = ['2025', '2026'].map((y) => years[y]).filter((y): y is Summary => !!y && y.n >= 30)
  const whole = profiles.conservative.mean ?? 0
  if (whole > 0 && recent.length && recent.every((y) => (y.mean ?? 0) < whole / 2)) {
    flags.push(`Fading: ${recent.map((y, k) => `${['2025', '2026'][k]} ${(y.mean ?? 0) >= 0 ? '+' : ''}${(y.mean ?? 0).toFixed(3)}R`).join(', ')} vs ${whole >= 0 ? '+' : ''}${whole.toFixed(3)}R over the whole history — the edge may be decaying.`)
  }
  const costPerTrade = ts.length ? ts.reduce((a, x) => a + x.r - cons(x), 0) / ts.length : 0
  return {
    id,
    name,
    trades: ts.length,
    markets: new Set(ts.map((x) => x.symbol)).size,
    first: ts.length ? ts.reduce((m, x) => Math.min(m, x.t), Infinity) : null,
    profiles,
    dev,
    holdout,
    holdoutSeen: SEEN_HOLDOUT[id] ?? true,
    live,
    years,
    regimes,
    sides,
    exits,
    byMarket,
    marketsPositive,
    topMarketShare,
    neighbours,
    costPerTrade,
    flags,
    verdict: v.verdict,
    why: v.why,
  }
}

/**
 * The bot's closed entries since LIVE_FROM vs the backtest's, on the same bars
 * (implementation check). Open trades are left out on both sides (the
 * backtest drops a trade still open at the end of the data). A backtest still
 * in a position opened before LIVE_FROM skips signals the freshly started bot
 * takes, so a few "only in the bot" are expected; the entries are listed.
 */
async function replication(reports: StrategyReport[], trades: Record<string, AuditTrade[]>) {
  const url = process.env.DATABASE_URL
  if (!url) return
  const db = connect(url)
  try {
    const q = await db.query<{ strategy: string; symbol: string; t: string }>(
      `select coalesce(strategy, case when mode = 'trend' then 'f1' else 'ml' end) strategy, symbol, extract(epoch from bar_time) * 1000 t from bot_trades where bar_time >= $1 and status = 'closed'
       union all select coalesce(strategy, 'ml'), symbol, extract(epoch from bar_time) * 1000 from bot_shadow_trades where bar_time >= $1 and status = 'closed'`,
      [new Date(LIVE_FROM).toISOString()],
    )
    for (const r of reports) {
      if (r.id === 'ml') continue
      const live = new Set(q.rows.filter((x) => x.strategy === r.id).map((x) => x.symbol + ':' + Math.round(Number(x.t))))
      // The bot stores the signal bar; the backtest's t is the entry bar after it.
      const bt = new Set(trades[r.id].filter((x) => x.t - STEP >= LIVE_FROM).map((x) => x.symbol + ':' + (x.t - STEP)))
      const matched = [...bt].filter((k) => live.has(k)).length
      const liveOnly = [...live].filter((k) => !bt.has(k))
      r.replication = { matched, backtestOnly: bt.size - matched, liveOnly: liveOnly.length, liveOnlyEntries: liveOnly.map((k) => k.split(':')[0] + ' ' + new Date(Number(k.split(':')[1])).toISOString().slice(0, 16)) }
    }
  } finally {
    await db.end()
  }
}

function md(rep: { generatedAt: number; data: { markets: number; from: number; to: number }; strategies: StrategyReport[] }): string {
  const r = (x: number | null | undefined) => (x == null ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(3))
  const d = (t: number | null) => (t == null ? 'n/a' : new Date(t).toISOString().slice(0, 10))
  const line = (s: Summary) => `${r(s.mean)}R (n ${s.n}, ≈${s.eff} indep., 95% ${r(s.lo)} to ${r(s.hi)}, PF ${s.pf?.toFixed(2) ?? 'n/a'})`
  const out: string[] = []
  out.push(`# Strategy audit — ${d(rep.generatedAt)}`, '')
  out.push(`Generated by \`radar-worker/scripts/audit.ts\` on ${rep.data.markets} markets, 4h bars ${d(rep.data.from)} → ${d(rep.data.to)}. Report only: nothing in the bot was changed.`, '')
  out.push('## Verdict rules (fixed before the run)', '', ...VERDICT_RULES.map((x) => '- ' + x), '')
  out.push('**Caveat for every strategy**: the 24 markets were chosen in 2026, so they are markets that survived and stayed liquid (survivorship bias); coins that collapsed or were delisted are missing, which flatters long-only trend strategies. Ranges group trades by entry day, week or 30 days, whichever is widest.', '')
  out.push('Costs per market leg: moderate 0.07% (the bot’s own assumption), conservative 0.10%, stress 0.20% with double funding. Funding is each market’s real 8-hourly rate. Trades entered on the same day are one cluster for every range.', '')
  out.push('| Strategy | Verdict | Trades | Moderate | Conservative | Stress | Holdout (Feb 2026+) |', '|---|---|---|---|---|---|---|')
  for (const s of rep.strategies) out.push(`| ${s.id.toUpperCase()} | **${s.verdict}** | ${s.trades} | ${r(s.profiles.moderate.mean)} | ${r(s.profiles.conservative.mean)} | ${r(s.profiles.stress.mean)} | ${r(s.holdout.mean)} (n ${s.holdout.n})${s.holdoutSeen ? ' ⚠' : ''} |`)
  out.push('', '⚠ = the holdout was seen while the strategy was designed; it is not independent evidence.', '')
  for (const s of rep.strategies) {
    out.push(`## ${s.id.toUpperCase()} — ${s.name}: ${s.verdict.toUpperCase()}`, '')
    out.push(...s.why.map((x) => '- ' + x), '')
    if (s.flags.length) out.push('**Weaknesses found**', '', ...s.flags.map((x) => '- ' + x), '')
    out.push(`- Conservative, whole history: ${line(s.profiles.conservative)}; max drawdown ${s.profiles.conservative.maxDdR.toFixed(1)}R`)
    out.push(`- Design period: ${line(s.dev)}`)
    out.push(`- Holdout: ${line(s.holdout)}`)
    out.push(`- Since go-live (Nov 2026): ${line(s.live)}`)
    out.push(`- Costs + funding: ${s.costPerTrade.toFixed(3)}R per trade (conservative); exits: ${Object.entries(s.exits).map(([k, v]) => `${k} ${v}`).join(', ')}`)
    out.push(`- Markets positive: ${s.marketsPositive} of ${s.byMarket.length}; best ${s.byMarket.slice(0, 3).map((m) => `${m.symbol} ${m.totalR.toFixed(1)}R`).join(', ')}; worst ${s.byMarket.slice(-3).map((m) => `${m.symbol} ${m.totalR.toFixed(1)}R`).join(', ')}`)
    if (s.neighbours != null) out.push(`- Parameter neighbours positive: ${Math.round(s.neighbours * 100)}%`)
    if (s.filter) out.push(`- Filter check: F1 trades skipped ${line(s.filter.skipped)}; kept ${line(s.filter.kept)}; ${s.filter.newEntries} entries F1 does not take`)
    if (s.replication) {
      out.push(`- Live replication (closed trades since Nov 1): ${s.replication.matched} entries matched, ${s.replication.backtestOnly} only in the backtest, ${s.replication.liveOnly} only in the bot${s.replication.liveOnly ? ` (${s.replication.liveOnlyEntries.join(', ')}: check whether the backtest was still in a trade opened before the bot started)` : ''}`)
    }
    out.push('', '| Year | Trades | Mean (cons.) | 95% range |', '|---|---|---|---|')
    for (const [y, v] of Object.entries(s.years)) out.push(`| ${y} | ${v.n} | ${r(v.mean)} | ${r(v.lo)} to ${r(v.hi)} |`)
    out.push('', '| BTC regime | Trades | Mean (cons.) | 95% range |', '|---|---|---|---|')
    for (const [k, v] of Object.entries(s.regimes)) out.push(`| ${k} | ${v.n} | ${r(v.mean)} | ${r(v.lo)} to ${r(v.hi)} |`)
    out.push('', '| Side | Trades | Mean (cons.) |', '|---|---|---|')
    for (const [k, v] of Object.entries(s.sides)) out.push(`| ${k} | ${v.n} | ${r(v.mean)} |`)
    out.push('')
  }
  return out.join('\n')
}

async function main() {
  const { bars, fund } = await load()
  for (const s of SYMBOLS) fund[s] = sortFund(fund[s])
  const btc = bars.BTCUSDT
  const reg = btcRegimes(btc)
  const trades: Record<string, AuditTrade[]> = {}
  for (const id of ['f1', 'f1x', 'c2', 'x1', 'x2']) {
    const s = STRATEGIES[id] as RuleStrategy
    trades[id] = SYMBOLS.flatMap((sym) => ruleTrades(id, s, sym, bars[sym], btc, fund[sym], reg))
    log(id, trades[id].length, 'trades')
  }
  const rows = SYMBOLS.flatMap((sym) => c6Rows(sym, bars[sym], fund[sym], sym === 'BTCUSDT' ? undefined : btc, MODERATE, STEP))
  trades.c6 = c6Trades(trades.f1, rows)
  log('c6', trades.c6.length, 'trades of', trades.f1.length, 'F1 entries')
  if (!args.has('--no-ml')) {
    trades.ml = []
    for (const sym of SYMBOLS) {
      trades.ml.push(...mlTrades(sym, bars[sym], fund[sym], reg))
      log('ml', sym, trades.ml.length)
    }
  }
  log('parameter neighbours…')
  const nF1 = neighbourShare(bars, fund, { entryLen: 20, exitLen: 10, slAtr: 3 })
  const nF1x = neighbourShare(bars, fund, { entryLen: 20, exitLen: 15, slAtr: 3 })
  const neighbours: Record<string, number | null> = { f1: nF1.share, f1x: nF1x.share, c6: nF1.share, c2: null, ml: null, x1: null, x2: null }
  const reports = Object.keys(trades).map((id) => report(id, STRATEGIES[id]?.name ?? id, trades[id], neighbours[id]))
  for (const r of reports) if (['c6', 'x1', 'x2'].includes(r.id)) filterCheck(r, trades.f1, trades[r.id])
  await replication(reports, trades).catch((e) => log('replication skipped:', (e as Error).message))
  const ends = Object.values(bars).filter((b) => b.length)
  const rep = {
    v: 1,
    generatedAt: Date.now(),
    data: { markets: SYMBOLS.length, from: Math.min(...ends.map((b) => b[0].t)), to: Math.max(...ends.map((b) => b[b.length - 1].t)) },
    rules: VERDICT_RULES,
    profiles: PROFILES,
    holdoutFrom: HOLDOUT_FROM,
    grid: nF1.grid,
    strategies: reports,
  }
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(resolve(CACHE, 'report.json'), JSON.stringify(rep, null, 1))
  const docs = resolve(ROOT, '../docs/research')
  mkdirSync(docs, { recursive: true })
  const file = resolve(docs, `strategy-audit-${new Date().toISOString().slice(0, 10)}.md`)
  writeFileSync(file, md(rep))
  log('wrote', file)
  for (const s of reports) log(s.id.padEnd(4), s.verdict.padEnd(7), 'n', s.trades, 'cons', s.profiles.conservative.mean?.toFixed(3), 'stress', s.profiles.stress.mean?.toFixed(3), 'holdout', s.holdout.mean?.toFixed(3))
  if (args.has('--publish')) {
    if (!process.env.DATABASE_URL) throw new Error('--publish needs DATABASE_URL')
    const db = connect(process.env.DATABASE_URL)
    await new BotStore(db).setState('audit:latest', rep)
    await db.end()
    log('published bot_state audit:latest')
  }
}

await main()
