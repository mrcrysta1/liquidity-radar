import type { Candle } from '../providers/types';
import { sma, ema, wma, rsi, macd, bollinger, atr, vwap, stochastic, obv, supertrend, keltner, cci, roc, type Series } from './index';
import { runPine, type PinePlot, type PineHLine, type PineShape, type PineInput } from '../pine/runtime';

export type SourceKey = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume';
export const SOURCES: SourceKey[] = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume'];
export interface ParamDef { key: string; label: string; default: number; min?: number; max?: number; step?: number }
export interface OutputDef { key: string; label: string; color: string; kind?: 'line' | 'histogram' }
export interface IndicatorDef {
  id: string; name: string; params: ParamDef[]; outputs: OutputDef[];
  /** overlay: draws on price pane; pane: own pane; source: inherits the pane of its source (indicator-on-indicator) */
  placement: 'overlay' | 'pane';
  /** true if the indicator can take an arbitrary numeric series (enables indicators on indicators) */
  seriesInput: boolean;
  compute(src: number[], candles: Candle[], p: Record<string, number>): Record<string, Series>;
}
export interface IndicatorInstance { uid: string; type: string; params: Record<string, number>; source: string /* SourceKey or `${uid}.${output}` */; visible: boolean;
  /** Pine Script indicators */ script?: string; title?: string; pineInputs?: Record<string, number | boolean | string> }

const D = (key: string, label: string, def: number, min = 1, max = 500): ParamDef => ({ key, label, default: def, min, max, step: 1 });
export const INDICATORS: IndicatorDef[] = [
  { id: 'sma', name: 'SMA', params: [D('length', 'Length', 20)], outputs: [{ key: 'v', label: 'SMA', color: '#e9b44c' }], placement: 'overlay', seriesInput: true, compute: (s, _c, p) => ({ v: sma(s, p.length) }) },
  { id: 'ema', name: 'EMA', params: [D('length', 'Length', 50)], outputs: [{ key: 'v', label: 'EMA', color: '#5ba8f5' }], placement: 'overlay', seriesInput: true, compute: (s, _c, p) => ({ v: ema(s, p.length) }) },
  { id: 'wma', name: 'WMA', params: [D('length', 'Length', 20)], outputs: [{ key: 'v', label: 'WMA', color: '#c084fc' }], placement: 'overlay', seriesInput: true, compute: (s, _c, p) => ({ v: wma(s, p.length) }) },
  { id: 'vwap', name: 'VWAP (session)', params: [], outputs: [{ key: 'v', label: 'VWAP', color: '#f0a04b' }], placement: 'overlay', seriesInput: false, compute: (_s, c) => ({ v: vwap(c) }) },
  { id: 'bb', name: 'Bollinger Bands', params: [D('length', 'Length', 20), { key: 'mult', label: 'StdDev', default: 2, min: 0.5, max: 5, step: 0.1 }], outputs: [{ key: 'u', label: 'Upper', color: 'rgba(167,179,192,.8)' }, { key: 'm', label: 'Basis', color: 'rgba(167,179,192,.45)' }, { key: 'l', label: 'Lower', color: 'rgba(167,179,192,.8)' }], placement: 'overlay', seriesInput: true, compute: (s, _c, p) => { const b = bollinger(s, p.length, p.mult); return { u: b.upper, m: b.mid, l: b.lower }; } },
  { id: 'supertrend', name: 'Supertrend', params: [D('length', 'ATR length', 10), { key: 'mult', label: 'Multiplier', default: 3, min: 0.5, max: 10, step: 0.1 }], outputs: [{ key: 'v', label: 'Supertrend', color: '#34c38f' }], placement: 'overlay', seriesInput: false, compute: (_s, c, p) => ({ v: supertrend(c, p.length, p.mult).line }) },
  { id: 'keltner', name: 'Keltner Channels', params: [D('length', 'Length', 20), { key: 'mult', label: 'Multiplier', default: 2, min: 0.5, max: 5, step: 0.1 }], outputs: [{ key: 'u', label: 'Upper', color: 'rgba(91,168,245,.8)' }, { key: 'm', label: 'Mid', color: 'rgba(91,168,245,.45)' }, { key: 'l', label: 'Lower', color: 'rgba(91,168,245,.8)' }], placement: 'overlay', seriesInput: false, compute: (_s, c, p) => { const k = keltner(c, p.length, p.mult); return { u: k.upper, m: k.mid, l: k.lower }; } },
  { id: 'rsi', name: 'RSI', params: [D('length', 'Length', 14)], outputs: [{ key: 'v', label: 'RSI', color: '#e9b44c' }], placement: 'pane', seriesInput: true, compute: (s, _c, p) => ({ v: rsi(s, p.length) }) },
  { id: 'macd', name: 'MACD', params: [D('fast', 'Fast', 12), D('slow', 'Slow', 26), D('signal', 'Signal', 9)], outputs: [{ key: 'h', label: 'Histogram', color: 'rgba(52,195,143,.6)', kind: 'histogram' }, { key: 'm', label: 'MACD', color: '#5ba8f5' }, { key: 's', label: 'Signal', color: '#e9b44c' }], placement: 'pane', seriesInput: true, compute: (s, _c, p) => { const m = macd(s, p.fast, p.slow, p.signal); return { h: m.hist, m: m.line, s: m.signal }; } },
  { id: 'stoch', name: 'Stochastic', params: [D('k', '%K', 14), D('d', '%D', 3)], outputs: [{ key: 'k', label: '%K', color: '#5ba8f5' }, { key: 'd', label: '%D', color: '#e9b44c' }], placement: 'pane', seriesInput: false, compute: (_s, c, p) => { const st = stochastic(c, p.k, p.d); return { k: st.k, d: st.d }; } },
  { id: 'cci', name: 'CCI', params: [D('length', 'Length', 20)], outputs: [{ key: 'v', label: 'CCI', color: '#c084fc' }], placement: 'pane', seriesInput: false, compute: (_s, c, p) => ({ v: cci(c, p.length) }) },
  { id: 'roc', name: 'Rate of Change', params: [D('length', 'Length', 12)], outputs: [{ key: 'v', label: 'ROC', color: '#f0a04b' }], placement: 'pane', seriesInput: true, compute: (s, _c, p) => ({ v: roc(s, p.length) }) },
  { id: 'atr', name: 'ATR', params: [D('length', 'Length', 14)], outputs: [{ key: 'v', label: 'ATR', color: '#a7b3c0' }], placement: 'pane', seriesInput: false, compute: (_s, c, p) => ({ v: atr(c, p.length) }) },
  { id: 'obv', name: 'OBV', params: [], outputs: [{ key: 'v', label: 'OBV', color: '#5ba8f5' }], placement: 'pane', seriesInput: false, compute: (_s, c) => ({ v: obv(c) }) },
  { id: 'volume', name: 'Volume', params: [], outputs: [{ key: 'v', label: 'Volume', color: 'rgba(91,168,245,.5)', kind: 'histogram' }], placement: 'pane', seriesInput: false, compute: (_s, c) => ({ v: c.map(k => k.volume) }) },
  { id: 'vp', name: 'Volume Profile', params: [D('rows', 'Rows', 48, 8, 200), { key: 'va', label: 'Value area %', default: 70, min: 50, max: 95, step: 1 }], outputs: [], placement: 'overlay', seriesInput: false, compute: () => ({}) },
];
export const indicatorDef = (id: string) => INDICATORS.find(i => i.id === id);
/** No cap on indicators per chart. */
export const MAX_INDICATORS_PER_CHART = Infinity;

export function sourceSeries(key: SourceKey, c: Candle[]): number[] {
  switch (key) {
    case 'open': return c.map(k => k.open); case 'high': return c.map(k => k.high); case 'low': return c.map(k => k.low);
    case 'hl2': return c.map(k => (k.high + k.low) / 2); case 'hlc3': return c.map(k => (k.high + k.low + k.close) / 3);
    case 'ohlc4': return c.map(k => (k.open + k.high + k.low + k.close) / 4); case 'volume': return c.map(k => k.volume);
    default: return c.map(k => k.close);
  }
}
export interface Computed { uid: string; def: IndicatorDef; outputs: Record<string, Series>; paneKey: string /* 'price' or uid of pane owner */;
  pine?: { plots: PinePlot[]; hlines: PineHLine[]; shapes: PineShape[]; inputs: PineInput[]; warnings: string[]; error?: string } }
const STYLE_KIND = (st: PinePlot['style']): 'line' | 'histogram' => (st === 'histogram' || st === 'columns' ? 'histogram' : 'line');
function computePine(inst: IndicatorInstance, candles: Candle[]): Computed {
  try {
    const r = runPine(inst.script ?? '', candles, inst.pineInputs ?? {});
    const def: IndicatorDef = { id: 'pine', name: inst.title || r.title, params: [], placement: r.overlay ? 'overlay' : 'pane', seriesInput: false, compute: () => ({}),
      outputs: r.plots.map(p => ({ key: p.key, label: p.title, color: p.color, kind: STYLE_KIND(p.style) })) };
    const outputs: Record<string, Series> = {}; r.plots.forEach(p => (outputs[p.key] = p.values));
    return { uid: inst.uid, def, outputs, paneKey: r.overlay ? 'price' : inst.uid, pine: { plots: r.plots, hlines: r.hlines, shapes: r.shapes, inputs: r.inputs, warnings: r.warnings } };
  } catch (e) {
    const def: IndicatorDef = { id: 'pine', name: inst.title || 'Pine script', params: [], outputs: [], placement: 'pane', seriesInput: false, compute: () => ({}) };
    return { uid: inst.uid, def, outputs: {}, paneKey: inst.uid, pine: { plots: [], hlines: [], shapes: [], inputs: [], warnings: [], error: e instanceof Error ? e.message : String(e) } };
  }
}
/** Computes instances in order. An instance may source another instance's output (`uid.key`) declared earlier → indicators on indicators. */
export function computeAll(instances: IndicatorInstance[], candles: Candle[]): Computed[] {
  const done = new Map<string, Computed>(); const out: Computed[] = [];
  for (const inst of instances) {
    if (!inst.visible) continue;
    if (inst.type === 'pine') { const c = computePine(inst, candles); done.set(inst.uid, c); out.push(c); continue; }
    const def = indicatorDef(inst.type); if (!def) continue;
    const p: Record<string, number> = {}; def.params.forEach(pd => (p[pd.key] = inst.params[pd.key] ?? pd.default));
    let src: number[]; let paneKey = def.placement === 'overlay' ? 'price' : inst.uid;
    if (inst.source.includes('.')) {
      const [suid, skey] = inst.source.split('.'); const dep = done.get(suid);
      if (!dep || !dep.outputs[skey]) continue;
      src = dep.outputs[skey].map(v => (v == null ? NaN : v));
      // indicator-on-indicator: draw where its source lives, unless it's a pane indicator of its own kind
      paneKey = def.placement === 'overlay' ? dep.paneKey : inst.uid;
    } else src = sourceSeries(inst.source as SourceKey, candles);
    // Trim leading NaNs (from a source indicator's warm-up) so the dependent indicator seeds correctly, then re-pad.
    let f = src.findIndex(v => Number.isFinite(v)); if (f < 0) f = src.length;
    const raw = def.compute(src.slice(f), candles.slice(f), p); const pad: Series = Array(f).fill(null);
    const outputs: Record<string, Series> = {};
    for (const k in raw) outputs[k] = [...pad, ...raw[k].map(v => (v == null || Number.isNaN(v) ? null : v))];
    const c: Computed = { uid: inst.uid, def, outputs, paneKey }; done.set(inst.uid, c); out.push(c);
  }
  return out;
}
