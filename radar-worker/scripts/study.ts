// npm run study — F1 confirmation filters and exit experiments (research,
// 2026-11-11 audit). Report only: nothing in the bot changes.
//
//   node scripts/study.ts [--publish] [--refresh]
//
// 1. Filters on F1's own entries, over the half-years where C6's walk-forward
//    model exists: F1 alone, F1 + C6, F1 + BTC above its EMA(300) (X1's rule),
//    F1 + both. Rejected entries keep their hypothetical outcome.
// 2. Exits: every F1 entry replayed under the current exit (A) and the
//    trailing / break-even / partial / trend variants (src/research/study.ts),
//    compared trade by trade with A, clustered by entry day.
// 3. Live paper results per strategy since go-live, clustered by decision
//    candle and day, and the real trades' best point vs result (with DATABASE_URL).
// 4. Every rule strategy by the 7-class market regime (src/context/market.ts,
//    rebuilt bar by bar from BTC's 4h and 1h history, past data only).
// 5. BTC correlation per coin over its whole history: rolling 180-bar (about
//    30 days) windows of 4h returns, every 30 bars: how strong, how stable,
//    downside beta, and how often a coin moved on its own.
//
// Costs: conservative (0.10% per market leg) plus each market's real funding.
// "Design" = before Feb 2026, "Holdout" = Feb 2026 on (C6 was designed after
// that holdout had been seen, so its holdout is not independent evidence).
// Writes .scratch/audit/study.json and docs/research/study-<date>.md;
// --publish stores bot_state 'study:latest' for the website.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Bar } from '../src/bot/features.ts'
import { F1, trendIndicators } from '../src/bot/strategy.ts'
import { F1_STRATEGY, STRATEGIES } from '../src/bot/strategies.ts'
import type { RuleStrategy } from '../src/bot/strategies.ts'
import { closedBars } from '../src/bot/data.ts'
import { REGIMES, correlation, regimeSeries } from '../src/context/market.ts'
import { c6Rows, fundingR } from '../src/bot/c6.ts'
import { btcAbove } from '../src/bot/experimental.ts'
import { connect } from '../src/db.ts'
import { BotStore } from '../src/bot/store.ts'
import { PROFILES, breakdown, btcRegimes, netR, summarize } from '../src/research/audit.ts'
import type { AuditTrade, Summary } from '../src/research/audit.ts'
import { EXIT_VARIANTS, compareFilter, ema, exitNetR, giveback, paired, simulateExit } from '../src/research/study.ts'
import type { FilterReport, Giveback } from '../src/research/study.ts'
import { CACHE, MODERATE, ROOT, STEP, SYMBOLS, args, c6Verdicts, cached, load, log, ruleTrades, sortFund } from './research-data.ts'

const HOLDOUT_FROM = Date.UTC(2026, 1, 1)
const LIVE_FROM = Date.UTC(2026, 10, 1)
const CONS = PROFILES[1]

const period = (t: number) => (t < HOLDOUT_FROM ? 'design' : 'holdout')

interface FilterVariant {
  id: string
  label: string
  all: FilterReport
  design: FilterReport
  holdout: FilterReport
  regimes: Record<string, Summary>
}

interface ExitReport {
  id: string
  kind: string
  n: number
  all: Summary
  design: Summary
  holdout: Summary
  /** Per trade vs A (net R), clustered by entry day. */
  vsA: (Summary & { better: boolean; worse: boolean }) | null
  vsADesign: (Summary & { better: boolean; worse: boolean }) | null
  vsAHoldout: (Summary & { better: boolean; worse: boolean }) | null
  giveback: Giveback
  exits: Record<string, number>
  regimes: Record<string, Summary>
}

function filters(f1: AuditTrade[], c6: Map<string, boolean>, btc: Bar[]): { variants: FilterVariant[]; covered: number; from: number | null } {
  const key = (t: AuditTrade) => t.symbol + ':' + t.t
  const set = f1.filter((t) => c6.has(key(t)))
  const rows = set.map((t) => ({ t: t.t, r: netR(t, CONS), regime: t.regime, c6: c6.get(key(t)) === true, btc: btcAbove(btc, t.t - STEP) === true }))
  const defs: Array<[string, string, (x: (typeof rows)[number]) => boolean]> = [
    ['f1', 'F1 alone', () => true],
    ['f1+c6', 'F1 + C6 model', (x) => x.c6],
    ['f1+btc', 'F1 + BTC above EMA(300)', (x) => x.btc],
    ['f1+c6+btc', 'F1 + C6 + BTC', (x) => x.c6 && x.btc],
  ]
  const variants = defs.map(([id, label, keep]) => {
    const rs = rows.map((x) => ({ t: x.t, r: x.r, keep: keep(x) }))
    return {
      id,
      label,
      all: compareFilter(rs),
      design: compareFilter(rs.filter((x) => period(x.t) === 'design')),
      holdout: compareFilter(rs.filter((x) => period(x.t) === 'holdout')),
      regimes: breakdown(rows.filter(keep), (x) => x.regime, (x) => x.r),
    }
  })
  return { variants, covered: set.length, from: set.length ? Math.min(...set.map((t) => t.t)) : null }
}

function exitsStudy(f1: AuditTrade[], bars: Record<string, Bar[]>, fund: Record<string, ReturnType<typeof sortFund>>): ExitReport[] {
  const index = new Map<string, Map<number, number>>()
  const inds = new Map<string, ReturnType<typeof trendIndicators>>()
  const emas = new Map<string, number[]>()
  for (const s of SYMBOLS) {
    index.set(s, new Map(bars[s].map((b, k) => [b.t, k])))
    inds.set(s, trendIndicators(bars[s]))
  }
  type Row = { t: number; regime: string; net: number; gross: number; mfe: number; why: string }
  const per: Record<string, Array<Row | null>> = Object.fromEntries(EXIT_VARIANTS.map((v) => [v.id, []]))
  for (const t of f1) {
    const b = bars[t.symbol]
    const i = index.get(t.symbol)!.get(t.t - STEP)
    if (i === undefined) continue
    for (const v of EXIT_VARIANTS) {
      let e: number[] | undefined
      if (v.kind === 'trend') {
        const k = t.symbol + ':' + v.emaLen
        e = emas.get(k)
        if (!e) emas.set(k, (e = ema(b, v.emaLen)))
      }
      const x = simulateExit(b, inds.get(t.symbol)!, i, t.entry, t.dist, v, e)
      if (!x) {
        per[v.id].push(null)
        continue
      }
      const tExit = x.why === 'signal' ? (b[x.exitBar + 1]?.t ?? b[x.exitBar].t + STEP) : b[x.exitBar].t + STEP
      const net = exitNetR(x, t.entry, t.dist, CONS.leg, fundingR(fund[t.symbol], t.t, tExit, t.entry, t.dist) * CONS.fundingX)
      per[v.id].push({ t: t.t, regime: t.regime, net, gross: x.grossR, mfe: x.mfeR, why: x.why })
    }
  }
  // Only entries every variant closed: the comparison is like for like.
  const n = per.A.length
  const ok = Array.from({ length: n }, (_, k) => EXIT_VARIANTS.every((v) => per[v.id][k] != null))
  const rows = (id: string) => per[id].filter((_, k) => ok[k]) as Row[]
  const base = rows('A')
  return EXIT_VARIANTS.map((v) => {
    const rs = rows(v.id)
    const pr = (f: (x: Row) => boolean) => {
      const idx = rs.map((x, k) => (f(x) ? k : -1)).filter((k) => k >= 0)
      return paired(idx.map((k) => ({ t: base[k].t, r: base[k].net })), idx.map((k) => ({ t: rs[k].t, r: rs[k].net })))
    }
    const exits: Record<string, number> = {}
    for (const x of rs) exits[x.why] = (exits[x.why] ?? 0) + 1
    return {
      id: v.id,
      kind: v.kind,
      n: rs.length,
      all: summarize(rs.map((x) => ({ t: x.t, r: x.net }))),
      design: summarize(rs.filter((x) => period(x.t) === 'design').map((x) => ({ t: x.t, r: x.net }))),
      holdout: summarize(rs.filter((x) => period(x.t) === 'holdout').map((x) => ({ t: x.t, r: x.net }))),
      vsA: v.id === 'A' ? null : pr(() => true),
      vsADesign: v.id === 'A' ? null : pr((x) => period(x.t) === 'design'),
      vsAHoldout: v.id === 'A' ? null : pr((x) => period(x.t) === 'holdout'),
      giveback: giveback(rs.map((x) => ({ mfeR: x.mfe, grossR: x.gross, netR: x.net }))),
      exits,
      regimes: breakdown(rs, (x) => x.regime, (x) => x.net),
    }
  })
}

interface LiveRow {
  strategy: string
  n: number
  candles: number
  days: number
  byCandle: Summary
  byTrade: Summary
}

/** Paper and real results since go-live, per strategy: by trade (days clustered) and one mean per decision candle. */
async function live(): Promise<{ strategies: LiveRow[]; real: Array<Record<string, unknown>> } | null> {
  const url = process.env.DATABASE_URL
  if (!url) return null
  const db = connect(url)
  try {
    const q = await db.query<{ strategy: string; t: string; r: string }>(
      `select coalesce(strategy, 'ml') strategy, extract(epoch from bar_time) * 1000 t, r_net r from bot_shadow_trades where status = 'closed' and bar_time >= $1 and r_net is not null
       union all select coalesce(strategy, 'f1'), extract(epoch from bar_time) * 1000, r_multiple from bot_trades where status = 'closed' and bar_time >= $1 and mode = 'trend'`,
      [new Date(LIVE_FROM).toISOString()],
    )
    const by = new Map<string, Array<{ t: number; r: number }>>()
    for (const x of q.rows) {
      const a = by.get(x.strategy) ?? []
      a.push({ t: Math.round(Number(x.t)), r: Number(x.r) })
      by.set(x.strategy, a)
    }
    const strategies = [...by].map(([strategy, xs]) => {
      const candle = new Map<number, number[]>()
      for (const x of xs) candle.set(x.t, [...(candle.get(x.t) ?? []), x.r])
      const byCandle = summarize([...candle].map(([t, rs]) => ({ t, r: rs.reduce((a, r) => a + r, 0) / rs.length })))
      return { strategy, n: xs.length, candles: candle.size, days: new Set(xs.map((x) => Math.floor(x.t / 86_400_000))).size, byCandle, byTrade: summarize(xs) }
    })
    const real = (
      await db.query(
        `select id, symbol, coalesce(strategy, mode) strategy, side, opened_at, closed_at, exit_reason, round(mfe_r::numeric, 2) mfe_r, round(mae_r::numeric, 2) mae_r, round(r_multiple::numeric, 2) r, round(pnl_usd::numeric, 2) pnl_usd
         from bot_trades where status = 'closed' and mfe_r is not null order by closed_at desc limit 40`,
      )
    ).rows
    return { strategies: strategies.sort((a, b) => a.strategy.localeCompare(b.strategy)), real }
  } finally {
    await db.end()
  }
}

const r3 = (x: number | null | undefined) => (x == null ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(3))
const line = (s: Summary) => `${r3(s.mean)}R (n ${s.n}, ≈${s.eff} indep., 95% ${r3(s.lo)} to ${r3(s.hi)}, win ${(s.win * 100).toFixed(0)}%, PF ${s.pf?.toFixed(2) ?? 'n/a'}, max DD ${s.maxDdR.toFixed(1)}R)`
const d10 = (t: number | null) => (t == null ? 'n/a' : new Date(t).toISOString().slice(0, 10))

function md(rep: Awaited<ReturnType<typeof run>>): string {
  const o: string[] = []
  o.push(`# Strategy study — ${d10(rep.generatedAt)}`, '')
  o.push(`Generated by \`radar-worker/scripts/study.ts\` on ${SYMBOLS.length} markets, 4h bars ${d10(rep.data.from)} → ${d10(rep.data.to)}. Report only: nothing in the bot was changed.`, '')
  o.push('Costs: conservative (fee + slippage 0.10% per market leg) plus each market’s real funding. Ranges are cluster-robust (entry day, week or 30 days, whichever is widest). “Design” is before Feb 2026, “holdout” from Feb 2026. **Survivorship**: the 24 markets were picked in 2026, which flatters long-only strategies.', '')
  o.push('## 1. F1 confirmation filters', '')
  o.push(`F1 entries with a C6 verdict (C6’s walk-forward model exists from ${d10(rep.filters.from)}): ${rep.filters.covered}. C6 was designed after the holdout had been seen, and X1’s BTC rule came from the audit of this same history: **neither holdout is independent evidence**. Only paper trades from go-live are.`, '')
  o.push('| Variant | Taken | Mean (taken) | Rejected | Mean (rejected) | False positives | Missed winners | Helps? |', '|---|---|---|---|---|---|---|---|')
  for (const v of rep.filters.variants) {
    o.push(`| ${v.label} | ${v.all.taken.n} | ${r3(v.all.taken.mean)} | ${v.all.rejected.n} | ${r3(v.all.rejected.mean)} | ${v.all.falsePositives} | ${v.all.missed} | ${v.id === 'f1' ? '—' : v.all.helps ? '**yes**' : 'not proven'} |`)
  }
  o.push('')
  for (const v of rep.filters.variants) {
    o.push(`### ${v.label}`, '')
    o.push(`- Taken, whole history: ${line(v.all.taken)}`)
    if (v.id !== 'f1') o.push(`- Rejected (hypothetical): ${line(v.all.rejected)}`)
    o.push(`- Design: ${line(v.design.taken)}`)
    o.push(`- Holdout: ${line(v.holdout.taken)}${v.id !== 'f1' ? `; rejected there ${r3(v.holdout.rejected.mean)} (n ${v.holdout.rejected.n})` : ''}`)
    o.push('', '| BTC regime | Trades | Mean | 95% range |', '|---|---|---|---|')
    for (const [k, s] of Object.entries(v.regimes)) o.push(`| ${k} | ${s.n} | ${r3(s.mean)} | ${r3(s.lo)} to ${r3(s.hi)} |`)
    o.push('')
  }
  o.push('## 2. Exit experiments on F1 entries', '')
  o.push('Each F1 entry replayed with every exit; only entries every variant has closed are compared. “vs A” is the per-trade difference from the current exit, clustered by entry day: **better/worse only when its 95% range clears zero** in the whole history. A variant counts as an improvement only if it is better overall *and* not worse in the design or the holdout period.', '')
  o.push('| Exit | Trades | Mean | vs A (whole) | vs A design | vs A holdout | Avg best point | Avg given back | Reached 1R then lost |', '|---|---|---|---|---|---|---|---|---|')
  for (const x of rep.exits) {
    const vs = (s: ExitReport['vsA']) => (s ? `${r3(s.mean)} (${r3(s.lo)}…${r3(s.hi)})${s.better ? ' ✓' : s.worse ? ' ✗' : ''}` : '—')
    o.push(`| ${x.id} | ${x.n} | ${r3(x.all.mean)} | ${vs(x.vsA)} | ${vs(x.vsADesign)} | ${vs(x.vsAHoldout)} | ${x.giveback.avgMfeR.toFixed(2)}R | ${x.giveback.avgGivebackR.toFixed(2)}R | ${x.giveback.reached1RLost} of ${x.giveback.reached1R} |`)
  }
  o.push('', 'Variants: A = F1 as it trades (3 ATR stop, 4 ATR trail, exit on close ≤ EMA 300 or < 10-bar low); B-trailN = trail N ATR; C-beN = stop to entry once N R up; D-partN = half sold at +N R; E-emaN = exit on a close under EMA N instead of F1’s rule.', '')
  for (const x of rep.exits) {
    o.push(`- **${x.id}**: ${line(x.all)}; exits ${Object.entries(x.exits).map(([k, v]) => `${k} ${v}`).join(', ')}; regimes ${Object.entries(x.regimes).map(([k, s]) => `${k} ${r3(s.mean)} (n ${s.n})`).join(', ')}`)
  }
  o.push('')
  if (rep.live) {
    o.push('## 3. Live paper and demo results since go-live (Nov 2026)', '')
    o.push('“By candle” averages all trades decided on the same 4h candle into one number first: one market-wide move counts once.', '')
    o.push('| Strategy | Trades | Candles | Days | Mean per trade | Mean per candle (95%) |', '|---|---|---|---|---|---|')
    for (const s of rep.live.strategies) o.push(`| ${s.strategy} | ${s.n} | ${s.candles} | ${s.days} | ${r3(s.byTrade.mean)} | ${r3(s.byCandle.mean)} (${r3(s.byCandle.lo)} to ${r3(s.byCandle.hi)}) |`)
    o.push('', '### Real demo trades: best point vs result', '', '| # | Market | Strategy | Exit | Best (MFE) | Worst (MAE) | Result | Given back |', '|---|---|---|---|---|---|---|---|')
    for (const t of rep.live.real) {
      const mfe = Number(t.mfe_r)
      const r = Number(t.r)
      o.push(`| ${t.id} | ${t.symbol} | ${t.strategy} | ${t.exit_reason} | ${mfe.toFixed(2)}R | ${Number(t.mae_r).toFixed(2)}R | ${r.toFixed(2)}R | ${Math.max(0, mfe - r).toFixed(2)}R |`)
    }
    o.push('')
  }
  o.push('## 4. Strategies by market regime (7 classes)', '')
  o.push('Regime at the signal bar, rebuilt from BTC’s 4h bars (1h to confirm) with the live rules of `src/context/market.ts`, past data only. Mean net R per trade (conservative); cells with fewer than 30 trades are in brackets: too few to read.', '')
  o.push('Share of 4h bars since 2019: ' + REGIMES.map((r) => `${r} ${(rep.regimes.share[r] * 100).toFixed(0)}%`).join(', '), '')
  o.push('| Strategy | ' + REGIMES.join(' | ') + ' |', '|---|' + REGIMES.map(() => '---').join('|') + '|')
  for (const s of rep.regimes.strategies) {
    const cell = (r: string) => {
      const x = s.regimes[r]
      if (!x) return '—'
      const v = `${r3(x.mean)} (n ${x.n})`
      return x.n < 30 ? `[${v}]` : x.lo != null && x.lo > 0 ? `**${v}**` : x.hi != null && x.hi < 0 ? `_${v}_` : v
    }
    o.push(`| ${s.id.toUpperCase()} | ` + REGIMES.map(cell).join(' | ') + ' |')
  }
  o.push('', 'Bold: the 95% range is above zero in that regime; italic: below zero. A strategy is never switched off by this table alone.', '')
  o.push('## 5. BTC correlation, measured per coin', '')
  o.push('Rolling 180 × 4h-bar windows (about 30 days) every 30 bars over each coin’s whole history. Correlation of log returns; beta = % move per 1% BTC move; downside beta = the same on BTC’s falling bars only; “changed” = significantly different from the window before (99%); “own move” = the last 6 bars’ return not explained by beta × BTC, beyond 2.58 of its own spread.', '')
  o.push('| Coin | Windows | Median r | 10–90% range | Strong (≥ 0.7) | Changed | Own move | Beta | Downside beta | Latest r / trend |', '|---|---|---|---|---|---|---|---|---|---|')
  const pc = (x: number) => `${(x * 100).toFixed(0)}%`
  const f2 = (x: number | null) => (x == null ? 'n/a' : x.toFixed(2))
  for (const c of rep.correlation) {
    o.push(`| ${c.symbol} | ${c.windows} | ${f2(c.median)} | ${f2(c.p10)}–${f2(c.p90)} | ${pc(c.strongShare)} | ${pc(c.changedShare)} | ${pc(c.decoupledShare)} | ${f2(c.beta)} | ${f2(c.downBeta)} | ${f2(c.latest?.r ?? null)} ${c.latest?.trend ?? ''}${c.latest?.decoupled ? ' · own move' : ''} |`)
  }
  o.push('')
  return o.join('\n')
}

interface RegimeReport {
  /** Share of 4h bars in each regime since 2019. */
  share: Record<string, number>
  strategies: Array<{ id: string; regimes: Record<string, Summary> }>
}

/** Rule strategies (and C6 = F1 filtered) by the 7-class regime at the signal bar. */
function regimes(trades: Record<string, AuditTrade[]>, reg: Map<number, string>, from: number): RegimeReport {
  const bars = [...reg].filter(([t]) => t >= from)
  const share: Record<string, number> = {}
  for (const r of REGIMES) share[r] = bars.filter(([, x]) => x === r).length / (bars.length || 1)
  const strategies = Object.entries(trades).map(([id, ts]) => ({
    id,
    regimes: breakdown(ts, (x) => reg.get(x.t - STEP) ?? 'uncertain', (x) => netR(x, CONS)),
  }))
  return { share, strategies }
}

interface CorrHistory {
  symbol: string
  windows: number
  median: number | null
  p10: number | null
  p90: number | null
  /** Share of windows with r >= 0.7. */
  strongShare: number
  /** Share of windows whose correlation changed significantly from the window before. */
  changedShare: number
  /** Share of windows ending in a 6-bar move of its own (|residual z| >= 2.58). */
  decoupledShare: number
  beta: number | null
  downBeta: number | null
  latest: { r: number | null; beta: number | null; downBeta: number | null; trend: string | null; decoupled: boolean } | null
}

/** Rolling 180-bar correlation with BTC every 30 bars over a coin's history. */
function corrHistory(btc: Bar[], bars: Record<string, Bar[]>): CorrHistory[] {
  const W = 180
  const q = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))] : null)
  const btcAt = new Map(btc.map((x, k) => [x.t, k]))
  return SYMBOLS.filter((s) => s !== 'BTCUSDT').map((symbol) => {
    const b = bars[symbol]
    const rs: number[] = []
    const betas: number[] = []
    const downs: number[] = []
    let changed = 0
    let decoupled = 0
    let latest: CorrHistory['latest'] = null
    for (let end = 2 * W + 1; end <= b.length; end += 30) {
      const win = b.slice(end - 2 * W - 1, end)
      const k0 = btcAt.get(win[0].t)
      const k1 = btcAt.get(win[win.length - 1].t)
      if (k0 == null || k1 == null) continue
      const c = correlation(btc.slice(k0, k1 + 1), win, W)
      if (c.r == null) continue
      rs.push(c.r)
      if (c.beta != null) betas.push(c.beta)
      if (c.downBeta != null) downs.push(c.downBeta)
      if (c.changed) changed++
      if (c.decoupled) decoupled++
      latest = { r: c.r, beta: c.beta, downBeta: c.downBeta, trend: c.trend, decoupled: c.decoupled }
    }
    const n = rs.length
    return {
      symbol,
      windows: n,
      median: q(rs, 0.5),
      p10: q(rs, 0.1),
      p90: q(rs, 0.9),
      strongShare: n ? rs.filter((r) => r >= 0.7).length / n : 0,
      changedShare: n ? changed / n : 0,
      decoupledShare: n ? decoupled / n : 0,
      beta: q(betas, 0.5),
      downBeta: q(downs, 0.5),
      latest,
    }
  })
}

async function run() {
  const { bars, fund } = await load()
  for (const s of SYMBOLS) fund[s] = sortFund(fund[s])
  const btc = bars.BTCUSDT
  const reg = btcRegimes(btc)
  const f1 = SYMBOLS.flatMap((sym) => ruleTrades('f1', F1_STRATEGY, sym, bars[sym], btc, fund[sym], reg))
  log('f1', f1.length, 'trades')
  const rows = SYMBOLS.flatMap((sym) => c6Rows(sym, bars[sym], fund[sym], sym === 'BTCUSDT' ? undefined : btc, MODERATE, STEP))
  const c6 = c6Verdicts(f1, rows)
  log('c6 verdicts', c6.size)
  const fl = filters(f1, c6, btc)
  log('filters done')
  const ex = exitsStudy(f1, bars, fund)
  log('exits done')
  const lv = await live().catch((e) => (log('live results skipped:', (e as Error).message), null))
  const btc1h = await cached('bars-BTCUSDT-1h', () => closedBars('BTCUSDT', '1h', 80_000))
  const reg7 = regimeSeries(btc, btc1h)
  const rule: Record<string, AuditTrade[]> = { f1 }
  for (const id of ['f1x', 'c2', 'x1', 'x2']) rule[id] = SYMBOLS.flatMap((sym) => ruleTrades(id, STRATEGIES[id] as RuleStrategy, sym, bars[sym], btc, fund[sym], reg))
  rule.c6 = f1.filter((t) => c6.get(t.symbol + ':' + t.t) === true)
  const rg = regimes(rule, reg7, Date.UTC(2019, 0, 1))
  log('regimes done')
  const ch = corrHistory(btc, bars)
  log('correlation history done')
  const ends = Object.values(bars).filter((b) => b.length)
  return {
    v: 1,
    generatedAt: Date.now(),
    data: { markets: SYMBOLS.length, from: Math.min(...ends.map((b) => b[0].t)), to: Math.max(...ends.map((b) => b[b.length - 1].t)) },
    costs: 'conservative',
    holdoutFrom: HOLDOUT_FROM,
    f1Params: F1,
    filters: fl,
    exits: ex,
    live: lv,
    regimes: rg,
    correlation: ch,
  }
}

const rep = await run()
mkdirSync(CACHE, { recursive: true })
writeFileSync(resolve(CACHE, 'study.json'), JSON.stringify(rep, null, 1))
const docs = resolve(ROOT, '../docs/research')
mkdirSync(docs, { recursive: true })
const file = resolve(docs, `study-${new Date().toISOString().slice(0, 10)}.md`)
writeFileSync(file, md(rep))
log('wrote', file)
for (const v of rep.filters.variants) log(v.id.padEnd(10), 'taken', v.all.taken.n, r3(v.all.taken.mean), 'rejected', v.all.rejected.n, r3(v.all.rejected.mean), v.all.helps ? 'HELPS' : '')
for (const x of rep.exits) log(x.id.padEnd(10), 'n', x.n, 'mean', r3(x.all.mean), 'vsA', x.vsA ? `${r3(x.vsA.mean)} [${r3(x.vsA.lo)}, ${r3(x.vsA.hi)}]` : '')
if (args.has('--publish')) {
  if (!process.env.DATABASE_URL) throw new Error('--publish needs DATABASE_URL')
  const db = connect(process.env.DATABASE_URL)
  // The website reads a compact copy: no per-trade rows beyond the real trades.
  await new BotStore(db).setState('study:latest', rep)
  await db.end()
  log('published bot_state study:latest')
}
