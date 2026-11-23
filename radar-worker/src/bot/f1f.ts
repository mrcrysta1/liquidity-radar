// Experimental strategy F1F (option 2, docs/research/f1-filter-2026-11-21.md):
// F1's entries, taken only when a logistic model on market inputs rates the
// trade more likely than usual to win. Paper only: no health bands, so it is
// never promoted (strategies configured shadow never are, PR #189).
//
//   Signal   F1 exactly, on F1's candidate bars (c6.ts f1FlatAt).
//   Inputs   16 at the signal bar: the 12 of src/research/ml2.ts (the coin,
//            BTC, breadth of all the bot's markets, the coin vs BTC, funding)
//            and 4 about the breakout (src/research/f1filter.ts).
//   Model    L2 logistic regression (λ = 10) on inputs scaled on the training
//            set; label = the F1 trade's net R > 0 (0.10% per leg, real
//            funding). Take only if p ≥ the training win rate.
//   Training every F1 trade of every market (entries from 2018), closed at
//            least 7 days before; at least 300. Retrained every 182 days in
//            the background (bot.ts f1fTick), like C6. Kept in bot_state
//            'f1f:model'.
//   Live     breadth needs the other markets' bars at the signal: on a
//            signal (rare) the last 400 bars of each are read.
import type { Bar } from './features.ts'
import { indicators } from './features.ts'
import { F1, trendBacktest } from './strategy.ts'
import { closedBars, fundingRates } from './data.ts'
import type { Funding } from './data.ts'
import type { BotStore } from './store.ts'
import { C6, f1FlatAt, fundingR } from './c6.ts'
import { applyScaler, fitScaler } from './mlp.ts'
import { ML2_INPUTS, fitLogit, logitProb, ml2Inputs } from '../research/ml2.ts'
import { F1_INPUTS, ema300, f1Inputs } from '../research/f1filter.ts'

export const F1F = {
  retrainMs: 182 * 86_400_000,
  embargoMs: 7 * 86_400_000,
  minRows: 300,
  lambda: 10,
  /** Cost per market leg in the label (conservative, as the research). */
  leg: 0.001,
  historyBars: 40_000,
  /** Bars of each other market read at a live decision (breadth's EMA(50) settles well within). */
  liveBars: 400,
  retryMs: 60 * 60_000,
  stateKey: 'f1f:model',
  interval: '4h',
}

export const F1F_INPUTS = [...ML2_INPUTS, ...F1_INPUTS]

export interface F1FRow {
  sym: string
  i: number
  t: number
  tExit: number
  r: number
  x: number[]
}

export interface F1FModel {
  v: 1
  createdAt: number
  cutoff: number
  base: number
  n: number
  symbols: string[]
  inputs: string[]
  scaler: { mean: number[]; std: number[] }
  w: number[]
  b: number
  ms?: number
}

/** Every F1 trade of every market as a training row (the research's rows). */
export function f1fRows(bars: Record<string, Bar[]>, fund: Record<string, Funding[]>, stepMs: number): F1FRow[] {
  const sorted = Object.fromEntries(Object.entries(fund).map(([s, f]) => [s, [...f].sort((a, z) => a.t - z.t)]))
  const X = ml2Inputs(bars, sorted, stepMs)
  const out: F1FRow[] = []
  for (const [sym, b] of Object.entries(bars)) {
    if (!b.length) continue
    const atr = indicators(b).atr
    const e = ema300(b)
    const f = sorted[sym] ?? []
    for (const t of trendBacktest(b, F1, C6.from)) {
      const a = X[sym]?.[t.i]
      const c = f1Inputs(b, atr, e, t.i)
      if (!a || !c) continue
      const tEntry = b[t.i + 1].t
      const tExit = t.why === 'signal' ? b[t.exitBar + 1].t : b[t.exitBar].t + stepMs
      const r = t.r - (F1F.leg * t.entry) / t.dist - (F1F.leg * t.exit) / t.dist + fundingR(f, tEntry, tExit, t.entry, t.dist)
      out.push({ sym, i: t.i, t: tEntry, tExit, r, x: [...a, ...c] })
    }
  }
  return out
}

/** Fit on the rows closed at least the embargo before `now`; null: too few. */
export function fitF1F(rows: F1FRow[], now: number): F1FModel | null {
  const cutoff = now - F1F.embargoMs
  const tr = rows.filter((r) => r.tExit < cutoff)
  if (tr.length < F1F.minRows) return null
  const y = tr.map((r) => (r.r > 0 ? 1 : 0))
  const scaler = fitScaler(tr.map((r) => r.x))
  const m = fitLogit(tr.map((r) => applyScaler(scaler, r.x)), y, F1F.lambda)
  return {
    v: 1,
    createdAt: now,
    cutoff,
    base: y.reduce((a: number, v) => a + v, 0) / y.length,
    n: tr.length,
    symbols: [...new Set(tr.map((r) => r.sym))],
    inputs: F1F_INPUTS,
    scaler,
    w: m.w,
    b: m.b,
  }
}

export const f1fProb = (m: F1FModel, x: number[]) => logitProb({ w: m.w, b: m.b }, applyScaler(m.scaler, x))

type FetchBars = (symbol: string, interval: string, count: number) => Promise<Bar[]>
type FetchFunding = (symbol: string, startTime: number, endTime?: number) => Promise<Funding[]>

/** The model held by this process, the markets breadth reads, and the fetchers (tests replace them). */
export const f1fState = {
  model: null as F1FModel | null,
  loaded: false,
  training: null as Promise<void> | null,
  triedAt: 0,
  symbols: [] as string[],
  bars: closedBars as FetchBars,
  funding: fundingRates as FetchFunding,
  reset(): void {
    this.model = null
    this.loaded = false
    this.training = null
    this.triedAt = 0
    this.symbols = []
    this.bars = closedBars
    this.funding = fundingRates
  },
}

const usable = (m: unknown): F1FModel | null => {
  const x = m as F1FModel | null
  return x && x.v === 1 && x.inputs?.length === F1F_INPUTS.length && x.w?.length === F1F_INPUTS.length && isFinite(x.base) ? x : null
}

export async function f1fModel(store: BotStore): Promise<F1FModel | null> {
  if (!f1fState.loaded) {
    f1fState.model = usable(await store.getState<unknown>(F1F.stateKey, null))
    f1fState.loaded = true
  }
  return f1fState.model
}

const yieldLoop = () => new Promise<void>((r) => setImmediate(r))

/** Fetch every market's history and funding, build the rows, fit and store the model. */
export async function trainF1F(store: BotStore, symbols: string[], o: { stepMs: number; heavy?: { at: number }; now?: number }): Promise<F1FModel | null> {
  const t0 = Date.now()
  const now = o.now ?? t0
  const touch = () => {
    if (o.heavy) o.heavy.at = Date.now()
  }
  const bars: Record<string, Bar[]> = {}
  const fund: Record<string, Funding[]> = {}
  let fundingOk = true
  for (const sym of [...new Set(['BTCUSDT', ...symbols])]) {
    bars[sym] = await f1fState.bars(sym, F1F.interval, F1F.historyBars)
    touch()
    fund[sym] = []
    if (fundingOk && bars[sym].length) {
      try {
        fund[sym] = await f1fState.funding(sym, bars[sym][0].t, now)
      } catch (e) {
        fundingOk = false
        await store.event('warn', null, `f1f: funding history unavailable (${(e as Error).message}) — trained without funding`)
      }
    }
    touch()
    await yieldLoop()
  }
  const m = fitF1F(f1fRows(bars, fund, o.stepMs), now)
  if (!m) {
    await store.event('warn', null, `f1f: fewer than ${F1F.minRows} closed F1 trades to train on — no model`)
    return null
  }
  m.ms = Date.now() - t0
  await store.setState(F1F.stateKey, m)
  await store.event('info', null, `f1f: model trained on ${m.n} F1 trades of ${m.symbols.length} markets (base rate ${(m.base * 100).toFixed(1)}%) in ${Math.round(m.ms / 1000)} s; next in 182 days`)
  return m
}

/** From the tick loop, as c6Tick: load the model; (re)train in the background when missing or 182 days old. */
export async function f1fTick(store: BotStore, symbols: string[], o: { stepMs: number; heavy: { at: number; spacingMs: number }; now?: number }): Promise<void> {
  f1fState.symbols = symbols
  const now = o.now ?? Date.now()
  const m = await f1fModel(store)
  if (f1fState.training || (m && now - m.createdAt < F1F.retrainMs) || now - f1fState.triedAt < F1F.retryMs) return
  if (Date.now() - o.heavy.at < o.heavy.spacingMs) return
  o.heavy.at = Date.now()
  f1fState.triedAt = now
  await store.event('info', null, m ? 'f1f: model is 182 days old — retraining in the background' : 'f1f: no model yet — training in the background (F1F decides nothing until it is ready)')
  f1fState.training = trainF1F(store, symbols, o)
    .then((x) => {
      if (x) f1fState.model = x
    })
    .catch((e) => store.event('warn', null, `f1f: training failed (${(e as Error).message}) — next try in 1 h`))
    .finally(() => {
      f1fState.training = null
    })
}

export interface F1FDecision {
  take: boolean
  p?: number
  base?: number
  note: string
  quiet?: boolean
}

/** Take / skip of an F1 signal at the latest bar i of `b` (`btc`: BTCUSDT's on the same grid). */
export async function f1fDecide(store: BotStore, symbol: string, b: Bar[], i: number, btc: Bar[] | undefined, stepMs: number): Promise<F1FDecision> {
  if (!f1FlatAt(b, i)) return { take: false, note: 'F1 is still in its previous trade here', quiet: true }
  const m = await f1fModel(store)
  if (!m) return { take: false, note: f1fState.training ? 'no model yet (training)' : 'no model yet' }
  const T = b[i].t
  const btcBars = symbol === 'BTCUSDT' ? b : btc
  if (!btcBars?.length) return { take: false, note: 'BTCUSDT bars unavailable' }
  const upTo = (x: Bar[]) => x.filter((k) => k.t <= T)
  const bars: Record<string, Bar[]> = { [symbol]: b.slice(0, i + 1), BTCUSDT: upTo(btcBars) }
  for (const s of f1fState.symbols.length ? f1fState.symbols : m.symbols) {
    if (bars[s]) continue
    try {
      bars[s] = upTo(await f1fState.bars(s, F1F.interval, F1F.liveBars))
    } catch {
      // One market missing only thins the breadth.
    }
  }
  let warn = ''
  const fund = await f1fState.funding(symbol, T + stepMs - 10 * 86_400_000, T + stepMs).catch(() => ((warn = ' (funding unavailable: default rate)'), [] as Funding[]))
  const a = ml2Inputs(bars, { [symbol]: [...fund].sort((x, z) => x.t - z.t) }, stepMs)[symbol]?.[i]
  const c = f1Inputs(b, indicators(b).atr, ema300(b), i)
  if (!a || !c) return { take: false, note: 'not enough history for the inputs' }
  const p = f1fProb(m, [...a, ...c])
  const take = p >= m.base
  return { take, p, base: m.base, note: `model p ${p.toFixed(3)} ${take ? '≥' : '<'} base rate ${m.base.toFixed(3)} (${Object.keys(bars).length} markets in breadth)${warn}` }
}
