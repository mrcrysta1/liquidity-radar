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

function closeWS(ws: Any): void {
  if (ws) {
    ws._dead = true
    try {
      ws.close()
    } catch (e) {
      /* ignore */
    }
  }
}

export function connectStreams(cb: StreamsCallbacks): void {
  closeWS(wsTk)
  closeWS(wsKl)
  closeWS(wsDp)
  closeWS(wsAg)
  wsTk = null
  wsKl = null
  wsDp = null
  wsAg = null
  if (tradeFrame) unraf(tradeFrame)
  tradeFrame = 0
  tradePending = null
  // A Yahoo-priced instrument has no Binance stream at all — every socket
  // below is symbol-scoped, so there is nothing here to subscribe to. Bail
  // out after the teardown above rather than opening four sockets against an
  // empty symbol and letting them reconnect forever. The ticker bar keeps
  // updating from the market-wide fetchTickers poll, and the instrument's own
  // price is polled by services/instrumentFeed.
  if (isInstrument(state.symbol)) {
    state.wsOpen = 0
    md.conn.ws.streams = 0
    md.conn.ws.up = false
    cb.onStatus()
    return
  }
  const s = mdSym(state.symbol)?.toLowerCase() ?? ''
  const tf = mdTf(state.tf)
  const def = tfDef(tf)
  const bufKey = mdSym(state.symbol) + '|' + tf
  md.series = { symbol: state.symbol, tf: tf }
  // exponential backoff per stream with jitter + attempt cap
  const backoff: { n: number } = { n: 0 } // multiplier: (2^n) * 1200ms, capped 30s
  const make = function (key: string, url: string, onMsg: (d: Any) => void) {
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
    ws.onopen = function () {
      noteStream(url, true)
      state.wsOpen++
      state[key + '_retry'] = 0
      mdHearbeat('ws')
      md.conn.ws.streams = state.wsOpen
      md.conn.ws.up = true
      cb.onStatus()
    }
    ws.onmessage = function (ev: MessageEvent) {
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
      state.wsOpen = Math.max(0, state.wsOpen - 1)
      md.conn.ws.streams = Math.max(0, md.conn.ws.streams - 1)
      cb.onStatus()
      if (ws._dead) return
      md.conn.ws.reconnects++
      mdHealth.wsReconnects++
      // subscription restoration: only revive if this stream is still wanted & symbol unchanged
      if (state[key + '_want'] !== url || state.symbol !== md.series.symbol) return
      const exp = Number(state[key + '_retry'] || 0)
      const cap = 30
      backoff.n = Math.min(backoff.n + 1, cap)
      const delay =
        Math.min(30000, 1200 * Math.pow(2, Math.min(exp, cap))) + Math.floor(Math.random() * 400)
      setTimeout(function () {
        if (!ws._dead && state[key + '_want'] === url && state.symbol === md.series.symbol)
          make(key, url, onMsg)
      }, delay)
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
  make('dp', 'wss://stream.binance.com:9443/ws/' + s + '@depth15@100ms', function (d: Any) {
    if (!d.bids || !d.bids.length) return
    const ob = {
      bids: d.bids.map((b: Any) => [+b[0], +b[1]]),
      asks: d.asks.map((a: Any) => [+a[0], +a[1]]),
    }
    if (!mdStoreOB(state.symbol, ob)) return
    state.ob = ob
  })
}
