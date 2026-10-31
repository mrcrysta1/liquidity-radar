// Price-scale modes and navigation for the main price chart, TradingView-style.
//
// Scale: Auto (fit), Log, Percent, Indexed to 100, Invert and Lock
// price-to-bar ratio, applied to the main chart's right price scale only —
// indicator panes and the delta strip sit on their own overlay scales and
// keep them. Mode, invert and lock are remembered per chart: per layout cell,
// since the main chart moves between cells (companionCharts activateCell).
//
// Navigation: zoom in/out, scroll to real time, reset (also Alt+R), the
// date-range quick buttons, and double-click on either axis.
//
// The chart hands itself over through attachScaleNav (chartRender initChart),
// so this module never imports chartRender. The React face is
// components/chart/ScaleNav.tsx.
import { storageGet, storageSet } from '../../services/storage'
import { getTimeframe, setTimeframe, subscribeTimeframe } from './timeframes'
import {
  DEFAULT_SCALE_PREFS,
  LWC_SCALE_MODE,
  cleanScalePrefs,
  rangePreset,
  rangeStartMs,
  zoomLogicalRange,
} from './scaleNavMath'
import type { ScaleMode, ScalePrefs } from './scaleNavMath'

type Any = any

export interface ScaleNavDeps {
  chart: Any
  /** The #chart element the library draws into. */
  el: HTMLElement
  /** The live price series (rebuilt on every style change). */
  getSeries: () => Any
  onSeriesChange: (fn: (s: Any) => void) => () => void
}

const KEY = 'lr-chartScale'
const ZOOM_STEP = 1.25
/** Empty bars left right of the latest bar when a date range is shown. */
const RANGE_PAD = 3
/** Context-menu box, for keeping it inside the chart (matches .sn-menu in index.css). */
const MENU_W = 220
const MENU_H = 370

let deps: ScaleNavDeps | null = null
/** Layout cell the main chart is in; prefs are stored under it. */
let cell = 0
const saved: Record<string, ScalePrefs> = (function () {
  const raw = storageGet<Record<string, unknown>>(KEY, {})
  const cells =
    raw && typeof raw === 'object' && raw.cells && typeof raw.cells === 'object' ? raw.cells : {}
  const out: Record<string, ScalePrefs> = {}
  Object.keys(cells as object).forEach((k) => {
    out[k] = cleanScalePrefs((cells as Record<string, unknown>)[k])
  })
  return out
})()
let prefs: ScalePrefs = saved['0'] || { ...DEFAULT_SCALE_PREFS }
/** Autoscale on. Session state: a manual price range is not worth restoring. */
let auto = true
/** Scrolled back far enough that the latest bar is out of view. */
let away = false
/** Price per pixel, per pixel of bar spacing, captured when lock was turned on. */
let lockRatio = 0
/** Last date-range button pressed; cleared once the user pans or zooms. */
let rangeSel: string | null = null
/** A date range waiting for the reload its interval switch started. */
let pending: { id: string; tf: string; until: number } | null = null
/**
 * Price-scale context menu position (inside #chartWrap) and the price under
 * the right-click (null when there is none), or null when closed.
 */
let menu: { x: number; y: number; price: number | null } | null = null
let psW = 56
let tsH = 26

export interface ScaleNavState {
  ready: boolean
  mode: ScaleMode
  invert: boolean
  lock: boolean
  /** Autoscale as shown: lock drives the scale itself, so Auto reads off. */
  auto: boolean
  away: boolean
  range: string | null
  menu: { x: number; y: number; price: number | null } | null
  /** Right price-scale width and time-axis height, for placing overlay buttons. */
  psW: number
  tsH: number
}
function build(): ScaleNavState {
  return {
    ready: !!deps,
    mode: prefs.mode,
    invert: prefs.invert,
    lock: prefs.lock,
    auto: auto && !prefs.lock,
    away,
    range: rangeSel,
    menu,
    psW,
    tsH,
  }
}
let snap = build()
type Listener = () => void
const listeners: Listener[] = []
export function subscribeScaleNav(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
export const scaleNavSnapshot = (): ScaleNavState => snap
function emit(): void {
  snap = build()
  listeners.slice().forEach((fn) => fn())
}

function save(): void {
  saved[String(cell)] = { ...prefs }
  storageSet(KEY, { cells: saved })
}

// ---- Applying to the chart ----
function priceScale(): Any {
  return deps ? deps.chart.priceScale('right') : null
}

function applyScale(): void {
  const ps = priceScale()
  if (!ps) return
  try {
    ps.applyOptions({
      mode: LWC_SCALE_MODE[prefs.mode],
      invertScale: prefs.invert,
      // Lock works through the autoscale provider below, so it needs autoscale on.
      autoScale: auto || prefs.lock,
    })
  } catch {
    /* scale not mounted yet */
  }
  installProvider()
}

/** Current bar spacing in pixels, from what is on screen. */
function barSpacing(): number {
  if (!deps) return 0
  const ts = deps.chart.timeScale()
  const r = ts.getVisibleLogicalRange()
  const w = ts.width()
  return r && r.to > r.from && w > 0 ? w / (r.to - r.from) : 0
}
/** Height in pixels the main price range is drawn over (inside its margins). */
function priceHeight(): number {
  if (!deps) return 0
  const h = Number(deps.chart.paneSize()?.height) || 0
  const m = priceScale()?.options()?.scaleMargins || { top: 0, bottom: 0 }
  return h * Math.max(0.05, 1 - (m.top || 0) - (m.bottom || 0))
}

/**
 * Lock price-to-bar ratio. lightweight-charts has no such option, so the
 * price series' autoscale provider sizes the range from the bar spacing:
 * zooming the time scale zooms price by the same factor, centred where
 * autoscale would have centred it.
 */
function lockedRange(orig: () => Any): Any {
  const o = orig()
  if (!prefs.lock || !(lockRatio > 0) || !o || !o.priceRange) return o
  const sp = barSpacing()
  const h = priceHeight()
  if (!(sp > 0) || !(h > 0)) return o
  const mid = (o.priceRange.minValue + o.priceRange.maxValue) / 2
  const half = (lockRatio * sp * h) / 2
  return { priceRange: { minValue: mid - half, maxValue: mid + half }, margins: o.margins }
}
function installProvider(): void {
  const s = deps?.getSeries()
  if (!s) return
  try {
    // A fresh function each time, so the library re-runs autoscale now.
    s.applyOptions({ autoscaleInfoProvider: (orig: () => Any) => lockedRange(orig) })
  } catch {
    /* series detached */
  }
}

function captureLockRatio(): boolean {
  const s = deps?.getSeries()
  const sp = barSpacing()
  if (!s || !(sp > 0)) return false
  try {
    const a = s.coordinateToPrice(50)
    const b = s.coordinateToPrice(150)
    if (a == null || b == null) return false
    const ppp = Math.abs(a - b) / 100
    if (!(ppp > 0)) return false
    lockRatio = ppp / sp
    return true
  } catch {
    return false
  }
}

// ---- Public scale controls ----
export function setScaleMode(mode: ScaleMode): void {
  if (mode === prefs.mode && !prefs.lock) return
  // Percent/indexed/log ranges are not linear in price: lock means nothing there.
  prefs = { ...prefs, mode, lock: mode === 'normal' ? prefs.lock : false }
  auto = true
  save()
  applyScale()
  emit()
}
/** The % and log buttons: on switches to that mode, off goes back to regular. */
export function toggleScaleMode(mode: ScaleMode): void {
  setScaleMode(prefs.mode === mode ? 'normal' : mode)
}
export function setInvert(on: boolean): void {
  if (on === prefs.invert) return
  prefs = { ...prefs, invert: on }
  save()
  applyScale()
  emit()
}
export function setAutoScale(on: boolean): void {
  auto = on
  if (on && prefs.lock) {
    prefs = { ...prefs, lock: false }
    save()
  }
  applyScale()
  emit()
}
export function setLock(on: boolean): void {
  if (on === prefs.lock) return
  if (on && prefs.mode !== 'normal') {
    // Measure the ratio on the regular scale, once it has been drawn.
    prefs = { ...prefs, mode: 'normal' }
    auto = true
    save()
    applyScale()
    emit()
    setTimeout(() => setLock(true), 60)
    return
  }
  if (on && !captureLockRatio()) return
  prefs = { ...prefs, lock: on }
  auto = !on
  save()
  applyScale()
  emit()
}

/**
 * The ratio belongs to the data it was measured on — a ratio taken on BTC is
 * meaningless on a sub-dollar coin. After a fresh dataset (or a cell switch)
 * let autoscale fit it once, then lock again from there.
 */
function rebaseLock(): void {
  if (!prefs.lock) return
  lockRatio = 0
  installProvider()
  setTimeout(() => {
    if (!prefs.lock) return
    if (captureLockRatio()) installProvider()
  }, 60)
}

/** Double-click on the price scale, "Reset price scale". */
export function resetPriceScale(): void {
  setAutoScale(true)
}

// ---- Navigation ----
export function zoomChart(dir: 1 | -1): void {
  if (!deps) return
  const ts = deps.chart.timeScale()
  const r = ts.getVisibleLogicalRange()
  if (!r) return
  clearRange()
  ts.setVisibleLogicalRange(zoomLogicalRange(r, dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, !away))
}
export function scrollToRealTime(): void {
  deps?.chart.timeScale().scrollToRealTime()
}
/** Double-click on the time scale: default bar spacing, latest bar in view. */
export function resetTimeScale(): void {
  if (!deps) return
  clearRange()
  deps.chart.timeScale().resetTimeScale()
}
/** Alt+R and the reset button: autoscale back on and the time scale reset. */
export function resetChartView(): void {
  if (!deps) return
  closeScaleMenu()
  resetTimeScale()
  resetPriceScale()
}

function clearRange(): void {
  pending = null
  if (rangeSel == null) return
  rangeSel = null
  emit()
}

/**
 * A date-range quick button: switch to an interval that fits the range, then
 * show it. Switching interval reloads; the range is applied when that load
 * fits the chart (afterChartFit).
 */
export function selectRange(id: string): void {
  const p = rangePreset(id)
  if (!p || !deps) return
  rangeSel = p.id
  pending = { id: p.id, tf: p.tf, until: Date.now() + 15000 }
  if (p.tf !== getTimeframe()) setTimeframe(p.tf)
  else applyRange()
  emit()
}
function applyRange(): void {
  if (!deps || !pending) return
  const ts = deps.chart.timeScale()
  const start = rangeStartMs(pending.id, Date.now())
  const go = () => {
    try {
      if (start == null) return ts.fitContent()
      // From the first bar of the range to the latest, with a little room on
      // the right as TradingView leaves it.
      const data: Array<{ time: number }> = deps?.getSeries()?.data() || []
      if (!data.length) return
      const from = Math.floor(start / 1000)
      const i = Math.max(
        0,
        data.findIndex((b) => Number(b.time) >= from),
      )
      ts.setVisibleLogicalRange({ from: i - 0.5, to: data.length - 1 + RANGE_PAD })
    } catch {
      /* no data yet */
    }
  }
  go()
  // A pane added in the same redraw can scroll the chart back afterwards.
  requestAnimationFrame(go)
}

/**
 * Called by chartRender right after a fresh dataset was fitted. Applies a
 * date range still waiting for its reload; it stays armed for a few seconds
 * so a cached render followed by the fresh one both land on the range.
 */
export function afterChartFit(): void {
  rebaseLock()
  if (!pending) return
  if (Date.now() > pending.until) {
    pending = null
    return
  }
  if (getTimeframe() === pending.tf) applyRange()
}

// ---- Price-scale context menu ----
export function openScaleMenu(x: number, y: number, price: number | null = null): void {
  menu = { x, y, price }
  emit()
}

/** Price at a y offset inside the chart element (series coordinates, so it is a real price in % / indexed modes too). */
function priceAtY(y: number): number | null {
  try {
    const s = deps && deps.getSeries()
    const p = s ? Number(s.coordinateToPrice(y)) : NaN
    return Number.isFinite(p) && p > 0 ? p : null
  } catch {
    return null
  }
}
export function closeScaleMenu(): void {
  if (!menu) return
  menu = null
  emit()
}

// ---- Per-chart prefs ----
/** The main chart moved to layout cell `pos`: load that cell's scale settings. */
export function setScaleCell(pos: number): void {
  if (pos === cell) return
  cell = pos
  prefs = saved[String(pos)] || { ...DEFAULT_SCALE_PREFS }
  auto = true
  pending = null
  rangeSel = null
  menu = null
  lockRatio = 0
  applyScale()
  rebaseLock()
  emit()
}

// ---- Wiring ----
/** Pull autoscale and on-screen state back from the chart after the user moved it. */
function syncFromChart(): void {
  if (!deps) return
  let changed = false
  try {
    const a = !!priceScale().options().autoScale
    if (prefs.lock && !a) {
      // Dragging the price scale takes it off autoscale: that ends the lock.
      prefs = { ...prefs, lock: false }
      save()
      installProvider()
      auto = false
      changed = true
    } else if (!prefs.lock && a !== auto) {
      auto = a
      changed = true
    }
  } catch {
    /* scale not mounted yet */
  }
  if (changed) emit()
}

/** Re-measure the axes and panes the overlays are positioned against. */
export function syncView(): void {
  if (!deps) return
  const ts = deps.chart.timeScale()
  let a = away
  let w = psW
  let h = tsH
  try {
    a = ts.scrollPosition() < -1
    w = Number(priceScale().width()) || w
    h = Number(ts.height()) || h
    // Native panes (lightweight-charts v5) sit between the price pane and the
    // time axis: the overlays anchored above the axis (zoom bar, whale
    // legend) clear them too, so they stay over the candles.
    const panes = deps.chart.panes?.() || []
    for (let i = 1; i < panes.length; i++) h += Number(panes[i].getHeight()) + 1
  } catch {
    /* no data yet */
  }
  if (a === away && w === psW && h === tsH) return
  away = a
  psW = w
  tsH = h
  emit()
}

type Zone = 'price' | 'time' | null
function zoneAt(e: MouseEvent): Zone {
  if (!deps) return null
  const r = deps.el.getBoundingClientRect()
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  if (y > r.height - tsH) return x > r.width - psW ? null : 'time'
  if (x > r.width - psW) return 'price'
  return null
}

export function attachScaleNav(d: ScaleNavDeps): void {
  deps = d
  const { chart, el } = d
  applyScale()
  rebaseLock()
  d.onSeriesChange(() => installProvider())
  chart.timeScale().subscribeVisibleLogicalRangeChange(syncView)
  // Panes appear, disappear and are dragged to new heights without the range
  // changing; the mouse is on the chart whenever that happens. syncView only
  // emits when a size actually changed.
  chart.subscribeCrosshairMove(syncView)
  // Another interval picked by hand: the range button no longer describes the chart.
  subscribeTimeframe(() => {
    const p = rangeSel ? rangePreset(rangeSel) : null
    if (p && p.tf !== getTimeframe()) clearRange()
  })

  // The user moved the chart: the date-range highlight no longer describes it.
  const moved = () => {
    clearRange()
    closeScaleMenu()
  }
  el.addEventListener('mousedown', moved, true)
  el.addEventListener('touchstart', moved, { capture: true, passive: true })
  el.addEventListener('wheel', moved, { capture: true, passive: true })
  const later = () => requestAnimationFrame(syncFromChart)
  el.addEventListener('pointerup', later, true)
  el.addEventListener('touchend', later, { capture: true, passive: true })

  // The library already resets on axis double-click; follow it explicitly so
  // the Auto button and the lock agree with what the chart shows.
  el.addEventListener('dblclick', (e) => {
    const z = zoneAt(e)
    if (z === 'price') resetPriceScale()
    else if (z === 'time') resetTimeScale()
  })
  el.addEventListener('contextmenu', (e) => {
    if (zoneAt(e) !== 'price') return
    e.preventDefault()
    // Opens to the left of the cursor (the scale is at the right edge), kept
    // inside the chart; positioned in #chartWrap, the menu's container.
    const wrap = el.parentElement || el
    const r = wrap.getBoundingClientRect()
    const x = e.clientX - r.left - MENU_W
    const y = e.clientY - r.top
    openScaleMenu(
      Math.max(4, Math.min(x, r.width - MENU_W - 4)),
      Math.max(4, Math.min(y, r.height - MENU_H - 4)),
      priceAtY(e.clientY - el.getBoundingClientRect().top),
    )
  })
  syncView()
  emit()
}
