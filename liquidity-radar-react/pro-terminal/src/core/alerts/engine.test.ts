import { describe, it, expect } from 'vitest';
import { evalPrice, evalTechnical, evalWatchlist, ALERT_LIMITS, type AlertRule } from './engine';
const r = (o: Partial<AlertRule>): AlertRule => ({ id: 'x', kind: 'price', name: 't', enabled: true, createdAt: 0, condition: 'above', value: 0, once: false, triggerCount: 0, ...o });
describe('alerts', () => {
  it('limits', () => { expect(ALERT_LIMITS).toEqual({ price: 1000, technical: 1000, watchlist: 15 }); });
  it('price crosses need previous value', () => { expect(evalPrice(r({ condition: 'crosses_above', value: 100 }), 101, 99, 0)).toBe(true); expect(evalPrice(r({ condition: 'crosses_above', value: 100 }), 101, undefined, 0)).toBe(false); expect(evalPrice(r({ condition: 'crosses_above', value: 100 }), 101, 100.5, 0)).toBe(false); });
  it('technical rsi', () => { const c = Array.from({ length: 100 }, (_, i) => ({ time: i, open: i, high: i + 1, low: i - 1, close: 100 + i, volume: 1 })); expect(evalTechnical(r({ kind: 'technical', condition: 'rsi_above', value: 70 }), c)).toBe(true); });
  it('watchlist', () => { expect(evalWatchlist(r({ kind: 'watchlist', condition: 'any_pct_24h_above', value: 5 }), [{ symbol: 'A', pct: 6 }, { symbol: 'B', pct: 1 }])).toEqual({ hit: true, detail: 'A 6.00%' }); });
});
