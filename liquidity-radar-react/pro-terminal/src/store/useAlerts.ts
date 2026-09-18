import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ALERT_LIMITS, evalPrice, evalTechnical, evalWatchlist, type AlertRule, type AlertEvent, type AlertKind } from '@/core/alerts/engine';
import { getJSON } from '@/providers/http';
import { binanceKlines } from '@/providers/binance';
import { fromBinance } from '@/core/symbols/registry';
import { useApp } from './useApp';

interface AlertsState {
  rules: AlertRule[]; events: AlertEvent[]; lastPrices: Record<string, number>; running: boolean; lastRun?: number; error?: string;
  add: (r: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount' | 'enabled'>) => { ok: boolean; reason?: string };
  remove: (id: string) => void; toggle: (id: string) => void; clearEvents: () => void; counts: () => Record<AlertKind, number>;
  tick: () => Promise<void>;
}
const SPOT = (import.meta as any).env?.VITE_BINANCE_SPOT ?? 'https://api.binance.com';
let notifyOk = false;
export async function requestNotifications() { if (typeof Notification === 'undefined') return false; if (Notification.permission === 'granted') return (notifyOk = true); const p = await Notification.requestPermission(); return (notifyOk = p === 'granted'); }
const notify = (ev: AlertEvent) => { if (notifyOk && typeof Notification !== 'undefined') try { new Notification(`Liquidity Radar: ${ev.name}`, { body: ev.message }); } catch { /* ignore */ } };

export const useAlerts = create<AlertsState>()(persist((set, get) => ({
  rules: [], events: [], lastPrices: {}, running: false,
  counts: () => { const c = { price: 0, technical: 0, watchlist: 0 }; get().rules.forEach(r => c[r.kind]++); return c; },
  add: r => {
    const c = get().counts(); if (c[r.kind] >= ALERT_LIMITS[r.kind]) return { ok: false, reason: `Limit of ${ALERT_LIMITS[r.kind]} ${r.kind} alerts reached` };
    set(s => ({ rules: [...s.rules, { ...r, id: `al-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now(), triggerCount: 0, enabled: true }] })); return { ok: true };
  },
  remove: id => set(s => ({ rules: s.rules.filter(r => r.id !== id) })),
  toggle: id => set(s => ({ rules: s.rules.map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r)) })),
  clearEvents: () => set({ events: [] }),
  /** One evaluation cycle: 1 request for all prices, 1 for all 24h tickers, then klines only for symbols with technical rules. */
  tick: async () => {
    const { rules, lastPrices } = get(); const active = rules.filter(r => r.enabled); if (!active.length) return;
    set({ running: true });
    try {
      const need24 = active.some(r => r.kind === 'watchlist' || String(r.condition).includes('pct'));
      const [prices, t24] = await Promise.all([
        getJSON<{ symbol: string; price: string }[]>(`${SPOT}/api/v3/ticker/price`),
        need24 ? getJSON<{ symbol: string; priceChangePercent: string }[]>(`${SPOT}/api/v3/ticker/24hr`) : Promise.resolve([]),
      ]);
      const px: Record<string, number> = {}; prices.forEach(p => (px[fromBinance(p.symbol)] = +p.price));
      const pct: Record<string, number> = {}; t24.forEach(p => (pct[fromBinance(p.symbol)] = +p.priceChangePercent));
      const fired: AlertEvent[] = []; const now = Date.now();
      const fire = (r: AlertRule, message: string) => { fired.push({ id: `ev-${now}-${r.id}`, ruleId: r.id, name: r.name, ts: now, message, symbol: r.symbol }); };
      const techSymbols = [...new Set(active.filter(r => r.kind === 'technical').map(r => `${r.symbol}|${r.timeframe ?? '15m'}`))].slice(0, 40);
      const kl: Record<string, Awaited<ReturnType<typeof binanceKlines>>> = {};
      await Promise.all(techSymbols.map(async k => { const [s, tf] = k.split('|'); try { kl[k] = await binanceKlines(s, tf, 200); } catch { /* skip */ } }));
      const wls = useApp.getState().watchlists;
      const next = active.map(r => {
        let hit = false, detail = '';
        if (r.kind === 'price' && r.symbol && px[r.symbol] != null) { hit = evalPrice(r, px[r.symbol], lastPrices[r.symbol], pct[r.symbol] ?? 0); detail = `${r.symbol} at ${px[r.symbol]}`; }
        else if (r.kind === 'technical' && r.symbol) { const c = kl[`${r.symbol}|${r.timeframe ?? '15m'}`]; if (c) { hit = evalTechnical(r, c); detail = `${r.symbol} ${r.timeframe ?? '15m'} close ${c[c.length - 1].close}`; } }
        else if (r.kind === 'watchlist') { const wl = wls.find(w => w.id === r.watchlistId); const tk = (wl?.symbols ?? []).map(s => ({ symbol: s, pct: pct[s] ?? 0 })); const res = evalWatchlist(r, tk); hit = res.hit; detail = res.detail; }
        const edge = hit && !r.lastState; // fire on transition only
        if (edge) fire(r, `${r.condition.replace(/_/g, ' ')} ${r.value}${r.value2 != null ? ` / ${r.value2}` : ''} — ${detail}`);
        return { ...r, lastState: hit, lastTriggered: edge ? now : r.lastTriggered, triggerCount: r.triggerCount + (edge ? 1 : 0), enabled: edge && r.once ? false : r.enabled };
      });
      fired.forEach(notify);
      set(s => ({ rules: s.rules.map(r => next.find(n => n.id === r.id) ?? r), events: [...fired, ...s.events].slice(0, 500), lastPrices: px, lastRun: now, error: undefined }));
    } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
    finally { set({ running: false }); }
  },
}), { name: 'liquidity-radar-alerts-v1', partialize: s => ({ rules: s.rules, events: s.events.slice(0, 100) }) as any }));
