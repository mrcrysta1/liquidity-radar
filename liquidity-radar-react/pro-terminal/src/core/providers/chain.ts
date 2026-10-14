import type { Envelope, Freshness } from './types';

export interface ChainOptions { cacheTtlMs: number; staleTtlMs: number; breakerFailures: number; breakerCooldownMs: number }
const DEFAULTS: ChainOptions = { cacheTtlMs: 5_000, staleTtlMs: 5 * 60_000, breakerFailures: 3, breakerCooldownMs: 30_000 };
interface Breaker { failures: number; openUntil: number }

/** Primary → Fallback(s) → Cached (STALE) → OFFLINE. Never returns unlabeled data. */
export class ProviderChain<TArgs extends unknown[], TRes> {
  private cache = new Map<string, { data: TRes; ts: number; provider: string }>();
  private breakers = new Map<string, Breaker>();
  private opts: ChainOptions;
  public lastEvents: string[] = [];
  constructor(
    private providers: { id: string; fn: (...args: TArgs) => Promise<TRes> }[],
    opts: Partial<ChainOptions> = {},
    private now: () => number = () => Date.now(),
  ) { this.opts = { ...DEFAULTS, ...opts }; }

  private breakerOpen(id: string) { const b = this.breakers.get(id); return !!b && b.openUntil > this.now(); }
  private fail(id: string) {
    const b = this.breakers.get(id) ?? { failures: 0, openUntil: 0 };
    b.failures += 1;
    if (b.failures >= this.opts.breakerFailures) { b.openUntil = this.now() + this.opts.breakerCooldownMs; b.failures = 0; }
    this.breakers.set(id, b);
  }
  private log(m: string) { this.lastEvents.push(m); if (this.lastEvents.length > 50) this.lastEvents.shift(); }

  async get(...args: TArgs): Promise<Envelope<TRes>> {
    const k = JSON.stringify(args); const cached = this.cache.get(k); const t = this.now();
    if (cached && t - cached.ts < this.opts.cacheTtlMs)
      return { data: cached.data, provider: cached.provider, ts: cached.ts, freshness: 'LIVE', confidence: 1 };
    let lastErr = '';
    for (let i = 0; i < this.providers.length; i++) {
      const p = this.providers[i];
      if (this.breakerOpen(p.id)) { this.log(`${p.id}: breaker open`); continue; }
      try {
        const data = await p.fn(...args);
        this.breakers.set(p.id, { failures: 0, openUntil: 0 });
        this.cache.set(k, { data, ts: t, provider: p.id });
        const freshness: Freshness = i === 0 ? 'LIVE' : 'FALLBACK';
        return { data, provider: p.id, ts: t, freshness, confidence: i === 0 ? 1 : 0.85 };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        this.fail(p.id); this.log(`${p.id}: ${lastErr}`);
      }
    }
    if (cached && t - cached.ts < this.opts.staleTtlMs)
      return { data: cached.data, provider: cached.provider, ts: cached.ts, freshness: 'STALE', confidence: 0.5, error: lastErr };
    if (cached) return { data: cached.data, provider: cached.provider, ts: cached.ts, freshness: 'OFFLINE', confidence: 0.2, error: lastErr };
    throw new Error(`All providers failed: ${lastErr}`);
  }
}
