import type { CandleLike } from '../types/market'
import { state } from './store'
import { $ } from '../utils/dom'

// --- Symbol / timeframe normalization -----------------------

export const mdTfs = ['1m', '5m', '15m', '1h', '4h', '1d']

export function mdSym(s: unknown): string | null {
  if (!s) return null
  const str = String(s).trim().toUpperCase().replace(/-/g, '')
  if (!/USDT$/.test(str)) return str + 'USDT'
  return str
}

export function mdTf(t: unknown): string {
  if (!t) return '15m'
  const str = String(t).toLowerCase().trim()
  if (str === '60m' || str === '60') return '1h'
  if (str === '24h' || str === '1d' || str === 'd') return '1d'
  if (str === '240' || str === '4h') return '4h'
  if (mdTfs.indexOf(str) !== -1) return str
  return '15m'
}

export interface CandleFlat {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export function mdFlat(c: unknown): CandleFlat | null {
  if (!c) return null
  const x = c as CandleFlat
  return { t: x.t, o: +x.o, h: +x.h, l: +x.l, c: +x.c, v: +x.v }
}

export function mdFromK(k: unknown): CandleFlat | null {
  if (!k || !Array.isArray(k)) return null
  const a = k as unknown[]
  return {
    t: Number(a[0]),
    o: Number(a[1]),
    h: Number(a[2]),
    l: Number(a[3]),
    c: Number(a[4]),
    v: Number(a[5]),
  }
}

// --- Data validation ----------------------------------------

export const mdVal = {
  num(v: unknown): v is number {
    return typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e15
  },
  pos(v: unknown): boolean {
    return mdVal.num(v) && v >= 0
  },
  price(p: unknown): boolean {
    return mdVal.num(p) && p > 0 && p < 1e9
  },
  obj(x: unknown): boolean {
    return !!x && typeof x === 'object'
  },
  sym(s: unknown): boolean {
    return typeof s === 'string' && /^[A-Z0-9]{4,20}$/.test(s) && /USDT$/.test(s)
  },
  candle(c: unknown): boolean {
    if (!mdVal.obj(c)) return false
    const x = c as CandleFlat
    return (
      mdVal.pos(x.t) &&
      mdVal.price(x.o) &&
      mdVal.price(x.h) &&
      mdVal.price(x.l) &&
      mdVal.price(x.c) &&
      mdVal.pos(x.v) &&
      Math.min(x.o, x.c) >= x.l &&
      Math.max(x.o, x.c) <= x.h + 0.000001 &&
      x.h >= x.l
    )
  },
  wsMsg(d: unknown): boolean {
    if (!mdVal.obj(d)) return false
    const m = d as Record<string, unknown>
    if (m.e === 'kline') return !!m.k && mdVal.candle(mdFlat(m.k))
    if (m.e === '24hrTicker') return typeof m.c !== 'undefined' && mdVal.price(Number(m.c))
    if (m.e === 'depthUpdate' || m.e === 'depth') {
      return (
        Array.isArray(m.bids) && Array.isArray(m.asks) && m.bids.length > 0 && m.asks.length > 0
      )
    }
    return m.e !== undefined || m.k !== undefined || m.c !== undefined || m.bids !== undefined
  },
}

// --- Centralized market data store --------------------------

export interface MdLastUpdate {
  tickers: number
  candles: number
  ob: number
  fr: number
  oi: number
  whales: number
  fg: number
}

export interface MdStore {
  tickers: Record<string, unknown>
  candles: Record<string, CandleFlat[]>
  ob: Record<string, { bids: Array<Array<number | string>>; asks: Array<Array<number | string>> }>
  fr: Record<string, unknown>
  oi: Record<string, unknown>
  lastUpdate: MdLastUpdate
  conn: {
    ws: { up: boolean; reconnects: number; streams: number; age: number }
    rest: { ok: boolean; errors: number; lastOk: number }
  }
  series: { symbol: string; tf: string }
}

// normalized view (mirrors state.* but validated/normalized)
export const md: MdStore = {
  tickers: {},
  candles: {},
  ob: {},
  fr: {},
  oi: {},
  lastUpdate: { tickers: 0, candles: 0, ob: 0, fr: 0, oi: 0, whales: 0, fg: 0 },
  conn: {
    ws: { up: false, reconnects: 0, streams: 0, age: 0 },
    rest: { ok: true, errors: 0, lastOk: 0 },
  },
  series: { symbol: '', tf: '' },
}

export function mdStoreTicker(sym: unknown, t: unknown): boolean {
  if (!mdVal.sym(sym) || !mdVal.obj(t)) return false
  const ticker = t as { last?: unknown }
  if (!mdVal.price(ticker.last)) return false
  md.tickers[String(sym)] = t
  md.lastUpdate.tickers = Date.now()
  return true
}

export function mdStoreCandles(sym: unknown, tf: unknown, arr: unknown): boolean {
  if (!mdVal.sym(sym) || !mdTf(tf) || !Array.isArray(arr) || !arr.length) return false
  const ok = (arr as unknown[]).filter((x) => mdVal.candle(x)) as CandleFlat[]
  if (ok.length < Math.min(2, arr.length)) return false
  const key = String(sym) + '|' + mdTf(tf)
  md.candles[key] = ok
  md.lastUpdate.candles = Date.now()
  return true
}

export function mdStoreOB(sym: unknown, ob: unknown): boolean {
  if (!mdVal.sym(sym) || !mdVal.obj(ob)) return false
  const o = ob as { bids?: Array<Array<number | string>>; asks?: Array<Array<number | string>> }
  if (!Array.isArray(o.bids) || !Array.isArray(o.asks) || !o.bids.length || !o.asks.length)
    return false
  const good =
    mdVal.price(Number(o.bids[0][0])) &&
    mdVal.price(Number(o.asks[0][0])) &&
    Number(o.bids[0][0]) < Number(o.asks[0][0])
  if (!good) return false
  md.ob[String(sym)] = {
    bids: o.bids.map((b) => [+b[0], +b[1]]),
    asks: o.asks.map((a) => [+a[0], +a[1]]),
  }
  md.lastUpdate.ob = Date.now()
  return true
}

export function mdDataAge(kind: keyof MdLastUpdate): number | null {
  const t = md.lastUpdate[kind] || 0
  if (!t) return null
  return Date.now() - t
}

// staleness thresholds (ms)
export const mdStale = {
  tickers: 6000,
  candles: 90000,
  ob: 6000,
  fr: 45000,
  oi: 45000,
  whales: 30000,
  fg: 360000,
}

// --- Lightweight historical candle cache --------------------

export interface MdCacheEntry {
  ts: number
  candles: CandleFlat[]
}

export const mdCache: { data: Record<string, MdCacheEntry>; ttl: number } = { data: {}, ttl: 45000 }

export function mdCacheGet(sym: unknown, tf: unknown): CandleFlat[] | null {
  const k = String(sym) + '|' + mdTf(tf)
  const e = mdCache.data[k]
  if (e && Date.now() - e.ts < mdCache.ttl) return e.candles
  return null
}

export function mdCachePut(sym: unknown, tf: unknown, arr: unknown): void {
  if (!Array.isArray(arr) || !arr.length) return
  mdCache.data[String(sym) + '|' + mdTf(tf)] = { ts: Date.now(), candles: arr as CandleFlat[] }
}

// --- Health monitor -----------------------------------------

export interface MdHealth {
  wsUp: boolean
  wsStreams: number
  wsReconnects: number
  restOk: boolean
  restErrors: number
  lastWsMsg: number
  lastRestOk: number
  staleWarn: string[]
}

export const mdHealth: MdHealth = {
  wsUp: false,
  wsStreams: 0,
  wsReconnects: 0,
  restOk: true,
  restErrors: 0,
  lastWsMsg: 0,
  lastRestOk: 0,
  staleWarn: [],
}

export function mdHearbeat(kind: 'ws' | 'rest'): void {
  if (kind === 'ws') {
    mdHealth.lastWsMsg = Date.now()
    mdHealth.wsUp = true
  } else if (kind === 'rest') {
    mdHealth.lastRestOk = Date.now()
    mdHealth.restOk = true
  }
}

export function mdRefreshHealth(): MdHealth {
  const now = Date.now()
  mdHealth.staleWarn.length = 0
  if (md.conn.ws.streams > 0 && now - mdHealth.lastWsMsg > 8000)
    mdHealth.staleWarn.push('WS stalled')
  if (mdHealth.lastWsMsg === 0) mdHealth.staleWarn.push('no live stream')
  Object.keys(mdStale).forEach(function (k) {
    const a = mdDataAge(k as keyof MdLastUpdate)
    if (a != null && a > mdStale[k as keyof typeof mdStale])
      mdHealth.staleWarn.push(k + ' stale ' + Math.round(a / 1000) + 's')
  })
  return mdHealth
}

// REST health integration (used by the api client)
export function mdRestOk(): void {
  md.conn.rest.ok = true
  md.conn.rest.lastOk = Date.now()
  md.conn.rest.errors = 0
}

export function mdRestErr(): void {
  md.conn.rest.ok = false
  md.conn.rest.errors++
}

// non-disruptive UI: augment the existing status pill (no new layout)
export function mdPill(): void {
  const pill = $('statusPill'),
    txt = $('statusTxt')
  if (!pill || !txt) return
  const h = mdRefreshHealth()
  const live = md.conn.ws.streams > 0
  const stale = h.staleWarn.length > 0
  pill.classList.toggle('off', !live || stale)
  if (!live) {
    txt.textContent = 'CONNECTING…'
    return
  }
  if (stale) {
    txt.textContent = 'RECONNECTING…'
    return
  }
  txt.textContent = 'LIVE · ' + md.conn.ws.streams + ' STREAMS'
}

// --- Diagnostics / debug mode --------------------------------

export const mdDebug: {
  on: boolean
  log: (kind: string, msg: unknown) => void
  snapshot: () => unknown
} = {
  on: (function () {
    try {
      return /[?&]debug=1/.test(location.search) || localStorage.getItem('lr-debug') === '1'
    } catch (e) {
      return false
    }
  })(),
  log: null as unknown as (kind: string, msg: unknown) => void,
  snapshot: function () {
    return {
      ws: mdHealth,
      conn: md.conn,
      lastUpdate: md.lastUpdate,
      age: {
        tickers: mdDataAge('tickers'),
        candles: mdDataAge('candles'),
        ob: mdDataAge('ob'),
        fr: mdDataAge('fr'),
        oi: mdDataAge('oi'),
      },
      series: md.series,
      cacheKeys: Object.keys(mdCache.data).length,
      stateSymbol: state.symbol,
      stateTf: state.tf,
    }
  },
}
mdDebug.log = function (kind, msg) {
  if (mdDebug.on) {
    try {
      console.log('[md:' + kind + ']', msg)
    } catch (e) {
      /* noop */
    }
  }
}

export function mdToggleDebug(): boolean {
  try {
    mdDebug.on = !mdDebug.on
    localStorage.setItem('lr-debug', mdDebug.on ? '1' : '0')
  } catch (e) {
    /* noop */
  }
  if (mdDebug.on) console.log('[md] debug ON', mdDebug.snapshot())
  return mdDebug.on
}

const _win = window as unknown as Record<string, unknown>
_win.mdDebug = mdDebug
_win.mdSnapshot = function () {
  return mdDebug.snapshot()
}
_win.mdToggleDebug = mdToggleDebug
