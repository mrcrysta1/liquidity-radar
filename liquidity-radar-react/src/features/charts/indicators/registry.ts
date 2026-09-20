// Indicator catalogue for the price-action chart — the Pro terminal's set
// (core/indicators/registry.ts), plus Williams %R and MFI.
//
// `placement: 'overlay'` draws on the price scale; `'pane'` gets its own price
// scale stacked under the candles. Colours come from the palette at render
// time where a theme colour fits, so indicators re-tint with the rest of the app.
import type { CandleFlat } from '../../../services/market'
import type { Series } from './math'
import {
  atr,
  bollinger,
  cci,
  ema,
  keltner,
  macd,
  mfi,
  obv,
  roc,
  rsi,
  sma,
  stochastic,
  supertrend,
  vwap,
  williamsR,
  wma,
} from './math'

export type SourceKey = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4'
export const SOURCES: Array<{ key: SourceKey; label: string }> = [
  { key: 'close', label: 'Close' },
  { key: 'open', label: 'Open' },
  { key: 'high', label: 'High' },
  { key: 'low', label: 'Low' },
  { key: 'hl2', label: 'HL/2' },
  { key: 'hlc3', label: 'HLC/3' },
  { key: 'ohlc4', label: 'OHLC/4' },
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
  kind?: 'line' | 'histogram'
  /** Dashed, for band edges. */
  dashed?: boolean
}
export interface IndicatorDef {
  id: string
  name: string
  group: 'Moving averages' | 'Bands & channels' | 'Oscillators' | 'Volume'
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
]

export const INDICATOR_GROUPS: Array<IndicatorDef['group']> = [
  'Moving averages',
  'Bands & channels',
  'Oscillators',
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
