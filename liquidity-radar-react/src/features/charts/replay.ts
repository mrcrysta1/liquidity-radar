// Bar replay for the price-action chart — the Pro terminal's replay, with a
// proper transport.
//
// Replay never touches the live candle array: it only caps how much of it the
// chart draws. Turning replay off restores the full series, and live socket
// ticks are ignored for rendering while it is on so the tape cannot jump ahead
// of where the user is.
import { state } from '../../services/store'
import type { CandleFlat } from '../../services/market'
import { countAtOrBefore, countFromDate, randomCount } from './replayMath'

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
}

const rs: ReplayState = {
  on: false,
  idx: 0,
  at: 0,
  playing: false,
  speed: 1,
  selecting: false,
  stepBars: 1,
}

/** Set the position by count, remembering it as the last visible bar's time. */
function setIdx(i: number): void {
  rs.idx = i
  rs.at = state.candles[i - 1]?.t ?? 0
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
  at: CandleFlat | null
} {
  syncIdx()
  const total = state.candles.length
  const idx = Math.min(rs.idx, total)
  return {
    on: rs.on,
    idx,
    total,
    playing: rs.playing,
    speed: rs.speed,
    selecting: rs.selecting,
    stepBars: rs.stepBars,
    at: rs.on && idx > 0 ? state.candles[idx - 1] : null,
  }
}

/** The candles the chart should draw right now. */
export function visibleCandles(): CandleFlat[] {
  if (!rs.on || rs.selecting) return state.candles
  syncIdx()
  return state.candles.slice(0, Math.max(1, Math.min(rs.idx, state.candles.length)))
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
  setIdx(Math.max(1, Math.min(state.candles.length, rs.idx + delta)))
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
