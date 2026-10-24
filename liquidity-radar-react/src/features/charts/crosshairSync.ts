// Crosshair sync across the multi-chart layout, TradingView-style.
//
// Every chart in the layout (the main chart and each companion cell) joins
// the hub. Moving the cursor over one chart puts a crosshair on all the
// others at the same moment in time. Cells can show different coins and
// timeframes, so each follower snaps to its own bar at or before the hovered
// time, and its horizontal line sits on that bar's close: prices are never
// mapped across symbols.
//
// lightweight-charts 4.1 does not fire crosshairMove for setCrosshairPosition,
// so followers are told through `onSync` (their legends show the synced bar).
// A re-entrancy guard still keeps charts from echoing each other should a
// library update start firing it.
import { storageGet, storageSet } from '../../services/storage'
import { barAtOrBefore } from './crosshairSyncMath'

type Any = any

/** A bar as the charts keep them: open time in milliseconds, close price. */
interface SyncBar {
  t: number
  c: number
}

export interface CrosshairMember {
  chart: Any
  /** The chart's price series (the crosshair is set against it). */
  series: () => Any
  /** The bars on the chart, oldest first. */
  bars: () => readonly SyncBar[]
  /**
   * Another chart moved this chart's crosshair to the bar at `time`
   * (seconds), or took it away (null).
   */
  onSync?: (time: number | null) => void
}

interface Entry {
  m: CrosshairMember
  handler: (param: Any) => void
  /** Its crosshair is currently placed by another chart. */
  following: boolean
}

const STORE_KEY = 'lr-crosshairSync'

const entries: Entry[] = []
let syncing = false
let enabled = storageGet<unknown>(STORE_KEY, true) !== false

export function isCrosshairSyncOn(): boolean {
  return enabled
}

export function setCrosshairSync(on: boolean): void {
  if (on === enabled) return
  enabled = on
  storageSet(STORE_KEY, on)
  if (!on) entries.forEach(release)
}

function release(e: Entry): void {
  if (!e.following) return
  e.following = false
  try {
    e.m.chart.clearCrosshairPosition()
  } catch (err) {
    /* chart already removed */
  }
  e.m.onSync?.(null)
}

function follow(e: Entry, timeSec: number): void {
  const bars = e.m.bars()
  const i = barAtOrBefore(bars, timeSec)
  const series = e.m.series()
  if (i < 0 || !series) return release(e)
  const b = bars[i]
  const t = Math.floor(b.t / 1000)
  try {
    e.m.chart.setCrosshairPosition(b.c, t, series)
  } catch (err) {
    // No data on the chart yet: nothing to point at.
    return release(e)
  }
  e.following = true
  e.m.onSync?.(t)
}

function broadcast(from: Entry, param: Any): void {
  if (syncing || !enabled || entries.length < 2) return
  // The cursor over this chart is its own crosshair, not a synced one.
  from.following = false
  const time = param && param.point && typeof param.time === 'number' ? param.time : null
  syncing = true
  try {
    entries.forEach((e) => {
      if (e === from) return
      if (time == null) release(e)
      else follow(e, time)
    })
  } finally {
    syncing = false
  }
}

/** Join the hub; returns the call that leaves it (before chart.remove()). */
export function registerCrosshairSync(m: CrosshairMember): () => void {
  const e: Entry = { m, handler: () => {}, following: false }
  e.handler = (param: Any) => broadcast(e, param)
  entries.push(e)
  m.chart.subscribeCrosshairMove(e.handler)
  return () => {
    const i = entries.indexOf(e)
    if (i === -1) return
    entries.splice(i, 1)
    // A chart leaving mid-hover takes its synced crosshairs with it.
    entries.forEach(release)
    try {
      m.chart.unsubscribeCrosshairMove(e.handler)
    } catch (err) {
      /* chart already removed */
    }
  }
}
