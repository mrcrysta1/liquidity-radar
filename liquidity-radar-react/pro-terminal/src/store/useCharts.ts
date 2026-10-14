import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { IndicatorInstance } from '@/core/indicators/registry';
import { indicatorDef } from '@/core/indicators/registry';

export type ChartType = 'candles' | 'line' | 'area' | 'range';
export interface ChartConfig { id: string; symbol: string; timeframe: string; type: ChartType; rangeSize: number | null /* null = auto (ATR14) */; indicators: IndicatorInstance[] }
export const LAYOUTS = [1, 2, 3, 4, 6, 8, 9, 12, 16] as const;
export const MAX_CHARTS = 16;
const uid = () => Math.random().toString(36).slice(2, 9);
const mk = (symbol: string, timeframe = '15m'): ChartConfig => ({ id: uid(), symbol, timeframe, type: 'candles', rangeSize: null, indicators: [
  { uid: uid(), type: 'ema', params: { length: 50 }, source: 'close', visible: true }, { uid: uid(), type: 'ema', params: { length: 200 }, source: 'close', visible: true },
  { uid: uid(), type: 'volume', params: {}, source: 'close', visible: true }, { uid: uid(), type: 'rsi', params: { length: 14 }, source: 'close', visible: true }] });

interface ChartsState {
  charts: ChartConfig[]; layout: number; activeId: string; customTimeframes: string[];
  setLayout: (n: number) => void; setActive: (id: string) => void; update: (id: string, p: Partial<ChartConfig>) => void;
  addIndicator: (id: string, type: string, source?: string) => string | undefined; removeIndicator: (id: string, uid: string) => void; updateIndicator: (id: string, uid: string, p: Partial<IndicatorInstance>) => void;
  addCustomTimeframe: (tf: string) => void;
  addPine: (id: string, script: string, title: string) => string;
}
export const useCharts = create<ChartsState>()(persist((set, get) => {
  const first = mk('BTC-USDT');
  return {
    charts: [first], layout: 1, activeId: first.id, customTimeframes: [],
    setLayout: n => set(s => { const charts = [...s.charts]; const defaults = ['BTC-USDT', 'ETH-USDT', 'SOL-USDT', 'BNB-USDT', 'XRP-USDT', 'DOGE-USDT', 'ADA-USDT', 'AVAX-USDT', 'LINK-USDT', 'SUI-USDT', 'TRX-USDT', 'DOT-USDT', 'LTC-USDT', 'BCH-USDT', 'NEAR-USDT', 'APT-USDT'];
      while (charts.length < Math.min(n, MAX_CHARTS)) charts.push(mk(defaults[charts.length % defaults.length])); return { layout: n, charts }; }),
    setActive: id => set({ activeId: id }),
    update: (id, p) => set(s => ({ charts: s.charts.map(c => (c.id === id ? { ...c, ...p } : c)) })),
    addIndicator: (id, type, source = 'close') => { const c = get().charts.find(x => x.id === id); const def = indicatorDef(type); if (!c || !def) return;
      const params: Record<string, number> = {}; def.params.forEach(p => (params[p.key] = p.default));
      get().update(id, { indicators: [...c.indicators, { uid: uid(), type, params, source, visible: true }] }); return undefined; },
    removeIndicator: (id, u) => { const c = get().charts.find(x => x.id === id); if (c) get().update(id, { indicators: c.indicators.filter(i => i.uid !== u && !i.source.startsWith(u + '.')) }); },
    updateIndicator: (id, u, p) => { const c = get().charts.find(x => x.id === id); if (c) get().update(id, { indicators: c.indicators.map(i => (i.uid === u ? { ...i, ...p } : i)) }); },
    addPine: (id, script, title) => { const c = get().charts.find(x => x.id === id); const u = uid(); if (c) get().update(id, { indicators: [...c.indicators, { uid: u, type: 'pine', params: {}, source: 'close', visible: true, script, title, pineInputs: {} }] }); return u; },
    addCustomTimeframe: tf => set(s => ({ customTimeframes: s.customTimeframes.includes(tf) ? s.customTimeframes : [...s.customTimeframes, tf] })),
  };
}, { name: 'liquidity-radar-charts-v1' }));
