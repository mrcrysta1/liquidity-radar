// The price chart's look — TradingView's defaults, mapped onto the app's
// palette system.
//
// The default palette (Radar Navy) draws its charts exactly like TradingView:
// #131722 / white canvas, barely-there grid, #089981 / #F23645 candles, grey
// dashed crosshair. Every other palette keeps its own colours (read live from
// the CSS variables applyPalette writes) and only borrows the TradingView
// structure — dashed crosshair, grey labels, fonts — so the palette switcher
// still changes the chart.
//
// Kept free of chart imports so the close timer and the indicator renderer can
// read the same colours without an import cycle through chartRender.
import { createTextWatermark } from 'lightweight-charts'
import { chartTzOptions } from './timezone'
import { chartSettings } from './chartSettings'
import { settingsChartOptions } from './chartSettingsMath'

type Any = any

/** TradingView's scale font stack. */
export const TV_FONT =
  "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif"
export const TV_FONT_SIZE = 12

export interface ChartPalette {
  bg: string
  txt: string
  grid: string
  border: string
  up: string
  dn: string
  /** Crosshair lines, and their axis labels. */
  cross: string
  crossLabel: string
  watermark: string
}

const TV_DARK: ChartPalette = {
  bg: '#131722',
  txt: '#B2B5BE',
  grid: 'rgba(42,46,57,.6)',
  border: '#2A2E39',
  up: '#089981',
  dn: '#F23645',
  cross: '#9598A1',
  crossLabel: '#363A45',
  watermark: 'rgba(178,181,190,.07)',
}
const TV_LIGHT: ChartPalette = {
  bg: '#FFFFFF',
  txt: '#131722',
  grid: '#F0F3FA',
  border: '#E0E3EB',
  up: '#089981',
  dn: '#F23645',
  cross: '#9598A1',
  crossLabel: '#131722',
  watermark: 'rgba(19,23,34,.06)',
}

function lightMode(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'light'
}
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--' + name)
    .trim()
  return v || fallback
}

/** True while the default palette — the one drawn as TradingView — is active. */
export function isTvPalette(): boolean {
  const id = document.documentElement.dataset.palette
  return !id || id === 'navy'
}

/**
 * Read on every live tick (price-line colour, legend, volume bars), once per
 * panel: getComputedStyle six times each time forced style recalculation.
 * Cached per theme + palette, which are what the CSS variables follow.
 */
let paletteKey = ''
let paletteCache: ChartPalette | null = null
export function chartPalette(): ChartPalette {
  const light = lightMode()
  if (isTvPalette()) return light ? TV_LIGHT : TV_DARK
  const key = (light ? 'l' : 'd') + '|' + (document.documentElement.dataset.palette || '')
  if (paletteCache && key === paletteKey) return paletteCache
  paletteKey = key
  paletteCache = readPalette(light)
  return paletteCache
}
function readPalette(light: boolean): ChartPalette {
  return {
    bg: cssVar('card', light ? '#FFFFFF' : '#0D1628'),
    txt: cssVar('muted', light ? '#6B7280' : '#8FA3BF'),
    grid: light ? '#E5E7EB' : '#12203A',
    border: cssVar('border', light ? '#D1D5DB' : '#1A2D4A'),
    up: cssVar('green', '#00E676'),
    dn: cssVar('red', '#FF1744'),
    cross: cssVar('dim', '#9598A1'),
    crossLabel: cssVar('border2', light ? '#9CA3AF' : '#22385E'),
    watermark: light ? 'rgba(31,41,55,.06)' : 'rgba(232,238,249,.06)',
  }
}

/** `#RRGGBB` (or `#RGB`) at alpha `a`; anything else is returned unchanged. */
export function withAlpha(color: string, a: number): string {
  let h = color.trim()
  if (/^#[0-9a-f]{3}$/i.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]
  if (!/^#[0-9a-f]{6}$/i.test(h)) return color
  const n = parseInt(h.slice(1), 16)
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
}

/** Volume bar colour: the candle's direction at TradingView's ~50% alpha. */
export function volumeColor(up: boolean): string {
  const p = chartPalette()
  return withAlpha(up ? p.up : p.dn, 0.5)
}

/**
 * Chart options shared by the main chart and the companions. Includes the
 * time-zone formatters (./timezone); `daily` reports whether the chart's bars
 * are a day or longer, which are dated by their UTC session.
 */
export function tvChartOptions(
  p: ChartPalette = chartPalette(),
  daily?: () => boolean,
): Record<string, unknown> {
  const tz = chartTzOptions(daily)
  // The user's chart settings (background, grid, crosshair, label mode) ride
  // on top, so every chart built or re-themed from here honours them.
  const st = settingsChartOptions(chartSettings(), p.bg) as Any
  return {
    localization: tz.localization,
    layout: {
      background: st.layout.background,
      textColor: p.txt,
      fontSize: TV_FONT_SIZE,
      fontFamily: TV_FONT,
      // v5's pane divider defaults to #E0E3EB: a bright line on the dark theme.
      panes: { separatorColor: p.border, separatorHoverColor: 'rgba(178,181,189,0.2)' },
    },
    grid: {
      vertLines: { color: p.grid, ...st.grid.vertLines },
      horzLines: { color: p.grid, ...st.grid.horzLines },
    },
    rightPriceScale: {
      borderVisible: true,
      borderColor: p.border,
      ...st.rightPriceScale,
      // Axis label collisions (audit U12): lightweight-charts 5.2 draws the
      // tick labels and then the last-price / crosshair labels on top, and has
      // no option to drop a tick hidden under a label. The closest levers:
      // fewer ticks (a higher density spaces them further apart, so a label
      // covers at most one), no clipped half-labels at the top and bottom
      // edges, and a minimum width so the scale does not jump as labels with
      // more digits appear (which re-laid every tick). alignLabels — on by
      // default, see the Scales setting — keeps the labels off each other.
      tickMarkDensity: 3.4,
      entireTextOnly: true,
      minimumWidth: 64,
    },
    timeScale: { ...tz.timeScale, borderVisible: true, borderColor: p.border },
    crosshair: {
      // LargeDashed lines with grey labels, as TradingView draws them (the
      // Canvas setting can make them dotted or solid).
      mode: st.crosshair.mode,
      vertLine: { color: p.cross, width: 1, style: st.crosshair.vertLine.style, labelBackgroundColor: p.crossLabel },
      horzLine: { color: p.cross, width: 1, style: st.crosshair.horzLine.style, labelBackgroundColor: p.crossLabel },
    },
  }
}

/**
 * TradingView's last-price marker: a dotted line, with the line and its axis
 * label in the colour of the last bar's direction. Applied over whatever the
 * style's series set, and only when it changes — the live tick calls this.
 */
export function tvLastPrice(series: { applyOptions(o: unknown): void } | null, up: boolean): void {
  if (!series) return
  const p = chartPalette()
  // A custom candle body colour (chart settings) colours the marker too.
  const st = chartSettings()
  const color = up ? st.bodyUp || p.up : st.bodyDown || p.dn
  const s = series as unknown as { __tvLast?: string }
  if (s.__tvLast === color) return
  s.__tvLast = color
  series.applyOptions({ priceLineColor: color, priceLineStyle: 1, priceLineWidth: 1 })
}
/** Forget the cached colour so the next tvLastPrice re-applies it (after a re-theme). */
export function resetTvLastPrice(series: unknown): void {
  if (series) (series as { __tvLast?: string }).__tvLast = undefined
}

/**
 * TradingView-style watermark: symbol and interval, faint, mid-chart.
 * lightweight-charts v5 made the watermark a plugin on a pane, so this keeps
 * one per chart (on its main pane) and updates it in place.
 */
const watermarks = new WeakMap<object, { applyOptions(o: unknown): void }>()
export function syncTvWatermark(
  chart: Any,
  text: string,
  fontSize = 52,
  p: ChartPalette = chartPalette(),
): void {
  const pane = chart?.panes?.()[0]
  if (!pane) return
  const opts = {
    visible: !!text,
    horzAlign: 'center',
    vertAlign: 'center',
    lines: [{ text, color: p.watermark, fontSize, fontFamily: TV_FONT }],
  }
  const w = watermarks.get(chart)
  if (w) w.applyOptions(opts)
  else watermarks.set(chart, createTextWatermark(pane, opts as Any))
}

/**
 * Height of the chart's main (price) pane. With native panes (v5) the canvas
 * overlays — drawings, volume profile, whale bubbles — cover every pane, so
 * they clip to this rather than the whole chart.
 */
export function mainPaneHeight(chart: Any, fallback: number): number {
  try {
    const h = chart?.panes?.()[0]?.getHeight()
    return h > 0 ? Math.min(h, fallback) : fallback
  } catch {
    return fallback
  }
}

/**
 * Keep a chart's main (price) pane even while it is empty. lightweight-charts
 * v5 drops an empty pane: rebuilding the price series for a new style emptied
 * it for a moment, the delta pane moved up into its place, and the new candles
 * landed there, sharing the delta's scale (0…100k) — a flat line.
 */
export function keepMainPane(chart: Any): void {
  try {
    chart?.panes?.()[0]?.setPreserveEmptyPane(true)
  } catch {
    /* not laid out yet */
  }
}
