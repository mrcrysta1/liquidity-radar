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
  aroon,
  atr,
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
  vwap,
  vwma,
  williamsR,
  wma,
  zscore,
} from './math'

export type SourceKey = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume'
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
  kind?: 'line' | 'histogram' | 'dots' | 'step' | 'cloud' | 'signal'
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
}
/** Outputs that hold a plain value per bar — legend rows and valid sources. */
export const valueOutputs = (def: IndicatorDef): OutputDef[] =>
  def.outputs.filter((o) => o.kind !== 'cloud' && o.kind !== 'signal')
export interface IndicatorDef {
  id: string
  name: string
  group: 'Moving averages' | 'Bands & channels' | 'Trend' | 'Oscillators' | 'Volatility' | 'Volume'
  params: ParamDef[]
  outputs: OutputDef[]
  placement: 'overlay' | 'pane'
  /** Horizontal guides drawn in the indicator's own pane. */
  guides?: number[]
  /** true when the indicator reads a configurable price source. */
  sourced: boolean
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
    name: 'VWAP (session)',
    group: 'Moving averages',
    params: [],
    outputs: [{ key: 'v', label: 'VWAP', color: '#FF5252' }],
    placement: 'overlay',
    sourced: false,
    compute: (_s, c) => ({ v: vwap(c) }),
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
    params: [L('length', 'Length', 20), M('mult', 'Multiplier', 2, 0.5, 5)],
    outputs: [
      { key: 'u', label: 'Upper', color: '#5BA8F5', dashed: true },
      { key: 'm', label: 'Mid', color: 'rgba(91,168,245,.5)' },
      { key: 'l', label: 'Lower', color: '#5BA8F5', dashed: true },
    ],
    placement: 'overlay',
    sourced: false,
    compute: (_s, c, p) => {
      const k = keltner(c, p.length, p.mult)
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
  return def.name + ' ' + def.params.map((x) => params[x.key] ?? x.default).join('/')
}
