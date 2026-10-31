// Bar replay for the price-action chart — the Pro terminal's replay, with a
// proper transport.
//
// Replay never touches the live candle array: it only caps how much of it the
// chart draws. Turning replay off restores the full series, and live socket
// ticks are ignored for rendering while it is on so the tape cannot jump ahead
// of where the user is.
import { state } from '../../services/store'
import type { CandleFlat } from '../../services/market'

export const SPEEDS = [0.5, 1, 2, 5, 10]
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
}

const rs: ReplayState = { on: false, idx: 0, at: 0, playing: false, speed: 1 }

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
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid].t <= rs.at) lo = mid + 1
    else hi = mid
  }
  rs.idx = Math.max(1, lo)
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
    at: rs.on && idx > 0 ? state.candles[idx - 1] : null,
  }
}

/** The candles the chart should draw right now. */
export function visibleCandles(): CandleFlat[] {
  if (!rs.on) return state.candles
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
  rs.on = !rs.on
  rs.playing = false
  stopTimer()
  if (rs.on) {
    const n = state.candles.length
    setIdx(Math.max(1, Math.min(n, Math.floor(n * START_FRACTION))))
  }
  emit(true, true)
}

export function exitReplay(): void {
  if (!rs.on) return
  rs.on = false
  rs.playing = false
  stopTimer()
  emit(true, true)
}

export function playPause(): void {
  if (!rs.on) return
  syncIdx()
  if (rs.idx >= state.candles.length) setIdx(Math.max(1, Math.floor(state.candles.length * 0.5)))
  rs.playing = !rs.playing
  if (rs.playing) startTimer()
  else stopTimer()
  emit()
}

export function step(delta: number): void {
  if (!rs.on) return
  rs.playing = false
  stopTimer()
  syncIdx()
  setIdx(Math.max(1, Math.min(state.candles.length, rs.idx + delta)))
  emit()
}

export function seek(idx: number): void {
  if (!rs.on) return
  setIdx(Math.max(1, Math.min(state.candles.length, Math.round(idx))))
  emit()
}

export function setSpeed(s: number): void {
  rs.speed = SPEEDS.indexOf(s) === -1 ? 1 : s
  if (rs.playing) startTimer()
  emit(false)
}

export function restart(): void {
  if (!rs.on) return
  setIdx(1)
  emit()
}
