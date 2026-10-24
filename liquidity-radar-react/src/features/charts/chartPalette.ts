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
import { chartTzOptions } from './timezone'

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

export function chartPalette(): ChartPalette {
  const light = lightMode()
  if (isTvPalette()) return light ? TV_LIGHT : TV_DARK
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
  return {
    localization: tz.localization,
    layout: {
      background: { type: 'solid', color: p.bg },
      textColor: p.txt,
      fontSize: TV_FONT_SIZE,
      fontFamily: TV_FONT,
    },
    grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
    rightPriceScale: { borderVisible: true, borderColor: p.border },
    timeScale: { ...tz.timeScale, borderVisible: true, borderColor: p.border },
    crosshair: {
      // LargeDashed lines with grey labels, as TradingView draws them.
      vertLine: { color: p.cross, width: 1, style: 3, labelBackgroundColor: p.crossLabel },
      horzLine: { color: p.cross, width: 1, style: 3, labelBackgroundColor: p.crossLabel },
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
  const color = up ? p.up : p.dn
  const s = series as unknown as { __tvLast?: string }
  if (s.__tvLast === color) return
  s.__tvLast = color
  series.applyOptions({ priceLineColor: color, priceLineStyle: 1, priceLineWidth: 1 })
}
/** Forget the cached colour so the next tvLastPrice re-applies it (after a re-theme). */
export function resetTvLastPrice(series: unknown): void {
  if (series) (series as { __tvLast?: string }).__tvLast = undefined
}

/** TradingView-style watermark: symbol and interval, faint, mid-chart. */
export function tvWatermark(
  text: string,
  fontSize = 52,
  p: ChartPalette = chartPalette(),
): Record<string, unknown> {
  return {
    watermark: {
      visible: !!text,
      text,
      color: p.watermark,
      fontSize,
      fontFamily: TV_FONT,
      horzAlign: 'center',
      vertAlign: 'center',
    },
  }
}
