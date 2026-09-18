// Advanced (Pro-adopted) REST data fetchers for the Radar tab.
// Adds deep order book (liquidity score), OI history + long/short (futures
// positioning) and a cross-exchange fan-out. Uses the app's shared jget and
// writes into the single app state object, matching services/marketData.ts.
import { jget } from '../../api/client'
import { state } from '../../services/store'

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
  const sym = state.symbol
  const base = baseOf(sym)
  const okx = base + '-USDT'
  const [bT, bB, bF, yS, yF, oS, oF] = await Promise.all([
    safe(jget('https://api.binance.com/api/v3/ticker/24hr?symbol=' + sym)),
    safe(jget('https://api.binance.com/api/v3/ticker/bookTicker?symbol=' + sym)),
    safe(jget('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=' + sym)),
    safe(jget('https://api.bybit.com/v5/market/tickers?category=spot&symbol=' + sym)),
    safe(jget('https://api.bybit.com/v5/market/tickers?category=linear&symbol=' + sym)),
    safe(jget('https://www.okx.com/api/v5/market/ticker?instId=' + okx)),
    safe(jget('https://www.okx.com/api/v5/public/funding-rate?instId=' + okx + '-SWAP')),
  ])
  const rows: CrossExRow[] = []
  const spreadBps = (bid?: number, ask?: number): number | undefined =>
    bid && ask && bid > 0 ? ((ask - bid) / ((ask + bid) / 2)) * 1e4 : undefined

  // Binance
  {
    const t = bT.ok ? (bT.v as { lastPrice?: string; quoteVolume?: string }) : undefined
    const bk = bB.ok ? (bB.v as { bidPrice?: string; askPrice?: string }) : undefined
    const f = bF.ok ? (bF.v as { lastFundingRate?: string }) : undefined
    const row: CrossExRow = {
      id: 'binance',
      last: t?.lastPrice ? +t.lastPrice : undefined,
      vol: t?.quoteVolume ? +t.quoteVolume : undefined,
      spread: spreadBps(bk?.bidPrice ? +bk.bidPrice : undefined, bk?.askPrice ? +bk.askPrice : undefined),
      funding: f?.lastFundingRate ? +f.lastFundingRate : undefined,
    }
    if (row.last == null) row.err = 'unreachable'
    rows.push(row)
  }
  // Bybit
  {
    const t = yS.ok
      ? ((yS.v as { result?: { list?: Array<Record<string, string>> } }).result?.list?.[0] ?? undefined)
      : undefined
    const f = yF.ok
      ? ((yF.v as { result?: { list?: Array<Record<string, string>> } }).result?.list?.[0] ?? undefined)
      : undefined
    const row: CrossExRow = {
      id: 'bybit',
      last: t?.lastPrice ? +t.lastPrice : undefined,
      vol: t?.turnover24h ? +t.turnover24h : undefined,
      spread: spreadBps(t?.bid1Price ? +t.bid1Price : undefined, t?.ask1Price ? +t.ask1Price : undefined),
      funding: f?.fundingRate ? +f.fundingRate : undefined,
    }
    if (row.last == null) row.err = 'unreachable'
    rows.push(row)
  }
  // OKX
  {
    const t = oS.ok
      ? ((oS.v as { data?: Array<Record<string, string>> }).data?.[0] ?? undefined)
      : undefined
    const f = oF.ok
      ? ((oF.v as { data?: Array<Record<string, string>> }).data?.[0] ?? undefined)
      : undefined
    const row: CrossExRow = {
      id: 'okx',
      last: t?.last ? +t.last : undefined,
      vol: t?.volCcy24h ? +t.volCcy24h : undefined,
      spread: spreadBps(t?.bidPx ? +t.bidPx : undefined, t?.askPx ? +t.askPx : undefined),
      funding: f?.fundingRate ? +f.fundingRate : undefined,
    }
    if (row.last == null) row.err = 'unreachable'
    rows.push(row)
  }
  state.crossEx = rows
}
