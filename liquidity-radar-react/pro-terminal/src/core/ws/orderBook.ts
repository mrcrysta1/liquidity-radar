import type { BookLevel, BookSnapshot } from '../providers/types';
import type { DepthDiff } from './binanceStream';

/** Local L2 book maintained from REST snapshot + diff stream (Binance semantics). */
export class LocalOrderBook {
  bids = new Map<number, number>(); asks = new Map<number, number>();
  lastUpdateId = 0; ready = false; private buffer: DepthDiff[] = [];
  applySnapshot(s: BookSnapshot & { lastUpdateId?: number }) {
    this.bids.clear(); this.asks.clear();
    s.bids.forEach(l => this.bids.set(l.price, l.size)); s.asks.forEach(l => this.asks.set(l.price, l.size));
    this.lastUpdateId = s.lastUpdateId ?? 0; this.ready = true;
    this.buffer.forEach(d => this.applyDiff(d)); this.buffer = [];
  }
  applyDiff(d: DepthDiff) {
    if (!this.ready) { this.buffer.push(d); return; }
    if (this.lastUpdateId && d.lastId <= this.lastUpdateId) return;
    const upd = (m: Map<number, number>, ls: BookLevel[]) => ls.forEach(l => (l.size === 0 ? m.delete(l.price) : m.set(l.price, l.size)));
    upd(this.bids, d.bids); upd(this.asks, d.asks); this.lastUpdateId = d.lastId;
  }
  top(n = 25): BookSnapshot {
    const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, n).map(([price, size]) => ({ price, size }));
    const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, n).map(([price, size]) => ({ price, size }));
    return { bids, asks, ts: Date.now() };
  }
}
