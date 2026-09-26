// Live market streams (WebSocket). Faithful extraction of the stream-render
// block previously living in the engine; DOM updates are delegated to an
// injected callback set so this module stays free of UI concerns.
import { state } from './store'
import { isInstrument } from '../constants/instruments'
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
}

let wsTk: Any = null
let wsKl: Any = null
let wsDp: Any = null
let wsAg: Any = null

// The trade tape can run to hundreds of prints a second; paints are coalesced
// onto an animation frame so a busy market cannot outrun the renderer.
let tradeFrame = 0
let tradePending: { p: number; q: number; T: number } | null = null
const raf: (fn: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(fn, 16) as unknown as number
const unraf: (h: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? cancelAnimationFrame
    : (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>)

// Socket lifecycle. Every connectStreams() starts a new generation; a socket
// from an older generation can no longer write data, touch the live count or
// schedule a reconnect. That closes three holes the old counter-based version
// had: closing sockets decrementing the *new* sockets' count (the status pill
// flipping to "Try" while data flowed), untracked reconnect timers opening a
// duplicate socket after a timeframe switch, and the previous coin's sockets
// writing prices into the new coin while a symbol switch was still loading.
let gen = 0
/** Open sockets of the current generation — the live count is its size, never a running tally. */
const openSockets = new Set<Any>()
const reconnectTimers = new Set<ReturnType<typeof setTimeout>>()
const lastMsgAt = new Map<Any, number>()
let lastCb: StreamsCallbacks | null = null
let expectedStreams = 0
/**
 * Silence after which a socket counts as stalled and is replaced. The ticker
 * pushes every second and klines every ~2s; depth pushes only on change. The
 * trade tape has no limit: a quiet pair can go minutes without a print.
 */
const STALL_MS: Record<string, number> = { tk: 20_000, kl: 45_000, dp: 45_000 }

function syncCount(): void {
  state.wsOpen = openSockets.size
  md.conn.ws.streams = openSockets.size
  md.conn.ws.up = openSockets.size > 0
}

function closeWS(ws: Any): void {
  if (ws) {
    ws._dead = true
    openSockets.delete(ws)
    lastMsgAt.delete(ws)
    try {
      ws.close()
    } catch (e) {
      /* ignore */
    }
  }
}

/** Close every stream now, e.g. the moment the symbol changes. */
export function disconnectStreams(cb?: StreamsCallbacks): void {
  gen++
  reconnectTimers.forEach((h) => clearTimeout(h))
  reconnectTimers.clear()
  closeWS(wsTk)
  closeWS(wsKl)
  closeWS(wsDp)
  closeWS(wsAg)
  wsTk = null
  wsKl = null
  wsDp = null
  wsAg = null
  openSockets.clear()
  lastMsgAt.clear()
  expectedStreams = 0
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
  const check = () => {
    const now = Date.now()
    openSockets.forEach((ws) => {
      const limit = STALL_MS[ws._key]
      if (!limit) return
      if (now - (lastMsgAt.get(ws) ?? ws._openedAt ?? now) > limit) {
        mdDebug.log('ws', 'stalled ' + ws._key + ' — reconnecting')
        // Not marked dead, so onclose takes the normal reconnect path.
        try {
          ws.close()
        } catch (e) {
          /* ignore */
        }
      }
    })
  }
  setInterval(check, 5000)
  // Back from sleep or a hidden tab: check at once instead of up to 5s later.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  // The network returned: anything missing reconnects now, not on its backoff.
  window.addEventListener('online', () => {
    if (lastCb && openSockets.size < expectedStreams) connectStreams(lastCb)
  })
}

export function connectStreams(cb: StreamsCallbacks): void {
  disconnectStreams()
  lastCb = cb
  watchStreams()
  const myGen = gen
  // A Yahoo-priced instrument has no Binance stream at all — every socket
  // below is symbol-scoped, so there is nothing here to subscribe to. Bail
  // out after the teardown above rather than opening four sockets against an
  // empty symbol and letting them reconnect forever. The ticker bar keeps
  // updating from the market-wide fetchTickers poll, and the instrument's own
  // price is polled by services/instrumentFeed.
  if (isInstrument(state.symbol)) {
    syncCount()
    cb.onStatus()
    return
  }
  expectedStreams = 4
  const s = mdSym(state.symbol)?.toLowerCase() ?? ''
  const tf = mdTf(state.tf)
  const def = tfDef(tf)
  const bufKey = mdSym(state.symbol) + '|' + tf
  md.series = { symbol: state.symbol, tf: tf }
  // Reconnect backoff per stream: 1.2s x 2^attempt, capped at 30s, with jitter.
  const make = function (key: string, url: string, onMsg: (d: Any) => void) {
    if (gen !== myGen) return null
    let ws: Any = null
    try {
      ws = new WebSocket(url)
    } catch (e) {
      mdDebug.log('ws', 'create fail ' + key)
      return null
    }
    if (key === 'tk') wsTk = ws
    else if (key === 'kl') wsKl = ws
    else if (key === 'ag') wsAg = ws
    else wsDp = ws
    const attempts = (state[key + '_retry'] = Number(state[key + '_retry'] || 0) + 1)
    ws._attempts = attempts
    ws._gen = myGen
    ws._key = key
    ws.onopen = function () {
      if (ws._gen !== gen || ws._dead) {
        try {
          ws.close()
        } catch (e) {
          /* ignore */
        }
        return
      }
      noteStream(url, true)
      ws._openedAt = Date.now()
      openSockets.add(ws)
      state[key + '_retry'] = 0
      mdHearbeat('ws')
      syncCount()
      cb.onStatus()
    }
    ws.onmessage = function (ev: MessageEvent) {
      // A socket from an earlier generation (the previous coin or timeframe)
      // must not write into the current one's state.
      if (ws._gen !== gen) return
      lastMsgAt.set(ws, Date.now())
      let d: Any
      try {
        d = JSON.parse(ev.data)
      } catch (e) {
        mdDebug.log('ws', 'bad json ' + key)
        return
      }
      if (!mdVal.wsMsg(d)) {
        mdDebug.log('ws', 'invalid ' + key, ev.data && ev.data.slice ? ev.data.slice(0, 60) : '')
        return
      }
      mdHearbeat('ws')
      try {
        onMsg(d)
      } catch (e) {
        mdDebug.log('ws', 'handler ' + key, e)
      }
    }
    ws.onclose = function () {
      noteStream(url, false)
      openSockets.delete(ws)
      lastMsgAt.delete(ws)
      if (ws._gen !== gen) return // superseded: it neither counts nor reconnects
      syncCount()
      cb.onStatus()
      if (ws._dead) return
      md.conn.ws.reconnects++
      mdHealth.wsReconnects++
      // subscription restoration: only revive if this stream is still wanted & symbol unchanged
      if (state[key + '_want'] !== url || state.symbol !== md.series.symbol) return
      const exp = Number(state[key + '_retry'] || 0)
      const delay = Math.min(30000, 1200 * Math.pow(2, Math.min(exp, 5))) + Math.floor(Math.random() * 400)
      const h = setTimeout(function () {
        reconnectTimers.delete(h)
        if (gen === myGen && state[key + '_want'] === url && state.symbol === md.series.symbol)
          make(key, url, onMsg)
      }, delay)
      reconnectTimers.add(h)
    }
    ws.onerror = function () {
      /* recovery handled via onclose */
    }
    state[key + '_want'] = url
    return ws
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
  make('tk', 'wss://stream.binance.com:9443/ws/' + s + '@ticker', function (d: Any) {
    if (!mdVal.price(+d.c)) return
    const t = ticker()
    // 24h open, kept so a trade print can recompute the change without
    // waiting for the next once-a-second stats frame.
    t.open = +d.o || t.open
    t.last = +d.c
    t.pct = +d.P
    t.high = +d.h
    t.low = +d.l
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
  make('ag', 'wss://stream.binance.com:9443/ws/' + s + '@aggTrade', function (d: Any) {
    const p = +d.p
    if (!mdVal.price(p)) return
    // Delta/whale tracking runs on every print (not coalesced to rAF like the
    // tape paint below) — dropping ticks here would silently under-count CVD.
    const arr = state.candles
    const bucketStart = arr.length ? arr[arr.length - 1].t : +d.T
    ingestTrade(state.symbol, bucketStart, +d.q, !!d.m)
    ingestWhaleAgg(state.symbol, +d.a, p, +d.q, +d.T, !!d.m)
    tradePending = { p: p, q: +d.q, T: +d.T }
    if (!tradeFrame) tradeFrame = raf(flushTrade)
  })
  // Resampled intervals stream their base interval and fold each tick into the
  // bucket still forming, so the last candle stays live rather than appearing
  // only once the bucket closes. Native intervals (factor 1) are unchanged.
  make('kl', 'wss://stream.binance.com:9443/ws/' + s + '@kline_' + def.base, function (d: Any) {
    const k = d.k
    const base = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }
    if (!mdVal.candle(base)) return
    const folder = mainFolder.key === bufKey ? mainFolder.folder : null
    const c = def.factor > 1 ? (folder ? folder.push(base) : null) : base
    if (!c) return
    const arr = state.candles
    cb.onKlineLive()
    if (arr.length && arr[arr.length - 1].t === c.t) {
      arr[arr.length - 1] = c
    } else if (arr.length && c.t > arr[arr.length - 1].t) {
      arr.push(c)
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
  make('dp', 'wss://stream.binance.com:9443/ws/' + s + '@depth20@100ms', function (d: Any) {
    if (!d.bids || !d.bids.length) return
    const ob = {
      bids: d.bids.slice(0, 15).map((b: Any) => [+b[0], +b[1]]),
      asks: d.asks.slice(0, 15).map((a: Any) => [+a[0], +a[1]]),
    }
    if (!mdStoreOB(state.symbol, ob)) return
    state.ob = ob
  })
}
