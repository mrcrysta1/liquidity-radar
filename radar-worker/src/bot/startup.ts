// Per-symbol startup with isolation: a market whose setup fails is skipped and
// retried later with a bounded backoff, while the markets that did start keep
// trading. One stuck symbol (e.g. Binance -4067 on BTC) must never stall the run.

export interface Initable {
  symbol: string
  init(): Promise<void>
}

export interface InitBackoff {
  /** Wait after the first failure. */
  baseMs: number
  /** Longest wait between attempts. */
  maxMs: number
}

export const DEFAULT_INIT_BACKOFF: InitBackoff = { baseMs: 10_000, maxMs: 300_000 }

/** Wait before the next attempt after `attempt` failures: base · 2^(attempt-1), capped. */
export function initBackoffMs(attempt: number, b: InitBackoff = DEFAULT_INIT_BACKOFF): number {
  return Math.min(b.maxMs, b.baseMs * 2 ** Math.max(0, attempt - 1))
}

export interface InitHooks {
  /** A failed attempt; `waitMs` until the next one. */
  onFail?(symbol: string, attempt: number, err: Error, waitMs: number): Promise<void> | void
  /** Ready, after `attempts` tries. */
  onReady?(symbol: string, attempts: number): Promise<void> | void
}

/** A reporting hook (usually a database event) must never break startup. */
async function quietly(f: () => Promise<void> | void): Promise<void> {
  try {
    await f()
  } catch {
    // ignored
  }
}

interface Slot<T extends Initable> {
  item: T
  ready: boolean
  attempts: number
  nextAt: number
}

export class InitQueue<T extends Initable> {
  private slots: Slot<T>[]
  private hooks: InitHooks
  private backoff: InitBackoff

  constructor(items: T[], hooks: InitHooks = {}, backoff: InitBackoff = DEFAULT_INIT_BACKOFF) {
    this.hooks = hooks
    this.backoff = backoff
    this.slots = items.map((item) => ({ item, ready: false, attempts: 0, nextAt: 0 }))
  }

  /** Try every pending item that is due. Never throws: a failure only schedules a retry. */
  async run(now = Date.now()): Promise<void> {
    for (const s of this.slots) {
      if (s.ready || s.nextAt > now) continue
      s.attempts++
      try {
        await s.item.init()
        s.ready = true
      } catch (e) {
        const wait = initBackoffMs(s.attempts, this.backoff)
        s.nextAt = now + wait
        await quietly(() => this.hooks.onFail?.(s.item.symbol, s.attempts, e as Error, wait))
        continue
      }
      await quietly(() => this.hooks.onReady?.(s.item.symbol, s.attempts))
    }
  }

  /** Items that started, in their original order. */
  get ready(): T[] {
    return this.slots.filter((s) => s.ready).map((s) => s.item)
  }

  get pending(): string[] {
    return this.slots.filter((s) => !s.ready).map((s) => s.item.symbol)
  }
}
