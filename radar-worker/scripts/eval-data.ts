// Historical market data for the offline evaluation, from Binance's public,
// unsigned endpoints only (no keys, no orders), cached on disk.
//
//   USDⓈ-M futures klines   fapi.binance.com/fapi/v1/klines
//   funding rate history    fapi.binance.com/fapi/v1/fundingRate
//   spot klines (optional)  data-api.binance.vision/api/v3/klines
//
// The cache is one JSON file per symbol, interval and UTC month. A month is
// only cached once it is entirely in the past (a part-month is cached under its
// exact range), so a run pinned to an end date reads the same bytes every time.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { barFromKline } from '../src/bot/features.ts'
import type { Bar } from '../src/bot/features.ts'
import { INTERVAL_MS } from '../src/bot/data.ts'
import type { FundingEvent } from '../src/bot/walkforward.ts'

export type Source = 'futures' | 'spot'

const HOSTS: Record<Source, string> = { futures: 'https://fapi.binance.com', spot: 'https://data-api.binance.vision' }
const KLINES: Record<Source, string> = { futures: '/fapi/v1/klines', spot: '/api/v3/klines' }
const LIMIT: Record<Source, number> = { futures: 1500, spot: 1000 }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getJson(url: string): Promise<unknown> {
  let err: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (r.status === 429 || r.status === 418) {
        await sleep((Number(r.headers.get('retry-after')) || 30) * 1000)
        continue
      }
      if (!r.ok) throw new Error(`${url} → HTTP ${r.status} ${await r.text().catch(() => '')}`)
      await sleep(200) // stay far below the public weight limit
      return await r.json()
    } catch (e) {
      err = e
      await sleep(1000 * 2 ** attempt)
    }
  }
  throw err
}

/** UTC month chunks covering [start, end). */
function months(start: number, end: number): Array<{ from: number; to: number; key: string; whole: boolean }> {
  const out = []
  const d = new Date(start)
  let m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  while (m < end) {
    const md = new Date(m)
    const next = Date.UTC(md.getUTCFullYear(), md.getUTCMonth() + 1, 1)
    const from = Math.max(start, m)
    const to = Math.min(end, next)
    const whole = from === m && to === next
    const ym = md.toISOString().slice(0, 7)
    out.push({ from, to, key: whole ? ym : `${ym}_${from}-${to}`, whole })
    m = next
  }
  return out
}

async function cached<T>(file: string, immutable: boolean, load: () => Promise<T>): Promise<T> {
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T
  const v = await load()
  if (immutable) writeFileSync(file, JSON.stringify(v))
  return v
}

/** Closed klines with open time in [start, end), oldest first, de-duplicated. */
export async function klines(symbol: string, interval: string, start: number, end: number, cacheDir: string, source: Source = 'futures'): Promise<Bar[]> {
  const step = INTERVAL_MS[interval]
  if (!step) throw new Error('unknown interval ' + interval)
  mkdirSync(cacheDir, { recursive: true })
  const out: Bar[] = []
  for (const c of months(start, end)) {
    const file = join(cacheDir, `${source}-${symbol}-${interval}-${c.key}.json`)
    const bars = await cached(file, c.to <= Date.now() - step, async () => {
      const rows: Bar[] = []
      let cursor = c.from
      while (cursor < c.to) {
        const url = `${HOSTS[source]}${KLINES[source]}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${c.to - 1}&limit=${LIMIT[source]}`
        const page = (await getJson(url)) as unknown[][]
        if (!page.length) break
        rows.push(...page.map(barFromKline))
        cursor = Number(page[page.length - 1][0]) + step
        if (page.length < LIMIT[source]) break
      }
      return rows.filter((b) => b.t >= c.from && b.t < c.to && b.t + step <= Date.now())
    })
    out.push(...bars)
  }
  const seen = new Set<number>()
  return out.sort((a, b) => a.t - b.t).filter((b) => !seen.has(b.t) && seen.add(b.t))
}

/** Funding settlements in [start, end) for a USDⓈ-M perpetual. */
export async function fundingHistory(symbol: string, start: number, end: number, cacheDir: string): Promise<FundingEvent[]> {
  mkdirSync(cacheDir, { recursive: true })
  const out: FundingEvent[] = []
  for (const c of months(start, end)) {
    const file = join(cacheDir, `funding-${symbol}-${c.key}.json`)
    const ev = await cached(file, c.to <= Date.now(), async () => {
      const rows: FundingEvent[] = []
      let cursor = c.from
      while (cursor < c.to) {
        const page = (await getJson(`${HOSTS.futures}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${cursor}&endTime=${c.to - 1}&limit=1000`)) as Array<{ fundingTime: number; fundingRate: string }>
        if (!page.length) break
        rows.push(...page.map((x) => ({ t: Number(x.fundingTime), rate: Number(x.fundingRate) })))
        cursor = Number(page[page.length - 1].fundingTime) + 1
        if (page.length < 1000) break
      }
      return rows
    })
    out.push(...ev)
  }
  return out.sort((a, b) => a.t - b.t)
}

/** Missing bars (gaps in open times), for the data-quality line of the report. */
export function gaps(b: Bar[], step: number): number {
  let n = 0
  for (let i = 1; i < b.length; i++) n += Math.max(0, Math.round((b[i].t - b[i - 1].t) / step) - 1)
  return n
}
