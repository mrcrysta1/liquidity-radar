import { describe, it, expect } from 'vitest';
import { ProviderChain } from './chain';
describe('ProviderChain', () => {
  it('uses primary when healthy', async () => {
    const c = new ProviderChain<[string], number>([{ id: 'a', fn: async () => 1 }, { id: 'b', fn: async () => 2 }]);
    const r = await c.get('x'); expect(r.data).toBe(1); expect(r.freshness).toBe('LIVE'); expect(r.provider).toBe('a');
  });
  it('falls back and labels FALLBACK', async () => {
    const c = new ProviderChain<[string], number>([{ id: 'a', fn: async () => { throw new Error('down'); } }, { id: 'b', fn: async () => 2 }]);
    const r = await c.get('x'); expect(r.data).toBe(2); expect(r.freshness).toBe('FALLBACK');
  });
  it('serves STALE then OFFLINE cache when all fail', async () => {
    let t = 0; let ok = true;
    const c = new ProviderChain<[string], number>([{ id: 'a', fn: async () => { if (!ok) throw new Error('down'); return 1; } }], { cacheTtlMs: 10, staleTtlMs: 100 }, () => t);
    await c.get('x'); ok = false; t = 50;
    expect((await c.get('x')).freshness).toBe('STALE');
    t = 500; expect((await c.get('x')).freshness).toBe('OFFLINE');
  });
  it('opens breaker after consecutive failures', async () => {
    let calls = 0;
    const c = new ProviderChain<[], number>([{ id: 'a', fn: async () => { calls++; throw new Error('x'); } }, { id: 'b', fn: async () => 2 }], { breakerFailures: 2, cacheTtlMs: 0 });
    await c.get(); await c.get(); await c.get();
    expect(calls).toBe(2);
  });
});
