// Bar replay for the price-action chart — the Pro terminal's replay, with a
// proper transport.
//
// Replay never touches the live candle array: it only caps how much of it the
// chart draws. Turning replay off restores the full series, and live socket
// ticks are ignored for rendering while it is on so the tape cannot jump ahead
// of where the user is.
import { state } from '../../services/store'
import type { CandleFlat } from '../../services/market'
import { fetchKlineRows, fetchOlderKlines, historyExhausted } from '../../services/marketData'
import { BASE_MS, bucketEnd, tfDef } from '../../services/timeframe'
import {
  countAtOrBefore,
  countFromDate,
  formingBar,
  nextSubTime,
  prevSubTime,
  randomCount,
  updateIntervalsFor,
} from './replayMath'

export const SPEEDS = [0.25, 0.5, 1, 2, 3, 5, 10, 20]
/** Bars per step button press — TradingView's "step" sizes. */
export const STEP_SIZES = [1, 5, 10, 20, 50]
/** Replay opens here: far enough back to have something to play forward into. */
const START_FRACTION = 0.6

interface ReplayState {
  on: boolean
  /** How many candles of the live array are visible. */
  idx: number
  /** Open time of the last visible bar: the position, as a time. */
  at: number
  playing: boolean
  speed: number
  /**
   * Picking the start bar: the full series is drawn and the next chart click
   * cuts it there (TradingView's "Select bar"). The default start stays in
   * idx, so any transport action before a click just starts from it.
   */
  selecting: boolean
  stepBars: number
  /** Update interval ('' = whole bars): the lower interval the bar in progress forms by. */
  sub: string
  /**
   * Open time of the last sub-bar shown inside the bar at idx - 1, which is
   * then still forming; 0 when that bar is shown complete.
   */
  subT: number
}

const rs: ReplayState = {
  on: false,
  idx: 0,
  at: 0,
  playing: false,
  speed: 1,
  selecting: false,
  stepBars: 1,
  sub: '',
  subT: 0,
}

/** Set the position by count, remembering it as the last visible bar's time. */
function setIdx(i: number): void {
  rs.idx = i
  rs.at = state.candles[i - 1]?.t ?? 0
  rs.subT = 0
}
/**
 * The live array keeps changing under replay: new bars are appended and the
 * oldest dropped at 5000, which shifted an index-only cursor one bar per new
 * bar, and older history paged in moved it the other way. The position is
 * kept as a time and the count re-derived from it.
 */
function syncIdx(): void {
  const a = state.candles
  if (!rs.on || !rs.at || a[rs.idx - 1]?.t === rs.at) return
  rs.idx = Math.max(1, countAtOrBefore(a, rs.at))
}
let timer: ReturnType<typeof setInterval> | null = null

type Listener = () => void
const listeners: Listener[] = []
export function subscribeReplay(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
let onRedraw: ((modeChanged: boolean) => void) | null = null
/**
 * The chart registers its redraw here. `modeChanged` is true when replay was
 * switched on or off — the series length jumps, so the view is refitted; a
 * scrub or step keeps whatever the user is looking at.
 */
export function onReplayChange(fn: (modeChanged: boolean) => void): void {
  onRedraw = fn
}
function emit(redraw = true, modeChanged = false): void {
  listeners.slice().forEach((fn) => fn())
  if (redraw && onRedraw) onRedraw(modeChanged)
}

export function isReplayOn(): boolean {
  return rs.on
}
export function replayInfo(): {
  on: boolean
  idx: number
  total: number
  playing: boolean
  speed: number
  selecting: boolean
  stepBars: number
  sub: string
  /** Waiting for the bar in progress's sub-bars to load. */
  loading: boolean
  at: CandleFlat | null
} {
  syncIdx()
  const total = state.candles.length
  const idx = Math.min(rs.idx, total)
  const shown = rs.on && !rs.selecting ? visibleCandles() : null
  return {
    on: rs.on,
    idx,
    total,
    playing: rs.playing,
    speed: rs.speed,
    selecting: rs.selecting,
    stepBars: rs.stepBars,
    sub: rs.sub,
    loading: !!(rs.on && rs.sub && rs.subT && idx > 0 && subsAt(state.candles[idx - 1].t) === undefined),
    // The bar in progress as far as it has formed: fills and P&L use its close.
    at: shown ? shown[shown.length - 1] ?? null : rs.on && idx > 0 ? state.candles[idx - 1] : null,
  }
}

// ------------------------------------------------- lower-interval stepping
/** Intervals a bar can be replayed by — TradingView's "update interval". */
const UPDATE_IDS = ['1s', '1m', '5m', '15m', '1h', '4h', '1d']

/** The update intervals the current chart interval offers (shorter ones only). */
export function updateIntervals(): string[] {
  const main = mainMs()
  return updateIntervalsFor(
    main,
    UPDATE_IDS.map((id) => ({ id, ms: BASE_MS[id] || 0 })).filter((o) => o.ms > 0),
  ).map((o) => o.id)
}
function mainMs(): number {
  const def = tfDef(state.tf)
  return (BASE_MS[def.base] || 0) * def.factor
}
/** When the bar opening at `t` closes. */
function barEnd(t: number): number {
  return bucketEnd(t, tfDef(state.tf))
}

/**
 * Sub-bars per main bar, keyed symbol|interval|update interval|bar open.
 * undefined = not loaded (a fetch is running or about to), [] = none to be
 * had (the bar is then shown whole).
 */
const subCache = new Map<string, CandleFlat[]>()
const subPending = new Set<string>()
const SUB_CACHE_MAX = 64
const subKey = (open: number): string =>
  String(state.symbol || '') + '|' + String(state.tf || '') + '|' + rs.sub + '|' + open

function subsAt(open: number): CandleFlat[] | undefined {
  return subCache.get(subKey(open))
}

/** Load the sub-bars of the bar opening at `open` (and, once in, the next one's). */
function ensureSubs(open: number, prefetch = true): void {
  if (!rs.sub) return
  const key = subKey(open)
  if (subCache.has(key) || subPending.has(key)) return
  subPending.add(key)
  const end = barEnd(open)
  const n = Math.ceil((end - open) / (BASE_MS[rs.sub] || 60000))
  fetchKlineRows(String(state.symbol || ''), rs.sub, n, end)
    .then((rows) => rows.filter((r) => r.t >= open && r.t < end))
    .catch(() => [] as CandleFlat[])
    .then((rows) => {
      subPending.delete(key)
      if (subCache.size >= SUB_CACHE_MAX) subCache.delete(subCache.keys().next().value as string)
      subCache.set(key, rows)
      if (rs.on && subKey(state.candles[rs.idx - 1]?.t ?? -1) === key) emit()
      if (prefetch && rs.on) {
        const i = countAtOrBefore(state.candles, open)
        const next = state.candles[i]
        if (next) ensureSubs(next.t, false)
      }
    })
}

/** Change the update interval ('' = whole bars). The bar in progress is shown whole. */
export function setUpdateInterval(id: string): void {
  rs.sub = updateIntervals().indexOf(id) === -1 ? '' : id
  rs.subT = 0
  syncIdx()
  const cur = state.candles[rs.idx]
  if (rs.on && cur) ensureSubs(cur.t)
  emit()
}

type SubMove = 'moved' | 'wait' | 'end'
/** One update-interval step, either way, crossing into the next or previous bar as needed. */
function subStep(dir: 1 | -1): SubMove {
  syncIdx()
  const n = state.candles.length
  const bar = state.candles[rs.idx - 1]
  if (!bar) return 'end'
  const subs = subsAt(bar.t)
  if (dir > 0) {
    if (rs.subT) {
      if (subs === undefined) {
        ensureSubs(bar.t)
        return 'wait'
      }
      const nx = nextSubTime(subs, rs.subT)
      if (nx != null) {
        rs.subT = nx
        return 'moved'
      }
    }
    if (rs.idx >= n) return 'end'
    setIdx(rs.idx + 1)
    const nb = state.candles[rs.idx - 1]
    rs.subT = nb.t
    ensureSubs(nb.t)
    return 'moved'
  }
  // Back: the previous sub-bar of this bar, else the previous bar, whole.
  const cur = rs.subT || (subs && subs.length ? subs[subs.length - 1].t : 0)
  if (subs && cur) {
    const pv = prevSubTime(subs, cur)
    if (pv != null && pv >= bar.t) {
      rs.subT = pv
      return 'moved'
    }
  }
  if (rs.idx <= 1) return 'end'
  setIdx(rs.idx - 1)
  return 'moved'
}

/**
 * The replay's "now" (ms): the last moment the chart shows — the end of the
 * last sub-bar of the bar in progress, or of the last whole bar. Null when
 * replay is off or the start bar is being picked. Companion cells cut here.
 */
export function replayNow(): number | null {
  if (!rs.on || rs.selecting) return null
  const shown = visibleCandles()
  const last = shown[shown.length - 1]
  if (!last) return null
  const full = state.candles[Math.min(rs.idx, state.candles.length) - 1]
  if (rs.sub && rs.subT && full && last.t === full.t && subsAt(full.t)?.length)
    return rs.subT + (BASE_MS[rs.sub] || 0) - 1
  return barEnd(last.t) - 1
}

/** The candles the chart should draw right now. */
let memoKey = ''
let memoSrc: CandleFlat[] | null = null
let memo: CandleFlat[] = []
export function visibleCandles(): CandleFlat[] {
  if (!rs.on || rs.selecting) return state.candles
  syncIdx()
  const a = state.candles
  const n = Math.max(1, Math.min(rs.idx, a.length))
  const last = a[n - 1]
  const subs = rs.sub && rs.subT && last ? subsAt(last.t) : undefined
  const key = [n, last?.t, last?.c, rs.sub, rs.subT, subs ? subs.length : -1].join('|')
  // The chart asks many times per frame: hand back the same array until the
  // position or the data under it changes.
  if (a === memoSrc && key === memoKey) return memo
  memoSrc = a
  memoKey = key
  const out = a.slice(0, n)
  if (rs.sub && rs.subT && last) {
    if (subs === undefined) {
      // Still loading: the bar in progress is not drawn rather than shown whole.
      if (out.length > 1) out.pop()
    } else if (subs.length) {
      const fb = formingBar(subs, last.t, rs.subT)
      if (fb) out[out.length - 1] = fb
      else if (out.length > 1) out.pop()
    }
  }
  memo = out
  return memo
}

function stopTimer(): void {
  if (timer) clearInterval(timer)
  timer = null
}

function startTimer(): void {
  stopTimer()
  timer = setInterval(() => {
    if (!rs.on || !rs.playing) return stopTimer()
    syncIdx()
    if (rs.sub) {
      // A tick waits on a bar whose sub-bars are still loading.
      const m = subStep(1)
      if (m === 'wait') return
      if (m === 'end') {
        rs.playing = false
        stopTimer()
      }
      emit()
      return
    }
    if (rs.idx >= state.candles.length) {
      rs.playing = false
      stopTimer()
      emit()
      return
    }
    setIdx(rs.idx + 1)
    emit()
  }, 600 / rs.speed)
}

export function toggleReplay(): void {
  if (rs.on) return exitReplay()
  rs.on = true
  rs.playing = false
  stopTimer()
  // The update interval must be shorter than this chart's interval.
  if (rs.sub && updateIntervals().indexOf(rs.sub) === -1) rs.sub = ''
  const n = state.candles.length
  setIdx(Math.max(1, Math.min(n, Math.floor(n * START_FRACTION))))
  // Like TradingView, replay opens by asking for the start bar. The chart
  // still shows every bar while picking, so the view is left where it is.
  rs.selecting = true
  emit(true, false)
}

export function exitReplay(): void {
  if (!rs.on) return
  const wasSelecting = rs.selecting
  rs.on = false
  rs.playing = false
  rs.selecting = false
  stopTimer()
  // Leaving the picker draws the same full series: no refit needed.
  emit(true, !wasSelecting)
}

export function isSelecting(): boolean {
  return rs.on && rs.selecting
}

/** Re-open the start-bar picker (turning replay on if it is off). */
export function startSelect(): void {
  if (!rs.on) return toggleReplay()
  rs.playing = false
  stopTimer()
  rs.selecting = true
  emit(true, false)
}

/**
 * Leave the picker before a transport action. The series shrinks from all
 * bars to the replay slice, so the view is refitted onto the cut — otherwise
 * it could be left over bars that no longer exist.
 */
function endSelect(): boolean {
  if (!rs.selecting) return false
  rs.selecting = false
  return true
}

/**
 * Start from the bar opening at `t` (ms) — a click on the chart. The view is
 * kept: the clicked bar stays under the cursor and the future to its right
 * just disappears, as on TradingView.
 */
export function selectBarAt(t: number): void {
  if (!rs.on || !state.candles.length) return
  rs.selecting = false
  setIdx(Math.max(1, countAtOrBefore(state.candles, t)))
  emit()
}

/** Start from a calendar date (ms). False when it lies outside the loaded bars. */
export function selectDate(t: number): boolean {
  const a = state.candles
  if (!a.length || !Number.isFinite(t)) return false
  if (!rs.on) toggleReplay()
  rs.playing = false
  stopTimer()
  rs.selecting = false
  setIdx(countFromDate(a, t))
  emit(true, true)
  return t >= a[0].t && t <= a[a.length - 1].t
}

/**
 * Start from a calendar date, paging older history in first when the date
 * lies before the loaded bars (up to the history cap). Resolves false when
 * the date still could not be reached.
 */
export async function selectDateLoading(t: number, onLoading?: () => void): Promise<boolean> {
  if (!Number.isFinite(t)) return false
  let a = state.candles
  if (a.length && t < a[0].t && !historyExhausted()) {
    onLoading?.()
    const sym = state.symbol
    const tf = state.tf
    // A page is ~500 bars; the history cap stops this long before the guard.
    for (let i = 0; i < 20 && state.candles.length && t < state.candles[0].t; i++) {
      const added = await fetchOlderKlines()
      if (state.symbol !== sym || state.tf !== tf) return false
      if (added <= 0 && (historyExhausted() || i > 2)) break
    }
    a = state.candles
  }
  return selectDate(t) && !!a.length
}

/** Start from a random bar, away from both ends of the loaded history. */
export function randomBar(): void {
  if (!state.candles.length) return
  if (!rs.on) toggleReplay()
  rs.playing = false
  stopTimer()
  rs.selecting = false
  setIdx(randomCount(state.candles.length, Math.random))
  emit(true, true)
}

export function playPause(): void {
  if (!rs.on) return
  const refit = endSelect()
  syncIdx()
  if (rs.idx >= state.candles.length) setIdx(Math.max(1, Math.floor(state.candles.length * 0.5)))
  rs.playing = !rs.playing
  if (rs.playing) startTimer()
  else stopTimer()
  emit(true, refit)
}

export function step(delta: number): void {
  if (!rs.on) return
  rs.playing = false
  stopTimer()
  const refit = endSelect()
  syncIdx()
  if (rs.sub && delta !== 0) {
    for (let k = 0; k < Math.abs(delta); k++) if (subStep(delta > 0 ? 1 : -1) !== 'moved') break
  } else setIdx(Math.max(1, Math.min(state.candles.length, rs.idx + delta)))
  emit(true, refit)
}

/** One press of the step buttons: the chosen step size, either way. */
export function stepBy(dir: 1 | -1): void {
  step(dir * rs.stepBars)
}

export function setStepBars(n: number): void {
  rs.stepBars = STEP_SIZES.indexOf(n) === -1 ? 1 : n
  emit(false)
}

export function seek(idx: number): void {
  if (!rs.on) return
  const refit = endSelect()
  setIdx(Math.max(1, Math.min(state.candles.length, Math.round(idx))))
  emit(true, refit)
}

export function setSpeed(s: number): void {
  rs.speed = SPEEDS.indexOf(s) === -1 ? 1 : s
  if (rs.playing) startTimer()
  emit(false)
}

export function restart(): void {
  if (!rs.on) return
  const refit = endSelect()
  setIdx(1)
  emit(true, refit)
}
