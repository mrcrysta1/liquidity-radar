// Indicator catalogue for the price-action chart — the Pro terminal's set
// (core/indicators/registry.ts and the scripts in core/pine/library.ts),
// plus Williams %R and MFI.
//
// `placement: 'overlay'` draws on the price scale; `'pane'` gets its own price
// scale stacked under the candles. Colours come from the palette at render
// time where a theme colour fits, so indicators re-tint with the rest of the app.
import type { CandleFlat } from '../../../services/market'
import type { Series } from './math'
import {
  FIB_RATIOS,
  PATTERN_KINDS,
  PATTERN_LABELS,
  aroon,
  atr,
  autoTrendlines,
  coppock,
  dpo,
  elderRay,
  linregChannel,
  massIndex,
  autoFib,
  chandelier,
  chartPatterns,
  fisher,
  kst,
  patternSeries,
  pivotPoints,
  zigzag,
  zigzagLine,
  awesome,
  bollinger,
  bollingerPctB,
  bollingerWidth,
  cci,
  choppiness,
  cmf,
  cmo,
  crosses,
  dmi,
  donchian,
  ema,
  histVol,
  hma,
  ichimoku,
  keltner,
  vwapBands,
  linreg,
  macd,
  mfi,
  momentum,
  obv,
  pivots,
  psar,
  rma,
  roc,
  rsi,
  sma,
  stochRsi,
  stochastic,
  supertrend,
  trix,
  tsi,
  ultimate,
  vortex,
  vwma,
  williamsR,
  wma,
  zscore,
} from './math.ts'

export type SourceKey = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume'
/** Volume Profile's range choices, by `mode` param value. */
export const VP_RANGE_MODES = ['Visible range', 'Session', 'Fixed lookback']

export const SOURCES: Array<{ key: SourceKey; label: string }> = [
  { key: 'close', label: 'Close' },
  { key: 'open', label: 'Open' },
  { key: 'high', label: 'High' },
  { key: 'low', label: 'Low' },
  { key: 'hl2', label: 'HL/2' },
  { key: 'hlc3', label: 'HLC/3' },
  { key: 'ohlc4', label: 'OHLC/4' },
  { key: 'volume', label: 'Volume' },
]

export interface ParamDef {
  key: string
  label: string
  default: number
  min: number
  max: number
  step: number
  /** A choice rather than a number: the value is an index into these. */
  options?: string[]
}
export interface OutputDef {
  key: string
  label: string
  color: string
  /**
   * line (default) · histogram · dots (points, no line) · step (stepped line)
   * · cloud (fill between the outputs named in `between`, drawn by a custom
   * series) · signal (a marker at each bar the series has a value).
   */
  kind?: 'line' | 'histogram' | 'dots' | 'step' | 'cloud' | 'signal' | 'vprofile'
  /** Dashed, for band edges. */
  dashed?: boolean
  /** histogram: tint by sign (default) or by bar-to-bar slope. */
  colorBy?: 'sign' | 'slope'
  /** cloud: the two outputs to fill between; `color` when the first is above. */
  between?: [string, string]
  /** cloud: fill when the second output is above the first. */
  colorDown?: string
  /** signal: marker placement relative to the series value. */
  marker?: { shape: 'arrowUp' | 'arrowDown' | 'circle'; position: 'aboveBar' | 'belowBar' }
  /** line width in px (default 2, 1 when dashed). */
  width?: number
  /** Null bars break the line (whitespace) instead of being skipped, so one
   *  series can draw separate segments: pivot periods, pattern outlines. */
  gaps?: boolean
  /** Price-pane line that still shows its value (and label) on the axis. */
  axisLabel?: boolean
  /** signal: marker text read per bar from another (undrawn) output of the
   *  compute result, as an index into `texts`. */
  labelFrom?: { key: string; texts: string[] }
  /** Per-bar colour overriding `color` (Pine plots coloured by condition). */
  colors?: Array<string | undefined>
  /** signal: individual markers (Pine plotshape) instead of one per value. */
  markers?: Array<{
    i: number
    /** Bar open time (ms), when set: placed by time rather than index. */
    t?: number
    shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square'
    position: 'aboveBar' | 'belowBar'
    color: string
    text?: string
  }>
}
/** Outputs that hold a plain value per bar — legend rows and valid sources. */
export const valueOutputs = (def: IndicatorDef): OutputDef[] =>
  def.outputs.filter((o) => o.kind !== 'cloud' && o.kind !== 'signal' && o.kind !== 'vprofile')
export interface IndicatorDef {
  id: string
  name: string
  group: 'Moving averages' | 'Bands & channels' | 'Trend' | 'Oscillators' | 'Volatility' | 'Volume'
  params: ParamDef[]
  outputs: OutputDef[]
  placement: 'overlay' | 'pane'
  /** Horizontal guides drawn in the indicator's own pane. */
  guides?: number[]
  /** Styled horizontal lines (Pine hline), drawn as price lines. */
  hlines?: Array<{
    price: number
    color: string
    title: string
    style: 'solid' | 'dashed' | 'dotted'
  }>
  /** true when the indicator reads a configurable price source. */
  sourced: boolean
  /** No higher-timeframe input: drawings tied to the chart's own bars
   *  (ZigZag turns, patterns, trendlines, the volume profile). */
  noMtf?: boolean
  compute(src: number[], candles: CandleFlat[], p: Record<string, number>): Record<string, Series>
}

const L = (key: string, label: string, def: number, min = 1, max = 500): ParamDef => ({
  key,
  label,
  default: def,
  min,
  max,
  step: 1,
})
const M = (key: string, label: string, def: number, min = 0.5, max = 10): ParamDef => ({
  key,
  label,
  default: def,
  min,
  max,
  step: 0.1,
})
const F = (key: string, label: string, def: number, min: number, max: number, step: number) => ({
  key,
  label,
  default: def,
  min,
  max,
  step,
})
const RIBBON = [
  '#90CAF9',
  '#7DBDF7',
  '#6AB0F5',
  '#57A3F3',
  '#4496F0',
  '#3189EE',
  '#1E7CEC',
  '#0B6FEA',
]

/** Auto Fib levels, 0 → 1, in TradingView's default colours. */
const FIB_COLORS = ['#787B86', '#F23645', '#FF9800', '#4CAF50', '#089981', '#00BCD4', '#787B86']

export const INDICATORS: IndicatorDef[] = [
  {
    id: 'sma',
    name: 'SMA',
    group: 'Moving averages',
    params: [L('length', 'Length', 20)],
    outputs: [{ key: 'v', label: 'SMA', color: '#64B5F6' }],
    placement: 'overlay',
    sourced: true,
    compute: (s, _c, p) => ({ v: sma(s, p.length) }),
  },
  {
    id: 'ema',
    name: 'EMA',
    group: 'Moving averages',
    params: [L('length', 'Length', 20)],
    outputs: [{ key: 'v', label: 'EMA', color: '#FFD54F' }],
    placement: 'overlay',
    sourced: true,
    compute: (s, _c, p) => ({ v: ema(s, p.length) }),
  },
  {
    id: 'wma',
    name: 'WMA',
    group: 'Moving averages',
    params: [L('length', 'Length', 20)],
    outputs: [{ key: 'v', label: 'WMA', color: '#C084FC' }],
    placement: 'overlay',
    sourced: true,
    compute: (s, _c, p) => ({ v: wma(s, p.length) }),
  },
  {
    id: 'vwap',
    name: 'VWAP (anchored)',
    group: 'Moving averages',
    params: [
      L('anchor', 'Reset: 1 day · 2 week · 3 month', 1, 1, 3),
      M('bands', 'Bands (σ, 0 = off)', 0, 0, 4),
    ],
    outputs: [
      { key: 'v', label: 'VWAP', color: '#FF5252' },
      { key: 'u', label: 'Upper', color: 'rgba(255,82,82,.55)', dashed: true },
      { key: 'l', label: 'Lower', color: 'rgba(255,82,82,.55)', dashed: true },
    ],
    placement: 'overlay',
    sourced: false,
    compute: (_s, c, p) => vwapBands(c, p.anchor ?? 1, p.bands ?? 0),
  },
  {
    id: 'bb',
    name: 'Bollinger Bands',
    group: 'Bands & channels',
    params: [L('length', 'Length', 20), M('mult', 'Std dev', 2, 0.5, 5)],
    outputs: [
      { key: 'u', label: 'Upper', color: '#B388FF', dashed: true },
      { key: 'm', label: 'Basis', color: 'rgba(179,136,255,.55)' },
      { key: 'l', label: 'Lower', color: '#B388FF', dashed: true },
    ],
    placement: 'overlay',
    sourced: true,
    compute: (s, _c, p) => {
      const b = bollinger(s, p.length, p.mult)
      return { u: b.upper, m: b.mid, l: b.lower }
    },
  },
  {
    id: 'keltner',
    name: 'Keltner Channels',
    group: 'Bands & channels',
    params: [L('length', 'Length', 20), M('mult', 'Multiplier', 2, 0.5, 5), L('atr', 'ATR length', 10)],
    outputs: [
      { key: 'u', label: 'Upper', color: '#5BA8F5', dashed: true },
      { key: 'm', label: 'Mid', color: 'rgba(91,168,245,.5)' },
      { key: 'l', label: 'Lower', color: '#5BA8F5', dashed: true },
    ],
    placement: 'overlay',
    sourced: false,
    compute: (_s, c, p) => {
      const k = keltner(c, p.length, p.mult, p.atr ?? 10)
      return { u: k.upper, m: k.mid, l: k.lower }
    },
  },
  {
    id: 'supertrend',
    name: 'Supertrend',
    group: 'Bands & channels',
    params: [L('length', 'ATR length', 10), M('mult', 'Multiplier', 3, 0.5, 10)],
    outputs: [{ key: 'v', label: 'Supertrend', color: '#34C38F' }],
    placement: 'overlay',
    sourced: false,
    compute: (_s, c, p) => ({ v: supertrend(c, p.length, p.mult).line }),
  },
  {
    id: 'rsi',
    name: 'RSI',
    group: 'Oscillators',
    params: [L('length', 'Length', 14)],
    outputs: [{ key: 'v', label: 'RSI', color: '#B388FF' }],
    placement: 'pane',
    guides: [30, 70],
    sourced: true,
    compute: (s, _c, p) => ({ v: rsi(s, p.length) }),
  },
  {
    id: 'macd',
    name: 'MACD',
    group: 'Oscillators',
    params: [L('fast', 'Fast', 12), L('slow', 'Slow', 26), L('signal', 'Signal', 9)],
    outputs: [
      { key: 'h', label: 'Histogram', color: 'rgba(52,195,143,.6)', kind: 'histogram' },
      { key: 'm', label: 'MACD', color: '#00E5FF' },
      { key: 's', label: 'Signal', color: '#FFD54F' },
    ],
    placement: 'pane',
    guides: [0],
    sourced: true,
    compute: (s, _c, p) => {
      const m = macd(s, p.fast, p.slow, p.signal)
      return { h: m.hist, m: m.line, s: m.signal }
    },
  },
  {
    id: 'stoch',
    name: 'Stochastic',
    group: 'Oscillators',
    params: [L('k', '%K', 14), L('d', '%D', 3)],
    outputs: [
      { key: 'k', label: '%K', color: '#5BA8F5' },
      { key: 'd', label: '%D', color: '#FFD54F' },
    ],
    placement: 'pane',
    guides: [20, 80],
    sourced: false,
    compute: (_s, c, p) => {
      const st = stochastic(c, p.k, p.d)
      return { k: st.k, d: st.d }
    },
  },
  {
    id: 'cci',
    name: 'CCI',
    group: 'Oscillators',
    params: [L('length', 'Length', 20)],
    outputs: [{ key: 'v', label: 'CCI', color: '#C084FC' }],
    placement: 'pane',
    guides: [-100, 100],
    sourced: false,
    compute: (_s, c, p) => ({ v: cci(c, p.length) }),
  },
  {
    id: 'willr',
    name: 'Williams %R',
    group: 'Oscillators',
    params: [L('length', 'Length', 14)],
    outputs: [{ key: 'v', label: '%R', color: '#F0A04B' }],
    placement: 'pane',
    guides: [-80, -20],
    sourced: false,
    compute: (_s, c, p) => ({ v: williamsR(c, p.length) }),
  },
  {
    id: 'roc',
    name: 'Rate of Change',
    group: 'Oscillators',
    params: [L('length', 'Length', 12)],
    outputs: [{ key: 'v', label: 'ROC', color: '#F0A04B' }],
    placement: 'pane',
    guides: [0],
    sourced: true,
    compute: (s, _c, p) => ({ v: roc(s, p.length) }),
  },
  {
    id: 'atr',
    name: 'ATR',
    group: 'Oscillators',
    params: [L('length', 'Length', 14)],
    outputs: [{ key: 'v', label: 'ATR', color: '#A7B3C0' }],
    placement: 'pane',
    sourced: false,
    compute: (_s, c, p) => ({ v: atr(c, p.length) }),
  },
  {
    id: 'volume',
    name: 'Volume',
    group: 'Volume',
    params: [],
    outputs: [{ key: 'v', label: 'Volume', color: 'rgba(91,168,245,.5)', kind: 'histogram' }],
    placement: 'pane',
    sourced: false,
    compute: (_s, c) => ({ v: c.map((k) => k.v) }),
  },
  {
    id: 'obv',
    name: 'OBV',
    group: 'Volume',
    params: [],
    outputs: [{ key: 'v', label: 'OBV', color: '#5BA8F5' }],
    placement: 'pane',
    sourced: false,
    compute: (_s, c) => ({ v: obv(c) }),
  },
  {
    id: 'mfi',
    name: 'Money Flow Index',
    group: 'Volume',
    params: [L('length', 'Length', 14)],
    outputs: [{ key: 'v', label: 'MFI', color: '#34C38F' }],
    placement: 'pane',
    guides: [20, 80],
    sourced: false,
    compute: (_s, c, p) => ({ v: mfi(c, p.length) }),
  },

  // ------------------------------------------------ Pro library, natively
  {
    id: 'hma',
    name: 'Hull MA',
    group: 'Moving averages',
    params: [L('length', 'Length', 20)],
    outputs: [{ key: 'v', label: 'HMA', color: '#4DD0E1' }],
    placement: 'overlay',
    sourced: true,
    compute: (s, _c, p) => ({ v: hma(s, p.length) }),
  },
  {
    id: 'vwma',
    name: 'VWMA',
    group: 'Moving averages',
    params: [L('length', 'Length', 20)],
    outputs: [{ key: 'v', label: 'VWMA', color: '#FF8A65' }],
    placement: 'overlay',
    sourced: true,
    compute: (s, c, p) => ({ v: vwma(s, c, p.length) }),
  },
  {
    id: 'rma',
    name: 'RMA (SMMA)',
    group: 'Moving averages',
    params: [L('length', 'Length', 14)],
    outputs: [{ key: 'v', label: 'RMA', color: '#AED581' }],
    placement: 'overlay',
    sourced: true,
    compute: (s, _c, p) => ({ v: rma(s, p.length) }),
  },
  {
    id: 'ribbon',
    name: 'EMA Ribbon',
    group: 'Moving averages',
    params: [L('start', 'First length', 20), L('step', 'Step', 5, 1, 100)],
    outputs: RIBBON.map((color, i) => ({ key: 'e' + i, label: 'EMA ' + (i + 1), color })),
    placement: 'overlay',
    sourced: true,
    compute: (s, _c, p) => {
      const out: Record<string, Series> = {}
      RIBBON.forEach((_, i) => (out['e' + i] = ema(s, p.start + i * p.step)))
      return out
    },
  },
  {
    id: 'linreg',
    name: 'Linear Regression',
    group: 'Moving averages',
    params: [L('length', 'Length', 50, 2)],
    outputs: [{ key: 'v', label: 'LinReg', color: '#5BA8F5' }],
    placement: 'overlay',
    sourced: true,
    compute: (s, _c, p) => ({ v: linreg(s, p.length) }),
  },
  {
    id: 'emacross',
    name: 'EMA Cross (signals)',
    group: 'Moving averages',
    params: [L('short', 'Short', 9), L('long', 'Long', 21)],
    outputs: [
      { key: 's', label: 'Short', color: '#34C38F' },
      { key: 'l', label: 'Long', color: '#FF5252' },
      {
        key: 'up',
        label: 'Golden cross',
        color: '#00E676',
        kind: 'signal',
        marker: { shape: 'arrowUp', position: 'belowBar' },
      },
      {
        key: 'dn',
        label: 'Death cross',
        color: '#FF1744',
        kind: 'signal',
        marker: { shape: 'arrowDown', position: 'aboveBar' },
      },
    ],
    placement: 'overlay',
    sourced: true,
    compute: (s, _c, p) => {
      const sh = ema(s, p.short)
      const lo = ema(s, p.long)
      const x = crosses(sh, lo)
      // Markers sit on the short EMA, so they follow it into whichever pane
      // the source lives in.
      return {
        s: sh,
        l: lo,
        up: sh.map((v, i) => (x.up[i] ? v : null)),
        dn: sh.map((v, i) => (x.down[i] ? v : null)),
      }
    },
  },
  {
    id: 'donchian',
    name: 'Donchian Channels',
    group: 'Bands & channels',
    params: [L('length', 'Length', 20)],
    outputs: [
      { key: 'u', label: 'Upper', color: '#5BA8F5' },
      { key: 'm', label: 'Basis', color: '#F0A04B' },
      { key: 'l', label: 'Lower', color: '#5BA8F5' },
    ],
    placement: 'overlay',
    sourced: false,
    compute: (_s, c, p) => {
      const d = donchian(c, p.length)
      return { u: d.upper, m: d.mid, l: d.lower }
    },
  },
  {
    id: 'ichimoku',
    name: 'Ichimoku Cloud',
    group: 'Trend',
    params: [
      L('conv', 'Conversion', 9),
      L('base', 'Base', 26),
      L('spanB', 'Span B', 52),
      L('disp', 'Displacement', 26, 1, 200),
    ],
    outputs: [
      {
        key: 'cloud',
        label: 'Cloud',
        color: 'rgba(52,195,143,.16)',
        colorDown: 'rgba(255,82,82,.16)',
        kind: 'cloud',
        between: ['a', 'b'],
      },
      { key: 'conv', label: 'Conversion', color: '#5BA8F5' },
      { key: 'base', label: 'Base', color: '#FF5252' },
      { key: 'a', label: 'Span A', color: 'rgba(52,195,143,.8)' },
      { key: 'b', label: 'Span B', color: 'rgba(255,82,82,.8)' },
      { key: 'lag', label: 'Lagging', color: 'rgba(167,179,192,.7)', dashed: true },
    ],
    placement: 'overlay',
    sourced: false,
    compute: (_s, c, p) => {
      const k = ichimoku(c, p.conv, p.base, p.spanB, p.disp)
      return { conv: k.conversion, base: k.base, a: k.spanA, b: k.spanB, lag: k.lagging }
    },
  },
  {
    id: 'psar',
    name: 'Parabolic SAR',
    group: 'Trend',
    params: [
      F('start', 'Start', 0.02, 0.001, 1, 0.001),
      F('inc', 'Increment', 0.02, 0.001, 1, 0.001),
      F('max', 'Max', 0.2, 0.01, 1, 0.01),
    ],
    outputs: [{ key: 'v', label: 'SAR', color: '#5BA8F5', kind: 'dots' }],
    placement: 'overlay',
    sourced: false,
    compute: (_s, c, p) => ({ v: psar(c, p.start, p.inc, p.max) }),
  },
  {
    id: 'pivots',
    name: 'Pivot High/Low',
    group: 'Trend',
    params: [L('left', 'Left bars', 5, 1, 100), L('right', 'Right bars', 5, 1, 100)],
    outputs: [
      { key: 'lh', label: 'Last high', color: 'rgba(255,82,82,.6)', kind: 'step' },
      { key: 'll', label: 'Last low', color: 'rgba(52,195,143,.6)', kind: 'step' },
      {
        key: 'ph',
        label: 'Pivot high',
        color: '#FF5252',
        kind: 'signal',
        marker: { shape: 'arrowDown', position: 'aboveBar' },
      },
      {
        key: 'pl',
        label: 'Pivot low',
        color: '#34C38F',
        kind: 'signal',
        marker: { shape: 'arrowUp', position: 'belowBar' },
      },
    ],
    placement: 'overlay',
    sourced: false,
    compute: (_s, c, p) => {
      const pv = pivots(c, p.left, p.right)
      return { lh: pv.lastHigh, ll: pv.lastLow, ph: pv.high, pl: pv.low }
    },
  },
  {
    id: 'pivotpts',
    name: 'Pivot Points',
    group: 'Trend',
    params: [
      L('kind', 'Type: 1 Trad · 2 Fib · 3 Woodie · 4 Camarilla', 1, 1, 4),
      L('anchor', 'Period: 1 day · 2 week · 3 month', 1, 1, 3),
    ],
    outputs: [
      { key: 'p', label: 'P', color: '#F0A04B', gaps: true, width: 1 },
      { key: 'r1', label: 'R1', color: 'rgba(255,82,82,.8)', gaps: true, width: 1 },
      { key: 'r2', label: 'R2', color: 'rgba(255,82,82,.65)', gaps: true, width: 1 },
      { key: 'r3', label: 'R3', color: 'rgba(255,82,82,.5)', gaps: true, width: 1 },
      { key: 'r4', label: 'R4', color: 'rgba(255,82,82,.4)', gaps: true, width: 1 },
      { key: 's1', label: 'S1', color: 'rgba(52,195,143,.8)', gaps: true, width: 1 },
      { key: 's2', label: 'S2', color: 'rgba(52,195,143,.65)', gaps: true, width: 1 },
      { key: 's3', label: 'S3', color: 'rgba(52,195,143,.5)', gaps: true, width: 1 },
      { key: 's4', label: 'S4', color: 'rgba(52,195,143,.4)', gaps: true, width: 1 },
    ],
    placement: 'overlay',
    sourced: false,
    compute: (_s, c, p) => pivotPoints(c, p.kind ?? 1, p.anchor ?? 1),
  },
  {
    id: 'adx',
    name: 'ADX / DMI',
    group: 'Trend',
    params: [L('len', 'DI length', 14), L('adx', 'ADX smoothing', 14, 1, 100)],
    outputs: [
      { key: 'adx', label: 'ADX', color: '#FF5252' },
      { key: 'p', label: '+DI', color: '#5BA8F5' },
      { key: 'm', label: '−DI', color: '#F0A04B' },
    ],
    placement: 'pane',
    guides: [25],
    sourced: false,
    compute: (_s, c, p) => {
      const d = dmi(c, p.len, p.adx)
      return { adx: d.adx, p: d.plus, m: d.minus }
    },
  },
  {
    id: 'aroon',
    name: 'Aroon',
    group: 'Trend',
    params: [L('length', 'Length', 14)],
    outputs: [
      { key: 'u', label: 'Up', color: '#F0A04B' },
      { key: 'd', label: 'Down', color: '#5BA8F5' },
    ],
    placement: 'pane',
    guides: [30, 70],
    sourced: false,
    compute: (_s, c, p) => {
      const a = aroon(c, p.length)
      return { u: a.up, d: a.down }
    },
  },
  {
    id: 'vortex',
    name: 'Vortex',
    group: 'Trend',
    params: [L('length', 'Period', 14, 2)],
    outputs: [
      { key: 'p', label: 'VI+', color: '#5BA8F5' },
      { key: 'm', label: 'VI−', color: '#FF5252' },
    ],
    placement: 'pane',
    guides: [1],
    sourced: false,
    compute: (_s, c, p) => {
      const v = vortex(c, p.length)
      return { p: v.plus, m: v.minus }
    },
  },
  {
    id: 'stochrsi',
    name: 'Stoch RSI',
    group: 'Oscillators',
    params: [
      L('k', 'K', 3, 1, 100),
      L('d', 'D', 3, 1, 100),
      L('rsi', 'RSI length', 14),
      L('stoch', 'Stoch length', 14),
    ],
    outputs: [
      { key: 'k', label: 'K', color: '#5BA8F5' },
      { key: 'd', label: 'D', color: '#F0A04B' },
    ],
    placement: 'pane',
    guides: [20, 80],
    sourced: true,
    compute: (s, _c, p) => {
      const st = stochRsi(s, p.rsi, p.stoch, p.k, p.d)
      return { k: st.k, d: st.d }
    },
  },
  {
    id: 'ao',
    name: 'Awesome Oscillator',
    group: 'Oscillators',
    params: [],
    outputs: [
      { key: 'v', label: 'AO', color: 'rgba(52,195,143,.6)', kind: 'histogram', colorBy: 'slope' },
    ],
    placement: 'pane',
    guides: [0],
    sourced: false,
    compute: (_s, c) => ({ v: awesome(c) }),
  },
  {
    id: 'mom',
    name: 'Momentum',
    group: 'Oscillators',
    params: [L('length', 'Length', 10)],
    outputs: [{ key: 'v', label: 'MOM', color: '#5BA8F5' }],
    placement: 'pane',
    guides: [0],
    sourced: true,
    compute: (s, _c, p) => ({ v: momentum(s, p.length) }),
  },
  {
    id: 'trix',
    name: 'TRIX',
    group: 'Oscillators',
    params: [L('length', 'Length', 18)],
    outputs: [{ key: 'v', label: 'TRIX', color: '#FF5252' }],
    placement: 'pane',
    guides: [0],
    sourced: false,
    compute: (_s, c, p) => ({ v: trix(c, p.length) }),
  },
  {
    id: 'uo',
    name: 'Ultimate Oscillator',
    group: 'Oscillators',
    params: [L('fast', 'Fast', 7), L('mid', 'Middle', 14), L('slow', 'Slow', 28)],
    outputs: [{ key: 'v', label: 'UO', color: '#FF5252' }],
    placement: 'pane',
    guides: [30, 70],
    sourced: false,
    compute: (_s, c, p) => ({ v: ultimate(c, p.fast, p.mid, p.slow) }),
  },
  {
    id: 'cmo',
    name: 'Chande Momentum',
    group: 'Oscillators',
    params: [L('length', 'Length', 9)],
    outputs: [{ key: 'v', label: 'CMO', color: '#5BA8F5' }],
    placement: 'pane',
    guides: [-50, 50],
    sourced: true,
    compute: (s, _c, p) => ({ v: cmo(s, p.length) }),
  },
  {
    id: 'tsi',
    name: 'True Strength Index',
    group: 'Oscillators',
    params: [L('long', 'Long', 25), L('short', 'Short', 13), L('signal', 'Signal', 13)],
    outputs: [
      { key: 'v', label: 'TSI', color: '#5BA8F5' },
      { key: 's', label: 'Signal', color: '#FF5252' },
    ],
    placement: 'pane',
    guides: [0],
    sourced: true,
    compute: (s, _c, p) => {
      const t = tsi(s, p.short, p.long, p.signal)
      return { v: t.line, s: t.signal }
    },
  },
  {
    id: 'zscore',
    name: 'Z-Score',
    group: 'Oscillators',
    params: [L('length', 'Length', 20, 2)],
    outputs: [{ key: 'v', label: 'Z', color: '#5BA8F5' }],
    placement: 'pane',
    guides: [-2, 0, 2],
    sourced: true,
    compute: (s, _c, p) => ({ v: zscore(s, p.length) }),
  },
  {
    id: 'bbpct',
    name: 'Bollinger %B',
    group: 'Volatility',
    params: [L('length', 'Length', 20), M('mult', 'Std dev', 2, 0.5, 5)],
    outputs: [{ key: 'v', label: '%B', color: '#26A69A' }],
    placement: 'pane',
    guides: [0, 1],
    sourced: true,
    compute: (s, _c, p) => ({ v: bollingerPctB(s, p.length, p.mult) }),
  },
  {
    id: 'bbw',
    name: 'Bollinger Bandwidth',
    group: 'Volatility',
    params: [L('length', 'Length', 20), M('mult', 'Std dev', 2, 0.5, 5)],
    outputs: [{ key: 'v', label: 'BBW', color: '#26A69A' }],
    placement: 'pane',
    sourced: true,
    compute: (s, _c, p) => ({ v: bollingerWidth(s, p.length, p.mult) }),
  },
  {
    id: 'chop',
    name: 'Choppiness Index',
    group: 'Volatility',
    params: [L('length', 'Length', 14, 2)],
    outputs: [{ key: 'v', label: 'CHOP', color: '#5BA8F5' }],
    placement: 'pane',
    guides: [38.2, 61.8],
    sourced: false,
    compute: (_s, c, p) => ({ v: choppiness(c, p.length) }),
  },
  {
    id: 'hv',
    name: 'Historical Volatility',
    group: 'Volatility',
    params: [L('length', 'Length', 10, 2), L('annual', 'Periods / year', 365, 1, 600000)],
    outputs: [{ key: 'v', label: 'HV', color: '#5BA8F5' }],
    placement: 'pane',
    sourced: false,
    compute: (_s, c, p) => ({ v: histVol(c, p.length, p.annual) }),
  },
  {
    id: 'cmf',
    name: 'Chaikin Money Flow',
    group: 'Volume',
    params: [L('length', 'Length', 20)],
    outputs: [{ key: 'v', label: 'CMF', color: '#34C38F' }],
    placement: 'pane',
    guides: [0],
    sourced: false,
    compute: (_s, c, p) => ({ v: cmf(c, p.length) }),
  },
  {
    id: 'zigzag',
    name: 'ZigZag',
    group: 'Trend',
    params: [M('dev', 'Deviation %', 5, 0.1, 50), L('depth', 'Depth', 10, 1, 200)],
    outputs: [{ key: 'v', label: 'ZigZag', color: '#F0A04B' }],
    placement: 'overlay',
    sourced: false,
    noMtf: true,
    compute: (_s, c, p) => ({ v: zigzagLine(c, p.dev, p.depth) }),
  },
  {
    id: 'autofib',
    name: 'Auto Fib Retracement',
    group: 'Trend',
    params: [M('dev', 'Deviation %', 5, 0.1, 50), L('depth', 'Depth', 10, 1, 200)],
    // One horizontal line per ratio, from the swing's first pivot onward.
    outputs: FIB_RATIOS.map((r, k) => ({
      key: 'f' + k,
      label: String(r),
      color: FIB_COLORS[k],
      width: 1,
      axisLabel: true,
    })),
    placement: 'overlay',
    sourced: false,
    noMtf: true,
    compute: (_s, c, p) => {
      const out: Record<string, Series> = {}
      autoFib(c, p.dev, p.depth).series.forEach((s, k) => (out['f' + k] = s))
      return out
    },
  },
  {
    id: 'chandelier',
    name: 'Chandelier Exit',
    group: 'Bands & channels',
    params: [L('length', 'ATR period', 22), M('mult', 'ATR multiplier', 3, 0.5, 10)],
    outputs: [
      { key: 'l', label: 'Long stop', color: '#34C38F', kind: 'step', width: 1 },
      { key: 's', label: 'Short stop', color: '#FF5252', kind: 'step', width: 1 },
      {
        key: 'buy',
        label: 'Buy',
        color: '#00E676',
        kind: 'signal',
        marker: { shape: 'arrowUp', position: 'belowBar' },
      },
      {
        key: 'sell',
        label: 'Sell',
        color: '#FF1744',
        kind: 'signal',
        marker: { shape: 'arrowDown', position: 'aboveBar' },
      },
    ],
    placement: 'overlay',
    sourced: false,
    compute: (_s, c, p) => {
      const x = chandelier(c, p.length, p.mult)
      return { l: x.long, s: x.short, buy: x.buy, sell: x.sell }
    },
  },
  {
    id: 'fisher',
    name: 'Fisher Transform',
    group: 'Oscillators',
    params: [L('length', 'Length', 9, 2)],
    outputs: [
      { key: 'v', label: 'Fisher', color: '#5BA8F5' },
      { key: 't', label: 'Trigger', color: '#F0A04B', width: 1 },
    ],
    placement: 'pane',
    guides: [-1.5, -0.75, 0, 0.75, 1.5],
    sourced: false,
    compute: (_s, c, p) => {
      const f = fisher(c, p.length)
      return { v: f.fisher, t: f.trigger }
    },
  },
  {
    id: 'kst',
    name: 'Know Sure Thing',
    group: 'Oscillators',
    params: [
      L('r1', 'ROC 1', 10),
      L('r2', 'ROC 2', 15),
      L('r3', 'ROC 3', 20),
      L('r4', 'ROC 4', 30),
      L('s1', 'SMA 1', 10),
      L('s2', 'SMA 2', 10),
      L('s3', 'SMA 3', 10),
      L('s4', 'SMA 4', 15),
      L('sig', 'Signal', 9),
    ],
    outputs: [
      { key: 'v', label: 'KST', color: '#26A69A' },
      { key: 's', label: 'Signal', color: '#FF5252' },
    ],
    placement: 'pane',
    guides: [0],
    sourced: true,
    compute: (s, _c, p) => {
      const k = kst(s, p.r1, p.r2, p.r3, p.r4, p.s1, p.s2, p.s3, p.s4, p.sig)
      return { v: k.line, s: k.signal }
    },
  },
  {
    id: 'patterns',
    name: 'Auto Chart Patterns',
    group: 'Trend',
    params: [
      M('dev', 'ZigZag deviation %', 3, 0.1, 50),
      L('depth', 'ZigZag depth', 5, 1, 200),
      M('tol', 'Level tolerance %', 1.5, 0.1, 10),
    ],
    // Two slots of two lines (see patternSeries), so neighbouring patterns
    // stay separate outlines; the markers name each pattern.
    outputs: [
      { key: 'a0', label: 'Outline', color: '#F0A04B', gaps: true, width: 2 },
      { key: 'b0', label: 'Neckline', color: 'rgba(240,160,75,.7)', gaps: true, width: 1, dashed: true },
      { key: 'a1', label: 'Outline 2', color: '#F0A04B', gaps: true, width: 2 },
      { key: 'b1', label: 'Neckline 2', color: 'rgba(240,160,75,.7)', gaps: true, width: 1, dashed: true },
      {
        key: 'bull',
        label: 'Bullish pattern',
        color: '#00E676',
        kind: 'signal',
        marker: { shape: 'arrowUp', position: 'belowBar' },
        labelFrom: { key: 'code', texts: PATTERN_LABELS },
      },
      {
        key: 'bear',
        label: 'Bearish pattern',
        color: '#FF1744',
        kind: 'signal',
        marker: { shape: 'arrowDown', position: 'aboveBar' },
        labelFrom: { key: 'code', texts: PATTERN_LABELS },
      },
    ],
    placement: 'overlay',
    sourced: false,
    noMtf: true,
    compute: (_s, c, p) => {
      const pats = chartPatterns(zigzag(c, p.dev, p.depth).pivots, p.tol)
      const [a0, b0, a1, b1] = patternSeries(c.length, pats)
      const bull: Series = Array(c.length).fill(null)
      const bear: Series = Array(c.length).fill(null)
      // `code` is not an output: it only feeds the markers' text.
      const code: Series = Array(c.length).fill(null)
      pats.forEach((x) => {
        ;(x.bullish ? bull : bear)[x.at] = x.bullish ? c[x.at].l : c[x.at].h
        code[x.at] = PATTERN_KINDS.indexOf(x.kind)
      })
      return { a0, b0, a1, b1, bull, bear, code }
    },
  },
  // ---- r4-indicators2
  {
    id: 'vprofile',
    name: 'Volume Profile',
    group: 'Volume',
    params: [
      { key: 'mode', label: 'Range', default: 0, min: 0, max: 2, step: 1, options: VP_RANGE_MODES },
      L('lookback', 'Fixed lookback (bars)', 200, 10, 5000),
      L('rows', 'Rows', 48, 8, 200),
      L('va', 'Value area %', 70, 10, 99),
      L('width', 'Width %', 30, 5, 100),
    ],
    // Drawn by a custom series over the chart's bars (see ./vprofile): no
    // per-bar values, so nothing for the legend or as a source.
    outputs: [
      {
        key: 'vp',
        label: 'Profile',
        color: 'rgba(41,98,255,.42)',
        colorDown: 'rgba(251,192,45,.42)',
        kind: 'vprofile',
      },
    ],
    placement: 'overlay',
    sourced: false,
    noMtf: true,
    compute: () => ({}),
  },
  {
    id: 'autotrend',
    name: 'Auto Trendlines',
    group: 'Trend',
    params: [
      M('dev', 'ZigZag deviation %', 3, 0.1, 50),
      L('depth', 'ZigZag depth', 5, 1, 200),
      F('tol', 'Touch tolerance %', 0.5, 0, 5, 0.1),
    ],
    outputs: [
      { key: 'res', label: 'Resistance', color: '#F23645', width: 2 },
      { key: 'sup', label: 'Support', color: '#089981', width: 2 },
    ],
    placement: 'overlay',
    sourced: false,
    noMtf: true,
    compute: (_s, c, p) => {
      const t = autoTrendlines(c, p.dev, p.depth, p.tol)
      return { res: t.res, sup: t.sup }
    },
  },
  {
    id: 'lrc',
    name: 'Linear Regression Channel',
    group: 'Bands & channels',
    params: [L('length', 'Length', 100, 2, 5000), M('dev', 'Deviations', 2, 0.1, 10)],
    outputs: [
      { key: 'u', label: 'Upper', color: '#F23645', width: 1 },
      { key: 'm', label: 'LinReg', color: '#2962FF', width: 1, dashed: true },
      { key: 'l', label: 'Lower', color: '#089981', width: 1 },
    ],
    placement: 'overlay',
    sourced: true,
    noMtf: true,
    compute: (s, _c, p) => {
      const r = linregChannel(s, p.length, p.dev)
      return { u: r.upper, m: r.mid, l: r.lower }
    },
  },
  {
    id: 'elder',
    name: 'Elder-Ray',
    group: 'Oscillators',
    params: [L('length', 'Length', 13)],
    outputs: [
      { key: 'bull', label: 'Bull power', color: '#26A69A', kind: 'histogram' },
      { key: 'bear', label: 'Bear power', color: '#EF5350', kind: 'histogram' },
    ],
    placement: 'pane',
    guides: [0],
    sourced: false,
    compute: (_s, c, p) => elderRay(c, p.length),
  },
  {
    id: 'massindex',
    name: 'Mass Index',
    group: 'Volatility',
    params: [L('ema', 'EMA length', 9), L('sum', 'Sum length', 25)],
    outputs: [{ key: 'v', label: 'Mass', color: '#AB47BC' }],
    placement: 'pane',
    guides: [27, 26.5],
    sourced: false,
    compute: (_s, c, p) => ({ v: massIndex(c, p.ema, p.sum) }),
  },
  {
    id: 'coppock',
    name: 'Coppock Curve',
    group: 'Oscillators',
    params: [L('wma', 'WMA length', 10), L('long', 'Long RoC', 14), L('short', 'Short RoC', 11)],
    outputs: [{ key: 'v', label: 'Coppock', color: '#2962FF' }],
    placement: 'pane',
    guides: [0],
    sourced: true,
    compute: (s, _c, p) => ({ v: coppock(s, p.wma, p.long, p.short) }),
  },
  {
    id: 'dpo',
    name: 'Detrended Price Osc',
    group: 'Oscillators',
    params: [L('length', 'Length', 21, 2)],
    outputs: [{ key: 'v', label: 'DPO', color: '#43A047' }],
    placement: 'pane',
    guides: [0],
    sourced: true,
    compute: (s, _c, p) => ({ v: dpo(s, p.length) }),
  },
]

export const INDICATOR_GROUPS: Array<IndicatorDef['group']> = [
  'Moving averages',
  'Bands & channels',
  'Trend',
  'Oscillators',
  'Volatility',
  'Volume',
]

const BY_ID: Record<string, IndicatorDef> = {}
INDICATORS.forEach((d) => {
  BY_ID[d.id] = d
})
export function indicatorDef(id: string): IndicatorDef | null {
  return BY_ID[id] || null
}

export function sourceSeries(key: SourceKey, c: CandleFlat[]): number[] {
  switch (key) {
    case 'open':
      return c.map((k) => k.o)
    case 'high':
      return c.map((k) => k.h)
    case 'low':
      return c.map((k) => k.l)
    case 'hl2':
      return c.map((k) => (k.h + k.l) / 2)
    case 'hlc3':
      return c.map((k) => (k.h + k.l + k.c) / 3)
    case 'ohlc4':
      return c.map((k) => (k.o + k.h + k.l + k.c) / 4)
    case 'volume':
      return c.map((k) => k.v)
    default:
      return c.map((k) => k.c)
  }
}

/** Does an instance's def take a higher-timeframe input? */
export const takesMtf = (def: IndicatorDef): boolean => !def.noMtf

export function defaultParams(def: IndicatorDef): Record<string, number> {
  const p: Record<string, number> = {}
  def.params.forEach((x) => {
    p[x.key] = x.default
  })
  return p
}

/** "EMA 20", "MACD 12/26/9" — the label shown on the chip and in the legend. */
export function instanceLabel(def: IndicatorDef, params: Record<string, number>): string {
  if (!def.params.length) return def.name
  return (
    def.name +
    ' ' +
    def.params
      .map((x) => {
        const v = params[x.key] ?? x.default
        return x.options ? (x.options[v] ?? v) : v
      })
      .join('/')
  )
}
