import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Interval, CanonSymbol } from '@/core/providers/types';
import { DEFAULT_SYMBOLS } from '@/core/symbols/registry';

export type PanelId = 'chart' | 'book' | 'tape' | 'futures' | 'liquidations' | 'liquidity' | 'crossex' | 'watchlist' | 'structure' | 'alerts';
export type IndicatorId = 'sma20' | 'ema50' | 'ema200' | 'vwap' | 'bb' | 'supertrend' | 'rsi' | 'macd' | 'volume';
interface Watchlist { id: string; name: string; symbols: CanonSymbol[]; pinned: CanonSymbol[] }

interface AppState {
  symbol: CanonSymbol; interval: Interval | string; setSymbol: (s: CanonSymbol) => void; setInterval: (i: Interval | string) => void;
  indicators: Record<IndicatorId, boolean>; toggleIndicator: (i: IndicatorId) => void;
  panels: Record<PanelId, boolean>; togglePanel: (p: PanelId) => void;
  watchlists: Watchlist[]; activeWatchlist: string; setActiveWatchlist: (id: string) => void;
  addToWatchlist: (s: CanonSymbol) => void; removeFromWatchlist: (s: CanonSymbol) => void; togglePin: (s: CanonSymbol) => void; createWatchlist: (name: string) => void;
}
export const useApp = create<AppState>()(persist((set, get) => ({
  symbol: 'BTC-USDT', interval: '15m',
  setSymbol: symbol => set({ symbol }), setInterval: interval => set({ interval }),
  indicators: { sma20: false, ema50: true, ema200: true, vwap: false, bb: false, supertrend: false, rsi: true, macd: false, volume: true },
  toggleIndicator: i => set(s => ({ indicators: { ...s.indicators, [i]: !s.indicators[i] } })),
  panels: { chart: true, book: true, tape: true, futures: true, liquidations: true, liquidity: true, crossex: true, watchlist: true, structure: true, alerts: true },
  togglePanel: p => set(s => ({ panels: { ...s.panels, [p]: !s.panels[p] } })),
  watchlists: [{ id: 'default', name: 'Majors', symbols: DEFAULT_SYMBOLS, pinned: ['BTC-USDT', 'ETH-USDT'] }], activeWatchlist: 'default',
  setActiveWatchlist: id => set({ activeWatchlist: id }),
  addToWatchlist: sym => set(s => ({ watchlists: s.watchlists.map(w => w.id === s.activeWatchlist && !w.symbols.includes(sym) ? { ...w, symbols: [...w.symbols, sym] } : w) })),
  removeFromWatchlist: sym => set(s => ({ watchlists: s.watchlists.map(w => w.id === s.activeWatchlist ? { ...w, symbols: w.symbols.filter(x => x !== sym), pinned: w.pinned.filter(x => x !== sym) } : w) })),
  togglePin: sym => set(s => ({ watchlists: s.watchlists.map(w => w.id === s.activeWatchlist ? { ...w, pinned: w.pinned.includes(sym) ? w.pinned.filter(x => x !== sym) : [...w.pinned, sym] } : w) })),
  createWatchlist: name => { const id = `wl-${Date.now()}`; set(s => ({ watchlists: [...s.watchlists, { id, name, symbols: [], pinned: [] }], activeWatchlist: id })); void get; },
}), { name: 'liquidity-radar-v2' }));
