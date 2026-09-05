import { mdRestErr, mdRestOk } from '../services/market'

// --- REST adapter: dedup + throttling + retry/backoff -------

const rl = { map: {} as Record<string, number>, queue: 0, minGap: 90, last: 0 }

function rlThrottle(_url?: string): boolean {
  const now = Date.now()
  if (now - rl.last >= rl.minGap) {
    rl.last = now
    rl.queue = 0
    return true
  }
  rl.queue++
  return false
}

async function rawFetch(url: string, to?: number): Promise<unknown> {
  const c = new AbortController()
  const h = setTimeout(() => c.abort(), to || 12000)
  try {
    const r = await fetch(url, { signal: c.signal })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return await r.json()
  } finally {
    clearTimeout(h)
  }
}

const mdReqs: Record<string, Promise<unknown>> = {}

export async function jget2(
  url: string,
  opts?: { retries?: number; to?: number; dedup?: boolean },
): Promise<unknown> {
  const o = opts ?? {}
  const retries = o.retries != null ? o.retries : 1
  const to = o.to || 12000
  // dedup: coalesce concurrent identical in-flight requests
  if (o.dedup !== false && url in mdReqs) return mdReqs[url]
  const doFetch = (): Promise<unknown> => {
    try {
      return rawFetch(url, to)
    } catch (e) {
      throw new Error('network', { cause: e })
    }
  }
  if (o.dedup !== false) {
    mdReqs[url] = doFetch().catch((err) => {
      delete mdReqs[url]
      throw err
    })
  }
  let attempt = 0
  const delay = 600
  const run = o.dedup !== false ? mdReqs[url] : doFetch()
  const p = run
    .then((res) => {
      if (o.dedup !== false) delete mdReqs[url]
      return res
    })
    .catch(function (err) {
      if (attempt >= retries) throw err
      attempt++
      return new Promise<void>((r2) => setTimeout(r2, delay + attempt * 250)).then(function () {
        if (o.dedup !== false) delete mdReqs[url]
        return rawFetch(url, to)
      })
    })
  return p
}

// throttle wrapper (fire-and-forget; dropped calls simply wait for next poll)
export function rlSchedule(fn: () => void): void {
  if (rlThrottle()) fn()
  else setTimeout(fn, Math.max(0, rl.minGap - (Date.now() - rl.last)))
}

export async function jget(url: string, to?: number): Promise<unknown> {
  const timeout = to || 12000
  const isBinance = /binance\.com/.test(url)
  try {
    const res = await jget2(url, { to: timeout, retries: isBinance ? 1 : 0, dedup: true })
    if (isBinance) mdRestOk()
    return res
  } catch (e) {
    if (isBinance) mdRestErr()
    throw e
  }
}
