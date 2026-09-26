// Whale orders for the price chart, built from Binance spot aggTrades — real
// executed trades only, nothing estimated or synthesised.
//
// One taker order that sweeps several price levels prints as several
// aggTrades, each at its own price, all carrying the same transaction time and
// side. Grouping consecutive aggTrades on (time, side) therefore rebuilds the
// order the taker actually sent, so a $2M market buy reads as one $2M bubble
// rather than a dozen smaller ones. Its price is the volume-weighted average of
// its fills.
//
// Sources, merged and deduplicated by aggTrade id:
//  - backfill: /api/v3/aggTrades paged backwards by id from the newest trade,
//    paced, until it reaches the start of the chart or its page budget. Every
//    page is exact, but a page holds 1000 aggTrades — minutes of BTC, hours of
//    a small cap — so how far back this reaches depends on the symbol.
//  - live: the aggTrade websocket the chart already runs.
//  - storage: what earlier sessions captured, so coverage grows over time.
//
// Coverage is tracked as aggTrade id ranges, so the chart can show exactly
// which stretches of time have been scanned and which have not.
import { state } from '../../services/store'
import { storageGetRaw, storageSetRaw } from '../../services/storage'
import { jget } from '../../api/client'
import { isInstrument } from '../../constants/instruments'
import { autoThreshold, groupAggTrades } from './whaleMath'
import type { Agg, WhaleOrder } from './whaleMath'

export type { WhaleOrder } from './whaleMath'

/** A scanned stretch of the tape: every aggTrade from a0 to a1 was seen. */
export interface Coverage {
  a0: number
  a1: number
  t0: number
  t1: number
}

export interface WhaleView {
  sym: string
  orders: WhaleOrder[]
  coverage: Coverage[]
  /** Smallest order kept, in USD. */
  floor: number
  /** Default display threshold for this symbol, in USD. */
  auto: number
  /** Threshold currently displayed, in USD. */
  min: number
  mult: number
  loading: boolean
  /** Open time of the chart's first candle — how far back a scan could go. */
  earliest: number
  /** History came from the radar-worker database. */
  server: boolean
  /** The collector's last heartbeat (ms), 0 if unknown. */
  serverUpdated: number
}

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com']
const PAGE = 1000
// A page is 1000 aggTrades, ~100KB of JSON. The automatic scan stops at
// ~8MB (hours of BTC, a day or more of most alts); going further back is the
// user's call, a batch at a time.
const AUTO_PAGES = 80
const MORE_PAGES = 160
const CONCURRENCY = 3
const KEEP_MS = 7 * 86_400_000
const MAX_ORDERS = 6000
const MAX_SYMBOLS = 6
const KEY = 'lr-whales-v1:'
const INDEX_KEY = 'lr-whales-v1-index'
const MULT_KEY = 'lr-whaleMult'
export const WHALE_MULTS = [0.5, 1, 2, 5, 10]

let sym = ''
let floor = 0
let auto = 0
let orders: WhaleOrder[] = []
let coverage: Coverage[] = []
let loading = false
let earliestT = 0
let gen = 0
// Live tape state (see ingestWhaleAgg).
let pending: Agg[] = []
let held = -1
let flushTimer: ReturnType<typeof setTimeout> | null = null
let liveCov: Coverage | null = null
// Optional history server (radar-worker → Supabase). Both values are public:
// the anon key can only read the whale tables (see radar-worker/sql).
const DB_URL = (import.meta.env.VITE_WHALE_DB_URL as string | undefined)?.replace(/\/+$/, '')
const DB_KEY = import.meta.env.VITE_WHALE_DB_KEY as string | undefined
const SERVER = !!(DB_URL && DB_KEY)
/** Smallest order size loaded from the server for the current symbol. */
let serverMin = Infinity
let serverUpdated = 0
let serverLoaded = false
/** Earliest time server orders have been loaded from. */
let serverFrom = Infinity
let mult = (() => {
  const v = Number(storageGetRaw(MULT_KEY))
  return WHALE_MULTS.includes(v) ? v : 1
})()

type Listener = () => void
const listeners: Listener[] = []
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}
export function onWhaleFlowChange(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

export function getWhaleView(): WhaleView {
  return {
    sym,
    orders,
    coverage,
    floor,
    auto,
    min: auto * mult,
    mult,
    loading,
    earliest: earliestT,
    server: serverLoaded,
    serverUpdated,
  }
}

export function setWhaleMult(m: number): void {
  if (!WHALE_MULTS.includes(m) || m === mult) return
  mult = m
  storageSetRaw(MULT_KEY, String(m))
  emit()
  // A lower threshold than the server rows already loaded: fetch the rest.
  if (serverLoaded && auto * m < serverMin)
    void loadServerOrders(gen, sym, earliestT).catch(() => {})
}

/** Merge orders into the book: dedupe by id, and re-join orders a page edge split. */
function addOrders(list: WhaleOrder[]): boolean {
  if (!list.length) return false
  const byId = new Map<number, WhaleOrder>()
  orders.forEach((o) => byId.set(o.a0, o))
  let changed = false
  for (const o of list) {
    if (byId.has(o.a0)) continue
    byId.set(o.a0, o)
    changed = true
  }
  if (!changed) return false
  const all = [...byId.values()].sort((x, y) => x.a0 - y.a0)
  const merged: WhaleOrder[] = []
  for (const o of all) {
    const last = merged[merged.length - 1]
    if (last && last.a1 + 1 === o.a0 && last.t === o.t && last.side === o.side) {
      last.usd += o.usd
      last.q += o.q
      last.a1 = o.a1
      last.n += o.n
      last.p = last.usd / last.q
    } else merged.push({ ...o })
  }
  orders = merged
  return true
}

function addCoverage(c: Coverage): void {
  const all = [...coverage, c].sort((x, y) => x.a0 - y.a0)
  const out: Coverage[] = []
  for (const s of all) {
    const last = out[out.length - 1]
    if (last && s.a0 <= last.a1 + 1) {
      if (s.a1 > last.a1) {
        last.a1 = s.a1
        last.t1 = s.t1
      }
      if (s.t0 < last.t0) last.t0 = s.t0
    } else out.push({ ...s })
  }
  coverage = out
}

/**
 * Orders under the floor are dropped; the floor is half the default
 * threshold, so the lowest display setting still has everything it needs.
 * Candidates straddling a page edge are kept at a quarter of the floor so the
 * re-join in addOrders can still lift them over it.
 */
function keepBig(list: WhaleOrder[], edgeIds: Set<number>): WhaleOrder[] {
  return list.filter(
    (o) => o.usd >= floor || ((edgeIds.has(o.a0) || edgeIds.has(o.a1)) && o.usd >= floor / 4),
  )
}

function ingestPage(page: Agg[]): void {
  if (!page.length) return
  const edge = new Set([page[0].a, page[page.length - 1].a])
  addOrders(keepBig(groupAggTrades(page), edge))
  addCoverage({
    a0: page[0].a,
    a1: page[page.length - 1].a,
    t0: page[0].T,
    t1: page[page.length - 1].T,
  })
}

// ---- storage ----------------------------------------------------------------

type Stored = {
  floor: number
  auto: number
  o: Array<[number, number, number, number, number, number, 0 | 1, number]>
  c: Coverage[]
}

function load(s: string): void {
  orders = []
  coverage = []
  floor = 0
  auto = 0
  try {
    const raw = storageGetRaw(KEY + s)
    if (!raw) return
    const d = JSON.parse(raw) as Stored
    floor = d.floor
    auto = d.auto
    orders = (d.o || []).map(([a0, a1, t, p, usd, q, sd, n]) => ({
      a0,
      a1,
      t,
      p,
      usd,
      q,
      side: sd ? 'buy' : 'sell',
      n,
    }))
    coverage = d.c || []
  } catch {
    orders = []
    coverage = []
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    save()
  }, 5000)
}

function save(): void {
  // With a history server the browser keeps nothing of its own.
  if (!sym || !floor || serverLoaded) return
  const cutoff = Date.now() - KEEP_MS
  // Only keep orders the floor still admits (page-edge candidates that never
  // got re-joined are dropped here).
  let keep = orders.filter((o) => o.t >= cutoff && o.usd >= floor)
  if (keep.length > MAX_ORDERS) keep = keep.slice(keep.length - MAX_ORDERS)
  const cov = coverage.filter((c) => c.t1 >= cutoff)
  const d: Stored = {
    floor,
    auto,
    o: keep.map((o) => [
      o.a0,
      o.a1,
      o.t,
      +o.p.toPrecision(8),
      Math.round(o.usd),
      +o.q.toPrecision(8),
      o.side === 'buy' ? 1 : 0,
      o.n,
    ]),
    c: cov,
  }
  storageSetRaw(KEY + sym, JSON.stringify(d))
  // Least-recently-used symbols make room for new ones.
  let idx: string[]
  try {
    idx = JSON.parse(storageGetRaw(INDEX_KEY) || '[]')
  } catch {
    idx = []
  }
  idx = [sym, ...idx.filter((x) => x !== sym)]
  idx.slice(MAX_SYMBOLS).forEach((x) => {
    try {
      localStorage.removeItem(KEY + x)
    } catch {
      /* storage unavailable */
    }
  })
  storageSetRaw(INDEX_KEY, JSON.stringify(idx.slice(0, MAX_SYMBOLS)))
}

// ---- backfill ---------------------------------------------------------------

async function fetchAgg(path: string): Promise<Agg[]> {
  let err: unknown = null
  for (const h of HOSTS) {
    try {
      const r = (await jget(h + path, 15000)) as Agg[]
      if (Array.isArray(r)) return r
    } catch (e) {
      err = e
    }
  }
  throw err || new Error('aggTrades unavailable')
}

async function quoteVolume(s: string): Promise<number> {
  const t = state.tickers[s]
  if (t && t.qvol > 0) return t.qvol
  for (const h of HOSTS) {
    try {
      const r = (await jget(h + '/api/v3/ticker/24hr?symbol=' + s, 10000)) as {
        quoteVolume?: string
      }
      const v = Number(r?.quoteVolume)
      if (v > 0) return v
    } catch {
      /* next host */
    }
  }
  return 0
}

// ---- history server -----------------------------------------------------------

async function rest<T>(path: string): Promise<T> {
  const r = await fetch(DB_URL + '/rest/v1/' + path, {
    headers: { apikey: DB_KEY!, Authorization: 'Bearer ' + DB_KEY },
    signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error('whale history server: HTTP ' + r.status)
  return (await r.json()) as T
}

type OrderRow = {
  a0: number
  a1: number
  t: string
  price: number
  usd: number
  qty: number
  side: number
  fills: number
}

async function loadServerOrders(g: number, s: string, from: number, to?: number): Promise<void> {
  const min = Math.max(floor, auto * mult)
  const base =
    'whale_orders?symbol=eq.' +
    s +
    '&t=gte.' +
    encodeURIComponent(new Date(from).toISOString()) +
    (to ? '&t=lt.' + encodeURIComponent(new Date(to).toISOString()) : '') +
    '&usd=gte.' +
    min +
    '&select=a0,a1,t,price,usd,qty,side,fills&order=t.asc&limit=1000&offset='
  // Supabase returns at most 1000 rows a request.
  for (let off = 0; off < 60_000; off += 1000) {
    const rows = await rest<OrderRow[]>(base + off)
    if (g !== gen) return
    addOrders(
      rows.map((r) => ({
        a0: r.a0,
        a1: r.a1,
        t: Date.parse(r.t),
        p: r.price,
        usd: r.usd,
        q: r.qty,
        side: r.side > 0 ? 'buy' : 'sell',
        n: r.fills,
      })),
    )
    emit()
    if (rows.length < 1000) break
  }
  serverMin = Math.min(serverMin, min)
  if (!to) serverFrom = Math.min(serverFrom, from)
}

/** Settings, coverage and orders from the collector. False if it is not usable. */
async function loadServer(g: number, s: string, from: number): Promise<boolean> {
  const [set] = await rest<Array<{ floor: number; auto: number; updated: string }>>(
    'whale_symbols?symbol=eq.' + s + '&select=floor,auto,updated',
  )
  if (g !== gen || !set) return false
  // The server's floor wins: every row it holds was kept under it.
  floor = set.floor
  auto = set.auto
  serverUpdated = Date.parse(set.updated)
  const cov = await rest<Array<{ a0: number; a1: number; t0: string; t1: string }>>(
    'whale_coverage?symbol=eq.' + s + '&select=a0,a1,t0,t1&order=a0',
  )
  if (g !== gen) return false
  cov.forEach((c) =>
    addCoverage({ a0: c.a0, a1: c.a1, t0: Date.parse(c.t0), t1: Date.parse(c.t1) }),
  )
  serverLoaded = true
  await loadServerOrders(g, s, from)
  return g === gen
}

/** A heartbeat in the last two minutes: the collector is running. */
function serverLive(): boolean {
  return serverLoaded && Date.now() - serverUpdated < 120_000
}

/** The aggTrade id just before `id` that is not already covered, or -1. */
function nextUncovered(id: number): number {
  let x = id
  for (let i = coverage.length - 1; i >= 0; i--) {
    const c = coverage[i]
    if (x >= c.a0 && x <= c.a1) x = c.a0 - 1
  }
  return x
}

async function backfill(g: number, s: string, earliest: number, budget: number): Promise<void> {
  loading = true
  emit()
  try {
    if (SERVER && !serverLoaded) {
      await loadServer(g, s, earliest).catch((e) => console.warn('whale history server', e))
      if (g !== gen) return
      // A running collector already holds everything up to a few seconds ago:
      // the live stream covers the rest. "Scan further back" still works.
      if (serverLive() && budget === AUTO_PAGES) return
    }
    if (!floor) {
      auto = autoThreshold(await quoteVolume(s))
      floor = auto / 2
    }
    if (g !== gen) return
    const newest = await fetchAgg('/api/v3/aggTrades?symbol=' + s + '&limit=' + PAGE)
    if (g !== gen || !newest.length) return
    ingestPage(newest)
    emit()
    let cursor = newest[0].a - 1
    let pages = 1
    let oldestT = newest[0].T
    while (pages < budget && cursor >= 0 && oldestT > earliest) {
      const batch: number[] = []
      let c = cursor
      while (batch.length < CONCURRENCY && pages + batch.length < budget) {
        const skipTo = nextUncovered(c)
        // Jumping over covered ground that already reaches the chart start: done.
        const skipped = coverage.find((k) => k.a0 === skipTo + 1)
        if (skipTo !== c && skipped && skipped.t0 <= earliest) {
          c = -1
          break
        }
        c = skipTo
        if (c < 0) break
        const from = Math.max(0, c - PAGE + 1)
        batch.push(from)
        c = from - 1
      }
      if (!batch.length) break
      const got = await Promise.all(
        batch.map((from) =>
          fetchAgg('/api/v3/aggTrades?symbol=' + s + '&fromId=' + from + '&limit=' + PAGE).catch(
            () => [] as Agg[],
          ),
        ),
      )
      if (g !== gen) return
      let any = false
      // Overlap with what is already held is harmless: orders dedupe by id and
      // coverage ranges merge.
      got.forEach((page) => {
        if (!page.length) return
        any = true
        ingestPage(page)
        if (page[0].T < oldestT) oldestT = page[0].T
      })
      pages += batch.length
      cursor = c
      emit()
      scheduleSave()
      if (!any) break
      // Leave room for everything else the app is fetching.
      await new Promise((r) => setTimeout(r, 400))
    }
  } catch (e) {
    console.warn('whale backfill', e)
  } finally {
    if (g === gen) {
      loading = false
      emit()
      scheduleSave()
    }
  }
}

/**
 * Point the whale book at a symbol. `earliest` is the open time of the first
 * candle on the chart; the backfill stops there.
 */
export function syncWhaleSymbol(s: string, earliest: number): void {
  if (s === sym) {
    // Older candles were loaded (or a timeframe change): the reachable range moved.
    earliestT = earliest
    if (serverLoaded && earliest < serverFrom) {
      const to = serverFrom
      serverFrom = earliest
      void loadServerOrders(gen, s, earliest, to).catch(() => {})
    }
    return
  }
  if (sym) save()
  sym = s
  gen++
  serverLoaded = false
  serverFrom = Infinity
  serverMin = Infinity
  serverUpdated = 0
  pending = []
  held = -1
  load(s)
  emit()
  if (isInstrument(s)) return
  earliestT = earliest
  void backfill(gen, s, earliest, AUTO_PAGES)
}

/** Scan another batch of history, continuing past what is already covered. */
export function scanFurther(): void {
  if (!sym || loading || isInstrument(sym)) return
  void backfill(gen, sym, earliestT, MORE_PAGES)
}

/** Whether older chart history exists that the tape has not been scanned for. */
export function canScanFurther(): boolean {
  if (!coverage.length || loading) return false
  return Math.min(...coverage.map((c) => c.t0)) > earliestT + 60_000
}

// ---- live ---------------------------------------------------------------------

function flushLive(): void {
  flushTimer = null
  if (!pending.length) return
  // The newest transaction may still be printing fills. Hold it back one
  // round; once a round passes with nothing added to it, it is complete.
  const last = pending[pending.length - 1]
  let cut = pending.length
  while (cut > 0 && pending[cut - 1].T === last.T && pending[cut - 1].m === last.m) cut--
  if (held !== last.a) {
    held = last.a
    if (cut === 0) {
      flushTimer = setTimeout(flushLive, 250)
      return
    }
  } else cut = pending.length
  const page = pending.slice(0, cut)
  pending = pending.slice(cut)
  if (pending.length) flushTimer = setTimeout(flushLive, 250)
  const before = orders.length
  addOrders(keepBig(groupAggTrades(page), new Set()))
  const first = page[0]
  const end = page[page.length - 1]
  if (!liveCov || first.a > liveCov.a1 + 1) {
    // A reconnect skipped trades: fetch the missing ids so the tape has no hole.
    const below = coverage.filter((c) => c.a1 < first.a).map((c) => c.a1)
    const holeFrom = liveCov ? liveCov.a1 + 1 : below.length ? Math.max(...below) + 1 : first.a
    if (first.a - holeFrom > 0 && first.a - holeFrom <= 5 * PAGE)
      void fillHole(gen, sym, holeFrom, first.a - 1)
    liveCov = { a0: first.a, a1: end.a, t0: first.T, t1: end.T }
  } else {
    liveCov.a1 = end.a
    liveCov.t1 = end.T
  }
  addCoverage({ ...liveCov })
  if (orders.length !== before) emit()
  scheduleSave()
}

async function fillHole(g: number, s: string, from: number, to: number): Promise<void> {
  for (let id = from; id <= to && g === gen; id += PAGE) {
    try {
      const page = await fetchAgg(
        '/api/v3/aggTrades?symbol=' + s + '&fromId=' + id + '&limit=' + Math.min(PAGE, to - id + 1),
      )
      if (g !== gen || !page.length) return
      ingestPage(page)
      emit()
      scheduleSave()
    } catch {
      return
    }
  }
}

/** Every aggTrade off the websocket; fills of one order are grouped before use. */
export function ingestWhaleAgg(
  s: string,
  a: number,
  p: number,
  q: number,
  T: number,
  m: boolean,
): void {
  if (s !== sym || !floor || !(a >= 0)) return
  pending.push({ a, p: String(p), q: String(q), T, m })
  if (!flushTimer) flushTimer = setTimeout(flushLive, 250)
}

/** A symbol switch: drop the half-read tape and the live coverage run. */
export function resetWhaleFlow(): void {
  liveCov = null
  pending = []
  held = -1
}
