// Binance rate-limit guard.
//
// Binance answers 429 when you are going too fast and 418 when it has banned
// the IP outright, with a Retry-After header and a ban expiry in the body. The
// worst thing an app can do then is keep retrying — that extends the ban. This
// module records the cooldown, refuses outgoing Binance calls until it passes,
// and tells the UI what is happening so the chart can say so instead of
// looking broken.
type Listener = (until: number) => void

let bannedUntil = 0
const listeners: Listener[] = []

export function onRateLimit(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

/** Milliseconds until Binance will accept requests again, 0 when clear. */
export function cooldownLeft(): number {
  return Math.max(0, bannedUntil - Date.now())
}
export function isRateLimited(): boolean {
  return cooldownLeft() > 0
}

export function noteRateLimit(untilMs: number): void {
  if (!(untilMs > Date.now())) return
  if (untilMs <= bannedUntil) return
  bannedUntil = untilMs
  listeners.slice().forEach((fn) => fn(bannedUntil))
}

/**
 * Pull the cooldown out of a 418/429. Binance sends `Retry-After` in seconds
 * and, for a ban, an expiry timestamp in the body: "IP banned until 1700000000000".
 */
export function noteLimitResponse(status: number, retryAfter: string | null, body: string): void {
  if (status !== 418 && status !== 429) return
  const m = /banned until (\d{10,})/i.exec(body || '')
  if (m) {
    noteRateLimit(Number(m[1]))
    return
  }
  const secs = Number(retryAfter)
  noteRateLimit(Date.now() + (Number.isFinite(secs) && secs > 0 ? secs * 1000 : 60_000))
}

export class RateLimitedError extends Error {
  readonly until: number
  constructor(until: number) {
    super('Binance rate limit — retry in ' + Math.ceil((until - Date.now()) / 1000) + 's')
    this.name = 'RateLimitedError'
    this.until = until
  }
}
