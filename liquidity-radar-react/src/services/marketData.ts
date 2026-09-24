// REST market-data polling loops. Faithful extraction of the engine's
// fetchTickers / fetchKlines / fetchOB / fetchFR / fetchOI / fetchFG /
// fetchWhales: endpoint calls, response parsing, market-state writes and
// cache/store updates live here. Every rendering/UI side effect is
// delegated through the hooks wired by the engine via wireMarketHooks()
// (the same pattern as userActions), so the engine stays pure orchestration.
import { COINS } from '../constants/market'
import { isInstrument } from '../constants/instruments'
import { yahooCandles } from './yahoo'
import { jget } from '../api/client'
import { cooldownLeft } from '../api/rateLimit'
import { state } from './store'
import {
  md,
  mdCacheGet,
  mdCachePut,
  mdDebug,
  mdFromK,
  mdStoreCandles,
  mdStoreOB,
  mdSym,
  mdTf,
} from './market'
import type { CandleFlat } from './market'
import { DEFAULT_TF, createFolder, mainFolder, resample, tfDef } from './timeframe'
import type { Folder } from './timeframe'

export interface MarketHooks {
  onTickers(): void
  onKlines(): void
  onKlineCache(): void
  onKlineFail(): void
  onFR(): void
  onFRfail(): void
  onOI(): void
  onOIfail(): void
  onFG(): void
  onFGfail(): void
  onWhales(): void
}

let hooks: MarketHooks | null = null

export function wireMarketHooks(h: MarketHooks): void {
  hooks = h
}

interface TickerEntry {
  last: number
  pct: number
  high: number
  low: number
  qvol: number
  trades: number
}

export async function fetchTickers(): Promise<void> {
  try {
    const syms = Object.values(COINS).map((c) => c.sym)
    const url =
      'https://api.binance.com/api/v3/ticker/24hr?symbols=' +
      encodeURIComponent(JSON.stringify(syms))
    const data = (await jget(url)) as Array<Record<string, unknown>>
    data.forEach((d) => {
      const entry: TickerEntry = {
        last: Number(d.lastPrice),
        pct: Number(d.priceChangePercent),
        high: Number(d.highPrice),
        low: Number(d.lowPrice),
        qvol: Number(d.quoteVolume),
        trades: Number(d.count),
      }
      state.tickers[d.symbol as string] = entry
    })
    hooks!.onTickers()
  } catch (e) {
    console.warn('tickers', e)
  }
}

const KLINE_URL = 'https://api.binance.com/api/v3/klines'
// Enough on first load to fill a wide screen with room to pan, then more is
// paged in as the user drags back (fetchOlderKlines).
const TARGET_CANDLES = 500
/** Older pages stop here so memory and redraw cost stay bounded. */
const MAX_KEEP = 5000
/** Aggregated candles per lazy page. */
const PAGE_CANDLES = 500
// Binance caps a kline request at 1000 rows. A resampled interval needs
// `factor` base rows per candle, so deep ones page backwards — bounded, since
// 45s off 1s candles would otherwise want 9000 rows.
const MAX_PAGES = 5

async function fetchBase(
  sym: string,
  base: string,
  need: number,
  before = 0,
): Promise<CandleFlat[]> {
  // Metals, energy, FX, indices and equities are priced by Yahoo, not
  // Binance. Dispatching here — the one place candles enter the app — means
  // the chart, the indicators, the ML model and the scanner all work on a
  // non-crypto instrument without any of them knowing where the bars came
  // from. Yahoo has no endTime paging, so a history request past the first
  // page simply ends; the chart stops at the loaded range instead of looping.
  if (isInstrument(sym)) {
    if (before) return []
    return yahooCandles(sym, base, need)
  }
  const pages = Math.max(1, Math.min(MAX_PAGES, Math.ceil(need / 1000)))
  let out: CandleFlat[] = []
  let endTime = before
  for (let i = 0; i < pages; i++) {
    const limit = Math.min(1000, need - out.length)
    if (limit <= 0) break
    const url =
      KLINE_URL +
      '?symbol=' +
      mdSym(sym) +
      '&interval=' +
      base +
      '&limit=' +
      limit +
      (endTime ? '&endTime=' + endTime : '')
    let page: CandleFlat[]
    try {
      const rows = (await jget(url)) as unknown[]
      page = rows.map(mdFromK).filter((c): c is CandleFlat => !!c)
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

/**
 * Load candles for any symbol/interval, resampled if the interval is not one
 * Binance serves natively, plus a folder seeded for the live socket. Shared by
 * the price-action chart and every companion chart in a multi-chart layout.
 */
/**
 * Load an explicit number of candles for a symbol/interval. Used by views that
 * need a fixed window (the liquidation heatmap asks for 720 × 1m, and so on)
 * rather than the chart's default depth.
 */
export async function loadCandleWindow(
  sym: string,
  tf: string,
  bars: number,
): Promise<CandleFlat[]> {
  const def = tfDef(tf)
  const base = await fetchBase(sym, def.base, Math.max(10, bars) * def.factor)
  return resample(base, def).slice(-bars)
}

export async function loadCandles(
  sym: string,
  tf: string,
): Promise<{ candles: CandleFlat[]; folder: Folder }> {
  const def = tfDef(tf)
  const base = await fetchBase(sym, def.base, TARGET_CANDLES * def.factor)
  const folder = createFolder(def)
  folder.seed(base)
  return { candles: resample(base, def).slice(-MAX_KEEP), folder }
}

// ---- Lazy history ----------------------------------------------------
// Dragging the chart back past the loaded range pages in older candles, so the
// history keeps going instead of ending at a wall of empty space.
let historyKey = ''
let historyBusy = false
let historyDone = false

function historyIdent(): string {
  return mdSym(state.symbol) + '|' + mdTf(state.tf || DEFAULT_TF)
}
/** True when there is nothing more to fetch for the current symbol/interval. */
export function historyExhausted(): boolean {
  return historyKey === historyIdent() && historyDone
}
export function resetHistory(): void {
  historyKey = historyIdent()
  historyBusy = false
  historyDone = false
}

/**
 * Fetch the page of candles immediately older than the ones already loaded and
 * prepend them. Returns how many were added (0 when there are no more, the cap
 * is reached, or a fetch is already running).
 */
export async function fetchOlderKlines(): Promise<number> {
  const ident = historyIdent()
  if (ident !== historyKey) resetHistory()
  if (historyBusy || historyDone) return 0
  const oldest = state.candles[0]
  if (!oldest) return 0
  if (state.candles.length >= MAX_KEEP) {
    historyDone = true
    return 0
  }
  historyBusy = true
  try {
    const tf = mdTf(state.tf || DEFAULT_TF)
    const def = tfDef(tf)
    // Strictly before the oldest bucket's open, so the older page resamples
    // into whole buckets of its own and cannot half-fill the one we hold.
    const base = await fetchBase(state.symbol, def.base, PAGE_CANDLES * def.factor, oldest.t - 1)
    if (ident !== historyIdent()) return 0 // symbol/interval changed mid-flight
    const older = resample(base, def).filter((c) => c.t < oldest.t)
    if (!older.length) {
      historyDone = true
      return 0
    }
    // Trim the page rather than the array, so the count reported back is
    // exactly what was prepended and the viewport shift stays correct.
    const room = MAX_KEEP - state.candles.length
    const add = older.length > room ? older.slice(-room) : older
    if (!add.length) {
      historyDone = true
      return 0
    }
    state.candles = add.concat(state.candles)
    mdStoreCandles(state.symbol, tf, state.candles)
    return add.length
  } catch (e) {
    mdDebug.log('klines', 'older page failed')
    return 0
  } finally {
    historyBusy = false
  }
}

let klineRetry: ReturnType<typeof setTimeout> | null = null
let klineAttempt = 0
const RETRY_MAX = 30000

function scheduleKlineRetry(): void {
  if (klineRetry) clearTimeout(klineRetry)
  // Binance answers 418 when it has banned the IP, and every request made
  // during a ban extends it. Sit out the cooldown before trying again — this
  // retry loop is exactly what turns a momentary 429 into a long outage.
  const cool = cooldownLeft()
  const delay =
    cool > 0 ? cool + 1000 : Math.min(RETRY_MAX, 2000 * Math.pow(2, klineAttempt++))
  mdDebug.log('klines', 'retry in ' + delay + 'ms')
  klineRetry = setTimeout(() => {
    klineRetry = null
    fetchKlines(state.symbol)
  }, delay)
}

export async function fetchKlines(sym: string): Promise<void> {
  // A newer request supersedes any pending retry.
  if (klineRetry) {
    clearTimeout(klineRetry)
    klineRetry = null
  }
  const tf = mdTf(state.tf || DEFAULT_TF)
  try {
    const { candles, folder } = await loadCandles(sym, tf)
    if (!candles.length) throw new Error('empty')
    state.candles = candles
    mainFolder.key = mdSym(sym) + '|' + tf
    mainFolder.folder = folder
    mdStoreCandles(state.symbol, tf, candles)
    mdCachePut(state.symbol, tf, candles)
    klineAttempt = 0
    resetHistory()
    hooks!.onKlines()
  } catch (e) {
    console.warn('klines', e)
    // REST fallback: serve recent cached candles so the chart isn't left blank
    const cached =
      mdCacheGet(state.symbol, tf) || md.candles[mdSym(state.symbol) + '|' + tf] || null
    if (cached && cached.length) {
      state.candles = cached
      mdDebug.log('klines', 'serving cached ' + state.symbol + ' ' + tf)
      hooks!.onKlineCache()
    } else {
      hooks!.onKlineFail()
    }
    scheduleKlineRetry()
  }
}

export async function fetchOB(): Promise<void> {
  // Order books, funding, open interest and the trade tape are Binance
  // derivatives concepts. A Yahoo-priced instrument has none of them, so
  // asking would just be a guaranteed 400 every poll — and whatever the
  // previous crypto symbol left in state has to go, or gold ends up skewed
  // by Bitcoin's funding rate.
  if (isInstrument(state.symbol)) {
    state.ob = { bids: [], asks: [] }
    return
  }
  try {
    const d = (await jget(
      'https://api.binance.com/api/v3/depth?symbol=' + mdSym(state.symbol) + '&limit=15',
    )) as { bids: Array<Array<string | number>>; asks: Array<Array<string | number>> }
    const ob = { bids: d.bids.map((b) => [+b[0], +b[1]]), asks: d.asks.map((a) => [+a[0], +a[1]]) }
    if (!mdStoreOB(state.symbol, ob)) return
    state.ob = ob
  } catch (e) {
    console.warn('depth', e)
  }
}

export async function fetchFR(): Promise<void> {
  // Order books, funding, open interest and the trade tape are Binance
  // derivatives concepts. A Yahoo-priced instrument has none of them, so
  // asking would just be a guaranteed 400 every poll — and whatever the
  // previous crypto symbol left in state has to go, or gold ends up skewed
  // by Bitcoin's funding rate.
  if (isInstrument(state.symbol)) {
    state.fr = null
    return
  }
  try {
    state.fr = await jget('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + state.symbol)
    hooks!.onFR()
  } catch (e) {
    console.warn('premiumIndex', e)
    hooks!.onFRfail()
  }
}

export async function fetchOI(): Promise<void> {
  // Order books, funding, open interest and the trade tape are Binance
  // derivatives concepts. A Yahoo-priced instrument has none of them, so
  // asking would just be a guaranteed 400 every poll — and whatever the
  // previous crypto symbol left in state has to go, or gold ends up skewed
  // by Bitcoin's funding rate.
  if (isInstrument(state.symbol)) {
    state.oi = null
    return
  }
  try {
    state.oi = await jget('https://fapi.binance.com/fapi/v1/openInterest?symbol=' + state.symbol)
    hooks!.onOI()
  } catch (e) {
    console.warn('openInterest', e)
    hooks!.onOIfail()
  }
}

export async function fetchFG(): Promise<void> {
  try {
    const d = (await jget('https://api.alternative.me/fng/')) as { data?: unknown[] }
    if (d.data && d.data[0]) {
      state.fg = d.data[0]
      hooks!.onFG()
    }
  } catch (e) {
    console.warn('fng', e)
    hooks!.onFGfail()
  }
}

interface WhaleTape {
  id: unknown
  time: number
  price: number
  qty: number
  usd: number
  maker: unknown
}

export async function fetchWhales(): Promise<void> {
  // Order books, funding, open interest and the trade tape are Binance
  // derivatives concepts. A Yahoo-priced instrument has none of them, so
  // asking would just be a guaranteed 400 every poll — and whatever the
  // previous crypto symbol left in state has to go, or gold ends up skewed
  // by Bitcoin's funding rate.
  if (isInstrument(state.symbol)) {
    state.whales = []
    return
  }
  try {
    const trades = (await jget(
      'https://api.binance.com/api/v3/trades?symbol=' + state.symbol + '&limit=1000',
    )) as Array<{ id: unknown; time: unknown; price: unknown; qty: unknown; isBuyerMaker: unknown }>
    const big: WhaleTape[] = trades
      .map((t) => ({
        id: t.id,
        time: Number(t.time),
        price: Number(t.price),
        qty: Number(t.qty),
        usd: Number(t.price) * Number(t.qty),
        maker: t.isBuyerMaker,
      }))
      .filter((t) => t.usd >= 50000)
      .sort((a, b) => b.time - a.time)
      .slice(0, 40)
    state.whales = big
    hooks!.onWhales()
  } catch (e) {
    console.warn('trades', e)
  }
}
