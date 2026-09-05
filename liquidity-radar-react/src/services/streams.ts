// Live market streams (WebSocket). Faithful extraction of the stream-render
// block previously living in the engine; DOM updates are delegated to an
// injected callback set so this module stays free of UI concerns.
import { state } from './store'
import {
  md,
  mdDebug,
  mdHealth,
  mdHearbeat,
  mdStoreCandles,
  mdStoreOB,
  mdStoreTicker,
  mdSym,
  mdTf,
  mdVal,
} from './market'

type Any = any

export interface StreamsCallbacks {
  onStatus(): void
  onHero(): void
  onTickerLive(t: Any): void
  onKlineLive(): void
  onChartLast(c: Any): void
  onAnalytics(): void
  onOB(): void
}

let wsTk: Any = null
let wsKl: Any = null
let wsDp: Any = null

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
  wsTk = null
  wsKl = null
  wsDp = null
  const s = mdSym(state.symbol)?.toLowerCase() ?? ''
  const tf = mdTf(state.tf)
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
    else wsDp = ws
    const attempts = (state[key + '_retry'] = Number(state[key + '_retry'] || 0) + 1)
    ws._attempts = attempts
    ws.onopen = function () {
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
      const delay = Math.min(30000, 1200 * Math.pow(2, Math.min(exp, cap))) + Math.floor(Math.random() * 400)
      setTimeout(function () {
        if (!ws._dead && state[key + '_want'] === url && state.symbol === md.series.symbol) make(key, url, onMsg)
      }, delay)
    }
    ws.onerror = function () {
      /* recovery handled via onclose */
    }
    state[key + '_want'] = url
    return ws
  }
  make('tk', 'wss://stream.binance.com:9443/ws/' + s + '@ticker', function (d: Any) {
    if (!mdVal.price(+d.c)) return
    const t = (state.tickers[state.symbol] as Any) || { last: 0, pct: 0, high: 0, low: 0, qvol: 0, trades: 0 }
    t.last = +d.c
    t.pct = +d.P
    t.high = +d.h
    t.low = +d.l
    t.qvol = +d.q
    t.trades = +d.n
    state.tickers[state.symbol] = t
    mdStoreTicker(state.symbol, { last: t.last, pct: t.pct, high: t.high, low: t.low, qvol: t.qvol, trades: t.trades })
    cb.onHero()
    cb.onTickerLive(t)
  })
  make('kl', 'wss://stream.binance.com:9443/ws/' + s + '@kline_' + tf, function (d: Any) {
    const k = d.k
    const c = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }
    if (!mdVal.candle(c)) return
    const arr = state.candles
    cb.onKlineLive()
    if (arr.length && arr[arr.length - 1].t === c.t) {
      arr[arr.length - 1] = c
    } else if (arr.length && c.t > arr[arr.length - 1].t) {
      arr.push(c)
      if (arr.length > 240) arr.shift()
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
    const ob = { bids: d.bids.map((b: Any) => [+b[0], +b[1]]), asks: d.asks.map((a: Any) => [+a[0], +a[1]]) }
    if (!mdStoreOB(state.symbol, ob)) return
    state.ob = ob
    cb.onOB()
  })
}