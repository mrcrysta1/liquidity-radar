import { mdRestErr, mdRestOk } from '../services/market'
import { noteCall } from '../services/dataSources'
import { RateLimitedError, cooldownLeft, isRateLimited, noteLimitResponse } from './rateLimit'

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
  const started = Date.now()
  try {
    const r = await fetch(url, { signal: c.signal })
    noteCall(url, r.ok, r.status, Date.now() - started)
    if (!r.ok) {
      // 429/418 mean slow down or you are banned. Read the cooldown out of the
      // response and record it, so nothing retries into a longer ban.
      if (r.status === 429 || r.status === 418) {
        let body = ''
        try {
          body = await r.text()
        } catch {
          /* body already consumed or empty */
        }
        noteLimitResponse(r.status, r.headers.get('Retry-After'), body)
        throw new RateLimitedError(Date.now() + cooldownLeft())
      }
      throw new Error('HTTP ' + r.status)
    }
    return await r.json()
  } catch (e) {
    if (!(e instanceof RateLimitedError)) noteCall(url, false, 0, Date.now() - started)
    throw e
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
      if (err instanceof RateLimitedError || attempt >= retries) throw err
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

// --- Binance budget ---------------------------------------------------------
//
// Binance prices REST calls by *weight* per minute, not by count, and one page
// load fans out to dozens of them: the chart's history pages, the signal
// scanner's per-coin trade pulls, the companion charts. Go over and the answer
// is 429, then 418 — an IP ban measured in minutes, which is what "chart data
// is not loading" actually looks like from the user's side.
//
// So requests are spaced a little, and a rolling minute of spend is watched.
//
// Both are *smoothing*, not enforcement — the thing that actually protects the
// IP is the 429/418 guard above, which knows the real limit because Binance
// tells it. A client-side budget set below genuine demand is far worse than no
// budget: it starves the app silently, which is indistinguishable from a hang.
// So the cap sits at half the published allowance, and a request that cannot
// afford it waits only briefly before going anyway.
const BINANCE_GAP = 50
/** Half of Binance's published 6000/min. A real boot costs around 1000. */
const WEIGHT_CAP = 3000
/** Longest a call will ever wait on the budget before proceeding regardless. */
const MAX_BUDGET_WAIT = 4000
const WINDOW_MS = 60_000

/**
 * Rough cost of a call, from Binance's published schedule. The exact numbers
 * matter less than the ratios: /trades?limit=1000 costs an order of magnitude
 * more than a small klines page, and counting requests hides that entirely.
 */
function weightOf(url: string): number {
  const lim = Number(/[?&]limit=(\d+)/.exec(url)?.[1] || 0)
  if (url.indexOf('/exchangeInfo') !== -1) return 20
  if (url.indexOf('/ticker/24hr') !== -1) return /[?&]symbols?=/.test(url) ? 80 : 2
  if (url.indexOf('/trades') !== -1 || url.indexOf('/aggTrades') !== -1) return lim > 100 ? 25 : 5
  if (url.indexOf('/depth') !== -1) return lim > 500 ? 50 : lim > 100 ? 25 : lim > 5 ? 5 : 2
  if (url.indexOf('/klines') !== -1) return lim > 1000 ? 10 : lim > 500 ? 10 : 2
  if (url.indexOf('/ticker/') !== -1) return 2
  return 5 // unknown endpoint: assume it is not free
}

const spent: Array<{ t: number; w: number }> = []
function weightUsed(now: number): number {
  while (spent.length && now - spent[0].t > WINDOW_MS) spent.shift()
  let n = 0
  for (let i = 0; i < spent.length; i++) n += spent[i].w
  return n
}

let binanceNext = 0
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function binanceSlot(url: string): Promise<void> {
  const now = Date.now()
  const at = Math.max(now, binanceNext)
  binanceNext = at + BINANCE_GAP
  if (at > now) await wait(at - now)
  const w = weightOf(url)
  // Over budget: hold while the oldest spend ages out — but only briefly. If
  // the window still has not cleared, go anyway and let the 418 guard deal with
  // a real limit; never leave a caller waiting minutes for a slot.
  const until = Date.now() + MAX_BUDGET_WAIT
  while (Date.now() < until && weightUsed(Date.now()) + w > WEIGHT_CAP) {
    await wait(Math.min(400, Math.max(50, until - Date.now())))
  }
  spent.push({ t: Date.now(), w })
}

export async function jget(url: string, to?: number): Promise<unknown> {
  const timeout = to || 12000
  const isBinance = /binance\.com/.test(url)
  // While Binance has us in a cooldown, do not even open the connection.
  if (isBinance && isRateLimited()) throw new RateLimitedError(Date.now() + cooldownLeft())
  if (isBinance) await binanceSlot(url)
  try {
    const res = await jget2(url, { to: timeout, retries: isBinance ? 1 : 0, dedup: true })
    if (isBinance) mdRestOk()
    return res
  } catch (e) {
    if (isBinance) mdRestErr()
    throw e
  }
}

// Feed getter for CORS-less hosts (Forex Factory, RSS feeds): prefers the
// same-origin /api/fetch proxy (Vercel function in prod) and falls back to a
// direct jget2 when the proxy is unavailable (e.g. plain `vite dev`).
export async function jgetProxied(
  url: string,
  opts?: { retries?: number; to?: number; dedup?: boolean },
): Promise<unknown> {
  const to = opts?.to || 12000
  const c = new AbortController()
  const h = setTimeout(() => c.abort(), to)
  const t0 = Date.now()
  try {
    const r = await fetch('/api/fetch?url=' + encodeURIComponent(url), { signal: c.signal })
    // Recorded against the *upstream* source, not the proxy: the register
    // documents where the data comes from, not how it got here.
    noteCall(url, r.ok, r.status, Date.now() - t0)
    if (!r.ok) throw new Error('proxy HTTP ' + r.status)
    return JSON.parse(await r.text())
  } catch {
    return jget2(url, opts)
  } finally {
    clearTimeout(h)
  }
}
