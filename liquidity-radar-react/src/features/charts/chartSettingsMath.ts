// The pure half of the chart settings (./chartSettings): the shape, its
// defaults, validation of what comes back from storage, and the
// lightweight-charts options each setting turns into. No DOM and no storage,
// so scripts/test-engines.mjs runs it as is.

export type CrosshairStyle = 'dashed' | 'dotted' | 'solid'
export type CanvasBackground = 'theme' | 'solid' | 'gradient'
/** Price-axis labels: pushed apart so they never overlap, or at their exact price. */
export type PriceLabelMode = 'aligned' | 'exact'

export interface ChartSettings {
  // Symbol — '' keeps the palette's colour.
  bodyUp: string
  bodyDown: string
  borderUp: string
  borderDown: string
  wickUp: string
  wickDown: string
  priceLine: boolean
  // Status line (the legend at the top left).
  legendOhlc: boolean
  legendChange: boolean
  legendVolume: boolean
  legendIndicators: boolean
  // Scales.
  priceLabels: PriceLabelMode
  countdown: boolean
  symbolLabel: boolean
  indicatorLabels: boolean
  // Canvas.
  background: CanvasBackground
  bgColor: string
  bgColor2: string
  gridVert: boolean
  gridHorz: boolean
  crosshair: CrosshairStyle
  magnet: boolean
  watermark: boolean
}

export const DEFAULT_SETTINGS: ChartSettings = {
  bodyUp: '',
  bodyDown: '',
  borderUp: '',
  borderDown: '',
  wickUp: '',
  wickDown: '',
  priceLine: true,
  legendOhlc: true,
  legendChange: true,
  legendVolume: true,
  legendIndicators: true,
  priceLabels: 'aligned',
  countdown: true,
  symbolLabel: true,
  indicatorLabels: true,
  background: 'theme',
  bgColor: '#131722',
  bgColor2: '#1E222D',
  gridVert: true,
  gridHorz: true,
  crosshair: 'dashed',
  magnet: false,
  watermark: true,
}

const ENUMS: Partial<Record<keyof ChartSettings, readonly string[]>> = {
  priceLabels: ['aligned', 'exact'],
  background: ['theme', 'solid', 'gradient'],
  crosshair: ['dashed', 'dotted', 'solid'],
}
/** The colour inputs give #rrggbb; anything else from storage is dropped. */
const HEX = /^#[0-9a-f]{6}$/i
const COLOR_KEYS = new Set<keyof ChartSettings>([
  'bodyUp',
  'bodyDown',
  'borderUp',
  'borderDown',
  'wickUp',
  'wickDown',
  'bgColor',
  'bgColor2',
])
/** Up to here a colour may be '' (the palette's); bgColor / bgColor2 may not. */
const OPTIONAL_COLOR = new Set<keyof ChartSettings>([
  'bodyUp',
  'bodyDown',
  'borderUp',
  'borderDown',
  'wickUp',
  'wickDown',
])

/** Whether `v` is a valid value for setting `k`. */
export function validSetting(k: keyof ChartSettings, v: unknown): boolean {
  const def = DEFAULT_SETTINGS[k]
  if (typeof def === 'boolean') return typeof v === 'boolean'
  if (typeof v !== 'string') return false
  if (ENUMS[k]) return ENUMS[k]!.includes(v)
  if (COLOR_KEYS.has(k)) return HEX.test(v) || (OPTIONAL_COLOR.has(k) && v === '')
  return false
}

/**
 * Stored settings over the defaults, keeping only valid values. The first
 * version had a single `grid` switch; it now seeds both grid directions.
 */
export function normalizeSettings(raw: unknown): ChartSettings {
  const out: ChartSettings = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return out
  const v = raw as Record<string, unknown>
  if (typeof v.grid === 'boolean') out.gridVert = out.gridHorz = v.grid
  for (const k of Object.keys(out) as Array<keyof ChartSettings>)
    if (validSetting(k, v[k])) (out as unknown as Record<string, unknown>)[k] = v[k]
  return out
}

/** lightweight-charts LineStyle for the crosshair (3 = LargeDashed, TradingView's). */
export function crosshairLineStyle(s: CrosshairStyle): number {
  return s === 'solid' ? 0 : s === 'dotted' ? 1 : 3
}

/**
 * Chart-level options for the settings, merged over the palette's
 * (chartPalette tvChartOptions). `themeBg` is the palette background, which
 * the 'theme' choice must write back after a custom one.
 */
export function settingsChartOptions(st: ChartSettings, themeBg: string): Record<string, unknown> {
  const ls = crosshairLineStyle(st.crosshair)
  return {
    layout: {
      background:
        st.background === 'gradient'
          ? { type: 'gradient', topColor: st.bgColor, bottomColor: st.bgColor2 }
          : { type: 'solid', color: st.background === 'solid' ? st.bgColor : themeBg },
    },
    grid: { vertLines: { visible: st.gridVert }, horzLines: { visible: st.gridHorz } },
    crosshair: { mode: st.magnet ? 1 : 0, vertLine: { style: ls }, horzLine: { style: ls } },
    rightPriceScale: { alignLabels: st.priceLabels === 'aligned' },
  }
}

/** The canvas colour at its bottom edge (a gradient ends in bgColor2). */
export function canvasEdgeColor(st: ChartSettings, themeBg: string): string {
  return st.background === 'gradient' ? st.bgColor2 : st.background === 'solid' ? st.bgColor : themeBg
}

/** Styles drawn as OHLC candles, which take every body / border / wick colour. */
const CANDLE_LIKE = new Set(['candle', 'heikin', 'range', 'linebreak', 'tick'])

/**
 * Price-series options for the settings. Colours only go to the styles that
 * have them (an unknown key is silently ignored by the library, which hides
 * mistakes); hollow candles carry their colours per bar, so only their
 * borders and wicks follow here.
 */
export function settingsSeriesOptions(st: ChartSettings, style: string): Record<string, unknown> {
  const o: Record<string, unknown> = {
    priceLineVisible: st.priceLine,
    lastValueVisible: st.symbolLabel,
  }
  const set = (k: string, v: string) => {
    if (v) o[k] = v
  }
  if (CANDLE_LIKE.has(style)) {
    set('upColor', st.bodyUp)
    set('downColor', st.bodyDown)
    // Candles are drawn without borders; a chosen border colour turns them on
    // (themePriceSeries turns them back off when it is cleared).
    if (st.borderUp || st.borderDown) o.borderVisible = true
  }
  if (CANDLE_LIKE.has(style) || style === 'hollow') {
    set('borderUpColor', st.borderUp)
    set('borderDownColor', st.borderDown)
    set('wickUpColor', st.wickUp)
    set('wickDownColor', st.wickDown)
  }
  if (style === 'bar' || style === 'hlc') {
    set('upColor', st.bodyUp)
    set('downColor', st.bodyDown)
  }
  return o
}

/** Classes on <html> that hide parts of every chart legend (index.css r4-ux). */
export function legendHideClasses(st: ChartSettings): Record<string, boolean> {
  return {
    'cs-hide-ohlc': !st.legendOhlc,
    'cs-hide-chg': !st.legendChange,
    'cs-hide-vol': !st.legendVolume,
    'cs-hide-indv': !st.legendIndicators,
  }
}
