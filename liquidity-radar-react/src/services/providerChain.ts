// Provider failover chain: primary → fallback(s) → last good copy (STALE) →
// OFFLINE, with a circuit breaker per provider. Ported from the Pro terminal's
// core/providers/chain.ts.
//
// Deliberately dependency-free (no runtime imports, no DOM): the unit tests in
// scripts/test-engines.mjs load this file straight into Node.

/** How much to trust what is on screen. */
export type Freshness = 'LIVE' | 'DELAYED' | 'STALE' | 'OFFLINE'

export interface ChainProvider<A extends unknown[], R> {
  id: string
  /** Display name for the freshness badge. */
  name: string
  /** Resolve `null` for "this provider does not serve that request" — skipped without counting as a failure. */
  fn: (...args: A) => Promise<R | null>
}

export interface ChainResult<R> {
  data: R
  provider: string
  name: string
  /** When the data was fetched (ms). */
  ts: number
  /** LIVE from the primary, DELAYED from a fallback, STALE/OFFLINE from the last good copy. */
  freshness: Freshness
  /** True when the primary provider answered this very request. */
  primary: boolean
  error?: string
}

export interface CacheEntry<R> {
  data: R
  ts: number
  provider: string
  name: string
}

/** Where last good results live. The default is an in-memory map. */
export interface ChainStore<R> {
  get(key: string): CacheEntry<R> | undefined
  set(key: string, entry: CacheEntry<R>): void
}

export interface ChainOptions<R> {
  /** Consecutive failures that open a provider's breaker. */
  breakerFailures: number
  /** How long an open breaker skips its provider. */
  breakerCooldownMs: number
  /** A last good copy younger than this is STALE; older is OFFLINE. */
  staleTtlMs: number
  now: () => number
  store: ChainStore<R>
}

interface Breaker {
  failures: number
  openUntil: number
}

/** Bounded insertion-order map, the default store. */
export function memoryStore<R>(max = 32): ChainStore<R> {
  const m = new Map<string, CacheEntry<R>>()
  return {
    get: (k) => m.get(k),
    set: (k, e) => {
      m.delete(k)
      m.set(k, e)
      while (m.size > max) m.delete(m.keys().next().value as string)
    },
  }
}

export class ProviderChain<A extends unknown[], R> {
  private providers: ChainProvider<A, R>[]
  private opts: ChainOptions<R>
  private breakers = new Map<string, Breaker>()
  /** Recent failures and skips, newest last — for diagnostics. */
  events: string[] = []

  constructor(providers: ChainProvider<A, R>[], opts: Partial<ChainOptions<R>> = {}) {
    this.providers = providers
    this.opts = {
      breakerFailures: 3,
      breakerCooldownMs: 30_000,
      staleTtlMs: 10 * 60_000,
      now: () => Date.now(),
      store: opts.store ?? memoryStore<R>(),
      ...opts,
    }
  }

  isOpen(id: string): boolean {
    const b = this.breakers.get(id)
    return !!b && b.openUntil > this.opts.now()
  }

  private fail(id: string): void {
    const b = this.breakers.get(id) ?? { failures: 0, openUntil: 0 }
    b.failures++
    if (b.failures >= this.opts.breakerFailures) {
      b.openUntil = this.opts.now() + this.opts.breakerCooldownMs
      b.failures = 0
    }
    this.breakers.set(id, b)
  }

  private log(m: string): void {
    this.events.push(m)
    if (this.events.length > 50) this.events.shift()
  }

  /** Last good copy for these arguments, if any — without fetching. */
  cached(...args: A): CacheEntry<R> | undefined {
    return this.opts.store.get(JSON.stringify(args))
  }

  async get(...args: A): Promise<ChainResult<R>> {
    const key = JSON.stringify(args)
    const errs: string[] = []
    for (let i = 0; i < this.providers.length; i++) {
      const p = this.providers[i]
      if (this.isOpen(p.id)) {
        this.log(p.id + ': breaker open')
        errs.push(p.name + ': cooling down after repeated failures')
        continue
      }
      let data: R | null
      try {
        data = await p.fn(...args)
      } catch (e) {
        const msg = p.name + ': ' + (e instanceof Error ? e.message : String(e))
        errs.push(msg)
        this.fail(p.id)
        this.log(msg)
        continue
      }
      if (data === null) continue // not served by this provider — not its fault
      this.breakers.set(p.id, { failures: 0, openUntil: 0 })
      const ts = this.opts.now()
      this.opts.store.set(key, { data, ts, provider: p.id, name: p.name })
      return {
        data,
        provider: p.id,
        name: p.name,
        ts,
        freshness: i === 0 ? 'LIVE' : 'DELAYED',
        primary: i === 0,
      }
    }
    const lastErr = errs.join('; ')
    const c = this.opts.store.get(key)
    if (c) {
      const age = this.opts.now() - c.ts
      return {
        data: c.data,
        provider: c.provider,
        name: c.name,
        ts: c.ts,
        freshness: age < this.opts.staleTtlMs ? 'STALE' : 'OFFLINE',
        primary: false,
        error: lastErr,
      }
    }
    throw new Error('All providers failed' + (lastErr ? ': ' + lastErr : ''))
  }
}

/** Live kline ticks newer than this keep the chart LIVE. */
export const LIVE_WINDOW_MS = 30_000
/** A REST snapshot from the primary counts as LIVE for this long without a tick. */
export const REST_LIVE_MS = 60_000
/** A REST snapshot older than this, with no live tick, is STALE. */
export const REST_STALE_MS = 5 * 60_000

/**
 * What the chart badge should say, from where the candles came from and when
 * the live stream last ticked. Pure so it can be tested without a clock.
 */
export function klineFreshness(
  rest: { freshness: Freshness; ts: number } | null,
  lastLiveTs: number,
  now: number,
): Freshness {
  if (lastLiveTs && now - lastLiveTs < LIVE_WINDOW_MS) return 'LIVE'
  if (!rest) return 'OFFLINE'
  if (rest.freshness === 'STALE' || rest.freshness === 'OFFLINE') return rest.freshness
  const age = now - rest.ts
  if (age >= REST_STALE_MS) return 'STALE'
  if (rest.freshness === 'LIVE' && age < REST_LIVE_MS && !lastLiveTs) return 'LIVE'
  return 'DELAYED'
}

/**
 * Spaces calls `gapMs` apart, first come first served: each caller reserves
 * the next free slot and waits for it. Used to keep bulk feature fetches (the
 * signal scanner, the home cards) from bursting at a fallback venue, whose
 * limits are far tighter than Binance's. `now` and `sleep` are injectable so
 * the spacing can be tested without a clock.
 */
export function createPacer(
  gapMs: number,
  now: () => number = () => Date.now(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): () => Promise<void> {
  let next = 0
  return async () => {
    const t = now()
    const at = Math.max(t, next)
    next = at + gapMs
    if (at > t) await sleep(at - t)
  }
}

/** Candles back into Binance's REST row shape, [openTime, o, h, l, c, v], oldest first. */
export function toKlineRows(
  candles: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
): number[][] {
  return candles.map((c) => [c.t, c.o, c.h, c.l, c.c, c.v])
}
