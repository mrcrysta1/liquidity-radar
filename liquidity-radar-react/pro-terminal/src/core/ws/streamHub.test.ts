import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamHub, MAX_PARALLEL_STREAMS } from './streamHub';
class FakeWS { static last: FakeWS; sent: string[] = []; onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void; onerror?: () => void; constructor(public url: string) { FakeWS.last = this; setTimeout(() => this.onopen?.(), 0); } send(m: string) { this.sent.push(m); } close() { this.onclose?.(); } }
beforeEach(() => { (globalThis as any).WebSocket = FakeWS; });
describe('StreamHub', () => {
  it('multiplexes streams on one socket and enforces the 200 cap', async () => {
    const hub = new StreamHub(); const offs: (() => void)[] = [];
    for (let i = 0; i < MAX_PARALLEL_STREAMS; i++) offs.push(hub.subscribe(`S${i}-USDT`, '1m', () => {}));
    expect(hub.streamCount).toBe(200); expect(() => hub.subscribe('X-USDT', '1m', () => {})).toThrow(/limit/);
    await new Promise(r => setTimeout(r, 5));
    const subscribeMsgs = FakeWS.last.sent.map(s => JSON.parse(s)).filter(m => m.method === 'SUBSCRIBE');
    expect(subscribeMsgs.reduce((n, m) => n + m.params.length, 0)).toBe(200);
    offs[0](); expect(hub.streamCount).toBe(199);
  });
  it('dispatches klines to the right handler', async () => {
    const hub = new StreamHub(); const h = vi.fn(); hub.subscribe('BTC-USDT', '1m', h); await new Promise(r => setTimeout(r, 5));
    FakeWS.last.onmessage!({ data: JSON.stringify({ stream: 'btcusdt@kline_1m', data: { e: 'kline', k: { t: 60000, o: '1', h: '2', l: '0.5', c: '1.5', v: '10', x: false } } }) });
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ time: 60, close: 1.5, closed: false }));
  });
});
