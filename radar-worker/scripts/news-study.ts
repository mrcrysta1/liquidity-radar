// npm run news-study — does the market's first reaction to a US release say
// anything about the next 24 hours? (research, 2026-11-11). Report only.
//
//   node scripts/news-study.ts [--publish]
//
// Reads econ_events + econ_reactions (needs DATABASE_URL, read-only) and
// tests the pre-registered N1 rule (src/news/n1.ts) in both modes, continue
// and fade, at |z| ≥ 1.5 / 2 / 3. The mode for the live paper record is
// chosen on the design period (2019–2024) only; 2025 on is the test. Every
// release is one cluster (BTC, ETH and gold reacting to the same release are
// one event, not three). Writes docs/research/news-study-<date>.md and
// .scratch/audit/news-study.json; --publish stores bot_state 'news:study'.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connect } from '../src/db.ts'
import { BotStore } from '../src/bot/store.ts'
import { closedBars } from '../src/bot/data.ts'
import { breakdown, summarize } from '../src/research/audit.ts'
import type { Summary } from '../src/research/audit.ts'
import { regimeSeries } from '../src/context/market.ts'
import { N1, N1_MODE, evaluateN1 } from '../src/news/n1.ts'
import type { N1Eval, N1Input, N1Mode } from '../src/news/n1.ts'
import { CACHE, ROOT, STEP, args, cached, log } from './research-data.ts'

const TEST_FROM = Date.UTC(2025, 0, 1)
const ZS = [1.5, 2, 3]

async function inputs(): Promise<N1Input[]> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('news-study needs DATABASE_URL (read-only)')
  const db = connect(url)
  try {
    const q = await db.query<{ t: string; category: string; asset: string; h: number; ret: number; z: number | null; surprise: number | null }>(
      `with ev as (
         select event_time, min(category) category, max(surprise) surprise from econ_events
         where country = 'USD' and category = any($1) and event_time >= '2019-01-01' group by event_time)
       select extract(epoch from ev.event_time) * 1000 t, ev.category, x.asset, x.horizon_min h, x.ret_pct ret, x.z, ev.surprise
       from ev join econ_reactions x on x.event_time = ev.event_time
       where x.horizon_min in (60, 1440) and x.asset = any($2)`,
      [N1.categories, N1.assets],
    )
    const m = new Map<string, N1Input>()
    for (const r of q.rows) {
      const t = Math.round(Number(r.t))
      const k = t + ':' + r.asset
      const x = m.get(k) ?? { eventTime: t, category: r.category, asset: r.asset, ret60: null, z60: null, ret1440: null, surprise: r.surprise == null ? null : Number(r.surprise) }
      if (Number(r.h) === 60) {
        x.ret60 = Number(r.ret)
        x.z60 = r.z == null ? null : Number(r.z)
      } else x.ret1440 = Number(r.ret)
      m.set(k, x)
    }
    return [...m.values()].sort((a, b) => a.eventTime - b.eventTime)
  } finally {
    await db.end()
  }
}

interface Cell {
  mode: N1Mode
  minZ: number
  design: Summary
  test: Summary
  all: Summary
}

const trades = (xs: N1Eval[]) => xs.filter((x) => x.side !== 0 && x.netPct != null).map((x) => ({ t: x.eventTime, r: x.netPct! }))

async function run() {
  const xs = await inputs()
  log('reactions', xs.length, 'from', new Set(xs.map((x) => x.eventTime)).size, 'releases')
  const grid: Cell[] = []
  for (const mode of ['continue', 'fade'] as N1Mode[]) {
    for (const z of ZS) {
      const ev = xs.map((x) => evaluateN1(x, mode, z))
      grid.push({ mode, minZ: z, design: summarize(trades(ev.filter((e) => e.eventTime < TEST_FROM))), test: summarize(trades(ev.filter((e) => e.eventTime >= TEST_FROM))), all: summarize(trades(ev)) })
    }
  }
  // The design choice at the pre-registered z: the better design mean; the test period is not looked at for it.
  const at = (m: N1Mode) => grid.find((g) => g.mode === m && g.minZ === N1.minZ)!
  const chosen: N1Mode = (at('continue').design.mean ?? -Infinity) >= (at('fade').design.mean ?? -Infinity) ? 'continue' : 'fade'
  const ev = xs.map((x) => evaluateN1(x, chosen))
  // Baseline: the same 24-hour window after every release, long, no reaction filter (does the filter add anything?).
  const base = summarize(xs.filter((x) => x.ret60 != null && x.ret1440 != null).map((x) => ({ t: x.eventTime, r: x.ret1440! - x.ret60! - 2 * N1.legPct })))
  const btc4h = await cached('bars-BTCUSDT-4h', () => closedBars('BTCUSDT', '4h', 40_000))
  const btc1h = await cached('bars-BTCUSDT-1h', () => closedBars('BTCUSDT', '1h', 80_000))
  const reg = regimeSeries(btc4h, btc1h)
  const regimeAt = (t: number) => reg.get(Math.floor(t / STEP) * STEP - STEP) ?? 'uncertain'
  // breakdown clusters on `t`: the release time, so one release is one cluster.
  const taken = ev.filter((e) => e.side !== 0 && e.netPct != null).map((e) => ({ ...e, t: e.eventTime }))
  const byCategory = breakdown(taken, (e) => e.category, (e) => e.netPct!)
  const byAsset = breakdown(taken, (e) => e.asset, (e) => e.netPct!)
  const byRegime = breakdown(taken, (e) => regimeAt(e.eventTime), (e) => e.netPct!)
  const evaluated = ev.length
  const rejected = ev.filter((e) => e.side === 0).length
  return { v: 1, generatedAt: Date.now(), testFrom: TEST_FROM, releases: new Set(xs.map((x) => x.eventTime)).size, evaluated, rejected, liveMode: N1_MODE, chosen, grid, base, byCategory, byAsset, byRegime, rule: N1 }
}

const f = (x: number | null | undefined, d = 3) => (x == null ? 'n/a' : (x >= 0 ? '+' : '') + x.toFixed(d))
const line = (s: Summary) => `${f(s.mean)}% (n ${s.n}, ≈${s.eff} indep., 95% ${f(s.lo)} to ${f(s.hi)}, win ${(s.win * 100).toFixed(0)}%)`

function md(r: Awaited<ReturnType<typeof run>>): string {
  const o: string[] = []
  o.push(`# News reaction study (N1) — ${new Date(r.generatedAt).toISOString().slice(0, 10)}`, '')
  o.push('Generated by `radar-worker/scripts/news-study.ts`. Report only; N1 trades on paper only and is not one of the bot’s strategies.', '')
  o.push(`Rule (pre-registered, src/news/n1.ts): US ${N1.categories.join(', ')} releases; 60 minutes after, if the asset’s 60-minute move is at least |z| ${N1.minZ} vs its own 30-day same-horizon moves, trade with it (continue) or against it (fade); exit 24 h after the release. Result = the move from decision to exit, % (log), minus ${N1.legPct}% per leg. Releases since 2019: ${r.releases}; reactions evaluated ${r.evaluated}, no trade ${r.rejected}. A scheduled release alone is never a signal.`, '')
  o.push(`**Mode chosen on 2019–2024 only: ${r.chosen}.** The live paper record uses \`N1_MODE = '${r.liveMode}'\`${r.liveMode === r.chosen ? '' : ' — **differs from the design choice; update n1.ts**'}. 2025 on is the test period, not used for the choice.`, '')
  o.push('| Mode | min |z| | Design 2019–2024 | Test 2025+ |', '|---|---|---|---|')
  for (const g of r.grid) o.push(`| ${g.mode} | ${g.minZ} | ${line(g.design)} | ${line(g.test)} |`)
  o.push('', `Baseline (every release, long the next 24 h after the first hour, no filter): ${line(r.base)}.`, '')
  o.push(`### ${r.chosen}, |z| ≥ ${N1.minZ}, whole history`, '')
  o.push('| Group | Trades | Mean % | 95% range |', '|---|---|---|---|')
  for (const [name, b] of [['category', r.byCategory], ['asset', r.byAsset], ['regime', r.byRegime]] as const) {
    for (const [k, s] of Object.entries(b)) o.push(`| ${name}: ${k} | ${s.n} | ${f(s.mean)} | ${f(s.lo)} to ${f(s.hi)} |`)
  }
  o.push('', '**Limits**: no consensus forecasts in the free history, so the surprise (actual − forecast) cannot be tested yet; about 100 releases per category since 2019; BTC, ETH and gold react to the same release, so one release is one sample; gold’s perpetual has history only since 2025.', '')
  return o.join('\n')
}

const rep = await run()
mkdirSync(CACHE, { recursive: true })
writeFileSync(resolve(CACHE, 'news-study.json'), JSON.stringify(rep, null, 1))
const docs = resolve(ROOT, '../docs/research')
mkdirSync(docs, { recursive: true })
const file = resolve(docs, `news-study-${new Date().toISOString().slice(0, 10)}.md`)
writeFileSync(file, md(rep))
log('wrote', file, '· chosen mode', rep.chosen)
for (const g of rep.grid) log(g.mode.padEnd(8), 'z', g.minZ, 'design', f(g.design.mean), 'n', g.design.n, '· test', f(g.test.mean), 'n', g.test.n)
if (args.has('--publish')) {
  const db = connect(process.env.DATABASE_URL!)
  await new BotStore(db).setState('news:study', rep)
  await db.end()
  log('published bot_state news:study')
}
