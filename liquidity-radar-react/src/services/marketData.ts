// REST market-data polling loops. Faithful extraction of the engine's
// fetchTickers / fetchKlines / fetchOB / fetchFR / fetchOI / fetchFG /
// fetchWhales: endpoint calls, response parsing, market-state writes and
// cache/store updates live here. Every rendering/UI side effect is
// delegated through the hooks wired by the engine via wireMarketHooks()
// (the same pattern as userActions), so the engine stays pure orchestration.
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
  mdStoreCandles,
  mdStoreOB,
  mdSym,
  mdTf,
} from './market'
import type { CandleFlat } from './market'
import { DEFAULT_TF, createFolder, mainFolder, resample, tfDef } from './timeframe'
import type { Folder } from './timeframe'
import {
  fetchKlinesChain,
  klineStreamLive,
  setKlineFeed,
  tickerChain,
  tickerFeed,
} from './failover'
import type { ChainResult } from './providerChain'

export interface MarketHooks {
  onTickers(): void
  /** Every ticker source failed; the last good set is still on screen. */
  onTickersStale?(): void
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

export async function fetchTickers(): Promise<void> {
  try {
    // Binance first, as always; Bybit then OKX only if it fails.
    const r = await tickerChain.get()
    if (r.freshness === 'STALE' || r.freshness === 'OFFLINE') {
      // Every venue failed. What is on screen is the last good set — keep it
      // (the live stream may be updating the focused coin) and say so.
      tickerFeed.freshness = r.freshness
      tickerFeed.name = r.name
      tickerFeed.ts = r.ts
      hooks!.onTickersStale?.()
      console.warn('tickers', r.error)
      return
    }
    Object.keys(r.data).forEach((sym) => {
      state.tickers[sym] = r.data[sym]
    })
    tickerFeed.freshness = r.freshness
    tickerFeed.name = r.name
    tickerFeed.ts = r.ts
    hooks!.onTickers()
  } catch (e) {
    console.warn('tickers', e)
  }
}

// Enough on first load to fill a wide screen with room to pan, then more is
// paged in as the user drags back (fetchOlderKlines).
const TARGET_CANDLES = 500
/** Older pages stop here so memory and redraw cost stay bounded. */
const MAX_KEEP = 5000
/** Aggregated candles per lazy page. */
const PAGE_CANDLES = 500
/** Where a load's candles came from; null for Yahoo-priced instruments. */
export type KlineSource = Omit<ChainResult<unknown>, 'data'> | null

async function fetchBase(
  sym: string,
  base: string,
  need: number,
  before = 0,
): Promise<{ rows: CandleFlat[]; source: KlineSource }> {
  // Metals, energy, FX, indices and equities are priced by Yahoo, not
  // Binance. Dispatching here — the one place candles enter the app — means
  // the chart, the indicators, the ML model and the scanner all work on a
  // non-crypto instrument without any of them knowing where the bars came
  // from. Yahoo has no endTime paging, so a history request past the first
  // page simply ends; the chart stops at the loaded range instead of looping.
  if (isInstrument(sym)) {
    if (before) return { rows: [], source: null }
    return { rows: await yahooCandles(sym, base, need), source: null }
  }
  // Binance → Bybit → OKX → last good copy (see services/failover).
  const { data, ...source } = await fetchKlinesChain(sym, base, need, before)
  return { rows: data, source }
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
  const { rows } = await fetchBase(sym, def.base, Math.max(10, bars) * def.factor)
  return resample(rows, def).slice(-bars)
}

export async function loadCandles(
  sym: string,
  tf: string,
): Promise<{ candles: CandleFlat[]; folder: Folder; source: KlineSource }> {
  const def = tfDef(tf)
  const { rows, source } = await fetchBase(sym, def.base, TARGET_CANDLES * def.factor)
  const folder = createFolder(def)
  folder.seed(rows)
  return { candles: resample(rows, def).slice(-MAX_KEEP), folder, source }
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
    const { rows, source } = await fetchBase(
      state.symbol,
      def.base,
      PAGE_CANDLES * def.factor,
      oldest.t - 1,
    )
    if (ident !== historyIdent()) return 0 // symbol/interval changed mid-flight
    // Every provider failed and this is a cached copy: not proof the history
    // has ended, so leave it retryable rather than marking it done.
    if (source && (source.freshness === 'STALE' || source.freshness === 'OFFLINE')) return 0
    const older = resample(rows, def).filter((c) => c.t < oldest.t)
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

/** While candles come from a fallback, look for Binance again this often. */
const PRIMARY_PROBE_MS = 60_000

function schedulePrimaryProbe(key: string): void {
  if (klineRetry) clearTimeout(klineRetry)
  klineRetry = setTimeout(() => {
    klineRetry = null
    // Only while the chart is otherwise frozen: with the live stream ticking
    // the chart is current, and a reload would reset the user's viewport.
    const tf = mdTf(state.tf || DEFAULT_TF)
    if (mdSym(state.symbol) + '|' + tf !== key) return
    if (klineStreamLive()) schedulePrimaryProbe(key)
    else fetchKlines(state.symbol)
  }, PRIMARY_PROBE_MS)
}

export async function fetchKlines(sym: string): Promise<void> {
  // A newer request supersedes any pending retry.
  if (klineRetry) {
    clearTimeout(klineRetry)
    klineRetry = null
  }
  const tf = mdTf(state.tf || DEFAULT_TF)
  const key = mdSym(sym) + '|' + tf
  try {
    const { candles, folder, source } = await loadCandles(sym, tf)
    if (!candles.length) throw new Error('empty')
    state.candles = candles
    mainFolder.key = key
    mainFolder.folder = folder
    mdStoreCandles(state.symbol, tf, candles)
    resetHistory()
    if (source) setKlineFeed(key, source)
    if (source && (source.freshness === 'STALE' || source.freshness === 'OFFLINE')) {
      // Every provider failed; this is the last good copy. Show it as such
      // and keep retrying exactly as a failed load does.
      mdDebug.log('klines', 'serving last good ' + key + ' from ' + source.name)
      hooks!.onKlineCache()
      scheduleKlineRetry()
      return
    }
    mdCachePut(state.symbol, tf, candles)
    klineAttempt = 0
    hooks!.onKlines()
    if (source && !source.primary) schedulePrimaryProbe(key)
  } catch (e) {
    console.warn('klines', e)
    // REST fallback: serve recent cached candles so the chart isn't left blank
    const cached =
      mdCacheGet(state.symbol, tf) || md.candles[mdSym(state.symbol) + '|' + tf] || null
    if (cached && cached.length) {
      state.candles = cached
      mdDebug.log('klines', 'serving cached ' + state.symbol + ' ' + tf)
      if (!isInstrument(sym))
        setKlineFeed(key, { freshness: 'STALE', ts: Date.now(), name: 'cache', primary: false })
      hooks!.onKlineCache()
    } else {
      if (!isInstrument(sym))
        setKlineFeed(key, {
          freshness: 'OFFLINE',
          ts: 0,
          name: 'none',
          primary: false,
          error: e instanceof Error ? e.message : String(e),
        })
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
