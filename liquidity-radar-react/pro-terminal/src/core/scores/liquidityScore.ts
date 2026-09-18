import type { BookSnapshot } from '../providers/types';
export interface ScoreComponent { key: string; label: string; value: number; weight: number; score: number; reason: string }
export interface Score { value: number; components: ScoreComponent[]; version: string }

export interface BookMetrics { mid: number; spreadBps: number; bidDepth1: number; askDepth1: number; bidDepth2: number; askDepth2: number; imbalance1: number; walls: { side: 'bid' | 'ask'; price: number; size: number; multiple: number }[]; slippage: { notional: number; side: 'buy' | 'sell'; bps: number; filled: boolean }[] }

export function bookMetrics(b: BookSnapshot, notionals = [10_000, 100_000, 1_000_000]): BookMetrics {
  const bb = b.bids[0]?.price ?? 0, ba = b.asks[0]?.price ?? 0; const mid = (bb + ba) / 2 || bb || ba;
  const spreadBps = mid ? ((ba - bb) / mid) * 1e4 : 0;
  const depth = (ls: { price: number; size: number }[], pct: number) => ls.filter(l => Math.abs(l.price - mid) / mid <= pct).reduce((s, l) => s + l.size * l.price, 0);
  const bidDepth1 = depth(b.bids, 0.01), askDepth1 = depth(b.asks, 0.01), bidDepth2 = depth(b.bids, 0.02), askDepth2 = depth(b.asks, 0.02);
  const imbalance1 = bidDepth1 + askDepth1 ? (bidDepth1 - askDepth1) / (bidDepth1 + askDepth1) : 0;
  const walls: BookMetrics['walls'] = [];
  for (const side of ['bid', 'ask'] as const) {
    const ls = side === 'bid' ? b.bids : b.asks; if (ls.length < 5) continue;
    const avg = ls.reduce((s, l) => s + l.size, 0) / ls.length;
    ls.forEach(l => { const m = l.size / avg; if (m >= 5) walls.push({ side, price: l.price, size: l.size, multiple: m }); });
  }
  walls.sort((a, c) => c.multiple - a.multiple);
  const slippage: BookMetrics['slippage'] = [];
  for (const notional of notionals) for (const side of ['buy', 'sell'] as const) {
    const ls = side === 'buy' ? b.asks : b.bids; let rem = notional, cost = 0, qty = 0;
    for (const l of ls) { const lv = l.price * l.size; const take = Math.min(rem, lv); qty += take / l.price; cost += take; rem -= take; if (rem <= 0) break; }
    const filled = rem <= 0; const avgPx = qty ? cost / qty : 0; const bps = filled && mid ? Math.abs(avgPx - mid) / mid * 1e4 : Infinity;
    slippage.push({ notional, side, bps, filled });
  }
  return { mid, spreadBps, bidDepth1, askDepth1, bidDepth2, askDepth2, imbalance1, walls: walls.slice(0, 6), slippage };
}

const clamp = (x: number, a = 0, b = 100) => Math.max(a, Math.min(b, x));
/**
 * LIQUIDITY SCORE v1 — every component visible. Inputs: book metrics + 24h quote volume.
 * Weights are explicit; no hidden constants.
 */
export function liquidityScore(m: BookMetrics, quoteVolume24h: number): Score {
  const comps: ScoreComponent[] = [];
  const add = (key: string, label: string, value: number, weight: number, score: number, reason: string) => comps.push({ key, label, value, weight, score: clamp(score), reason });
  add('spread', 'Spread', m.spreadBps, 0.25, 100 - m.spreadBps * 20, `${m.spreadBps.toFixed(2)} bps between best bid and ask (0 bps = 100, 5 bps = 0)`);
  const d1 = m.bidDepth1 + m.askDepth1;
  add('depth1', 'Depth ±1%', d1, 0.30, Math.log10(Math.max(d1, 1)) * 100 / 8, `$${fmt(d1)} resting within 1% of mid (log scale, $100M = 100)`);
  const s100k = m.slippage.find(s => s.notional === 100_000 && s.side === 'buy')?.bps ?? Infinity;
  add('slippage', 'Slippage $100k', s100k, 0.20, isFinite(s100k) ? 100 - s100k * 10 : 0, isFinite(s100k) ? `${s100k.toFixed(2)} bps to buy $100k at market` : 'book too thin to fill $100k');
  add('balance', 'Bid/ask balance', m.imbalance1, 0.10, 100 - Math.abs(m.imbalance1) * 100, `${(m.imbalance1 * 100).toFixed(0)}% imbalance within ±1% (${m.imbalance1 > 0 ? 'bid' : 'ask'}-heavy)`);
  add('volume', '24h volume', quoteVolume24h, 0.15, Math.log10(Math.max(quoteVolume24h, 1)) * 100 / 10, `$${fmt(quoteVolume24h)} traded in 24h (log scale, $10B = 100)`);
  const value = Math.round(comps.reduce((s, c) => s + c.score * c.weight, 0));
  return { value, components: comps, version: 'liq-v1' };
}
export function fmt(n: number) { if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k'; return n.toFixed(2); }
