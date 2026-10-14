import type { Candle } from '../providers/types';
export interface Swing { index: number; price: number; type: 'high' | 'low'; label?: 'HH' | 'HL' | 'LH' | 'LL' }
export interface StructureEvent { index: number; type: 'BOS' | 'CHoCH'; direction: 'bull' | 'bear'; price: number }

/** Fractal swings with `left/right` confirmation bars; then HH/HL/LH/LL, BOS and CHoCH. */
export function swings(c: Candle[], left = 3, right = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = left; i < c.length - right; i++) {
    let hi = true, lo = true;
    for (let j = 1; j <= left; j++) { if (c[i - j].high >= c[i].high) hi = false; if (c[i - j].low <= c[i].low) lo = false; }
    for (let j = 1; j <= right; j++) { if (c[i + j].high > c[i].high) hi = false; if (c[i + j].low < c[i].low) lo = false; }
    if (hi) out.push({ index: i, price: c[i].high, type: 'high' }); if (lo) out.push({ index: i, price: c[i].low, type: 'low' });
  }
  let lastH: Swing | undefined, lastL: Swing | undefined;
  for (const s of out) {
    if (s.type === 'high') { s.label = lastH ? (s.price > lastH.price ? 'HH' : 'LH') : undefined; lastH = s; }
    else { s.label = lastL ? (s.price > lastL.price ? 'HL' : 'LL') : undefined; lastL = s; }
  }
  return out;
}
export function structureEvents(c: Candle[], sw: Swing[]): StructureEvent[] {
  const ev: StructureEvent[] = []; let trend: 'bull' | 'bear' | null = null;
  let lastH: Swing | undefined, lastL: Swing | undefined; let si = 0;
  for (let i = 0; i < c.length; i++) {
    while (si < sw.length && sw[si].index + 3 <= i) { const s = sw[si++]; if (s.type === 'high') lastH = s; else lastL = s; }
    if (lastH && c[i].close > lastH.price) { ev.push({ index: i, type: trend === 'bear' ? 'CHoCH' : 'BOS', direction: 'bull', price: lastH.price }); trend = 'bull'; lastH = undefined; }
    if (lastL && c[i].close < lastL.price) { ev.push({ index: i, type: trend === 'bull' ? 'CHoCH' : 'BOS', direction: 'bear', price: lastL.price }); trend = 'bear'; lastL = undefined; }
  }
  return ev;
}
