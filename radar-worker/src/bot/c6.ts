// Strategy C6 (research round 2, meta2.ts): F1's entries, taken only when a
// gradient-boosted tree model rates the trade more likely than usual to win.
//
//   Signal   F1 exactly, on the bars where F1's own trade sequence is flat
//            (the research candidates: one F1 trade at a time per market).
//   Model    GBDT (models/gbdt.ts, defaults, seed 7) on FEATURES_V2 at the
//            signal bar; label = the F1 trade's net R > 0 (taker fee + slip
//            per leg, real funding; 0.01%/8 h before a market's funding starts).
//   Take     only if p >= the training set's base rate (its win fraction).
//   Exits    identical to F1.
//   Training every F1 trade (entries from 2018) over each market's whole
//            history, all of BOT_SYMBOLS, symbol by symbol in BOT_SYMBOLS
//            order (the research pool order: gbdt.ts holds out the last 20% of
//            the rows for early stopping), closed at least 7 days before the
//            training time. Retrained every 182 days.
//
// The model is kept in bot_state 'c6:model' (no schema change; the model's
// champions in bot_models are untouched), so it is trained once per 182 days,
// not on every run. Training is a background job started from the tick loop
// (bot.ts c6Tick) on the heavyJobs spacing: the long history (~400 kline pages
// and ~170 funding pages for 24 markets) is fetched with the trading ticks
// running in between. Until a model exists C6 decides nothing.
import type { Bar, Costs } from './features.ts'
import { FEATURES_V2, contextSeries, featureAtV2, indicators } from './features.ts'
import { fitGbdt, gbdtProb } from './models/gbdt.ts'
import type { GbdtModel } from './models/gbdt.ts'
import { F1, onClose, trendBacktest, trendIndicators, trendSignal } from './strategy.ts'
import type { TrailState, TrendInd } from './strategy.ts'
import { closedBars, fundingRates } from './data.ts'
import type { Funding } from './data.ts'
import type { BotStore } from './store.ts'

export const C6 = {
  retrainMs: 182 * 86_400_000,
  /** Training uses trades closed at least this long before the training time. */
  embargoMs: 7 * 86_400_000,
  seed: 7,
  /** First entry used for training (research f1All). */
  from: Date.UTC(2018, 0, 1),
  /** Funding per 8 h assumed before a market's funding history starts (research lib.ts DEFAULT_FUND). */
  defaultFunding: 0.0001,
  /** Fewest training trades a model needs. */
  minRows: 100,
  /** Bars asked for when training: more than any market's whole 4h history, so all of it. */
  historyBars: 40_000,
  /** After a failed training, wait this long before the next try. */
  retryMs: 60 * 60_000,
  stateKey: 'c6:model',
}

/** One training example: an F1 trade, its net R and FEATURES_V2 at its signal bar. */
export interface C6Row {
  sym: string
  /** Signal bar index. */
  i: number
  tEntry: number
  tExit: number
  /** Net R (costs and funding). */
  r: number
  x: number[]
}

/** The stored model (bot_state 'c6:model'). */
export interface C6Model {
  v: 1
  createdAt: number
  /** Trades used closed before this time (createdAt − embargo). */
  cutoff: number
  /** Win fraction of the training set: the take threshold. */
  base: number
  n: number
  /** Markets in the training set, and those whose real funding went in (the others had none). */
  symbols: string[]
  funding: string[]
  nFeatures: number
  /** Training time, ms (fetching included). */
  ms?: number
  gbdt: GbdtModel
}

/** Funding paid by a long, in R, for settlements in (t0, t1] (research lib.ts fundingR, side +1). */
export function fundingR(fund: Funding[], t0: number, t1: number, entry: number, dist: number): number {
  let lo = 0
  let hi = fund.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (fund[m].t <= t0) lo = m + 1
    else hi = m
  }
  let s = 0
  for (let k = lo; k < fund.length && fund[k].t <= t1; k++) s += fund[k].rate
  const first = fund.length ? fund[0].t : Infinity
  if (t0 < first) s += (C6.defaultFunding * Math.max(0, Math.min(t1, first) - t0)) / (8 * 3_600_000)
  return (-s * entry) / dist
}

/**
 * Every F1 trade of one market as a training row. `b`: its whole history;
 * `btc`: BTCUSDT's (the context of an alt; ignored for BTCUSDT itself);
 * `fund`: its funding settlements (any order; [] = none known).
 */
export function c6Rows(sym: string, b: Bar[], fund: Funding[], btc: Bar[] | undefined, costs: Costs, stepMs: number): C6Row[] {
  const trades = trendBacktest(b, F1, C6.from)
  if (!trades.length) return []
  const f = [...fund].sort((a, z) => a.t - z.t)
  const ind = indicators(b)
  const cs = contextSeries(b, ind, { btc: sym === 'BTCUSDT' ? undefined : btc, funding: f, stepMs })
  const leg = costs.taker + costs.slip
  const out: C6Row[] = []
  for (const t of trades) {
    const x = featureAtV2(b, ind, cs, t.i)
    if (!x) continue
    const tEntry = b[t.i + 1].t
    // A stop fills inside the exit bar; a rule exit at the next open.
    const tExit = t.why === 'signal' ? b[t.exitBar + 1].t : b[t.exitBar].t + stepMs
    const r = t.r - (leg * t.entry) / t.dist - (leg * t.exit) / t.dist + fundingR(f, tEntry, tExit, t.entry, t.dist)
    out.push({ sym, i: t.i, tEntry, tExit, r, x })
  }
  return out
}

/** Fit the model on the rows closed at least C6.embargoMs before `now` (rows in pool order). null: too few. */
export function fitC6(rows: C6Row[], now: number, funding: string[] = []): C6Model | null {
  const cutoff = now - C6.embargoMs
  const tr = rows.filter((r) => r.tExit < cutoff)
  if (tr.length < C6.minRows) return null
  const ys = tr.map((r) => (r.r > 0 ? 1 : 0))
  const base = ys.reduce((a: number, v) => a + v, 0) / ys.length
  const gbdt = fitGbdt(
    tr.map((r) => r.x),
    ys,
    { seed: C6.seed },
  )
  return { v: 1, createdAt: now, cutoff, base, n: tr.length, symbols: [...new Set(tr.map((r) => r.sym))], funding, nFeatures: FEATURES_V2.length, gbdt }
}

/** The model's verdict on one feature row. */
export function c6Verdict(m: C6Model, x: number[]): { p: number; take: boolean } {
  const p = gbdtProb(m.gbdt, x)
  return { p, take: p >= m.base }
}

const indCache = new WeakMap<Bar[], TrendInd>()
const trendInd = (b: Bar[]): TrendInd => {
  let x = indCache.get(b)
  if (!x) indCache.set(b, (x = trendIndicators(b)))
  return x
}

/**
 * Is F1's own trade sequence (trendBacktest: one trade at a time, the next
 * entry decided at the close of the exit bar) flat at the close of bar i?
 * Those bars, with an F1 signal, are C6's candidates — exactly the research's.
 */
export function f1FlatAt(b: Bar[], i: number): boolean {
  const ind = trendInd(b)
  for (let s = Math.max(F1.warm, 1); s < i; s++) {
    if (!trendSignal(b, ind, s)) continue
    const entry = b[s + 1].o
    const dist = F1.slAtr * ind.atr[s]
    if (!(dist > 0)) continue
    let st: TrailState = { stop: entry - dist, high: -Infinity }
    let exitBar = -1
    for (let j = s + 1; j <= i; j++) {
      if (b[j].l <= st.stop) {
        exitBar = j
        break
      }
      const r = onClose(b, ind, j, st)
      if (r.exit) {
        exitBar = j
        break
      }
      st = r
    }
    if (exitBar < 0) return false
    s = exitBar - 1
  }
  return true
}

// ---- the model in use, and its training ----------------------------------------

type FetchBars = (symbol: string, interval: string, count: number) => Promise<Bar[]>
type FetchFunding = (symbol: string, startTime: number, endTime?: number) => Promise<Funding[]>

/** The model held by this process (one per bot), and how to fetch for it (tests replace the fetchers). */
export const c6State = {
  model: null as C6Model | null,
  loaded: false,
  training: null as Promise<void> | null,
  triedAt: 0,
  bars: closedBars as FetchBars,
  funding: fundingRates as FetchFunding,
  reset(): void {
    this.model = null
    this.loaded = false
    this.training = null
    this.triedAt = 0
    this.bars = closedBars
    this.funding = fundingRates
  },
}

const usable = (m: unknown): C6Model | null => {
  const x = m as C6Model | null
  return x && x.v === 1 && x.nFeatures === FEATURES_V2.length && Array.isArray(x.gbdt?.trees) && isFinite(x.base) ? x : null
}

/** The model in use (read from bot_state once per process). */
export async function c6Model(store: BotStore): Promise<C6Model | null> {
  if (!c6State.loaded) {
    c6State.model = usable(await store.getState<unknown>(C6.stateKey, null))
    c6State.loaded = true
  }
  return c6State.model
}

export interface C6TrainOpts {
  costs: Costs
  interval: string
  stepMs: number
  /** Shared with the model's walk-forward (trader.ts heavyJobs): kept fresh while training runs, so they do not pile up. */
  heavy?: { at: number }
  now?: number
}

const yieldLoop = () => new Promise<void>((r) => setImmediate(r))

/** Fetch every market's history and funding, build the rows, fit and store the model. */
export async function trainC6(store: BotStore, symbols: string[], o: C6TrainOpts): Promise<C6Model | null> {
  const t0 = Date.now()
  const now = o.now ?? t0
  const touch = () => {
    if (o.heavy) o.heavy.at = Date.now()
  }
  const btc = await c6State.bars('BTCUSDT', o.interval, C6.historyBars)
  touch()
  // The funding host may be out of reach (some regions): after one failure, no market gets funding.
  let fundingOk = true
  const withFunding: string[] = []
  const rows: C6Row[] = []
  for (const sym of symbols) {
    const b = sym === 'BTCUSDT' ? btc : await c6State.bars(sym, o.interval, C6.historyBars)
    touch()
    let fund: Funding[] = []
    if (fundingOk && b.length) {
      try {
        fund = await c6State.funding(sym, b[0].t, now)
        withFunding.push(sym)
      } catch (e) {
        fundingOk = false
        await store.event('warn', null, `c6: funding history unavailable (${(e as Error).message}) — the model is trained without funding`)
      }
    }
    touch()
    rows.push(...c6Rows(sym, b, fund, btc, o.costs, o.stepMs))
    await yieldLoop()
  }
  const m = fitC6(rows, now, withFunding)
  if (!m) {
    await store.event('warn', null, `c6: only ${rows.filter((r) => r.tExit < now - C6.embargoMs).length} F1 trades to train on (needs ${C6.minRows}) — no model`)
    return null
  }
  m.ms = Date.now() - t0
  await store.setState(C6.stateKey, m)
  await store.event(
    'info',
    null,
    `c6: model trained on ${m.n} F1 trades of ${m.symbols.length} markets (base rate ${(m.base * 100).toFixed(1)}%, ${m.gbdt.trees.length} trees${withFunding.length ? '' : ', no funding'}) in ${Math.round(m.ms / 1000)} s; next in 182 days`,
  )
  return m
}

/**
 * From the tick loop: load the stored model, and start a (re)training in the
 * background when there is none or it is 182 days old — on the heavyJobs
 * spacing, at most one at a time, an hour apart after a failure. Never waits
 * for the training itself.
 */
export async function c6Tick(store: BotStore, symbols: string[], o: C6TrainOpts & { heavy: { at: number; spacingMs: number } }): Promise<void> {
  const now = o.now ?? Date.now()
  const m = await c6Model(store)
  if (c6State.training || (m && now - m.createdAt < C6.retrainMs) || now - c6State.triedAt < C6.retryMs) return
  if (Date.now() - o.heavy.at < o.heavy.spacingMs) return
  o.heavy.at = Date.now()
  c6State.triedAt = now
  await store.event('info', null, m ? 'c6: model is 182 days old — retraining in the background' : 'c6: no model yet — training in the background (C6 decides nothing until it is ready)')
  c6State.training = trainC6(store, symbols, o)
    .then((x) => {
      if (x) c6State.model = x
    })
    .catch((e) => store.event('warn', null, `c6: training failed (${(e as Error).message}) — next try in 1 h`))
    .finally(() => {
      c6State.training = null
    })
}

export interface C6Decision {
  /** Take the signal. */
  take: boolean
  p?: number
  base?: number
  note: string
  /** Not a C6 candidate at all (F1's sequence is in a trade): not worth an event line. */
  quiet?: boolean
}

/**
 * The live take / skip of an F1 signal at the latest bar i of `b` (the long
 * window the trader holds; `btc` BTCUSDT's on the same grid, unused for BTC).
 */
export async function c6Decide(store: BotStore, symbol: string, b: Bar[], i: number, btc: Bar[] | undefined, stepMs: number): Promise<C6Decision> {
  if (!f1FlatAt(b, i)) return { take: false, note: 'F1 is still in its previous trade here', quiet: true }
  const m = await c6Model(store)
  if (!m) return { take: false, note: c6State.training ? 'no model yet (training)' : 'no model yet' }
  if (symbol !== 'BTCUSDT' && !btc?.length) return { take: false, note: 'BTCUSDT bars unavailable' }
  let fund: Funding[] = []
  let warn = ''
  if (m.funding.includes(symbol)) {
    const T = b[i].t + stepMs
    fund = await c6State.funding(symbol, T - 10 * 86_400_000, T).catch(() => ((warn = ' (funding unavailable: counted as none)'), []))
  }
  const ind = indicators(b)
  const cs = contextSeries(b, ind, { btc: symbol === 'BTCUSDT' ? undefined : btc, funding: fund, stepMs })
  const x = featureAtV2(b, ind, cs, i)
  if (!x) return { take: false, note: 'not enough history for the model features' }
  const v = c6Verdict(m, x)
  return { take: v.take, p: v.p, base: m.base, note: `model p ${v.p.toFixed(3)} ${v.take ? '≥' : '<'} base rate ${m.base.toFixed(3)}${warn}` }
}
