import type { Candle } from '../providers/types';
import { toBinance } from '../symbols/registry';

export const MAX_PARALLEL_STREAMS = 200;
type KlineHandler = (c: Candle & { closed: boolean }) => void;

/**
 * One multiplexed WebSocket to Binance spot carrying up to 200 kline streams (Binance allows 1024/socket).
 * Charts subscribe by (symbol, nativeInterval); the hub reference-counts, live-SUBSCRIBEs/UNSUBSCRIBEs
 * and re-subscribes everything after a reconnect.
 */
export class StreamHub {
  private ws?: WebSocket; private open = false; private attempt = 0; private id = 1; private closed = false;
  private subs = new Map<string, Set<KlineHandler>>();
  public status: 'connecting' | 'open' | 'closed' = 'closed'; public onStatus?: (s: StreamHub['status']) => void;
  private base = (import.meta as any).env?.VITE_BINANCE_WS ?? 'wss://stream.binance.com:9443';

  get streamCount() { return this.subs.size; }
  private key(symbol: string, iv: string) { return `${toBinance(symbol).toLowerCase()}@kline_${iv}`; }

  subscribe(symbol: string, iv: string, h: KlineHandler): () => void {
    const k = this.key(symbol, iv);
    if (!this.subs.has(k)) {
      if (this.subs.size >= MAX_PARALLEL_STREAMS) throw new Error(`Stream limit reached (${MAX_PARALLEL_STREAMS})`);
      this.subs.set(k, new Set()); this.send({ method: 'SUBSCRIBE', params: [k], id: this.id++ });
    }
    this.subs.get(k)!.add(h); this.ensure();
    return () => { const set = this.subs.get(k); if (!set) return; set.delete(h); if (set.size === 0) { this.subs.delete(k); this.send({ method: 'UNSUBSCRIBE', params: [k], id: this.id++ }); } };
  }
  private send(m: unknown) { if (this.open && this.ws) this.ws.send(JSON.stringify(m)); }
  private ensure() {
    if (this.ws || this.closed) return;
    this.status = 'connecting'; this.onStatus?.(this.status);
    const ws = new WebSocket(`${this.base}/stream`); this.ws = ws;
    ws.onopen = () => { this.open = true; this.attempt = 0; this.status = 'open'; this.onStatus?.(this.status); const params = [...this.subs.keys()]; for (let i = 0; i < params.length; i += 100) this.send({ method: 'SUBSCRIBE', params: params.slice(i, i + 100), id: this.id++ }); };
    ws.onmessage = e => { try { const m = JSON.parse(e.data); const d = m.data; if (!d || d.e !== 'kline') return; const k = d.k; const c = { time: k.t / 1000, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, closed: !!k.x }; this.subs.get(m.stream)?.forEach(h => h(c)); } catch { /* ignore */ } };
    ws.onclose = () => { this.open = false; this.ws = undefined; this.status = 'closed'; this.onStatus?.(this.status); if (this.subs.size && !this.closed) setTimeout(() => this.ensure(), Math.min(30_000, 500 * 2 ** this.attempt++) + Math.random() * 300); };
    ws.onerror = () => ws.close();
  }
  closeAll() { this.closed = true; this.ws?.close(); }
}
export const streamHub = new StreamHub();
