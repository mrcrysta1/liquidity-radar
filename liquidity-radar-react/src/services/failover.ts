// REST failover for candles and tickers, the shared kline stream hub, and the
// freshness badge on the chart.
//
// Binance stays the primary for everything, called exactly as before. Only
// when it fails (down, geo-blocked, rate-limited) do Bybit and then OKX serve
// the same request; failing those, the last good copy is shown and labelled
// STALE (or OFFLINE once it is old). A circuit breaker stops a failing
// provider from being asked again for a while, so a Binance outage costs one
// slow request, not one per page. Ported from the Pro terminal's
// core/providers/chain.ts and providers/{binance,bybit,okx}.ts.
import { COINS } from '../constants/market'
import { isInstrument } from '../constants/instruments'
import { jget } from '../api/client'
import { noteStream } from './dataSources'
import { mdFromK, mdSym, mdTf } from './market'
import type { CandleFlat } from './market'
import { state } from './store'
import { $ } from '../utils/dom'
import { DEFAULT_TF } from './timeframe'
import { KlineHub } from './klineHub'
import { ProviderChain, klineFreshness, memoryStore } from './providerChain'
import type { CacheEntry, ChainResult, ChainStore, Freshness } from './providerChain'

// ---- Kline paging ----------------------------------------------------

/**
 * Page backwards until `need` rows are in hand. This is the loop the chart has
 * always used against Binance, parameterised by page size so the fallbacks can
 * share it: pages already fetched are kept if a later one fails, and an empty
 * or short page ends the walk.
 */
export async function pageKlines(
  need: number,
  before: number,
  perPage: number,
  maxPages: number,
  fetchPage: (limit: number, endTime: number) => Promise<CandleFlat[]>,
): Promise<CandleFlat[]> {
  const pages = Math.max(1, Math.min(maxPages, Math.ceil(need / perPage)))
  let out: CandleFlat[] = []
  let endTime = before
  for (let i = 0; i < pages; i++) {
    const limit = Math.min(perPage, need - out.length)
    if (limit <= 0) break
    let page: CandleFlat[]
    try {
      page = await fetchPage(limit, endTime)
    } catch (e) {
      // Keep the pages already fetched — a short history beats a blank chart.
      if (out.length) break
      throw e
    }
    if (!page.length) break
    out = page.concat(out)
    endTime = page[0].t - 1
    if (page.length < limit) break
  }
  return out
}

const KLINE_URL = 'https://api.binance.com/api/v3/klines'
// Binance caps a kline request at 1000 rows. A resampled interval needs
// `factor` base rows per candle, so deep ones page backwards — bounded, since
// 45s off 1s candles would otherwise want 9000 rows.
const MAX_PAGES = 5

function binanceKlines(sym: string, base: string, need: number, before: number) {
  return pageKlines(need, before, 1000, MAX_PAGES, async (limit, endTime) => {
    const url =
      KLINE_URL +
      '?symbol=' +
      mdSym(sym) +
      '&interval=' +
      base +
      '&limit=' +
      limit +
      (endTime ? '&endTime=' + endTime : '')
    const rows = (await jget(url)) as unknown[]
    return rows.map(mdFromK).filter((c): c is CandleFlat => !!c)
  })
}

// Native Binance interval → the fallback venue's name for it. Anything absent
// (1s, and 3d on Bybit) is not served there and the chain moves on.
const BYBIT_IV: Record<string, string> = {
  '1m': '1',
  '3m': '3',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '2h': '120',
  '4h': '240',
  '1d': 'D',
  '1w': 'W',
  '1M': 'M',
}
// OKX's plain 1D/1W/1M bars open at Hong Kong midnight; the -utc variants line
// up with Binance's UTC candles.
const OKX_BAR: Record<string, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '2h': '2H',
  '4h': '4H',
  '1d': '1Dutc',
  '3d': '3Dutc',
  '1w': '1Wutc',
  '1M': '1Mutc',
}

/** Rows as both venues send them: [openTimeMs, o, h, l, c, baseVolume, ...], newest first. */
function fromRows(rows: unknown): CandleFlat[] {
  if (!Array.isArray(rows)) throw new Error('bad payload')
  return rows
    .map(mdFromK)
    .filter((c): c is CandleFlat => !!c && isFinite(c.t) && c.c > 0)
    .reverse()
}

function bybitKlines(sym: string, base: string, need: number, before: number) {
  const iv = BYBIT_IV[base]
  if (!iv) return Promise.resolve(null)
  return pageKlines(need, before, 1000, MAX_PAGES, async (limit, endTime) => {
    const r = (await jget(
      'https://api.bybit.com/v5/market/kline?category=spot&symbol=' +
        mdSym(sym) +
        '&interval=' +
        iv +
        '&limit=' +
        limit +
        (endTime ? '&end=' + endTime : ''),
    )) as { retCode?: number; retMsg?: string; result?: { list?: unknown } }
    if (r.retCode !== 0) throw new Error('Bybit ' + r.retCode + ' ' + (r.retMsg || ''))
    return fromRows(r.result?.list)
  })
}

function okxInst(sym: string): string {
  return String(mdSym(sym)).replace(/USDT$/, '') + '-USDT'
}

function okxKlines(sym: string, base: string, need: number, before: number) {
  const bar = OKX_BAR[base]
  if (!bar) return Promise.resolve(null)
  // /candles holds the latest 1440 bars at 300 a page; older history lives
  // behind /history-candles at 100 a page.
  const deep = before > 0
  const per = deep ? 100 : 300
  return pageKlines(need, before, per, deep ? MAX_PAGES : 8, async (limit, endTime) => {
    const r = (await jget(
      'https://www.okx.com/api/v5/market/' +
        (deep ? 'history-candles' : 'candles') +
        '?instId=' +
        okxInst(sym) +
        '&bar=' +
        bar +
        '&limit=' +
        limit +
        (endTime ? '&after=' + endTime : ''),
    )) as { code?: string; msg?: string; data?: unknown }
    if (r.code !== '0') throw new Error('OKX ' + r.code + ' ' + (r.msg || ''))
    return fromRows(r.data)
  })
}

// ---- Last-good candle cache -------------------------------------------
// In memory for the session, plus a small localStorage copy of the most
// recent first pages so a reload during an outage still has a chart. Written
// straight to localStorage — never through storageSet, which syncs settings
// to the user's account.
const LS_KEY = 'lr-kline-cache'
const LS_MAX_KEYS = 6
const LS_MAX_BARS = 300

interface LsEntry {
  ts: number
  provider: string
  name: string
  c: number[][]
}

function lsRead(): Record<string, LsEntry> {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch (e) {
    return {}
  }
}

function klineStore(): ChainStore<CandleFlat[]> {
  const mem = memoryStore<CandleFlat[]>(32)
  return {
    get(k) {
      const hit = mem.get(k)
      if (hit) return hit
      const d = lsRead()[k]
      if (!d || !Array.isArray(d.c) || !d.c.length) return undefined
      const entry: CacheEntry<CandleFlat[]> = {
        ts: Number(d.ts) || 0,
        provider: String(d.provider),
        name: String(d.name),
        data: d.c.map((a) => ({ t: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] })),
      }
      mem.set(k, entry)
      return entry
    },
    set(k, e) {
      mem.set(k, e)
      // Only first pages (no endTime) are worth keeping across a reload.
      let before = 1
      try {
        before = Number(JSON.parse(k)[3])
      } catch (err) {
        /* not ours */
      }
      if (before !== 0 || !e.data.length) return
      try {
        const all = lsRead()
        all[k] = {
          ts: e.ts,
          provider: e.provider,
          name: e.name,
          c: e.data.slice(-LS_MAX_BARS).map((x) => [x.t, x.o, x.h, x.l, x.c, x.v]),
        }
        const keys = Object.keys(all).sort((a, b) => all[b].ts - all[a].ts)
        keys.slice(LS_MAX_KEYS).forEach((x) => delete all[x])
        localStorage.setItem(LS_KEY, JSON.stringify(all))
      } catch (err) {
        /* quota / private mode: the memory copy still works */
      }
    },
  }
}

/** Candle history: Binance → Bybit → OKX → last good copy. */
export const klineChain = new ProviderChain<[string, string, number, number], CandleFlat[]>(
  [
    { id: 'binance', name: 'Binance', fn: binanceKlines },
    { id: 'bybit', name: 'Bybit', fn: bybitKlines },
    { id: 'okx', name: 'OKX', fn: okxKlines },
  ],
  { store: klineStore() },
)

/**
 * Base-interval candles for a crypto symbol via the failover chain. Throws
 * only when every provider failed and nothing was ever cached.
 */
export function fetchKlinesChain(
  sym: string,
  base: string,
  need: number,
  before = 0,
): Promise<ChainResult<CandleFlat[]>> {
  return klineChain.get(String(mdSym(sym)), base, need, before)
}

// ---- Tickers -----------------------------------------------------------

export interface TickerEntry {
  last: number
  pct: number
  high: number
  low: number
  qvol: number
  trades: number
}
type TickerMap = Record<string, TickerEntry>

function wanted(): string[] {
  return Object.values(COINS).map((c) => c.sym)
}

async function binanceTickers(): Promise<TickerMap> {
  const url =
    'https://api.binance.com/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(wanted()))
  const data = (await jget(url)) as Array<Record<string, unknown>>
  const out: TickerMap = {}
  data.forEach((d) => {
    out[d.symbol as string] = {
      last: Number(d.lastPrice),
      pct: Number(d.priceChangePercent),
      high: Number(d.highPrice),
      low: Number(d.lowPrice),
      qvol: Number(d.quoteVolume),
      trades: Number(d.count),
    }
  })
  return out
}

function nonEmpty(m: TickerMap): TickerMap {
  if (!Object.keys(m).length) throw new Error('no tickers')
  return m
}

async function bybitTickers(): Promise<TickerMap> {
  const r = (await jget('https://api.bybit.com/v5/market/tickers?category=spot')) as {
    retCode?: number
    result?: { list?: Array<Record<string, string>> }
  }
  if (r.retCode !== 0 || !Array.isArray(r.result?.list)) throw new Error('Bybit ' + r.retCode)
  const want = new Set(wanted())
  const out: TickerMap = {}
  r.result!.list!.forEach((t) => {
    if (!want.has(t.symbol)) return
    out[t.symbol] = {
      last: Number(t.lastPrice),
      pct: Number(t.price24hPcnt) * 100,
      high: Number(t.highPrice24h),
      low: Number(t.lowPrice24h),
      qvol: Number(t.turnover24h),
      trades: 0, // not published by Bybit
    }
  })
  return nonEmpty(out)
}

async function okxTickers(): Promise<TickerMap> {
  const r = (await jget('https://www.okx.com/api/v5/market/tickers?instType=SPOT')) as {
    code?: string
    data?: Array<Record<string, string>>
  }
  if (r.code !== '0' || !Array.isArray(r.data)) throw new Error('OKX ' + r.code)
  const bySym: Record<string, string> = {}
  wanted().forEach((s) => (bySym[okxInst(s)] = s))
  const out: TickerMap = {}
  r.data.forEach((t) => {
    const sym = bySym[t.instId]
    if (!sym) return
    const last = Number(t.last)
    const open = Number(t.open24h)
    out[sym] = {
      last,
      pct: open ? ((last - open) / open) * 100 : 0,
      high: Number(t.high24h),
      low: Number(t.low24h),
      qvol: Number(t.volCcy24h), // quote-currency volume for spot
      trades: 0, // not published by OKX
    }
  })
  return nonEmpty(out)
}

export const tickerChain = new ProviderChain<[], TickerMap>([
  { id: 'binance', name: 'Binance', fn: binanceTickers },
  { id: 'bybit', name: 'Bybit', fn: bybitTickers },
  { id: 'okx', name: 'OKX', fn: okxTickers },
])

/** Where the ticker bar's numbers last came from. */
export const tickerFeed: { freshness: Freshness; name: string; ts: number } = {
  freshness: 'LIVE',
  name: 'Binance',
  ts: 0,
}

// ---- Shared kline stream -------------------------------------------------

/** One Binance combined-stream socket for every companion / workspace chart. */
export const klineHub = new KlineHub({
  // Tagged so the data-source register files it under the candle stream.
  onStatus: (up, url) => noteStream(url + '#@kline_hub', up),
})

// ---- Freshness badge ------------------------------------------------------
// The chart's existing #wsKlineState badge, now saying how fresh the candles
// are and where they came from, not just whether the socket is open.

interface KlineFeed {
  key: string
  freshness: Freshness
  ts: number
  name: string
  primary: boolean
  error?: string
}

let feed: KlineFeed | null = null
let liveKey = ''
let lastLiveTs = 0
let lastPaint = ''
let ticking = false

function currentKey(): string {
  return mdSym(state.symbol) + '|' + mdTf(state.tf || DEFAULT_TF)
}

/** Record where the main chart's candles for `key` (SYMBOL|tf) came from. */
export function setKlineFeed(
  key: string,
  r: { freshness: Freshness; ts: number; name: string; primary: boolean; error?: string },
): void {
  feed = { key, ...r }
  if (!ticking && typeof setInterval === 'function') {
    ticking = true
    // Ages LIVE down to DELAYED/STALE when nothing new arrives.
    setInterval(renderKlineBadge, 5000)
  }
  renderKlineBadge()
}

/** The main chart's own kline socket delivered a bar. */
export function noteKlineLive(): void {
  liveKey = currentKey()
  lastLiveTs = Date.now()
  renderKlineBadge()
}

/** True when the main chart's kline socket has ticked recently. */
export function klineStreamLive(): boolean {
  return liveKey === currentKey() && Date.now() - lastLiveTs < 30_000
}

/** Where the current chart's candle history came from, if known. */
export function currentKlineFeed(): KlineFeed | null {
  return feed && feed.key === currentKey() ? feed : null
}

export function renderKlineBadge(): void {
  // A Yahoo instrument has no stream; its badge ("POLLED") is set elsewhere.
  if (isInstrument(state.symbol)) return
  const el = $('wsKlineState')
  if (!el) return
  const key = currentKey()
  const f = feed && feed.key === key ? feed : null
  const live = liveKey === key ? lastLiveTs : 0
  // Nothing known yet for this symbol/interval: leave "SYNCING" alone.
  if (!f && !live) return
  const now = Date.now()
  // ts 0: nothing was loaded at all, not even a cached copy.
  const empty = !!f && f.freshness === 'OFFLINE' && !f.ts
  // No candles on the chart: a ticking socket alone cannot draw one.
  const fr = empty ? 'OFFLINE' : klineFreshness(f, live, now)
  const fromCache = !!f && !empty && (f.freshness === 'STALE' || f.freshness === 'OFFLINE')
  const src = fromCache ? 'Cache' : f && !empty ? f.name : 'Binance'
  const text = fr === 'OFFLINE' && (!f || empty) ? 'OFFLINE' : fr + ' · ' + src.toUpperCase()
  const cls =
    fr === 'LIVE'
      ? f && !f.primary
        ? 'badge b-cyan'
        : 'badge b-green'
      : fr === 'OFFLINE'
        ? 'badge b-red'
        : 'badge b-amber'
  const lines: string[] = []
  if (f && empty) lines.push('Candles: no provider answered and nothing is cached')
  else if (f) {
    lines.push(
      fromCache
        ? 'Candles: last good copy from ' + f.name + ', ' + Math.round((now - f.ts) / 1000) + 's old'
        : 'Candles: ' + f.name + ' REST' + (f.primary ? '' : ' (Binance unavailable — fallback)'),
    )
  }
  lines.push(
    live
      ? 'Live bar: Binance WebSocket, last tick ' + Math.round((now - live) / 1000) + 's ago'
      : 'Live bar: waiting for the Binance WebSocket',
  )
  lines.push(state.candles.length + ' bars loaded')
  if (f?.error) lines.push(f.error)
  const title = lines.join('\n')
  const paint = text + '|' + cls + '|' + title
  if (paint === lastPaint && el.textContent === text) return
  lastPaint = paint
  el.textContent = text
  el.className = cls
  el.title = title
}
