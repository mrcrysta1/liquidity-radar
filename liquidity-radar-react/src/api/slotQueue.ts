// Request slot queue: hands out one slot every `gapMs`, high priority first,
// first come first served within a priority, and drops a request whose caller
// no longer wants it before it ever spends a slot.
//
// Used to pace Binance REST calls (api/client). The old scheme reserved a time
// slot at call time, so a burst of background work (the signal scanner's trade
// pulls, companion charts reloading after every click) pushed the active
// chart's history load behind all of it, and nothing was ever cancelled.
//
// Deliberately dependency-free (no runtime imports, no DOM): the unit tests in
// scripts/test-engines.mjs load this file straight into Node, with an
// injectable clock and timer.

/**
 * Rejection for a queued request whose caller said it is stale (the user moved
 * to another coin or interval before its slot came up). Not a failure: callers
 * and failover chains ignore it rather than counting it or showing it.
 */
export class StaleRequestError extends Error {
  constructor(message = 'request dropped: no longer wanted') {
    super(message)
    this.name = 'StaleRequestError'
  }
}

/** True for a request the queue dropped as stale. Checked by name so it survives module boundaries. */
export function isStaleRequest(e: unknown): boolean {
  return e instanceof Error && e.name === 'StaleRequestError'
}

export type SlotPriority = 'high' | 'normal'

export interface SlotRequest {
  /** 'high' jumps every queued 'normal' request. Default 'normal'. */
  priority?: SlotPriority
  /** Checked when the request's turn comes; true drops it without spending a slot. */
  isStale?: () => boolean
}

interface Entry {
  isStale?: () => boolean
  resolve: () => void
  reject: (e: Error) => void
}

export interface SlotQueue {
  /** Resolves when the caller may go; rejects with StaleRequestError if dropped. */
  acquire(req?: SlotRequest): Promise<void>
  /** Requests waiting for a slot. */
  pending(): number
}

export function staleNow(isStale?: () => boolean): boolean {
  if (!isStale) return false
  try {
    return !!isStale()
  } catch {
    return false // a broken guard must not silently drop real work
  }
}

export function createSlotQueue(
  gapMs: number,
  now: () => number = () => Date.now(),
  setTimer: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
): SlotQueue {
  const high: Entry[] = []
  const normal: Entry[] = []
  let last = -Infinity
  let armed = false

  function next(): Entry | undefined {
    return high.shift() ?? normal.shift()
  }

  function pump(): void {
    armed = false
    for (;;) {
      if (!high.length && !normal.length) return
      const wait = last + gapMs - now()
      if (wait > 0) {
        armed = true
        setTimer(pump, wait)
        return
      }
      // Hand the slot to the first request still wanted; stale ones are
      // dropped on the way and cost nothing.
      let e = next()
      while (e && staleNow(e.isStale)) {
        e.reject(new StaleRequestError())
        e = next()
      }
      if (!e) return
      last = now()
      e.resolve()
    }
  }

  return {
    acquire(req = {}) {
      return new Promise<void>((resolve, reject) => {
        const e: Entry = { isStale: req.isStale, resolve, reject }
        if (req.priority === 'high') high.push(e)
        else normal.push(e)
        if (!armed) pump()
      })
    },
    pending: () => high.length + normal.length,
  }
}
