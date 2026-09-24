// Advanced (Pro-adopted) REST data fetchers for the Radar tab.
// Adds deep order book (liquidity score), OI history + long/short (futures
// positioning) and a cross-exchange fan-out. Uses the app's shared jget and
// writes into the single app state object, matching services/marketData.ts.
import { jget } from '../../api/client'
import { isInstrument } from '../../constants/instruments'
import { state } from '../../services/store'
import { VENUES, isUsdQuoted } from './venues'

export interface DeepOb {
  bids: { price: number; size: number }[]
  asks: { price: number; size: number }[]
}
export interface OiPoint {
  ts: number
  openInterest: number
}
export interface LongShortRow {
  ts: number
  longAccount: number
  shortAccount: number
  ratio: number
}
export interface CrossExRow {
  id: string
  name: string
  kind: 'spot' | 'perp'
  /** Quoted in USD rather than USDT — comparable, but worth flagging. */
  usd: boolean
  last?: number
  vol?: number
  spread?: number
  funding?: number
  err?: string
}

const baseOf = (sym: string): string => sym.replace(/USDT$/i, '')

export async function fetchDeepOB(): Promise<void> {
  try {
    const d = (await jget(
      'https://api.binance.com/api/v3/depth?symbol=' + state.symbol + '&limit=500',
    )) as { bids: Array<[string | number, string | number]>; asks: Array<[string | number, string | number]> }
    if (!d || !Array.isArray(d.bids) || !d.bids.length) throw new Error('empty')
    state.deepOb = {
      bids: d.bids.map((b) => ({ price: +b[0], size: +b[1] })),
      asks: d.asks.map((a) => ({ price: +a[0], size: +a[1] })),
    }
  } catch (e) {
    console.warn('deepOB', e)
  }
}

export async function fetchOIHist(): Promise<void> {
  try {
    const d = (await jget(
      'https://fapi.binance.com/futures/data/openInterestHist?symbol=' +
        state.symbol +
        '&period=1h&limit=96',
    )) as Array<{ sumOpenInterest: string; timestamp: number }>
    if (!Array.isArray(d) || !d.length) throw new Error('empty')
    state.oiHist = d.map((x) => ({ ts: Number(x.timestamp), openInterest: +x.sumOpenInterest }))
  } catch (e) {
    console.warn('oiHist', e)
  }
}

export async function fetchLongShort(): Promise<void> {
  try {
    const d = (await jget(
      'https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=' +
        state.symbol +
        '&period=1h&limit=96',
    )) as Array<{ longAccount: string; shortAccount: string; longShortRatio: string; timestamp: number }>
    if (!Array.isArray(d) || !d.length) throw new Error('empty')
    state.ls = d.map((x) => ({
      ts: Number(x.timestamp),
      longAccount: +x.longAccount,
      shortAccount: +x.shortAccount,
      ratio: +x.longShortRatio,
    }))
  } catch (e) {
    console.warn('longShort', e)
  }
}

async function safe<T>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false }> {
  try {
    return { ok: true, v: await p }
  } catch {
    return { ok: false }
  }
}

export async function fetchCrossExchange(): Promise<void> {
  // None of these venues list metals, FX, indices or equities. "No market" is
  // already how this table says so, which beats firing a 400 at every venue.
  if (isInstrument(state.symbol)) {
    state.crossEx = VENUES.map((v) => ({
      id: v.id, name: v.name, kind: v.kind, usd: isUsdQuoted(v.id), err: 'no market',
    }))
    return
  }
  const base = baseOf(state.symbol)
  const rows = await Promise.all(
    VENUES.map(async (v): Promise<CrossExRow> => {
      const sym = v.symbol(base)
      const row: CrossExRow = { id: v.id, name: v.name, kind: v.kind, usd: isUsdQuoted(v.id) }
      // No market here is an answer, not a failure — say which it is.
      if (!sym) return { ...row, err: 'no market' }
      const res = await Promise.all(v.urls(sym).map((u) => safe(jget(u))))
      let q
      try {
        q = v.parse(res.map((r) => (r.ok ? r.v : undefined)))
      } catch {
        return { ...row, err: 'bad response' }
      }
      if (q.last == null) return { ...row, err: 'unreachable' }
      const spread =
        q.bid && q.ask && q.bid > 0 ? ((q.ask - q.bid) / ((q.ask + q.bid) / 2)) * 1e4 : undefined
      return { ...row, last: q.last, vol: q.vol, spread, funding: q.funding }
    }),
  )
  state.crossEx = rows
}
