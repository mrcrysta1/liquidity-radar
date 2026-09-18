import type { Candle } from '../providers/types';
import { rsi, ema, sma, macd } from '../indicators';

export type AlertKind = 'price' | 'technical' | 'watchlist';
export const ALERT_LIMITS: Record<AlertKind, number> = { price: 1000, technical: 1000, watchlist: 15 };
export type PriceCond = 'crosses_above' | 'crosses_below' | 'above' | 'below' | 'pct_change_24h_above' | 'pct_change_24h_below';
export type TechCond = 'rsi_above' | 'rsi_below' | 'ema_cross_up' | 'ema_cross_down' | 'macd_cross_up' | 'macd_cross_down' | 'close_above_sma' | 'close_below_sma';
export type WatchCond = 'any_pct_24h_above' | 'any_pct_24h_below' | 'count_above_pct';

export interface AlertRule {
  id: string; kind: AlertKind; name: string; enabled: boolean; createdAt: number;
  symbol?: string; watchlistId?: string; timeframe?: string;
  condition: PriceCond | TechCond | WatchCond; value: number; value2?: number;
  once: boolean; lastTriggered?: number; triggerCount: number; lastState?: boolean;
}
export interface AlertEvent { id: string; ruleId: string; name: string; ts: number; message: string; symbol?: string }

/** Deterministic rule evaluation. Returns whether the condition holds now; the store handles edge detection ("crosses"). */
export function evalPrice(rule: AlertRule, price: number, prevPrice: number | undefined, pct24h: number): boolean {
  switch (rule.condition as PriceCond) {
    case 'above': return price > rule.value; case 'below': return price < rule.value;
    case 'crosses_above': return prevPrice != null && prevPrice <= rule.value && price > rule.value;
    case 'crosses_below': return prevPrice != null && prevPrice >= rule.value && price < rule.value;
    case 'pct_change_24h_above': return pct24h > rule.value; case 'pct_change_24h_below': return pct24h < rule.value;
    default: return false;
  }
}
export function evalTechnical(rule: AlertRule, c: Candle[]): boolean {
  if (c.length < 60) return false; const close = c.map(k => k.close); const i = close.length - 1, j = i - 1;
  const last = (s: (number | null)[], k: number) => s[k] as number;
  switch (rule.condition as TechCond) {
    case 'rsi_above': return last(rsi(close, 14), i) > rule.value; case 'rsi_below': return last(rsi(close, 14), i) < rule.value;
    case 'ema_cross_up': { const f = ema(close, rule.value || 9), s = ema(close, rule.value2 || 21); return last(f, j) <= last(s, j) && last(f, i) > last(s, i); }
    case 'ema_cross_down': { const f = ema(close, rule.value || 9), s = ema(close, rule.value2 || 21); return last(f, j) >= last(s, j) && last(f, i) < last(s, i); }
    case 'macd_cross_up': { const m = macd(close); return last(m.hist, j) <= 0 && last(m.hist, i) > 0; }
    case 'macd_cross_down': { const m = macd(close); return last(m.hist, j) >= 0 && last(m.hist, i) < 0; }
    case 'close_above_sma': return close[i] > last(sma(close, rule.value || 50), i); case 'close_below_sma': return close[i] < last(sma(close, rule.value || 50), i);
    default: return false;
  }
}
export function evalWatchlist(rule: AlertRule, tickers: { symbol: string; pct: number }[]): { hit: boolean; detail: string } {
  switch (rule.condition as WatchCond) {
    case 'any_pct_24h_above': { const m = tickers.filter(t => t.pct > rule.value); return { hit: m.length > 0, detail: m.map(t => `${t.symbol} ${t.pct.toFixed(2)}%`).join(', ') }; }
    case 'any_pct_24h_below': { const m = tickers.filter(t => t.pct < rule.value); return { hit: m.length > 0, detail: m.map(t => `${t.symbol} ${t.pct.toFixed(2)}%`).join(', ') }; }
    case 'count_above_pct': { const m = tickers.filter(t => t.pct > rule.value); return { hit: m.length >= (rule.value2 ?? 3), detail: `${m.length} symbols above ${rule.value}%` }; }
    default: return { hit: false, detail: '' };
  }
}
