import type { BookLevel, Liquidation, Trade } from '../providers/types';
import { toBinance } from '../symbols/registry';

type Handler<T> = (v: T) => void;
export interface DepthDiff { bids: BookLevel[]; asks: BookLevel[]; firstId: number; lastId: number; ts: number }
export interface MarkPrice { mark: number; index: number; fundingRate: number; nextFundingTime: number }

/**
 * One reconnecting combined-stream WebSocket per venue. Subscribe-on-view.
 * Binance combined streams: /stream?streams=a/b/c
 */
class ReconnectingWS {
  private ws?: WebSocket; private attempt = 0; private closed = false;
  public status: 'connecting' | 'open' | 'closed' = 'connecting';
  public onStatus?: (s: ReconnectingWS['status']) => void;
  constructor(private url: string, private onMsg: (m: any) => void) { this.open(); }
  private open() {
    if (this.closed) return;
    this.status = 'connecting'; this.onStatus?.(this.status);
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => { this.attempt = 0; this.status = 'open'; this.onStatus?.(this.status); };
    this.ws.onmessage = e => { try { this.onMsg(JSON.parse(e.data)); } catch { /* ignore */ } };
    this.ws.onclose = () => { this.status = 'closed'; this.onStatus?.(this.status); this.retry(); };
    this.ws.onerror = () => this.ws?.close();
  }
  private retry() { if (this.closed) return; const d = Math.min(30_000, 500 * 2 ** this.attempt++) + Math.random() * 300; setTimeout(() => this.open(), d); }
  close() { this.closed = true; this.ws?.close(); }
}

export class BinanceStreams {
  private spot?: ReconnectingWS; private fut?: ReconnectingWS;
  private handlers = { depth: new Set<Handler<DepthDiff>>(), trade: new Set<Handler<Trade>>(), liq: new Set<Handler<Liquidation>>(), mark: new Set<Handler<MarkPrice>>() };
  public status = { spot: 'closed' as ReconnectingWS['status'], fut: 'closed' as ReconnectingWS['status'] };
  public onStatus?: () => void;
  private spotBase = (import.meta as any).env?.VITE_BINANCE_WS ?? 'wss://stream.binance.com:9443';

  subscribe(symbol: string) {
    this.close();
    const s = toBinance(symbol).toLowerCase();
    this.spot = new ReconnectingWS(`${this.spotBase}/stream?streams=${s}@depth@100ms/${s}@aggTrade`, m => {
      const d = m.data; if (!d) return;
      if (d.e === 'depthUpdate') this.emit('depth', { bids: d.b.map((x: string[]) => ({ price: +x[0], size: +x[1] })), asks: d.a.map((x: string[]) => ({ price: +x[0], size: +x[1] })), firstId: d.U, lastId: d.u, ts: d.E });
      else if (d.e === 'aggTrade') this.emit('trade', { price: +d.p, qty: +d.q, ts: d.T, isBuyerMaker: d.m });
    });
    this.spot.onStatus = st => { this.status.spot = st; this.onStatus?.(); };
    this.fut = new ReconnectingWS(`wss://fstream.binance.com/stream?streams=${s}@markPrice@1s/!forceOrder@arr`, m => {
      const d = m.data; if (!d) return;
      if (d.e === 'markPriceUpdate') this.emit('mark', { mark: +d.p, index: +d.i, fundingRate: +d.r, nextFundingTime: d.T });
      else if (d.e === 'forceOrder') { const o = d.o; this.emit('liq', { symbol: o.s, side: o.S, price: +o.p, qty: +o.q, ts: o.T, exchange: 'binance' }); }
    });
    this.fut.onStatus = st => { this.status.fut = st; this.onStatus?.(); };
  }
  private emit<K extends keyof BinanceStreams['handlers']>(k: K, v: any) { (this.handlers[k] as Set<Handler<any>>).forEach(h => h(v)); }
  on<K extends keyof BinanceStreams['handlers']>(k: K, h: BinanceStreams['handlers'][K] extends Set<infer H> ? H : never) { (this.handlers[k] as Set<any>).add(h); return () => (this.handlers[k] as Set<any>).delete(h); }
  close() { this.spot?.close(); this.fut?.close(); }
}
export const binanceStreams = new BinanceStreams();
