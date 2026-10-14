// The self-learning engine: the part that runs on its own.
//
// For every tracked market and both styles (scalp, swing) it keeps a pair of
// models (long, short), trained on that market's own history and validated
// on a later stretch it never saw. On each closed bar it reads the market,
// and if one side's expected value clears the bar it opens a paper trade with
// a stop and a target. Open trades are checked against the live price every
// two seconds and against each closed bar's high and low. When a trade
// closes, the model that took it is updated from the result — that is the
// self-learning — and every step is written to the learning log.
//
// Paper only: no order is ever sent to an exchange from the browser. The
// 24/7 testnet bot lives in radar-worker; its records are read separately.
// Everything here persists in localStorage, so the record survives reloads.
import { storageGet, storageSet } from '../../services/storage'
import { series } from './features'
import { learnLogit } from './models'
import { SL_MARKETS, loadPerpCandles as loadCandleWindow, marketLabel, perpPrice, pollPerpPrices } from './perp'
import { setupOf } from './patterns'
import { trainInBackground } from './trainClient'
import {
  FEE,
  STRATS,
  costR,
  dataset,
  edgeProven,
  decide,
  levels,
  runBacktest,
  simulate,
  stats,
  trainPair,
} from './strategy'
import type { BacktestOpts, BacktestResult, EdgeCheck, Pair, Side, StratId } from './strategy'

export interface SLTrade {
  id: string
  sym: string
  strat: StratId
  side: Side
  entry: number
  sl: number
  tp: number
  atr: number
  /** Model's chance of the target before the stop, and expected value in R. */
  p: number
  ev: number
  openedAt: number
  /** Open time of the bar the decision was made on. */
  barT: number
  closedAt?: number
  exit?: number
  reason?: 'tp' | 'sl' | 'time' | 'manual'
  r?: number
  pnlPct?: number
  setup: string
  note: string
  x: number[]
  model: number
  learned?: { before: number; after: number }
}

export interface SLModel {
  key: string
  sym: string
  strat: StratId
  version: number
  trainedAt: number
  bars: number
  rows: number
  pair: Pair
  holdout: { n: number; winRate: number; avgR: number; pf: number }
  updates: number
  lastBarT: number
  last?: { pLong: number; pShort: number; evLong: number; evShort: number; at: number; price: number }
}

export type SLEventKind = 'train' | 'open' | 'close' | 'learn' | 'risk' | 'info' | 'error'
export interface SLEvent {
  id: string
  t: number
  kind: SLEventKind
  sym?: string
  strat?: StratId
  title: string
  msg: string
}

export interface SLConfig {
  auto: boolean
  symbols: string[]
  strats: StratId[]
  leverage: number
  riskPct: number
  /** Only models that made money on history they never saw may trade. */
  provenOnly: boolean
}

export type SLStatus = 'idle' | 'warming' | 'running'

const K = { cfg: 'lr-sl-config-v1', models: 'lr-sl-models-v1', trades: 'lr-sl-trades-v1', log: 'lr-sl-log-v1' }
export const DEFAULT_SYMBOLS = SL_MARKETS
const MAX_TRADES = 600
const MAX_LOG = 250

let config: SLConfig = {
  auto: true,
  strats: ['scalp', 'swing'],
  leverage: 10,
  riskPct: 1,
  provenOnly: false,
  ...storageGet<Partial<SLConfig>>(K.cfg, {}),
  // Fixed to BTC + Gold perpetuals; older saved configs listed other markets.
  symbols: SL_MARKETS,
}
const models: Record<string, SLModel> = storageGet(K.models, {})
// Markets dropped from the list: forget their models and their still-open paper
// trades (nothing prices them any more); closed trades stay in the records.
for (const k of Object.keys(models)) if (!SL_MARKETS.includes(k.split('|')[0]!)) delete models[k]
let trades: SLTrade[] = storageGet<SLTrade[]>(K.trades, []).filter((t) => t.closedAt != null || SL_MARKETS.includes(t.sym))
let events: SLEvent[] = storageGet(K.log, [])
let status: SLStatus = 'idle'
let busy: string | null = null
let version = 0
let seq = 0

const listeners = new Set<() => void>()
function emit(): void {
  version++
  listeners.forEach((fn) => fn())
}
export function onSLChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
export const slVersion = () => version

let bt: { running: boolean; result: BacktestResult | null; error: string } = { running: false, result: null, error: '' }

export function getSL() {
  return { config, models, trades, events, status, busy, bt }
}

const keyOf = (sym: string, strat: StratId) => sym + '|' + strat
const uid = (p: string) => p + Date.now().toString(36) + (seq++).toString(36)
const short = marketLabel
const fmt = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString('en-US') : v >= 1 ? v.toFixed(2) : v.toPrecision(4))

function save(): void {
  storageSet(K.models, models)
  storageSet(K.trades, trades.slice(-MAX_TRADES))
  storageSet(K.log, events.slice(-MAX_LOG))
  storageSet(K.cfg, config)
}

function log(kind: SLEventKind, title: string, msg: string, sym?: string, strat?: StratId): void {
  events.push({ id: uid('e'), t: Date.now(), kind, title, msg, sym, strat })
  if (events.length > MAX_LOG) events = events.slice(-MAX_LOG)
}

// ---- training -----------------------------------------------------------------

export async function trainModel(sym: string, strat: StratId, why = 'Initial training'): Promise<void> {
  const st = STRATS[strat]
  const key = keyOf(sym, strat)
  busy = short(sym) + ' ' + st.label
  emit()
  try {
    const cs = await loadCandleWindow(sym, st.tf, st.bars)
    if (cs.length < 400) throw new Error('only ' + cs.length + ' bars')
    // Features, labels, the unseen-30% check and both fits (train.ts), in a worker.
    const { rows: nRows, pair, holdout } = await trainInBackground(cs, strat)
    const hs = holdout
    const prev = models[key]
    models[key] = {
      key, sym, strat,
      version: (prev?.version ?? 0) + 1,
      trainedAt: Date.now(),
      bars: cs.length,
      rows: nRows,
      pair,
      holdout,
      updates: 0,
      lastBarT: prev?.lastBarT ?? 0,
      last: prev?.last,
    }
    log(
      'train',
      `${why} · ${short(sym)} ${st.label} v${models[key].version}`,
      `Trained on ${nRows.toLocaleString()} labelled ${st.tf} bars. Unseen test: ${hs.n} trades, ` +
        `${(hs.winRate * 100).toFixed(0)}% win, ${hs.avgR >= 0 ? '+' : ''}${hs.avgR.toFixed(2)}R avg.`,
      sym,
      strat,
    )
  } catch (e) {
    log('error', `Training failed · ${short(sym)} ${st.label}`, e instanceof Error ? e.message : String(e), sym, strat)
  } finally {
    busy = null
    save()
    emit()
  }
}

// ---- risk -----------------------------------------------------------------------

function lossStreak(key: string): number {
  const closed = trades.filter((t) => keyOf(t.sym, t.strat) === key && t.r != null && t.reason !== 'manual')
  let n = 0
  for (let i = closed.length - 1; i >= 0 && (closed[i].r as number) <= 0; i--) n++
  return n
}

/** The entry bar rises after a run of losses and falls back after a win. */
export function minEVFor(key: string): number {
  const base = STRATS[key.split('|')[1] as StratId]?.minEV ?? 0.1
  return Math.min(base + 0.3, base + 0.05 * Math.max(0, lossStreak(key) - 2))
}

/** The model's edge check: unseen-test trades plus its live paper trades (strategy.ts). */
export function edgeOf(m: SLModel): EdgeCheck {
  const key = keyOf(m.sym, m.strat)
  const liveR = trades
    .filter((t) => keyOf(t.sym, t.strat) === key && t.r != null && t.reason !== 'manual')
    .map((t) => t.r as number)
  return edgeProven(m.holdout, liveR, STRATS[m.strat])
}

/** Made money beyond what chance explains, on unseen history and live paper trades. */
export const proven = (m: SLModel) => edgeOf(m).proven

// ---- trades ---------------------------------------------------------------------

export const openTrades = () => trades.filter((t) => t.closedAt == null)

function close(t: SLTrade, exit: number, reason: NonNullable<SLTrade['reason']>, at = Date.now()): void {
  const st = STRATS[t.strat]
  const cR = costR(t.entry, t.atr, st)
  t.exit = exit
  t.reason = reason
  t.closedAt = at
  t.r = (t.side * (exit - t.entry)) / (st.slM * t.atr) - cR
  t.pnlPct = t.side * (exit / t.entry - 1) * 100 - FEE * 100
  const key = keyOf(t.sym, t.strat)
  const before = minEVFor(key)
  log(
    'close',
    `${t.r > 0 ? 'Win' : 'Loss'} · ${short(t.sym)} ${t.side === 1 ? 'long' : 'short'} (${st.label})`,
    `${reason === 'tp' ? 'Target hit' : reason === 'sl' ? 'Stopped out' : reason === 'time' ? 'Time limit' : 'Closed by hand'} at $${fmt(exit)} · ` +
      `${t.r >= 0 ? '+' : ''}${t.r.toFixed(2)}R · ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}% (${(t.pnlPct * config.leverage).toFixed(1)}% at ${config.leverage}x)`,
    t.sym,
    t.strat,
  )
  const m = models[key]
  if (m && reason !== 'manual') {
    const win = t.r > 0 ? 1 : 0
    const lr = learnLogit(t.side === 1 ? m.pair.long : m.pair.short, t.x, win)
    t.learned = lr
    m.updates++
    log(
      'learn',
      `Model update · ${short(t.sym)} ${st.label} ${t.side === 1 ? 'long' : 'short'}`,
      `Learned from this ${win ? 'win' : 'loss'}: the same setup now scores ${(lr.after * 100).toFixed(1)}% ` +
        `(was ${(lr.before * 100).toFixed(1)}%). ${m.updates} live update${m.updates === 1 ? '' : 's'} since v${m.version}.`,
      t.sym,
      t.strat,
    )
  }
  const after = minEVFor(key)
  if (after !== before)
    log(
      'risk',
      `Risk management · ${short(t.sym)} ${st.label}`,
      after > before
        ? `${lossStreak(key)} losses in a row: entry bar raised to EV ≥ ${after.toFixed(2)}R until a win.`
        : `Back to the normal entry bar (EV ≥ ${after.toFixed(2)}R) after a win.`,
      t.sym,
      t.strat,
    )
}

export function closeTrade(id: string): void {
  const t = trades.find((x) => x.id === id && x.closedAt == null)
  const px = t ? perpPrice(t.sym) : undefined
  if (!t || !px) return
  close(t, px, 'manual')
  save()
  emit()
}

function tickPrices(): void {
  let changed = false
  openTrades().forEach((t) => {
    const px = perpPrice(t.sym)
    if (!px) return
    if (t.side === 1 ? px <= t.sl : px >= t.sl) close(t, t.sl, 'sl')
    else if (t.side === 1 ? px >= t.tp : px <= t.tp) close(t, t.tp, 'tp')
    else return
    changed = true
  })
  if (changed) {
    save()
    emit()
  }
}

// ---- the bar loop ---------------------------------------------------------------

async function scanKey(sym: string, strat: StratId): Promise<void> {
  const st = STRATS[strat]
  const key = keyOf(sym, strat)
  let m = models[key]
  if (!m || Date.now() - m.trainedAt > st.retrainMs) {
    await trainModel(sym, strat, m ? 'Scheduled retrain' : 'Initial training')
    m = models[key]
    if (!m) return
  }
  const now = Date.now()
  const closedT = Math.floor(now / st.tfMs) * st.tfMs - st.tfMs
  if (m.lastBarT >= closedT) return
  const cs = (await loadCandleWindow(sym, st.tf, 160)).filter((k) => k.t <= closedT)
  if (cs.length < 80) return
  const S = series(cs)
  const i = cs.length - 1
  // Settle open trades on the bars since they opened: the tick check can miss a wick.
  trades
    .filter((t) => t.closedAt == null && t.sym === sym && t.strat === strat)
    .forEach((t) => {
      const after = cs.filter((k) => k.t > t.barT)
      for (const k of after) {
        if (t.side === 1 ? k.l <= t.sl : k.h >= t.sl) return close(t, t.sl, 'sl', k.t + st.tfMs)
        if (t.side === 1 ? k.h >= t.tp : k.l <= t.tp) return close(t, t.tp, 'tp', k.t + st.tfMs)
      }
      if (after.length >= st.maxHold) close(t, cs[i].c, 'time', cs[i].t + st.tfMs)
    })
  const x = S.X[i]
  m.lastBarT = closedT
  if (!x) return
  // Enter at the live price, not the closed bar's close: after the tab was
  // hidden or at startup that close can be most of a bar old, and the trade
  // was then checked against live prices it could never have had. A decision
  // reached long after its bar closed is not acted on at all.
  const sinceClose = now - (closedT + st.tfMs)
  const tooLate = sinceClose > Math.min(st.tfMs * 0.25, 30 * 60_000)
  const live = perpPrice(sym)
  const entry = live && live > 0 ? live : cs[i].c
  const atr = S.atr[i]
  const minEV = minEVFor(key)
  const d = decide(m.pair, x, entry, atr, st, minEV)
  m.last = { pLong: d.pLong, pShort: d.pShort, evLong: d.evLong, evShort: d.evShort, at: now, price: entry }
  const busyKey = trades.some((t) => t.closedAt == null && t.sym === sym && t.strat === strat)
  if (config.auto && d.side && !busyKey && !tooLate && (!config.provenOnly || proven(m))) {
    const { sl, tp } = levels(entry, atr, d.side, st)
    const { setup, note } = setupOf(cs, S, i, d.side)
    const t: SLTrade = {
      id: uid('t'), sym, strat, side: d.side, entry, sl, tp, atr,
      p: d.side === 1 ? d.pLong : d.pShort, ev: d.side === 1 ? d.evLong : d.evShort,
      openedAt: now, barT: cs[i].t, setup, note, x, model: m.version,
    }
    trades.push(t)
    log(
      'open',
      `Opened ${d.side === 1 ? 'LONG' : 'SHORT'} · ${short(sym)} ${st.label}`,
      `${setup} at $${fmt(entry)} · stop $${fmt(sl)} · target $${fmt(tp)} · ` +
        `${(t.p * 100).toFixed(0)}% chance, EV ${t.ev >= 0 ? '+' : ''}${t.ev.toFixed(2)}R (bar: ${minEV.toFixed(2)}R).`,
      sym,
      strat,
    )
  }
}

async function scan(): Promise<void> {
  if (busy || document.hidden) return
  for (const sym of config.symbols) {
    for (const strat of config.strats) {
      try {
        await scanKey(sym, strat)
      } catch (e) {
        log('error', `Scan failed · ${short(sym)} ${STRATS[strat].label}`, e instanceof Error ? e.message : String(e), sym, strat)
      }
    }
  }
  if (status !== 'running') status = 'running'
  save()
  emit()
}

let started = false
/** Idempotent. Called once, a little after the page settles. */
export function startSelfLearning(): void {
  if (started) return
  started = true
  status = 'warming'
  if (!events.length) log('info', 'Self-learning engine started', 'Training a long and a short model per market and style before it trades.')
  emit()
  void scan()
  setInterval(() => void scan(), 20_000)
  void pollPerpPrices(SL_MARKETS)
  setInterval(() => {
    if (!document.hidden) void pollPerpPrices(SL_MARKETS).then(tickPrices)
  }, 3_000)
}

// ---- controls -------------------------------------------------------------------

export function setConfig(p: Partial<SLConfig>): void {
  const wasAuto = config.auto
  config = { ...config, ...p }
  if (p.auto != null && p.auto !== wasAuto)
    log('info', p.auto ? 'Auto trading on' : 'Auto trading paused', p.auto ? 'The engine will open paper trades when a setup clears the bar.' : 'Open trades keep running to their stop or target; no new ones open.')
  save()
  emit()
  void scan()
}

export function retrainAll(): void {
  void (async () => {
    for (const sym of config.symbols) for (const s of config.strats) await trainModel(sym, s, 'Manual retrain')
  })()
}

export function clearRecords(): void {
  trades = trades.filter((t) => t.closedAt == null)
  events = []
  log('info', 'Records cleared', 'Closed trades and the learning log were cleared. Models were kept.')
  save()
  emit()
}

/** Fetch the history and replay it through the same rules the live engine trades by. */
export async function backtest(o: BacktestOpts): Promise<BacktestResult> {
  const cs = await loadCandleWindow(o.sym, STRATS[o.strat].tf, o.bars)
  // Let the "Running…" state paint before the replay takes the thread.
  await new Promise((r) => setTimeout(r, 30))
  return runBacktest(o, cs)
}

/** Run a backtest and keep its result for whichever card shows it next. */
export async function runBt(o: BacktestOpts): Promise<void> {
  if (bt.running) return
  bt = { ...bt, running: true, error: '' }
  emit()
  try {
    bt = { running: false, result: await backtest(o), error: '' }
  } catch (e) {
    bt = { running: false, result: bt.result, error: e instanceof Error ? e.message : String(e) }
  }
  emit()
}
