// Live market streams (WebSocket). Faithful extraction of the stream-render
// block previously living in the engine; DOM updates are delegated to an
// injected callback set so this module stays free of UI concerns.
import { state } from './store'
import { binancePerpOf, isInstrument } from '../constants/instruments'
import { PERP_WS } from './perpData'
import { spotBasis } from './spotGold'
import {
  md,
  mdDebug,
  mdHealth,
  mdHearbeat,
  mdPatchLastCandle,
  mdStoreCandles,
  mdStoreOB,
  mdStoreTicker,
  mdSym,
  mdTf,
  mdVal,
} from './market'
import { bucketEnd, mainFolder, tfDef } from './timeframe'
import { noteStream } from './dataSources'
import { StreamMux } from './streamMux'
import { ingestTrade } from '../features/delta/delta'
import { ingestWhaleAgg } from '../features/whales/whaleFlow'

type Any = any

export interface StreamsCallbacks {
  onStatus(): void
  onHero(): void
  onTickerLive(t: Any): void
  onKlineLive(): void
  onChartLast(c: Any): void
  onAnalytics(): void
  /** Live bars skipped one or more intervals (the socket dropped): reload them. */
  onKlineGap?(): void
}

// A gap is refilled over REST at most this often, so a flapping socket cannot
// turn into a request storm.
const GAP_REFILL_MS = 30000
let gapRefillAt = 0

// The trade tape can run to hundreds of prints a second; paints are coalesced
// onto an animation frame so a busy market cannot outrun the renderer.
let tradeFrame = 0
let tradePending: { p: number; q: number; T: number } | null = null
/** Called with every trade print of the charted symbol (price alerts read the tape). */
const tradeListeners: Array<(sym: string, price: number) => void> = []
export function onTradePrint(fn: (sym: string, price: number) => void): void {
  tradeListeners.push(fn)
}
/** The last trade painted onto the live candle (price, trade time). */
let lastTrade: { p: number; q: number; T: number } | null = null
const raf: (fn: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16) as unknown as number
const unraf: (h: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? cancelAnimationFrame
    : (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>)

// Socket lifecycle. The focused symbol's four streams share one combined
// socket per host (services/streamMux) that stays open across coin and
// timeframe switches: a switch replaces the wanted set and the mux sends the
// difference as SUBSCRIBE / UNSUBSCRIBE frames. Closing and reopening four
// sockets per switch is what produced Chrome's "Ping received after close"
// (Binance answers a client Close ~2s late and pings inside that window) and
// sockets torn down while still connecting.
//
// Every connectStreams() starts a new generation with fresh handlers, so the
// previous coin's frames still in flight have nowhere to land.
let gen = 0
let lastCb: StreamsCallbacks | null = null
const SPOT_WS = 'wss://stream.binance.com:9443/ws/'
/**
 * Silence after which a stream counts as stalled and its socket is replaced.
 * The ticker pushes every second and klines every ~2s; depth pushes only on
 * change. The trade tape has no limit: a quiet pair can go minutes without a
 * print.
 */
const STALL_MS: Record<string, number> = { ticker: 20_000, kline: 45_000, depth: 45_000 }
const stallOf = (stream: string): number =>
  /@ticker$/.test(stream)
    ? STALL_MS.ticker
    : /@kline_/.test(stream)
      ? STALL_MS.kline
      : /@depth/.test(stream)
        ? STALL_MS.depth
        : 0

/** One mux per host: spot, and the futures host gold streams from. */
const muxes = new Map<string, StreamMux>()
function muxFor(wsBase: string): StreamMux {
  let m = muxes.get(wsBase)
  if (!m) {
    m = new StreamMux({
      base: wsBase.replace(/\/ws\/$/, '/stream'),
      stallMs: stallOf,
      // Per-stream URL, as dataSources matches it (…/ws/btcusdt@ticker).
      onLive: (stream, up, dropped) => {
        if (up) noteStream(wsBase + stream, true)
        else if (dropped) noteStream(wsBase + stream, false)
      },
      onChange: () => {
        if (m!.connected) mdHearbeat('ws')
        syncCount()
        lastCb?.onStatus()
      },
      onDrop: (reason) => {
        mdDebug.log('ws', reason + ' — reconnecting')
        md.conn.ws.reconnects++
        mdHealth.wsReconnects++
      },
    })
    muxes.set(wsBase, m)
  }
  return m
}

function syncCount(): void {
  let n = 0
  muxes.forEach((m) => (n += m.liveCount))
  state.wsOpen = n
  md.conn.ws.streams = n
  md.conn.ws.up = n > 0
}

/** Stop every stream now, e.g. the moment the symbol changes. The socket stays up for the next one. */
export function disconnectStreams(cb?: StreamsCallbacks): void {
  gen++
  muxes.forEach((m) => m.want({}))
  syncCount()
  if (tradeFrame) unraf(tradeFrame)
  tradeFrame = 0
  tradePending = null
  cb?.onStatus()
}

let watching = false
function watchStreams(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  const check = () => muxes.forEach((m) => m.check())
  setInterval(check, 5000)
  // Back from sleep or a hidden tab: check at once instead of up to 5s later.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  // The network returned: anything missing reconnects now, not on its backoff.
  window.addEventListener('online', () => muxes.forEach((m) => m.wake()))
}

export function connectStreams(cb: StreamsCallbacks): void {
  disconnectStreams()
  // Another symbol or interval: the previous market's last trade must never
  // be painted onto this one's candle.
  lastTrade = null
  lastCb = cb
  watchStreams()
  const myGen = gen
  // A Yahoo-priced instrument has no Binance stream at all — every socket
  // below is symbol-scoped, so there is nothing here to subscribe to. Bail
  // out after the teardown above rather than opening four sockets against an
  // empty symbol and letting them reconnect forever. The ticker bar keeps
  // updating from the market-wide fetchTickers poll, and the instrument's own
  // price is polled by services/instrumentFeed.
  // Gold is the exception: its Binance perpetual (XAUUSDT) streams exactly like
  // a spot pair, so it gets the full live set from the futures socket host.
  const perp = binancePerpOf(state.symbol)
  if (isInstrument(state.symbol) && !perp) {
    syncCount()
    cb.onStatus()
    return
  }
  const s = (perp ?? mdSym(state.symbol) ?? '').toLowerCase()
  const WS = perp ? PERP_WS : SPOT_WS
  // Gold's perpetual trades at a basis to spot; shift every price onto spot
  // (services/spotGold). 0 for everything else.
  const sb = (): number => (perp ? spotBasis(perp) : 0)
  const tf = mdTf(state.tf)
  const def = tfDef(tf)
  const bufKey = mdSym(state.symbol) + '|' + tf
  md.series = { symbol: state.symbol, tf: tf }
  // Handlers for this generation, keyed by stream name; handed to the mux
  // below once all four are built.
  const wanted: Record<string, (d: unknown) => void> = {}
  const make = function (key: string, url: string, onMsg: (d: Any) => void): void {
    wanted[url.slice(WS.length)] = function (d: unknown) {
      // The previous coin's or timeframe's handler must not write into the
      // current one's state.
      if (gen !== myGen) return
      if (!mdVal.wsMsg(d)) {
        mdDebug.log('ws', 'invalid ' + key, JSON.stringify(d).slice(0, 60))
        return
      }
      mdHearbeat('ws')
      try {
        onMsg(d)
      } catch (e) {
        mdDebug.log('ws', 'handler ' + key, e)
      }
    }
  }
  const ticker = function (): Any {
    const t = (state.tickers[state.symbol] as Any) || {
      last: 0,
      pct: 0,
      open: 0,
      high: 0,
      low: 0,
      qvol: 0,
      trades: 0,
    }
    state.tickers[state.symbol] = t
    return t
  }
  const publishTicker = function (t: Any): void {
    mdStoreTicker(state.symbol, {
      last: t.last,
      pct: t.pct,
      high: t.high,
      low: t.low,
      qvol: t.qvol,
      trades: t.trades,
    })
    cb.onHero()
    cb.onTickerLive(t)
  }
  make('tk', WS + s + '@ticker', function (d: Any) {
    if (!mdVal.price(+d.c)) return
    const t = ticker()
    const b = sb()
    // 24h open, kept so a trade print can recompute the change without
    // waiting for the next once-a-second stats frame.
    t.open = +d.o ? +d.o + b : t.open
    t.last = +d.c + b
    t.pct = +d.P
    t.high = +d.h + b
    t.low = +d.l + b
    t.qvol = +d.q
    t.trades = +d.n
    publishTicker(t)
  })
  // Trade-by-trade tape. @ticker arrives once a second and @kline every two, so
  // both trail the market by up to that much and disagree with each other in
  // between. Every fill lands here, so the header price and the candle's close
  // are the same number at the same moment — which is what "live" has to mean.
  const flushTrade = function (): void {
    tradeFrame = 0
    const tr = tradePending
    tradePending = null
    if (!tr) return
    const t = ticker()
    t.last = tr.p
    if (t.open > 0) t.pct = ((tr.p - t.open) / t.open) * 100
    if (tr.p > t.high) t.high = tr.p
    if (!(t.low > 0) || tr.p < t.low) t.low = tr.p
    publishTicker(t)

    const arr = state.candles
    const last = arr.length ? arr[arr.length - 1] : null
    if (!last) return
    // Outside the bar still forming: the kline stream opens the next one, and
    // guessing here would stretch a closed candle.
    if (tr.T < last.t || tr.T >= bucketEnd(last.t, def)) return
    if (tr.p === last.c && tr.p <= last.h && tr.p >= last.l) return
    // Replaced rather than mutated: the folder may be holding this same object
    // as its in-progress bucket, and it owns the authoritative numbers.
    lastTrade = tr
    const c = {
      ...last,
      c: tr.p,
      h: tr.p > last.h ? tr.p : last.h,
      l: tr.p < last.l ? tr.p : last.l,
    }
    arr[arr.length - 1] = c
    mdPatchLastCandle(state.symbol, tf, c)
    cb.onChartLast(c)
  }
  make('ag', WS + s + '@aggTrade', function (d: Any) {
    const p = +d.p + sb()
    if (!mdVal.price(p)) return
    // Delta/whale tracking runs on every print (not coalesced to rAF like the
    // tape paint below) — dropping ticks here would silently under-count CVD.
    const arr = state.candles
    // Bucket by the trade's own time: trades of a new bar arrive before the
    // kline frame that opens it (~2s), and were credited to the bar that had
    // just closed, skewing the delta pane and CVD divergence.
    let bucketStart = arr.length ? arr[arr.length - 1].t : +d.T
    if (arr.length) {
      const end = bucketEnd(bucketStart, def)
      if (+d.T >= end) bucketStart = end
    }
    ingestTrade(state.symbol, bucketStart, +d.q, !!d.m)
    ingestWhaleAgg(state.symbol, +d.a, p, +d.q, +d.T, !!d.m)
    tradeListeners.forEach((fn) => fn(state.symbol, p))
    tradePending = { p: p, q: +d.q, T: +d.T }
    if (!tradeFrame) tradeFrame = raf(flushTrade)
  })
  // Resampled intervals stream their base interval and fold each tick into the
  // bucket still forming, so the last candle stays live rather than appearing
  // only once the bucket closes. Native intervals (factor 1) are unchanged.
  make('kl', WS + s + '@kline_' + def.base, function (d: Any) {
    const k = d.k
    const b = sb()
    const base = { t: k.t, o: +k.o + b, h: +k.h + b, l: +k.l + b, c: +k.c + b, v: +k.v, tb: +k.V }
    if (!mdVal.candle(base)) return
    const folder = mainFolder.key === bufKey ? mainFolder.folder : null
    let c = def.factor > 1 ? (folder ? folder.push(base) : null) : base
    if (!c) return
    // A kline frame can be older than the last trade already drawn (frames
    // come every second or two, trades far more often): keep that trade's
    // price rather than let the live candle step back until the next print.
    // On resampled intervals the folded bucket otherwise rewound every frame.
    const tr = lastTrade
    if (tr && tr.T > +d.E && tr.T >= c.t && tr.T < bucketEnd(c.t, def))
      c = { ...c, c: tr.p, h: Math.max(c.h, tr.p), l: Math.min(c.l, tr.p) }
    const arr = state.candles
    cb.onKlineLive()
    if (arr.length && arr[arr.length - 1].t === c.t) {
      arr[arr.length - 1] = c
    } else if (arr.length && c.t > arr[arr.length - 1].t) {
      // A bar further away than the next interval means bars were missed while
      // the socket was down; they would otherwise be lost for good, drawn
      // edge to edge with no visible gap.
      const gap = c.t > bucketEnd(arr[arr.length - 1].t, def)
      arr.push(c)
      if (gap && cb.onKlineGap && Date.now() - gapRefillAt > GAP_REFILL_MS) {
        gapRefillAt = Date.now()
        cb.onKlineGap()
      }
      // Matches marketData's MAX_KEEP so lazily-paged history is not eaten.
      if (arr.length > 5000) arr.shift()
    } else {
      return
    }
    mdStoreCandles(state.symbol, tf, arr)
    cb.onChartLast(c)
    state.klineTick++
    if (state.klineTick % 8 === 0 || k.x) cb.onAnalytics()
  })
  // Binance's partial-depth streams exist for 5, 10 and 20 levels only. The
  // "@depth15" this used to request is accepted and then never sends a frame,
  // so the live book was never live: it froze at the one REST snapshot and
  // the status pill fell to "Try" (ob stale) seconds after every load. Ask
  // for 20 and keep the 15 the ladder shows.
  make('dp', WS + s + '@depth20@100ms', function (d: Any) {
    // Spot sends bids/asks; the futures socket (gold) sends b/a.
    const bids = d.bids || d.b
    const asks = d.asks || d.a
    if (!bids || !bids.length || !asks) return
    const b0 = sb()
    const ob = {
      bids: bids.slice(0, 15).map((b: Any) => [+b[0] + b0, +b[1]]),
      asks: asks.slice(0, 15).map((a: Any) => [+a[0] + b0, +a[1]]),
    }
    if (!mdStoreOB(state.symbol, ob)) return
    state.ob = ob
  })
  muxFor(WS).want(wanted)
  syncCount()
  cb.onStatus()
}
