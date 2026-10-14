// Pure whale-order maths, kept free of imports so the engine tests can load it
// directly: rebuilding taker orders from aggTrades, the default size threshold,
// and bubble sizing.

/** A Binance aggTrade as the REST API and websocket deliver it. */
export type Agg = { a: number; p: string; q: string; T: number; m: boolean }

export interface WhaleOrder {
  /** First and last aggTrade id in the order. */
  a0: number
  a1: number
  t: number
  /** Volume-weighted average fill price. */
  p: number
  usd: number
  q: number
  side: 'buy' | 'sell'
  /** Number of aggTrades (price levels) the order filled across. */
  n: number
}

// ---- thresholds -----------------------------------------------------------

function nice(v: number): number {
  const e = Math.pow(10, Math.floor(Math.log10(v)))
  const f = v / e
  return (f < 1.5 ? 1 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * e
}

/**
 * The same dollar figure means very different things on BTC and on a small
 * cap, so the default scales with the pair's 24h turnover: about 1/20,000 of
 * a day's volume — $100k on BTC, $50k on ETH — kept within $10k–$1M.
 */
export function autoThreshold(quoteVol24h: number): number {
  if (!(quoteVol24h > 0)) return 50_000
  return Math.min(1_000_000, Math.max(10_000, nice(quoteVol24h / 20_000)))
}

// ---- grouping ---------------------------------------------------------------

/** Group ascending aggTrades into taker orders (same time + side + consecutive ids). */
export function groupAggTrades(trades: Agg[]): WhaleOrder[] {
  const out: WhaleOrder[] = []
  let cur: WhaleOrder | null = null
  for (const t of trades) {
    const p = +t.p
    const q = +t.q
    if (!(p > 0) || !(q > 0)) continue
    const side = t.m ? 'sell' : 'buy'
    if (cur && cur.t === t.T && cur.side === side && t.a === cur.a1 + 1) {
      cur.usd += p * q
      cur.q += q
      cur.a1 = t.a
      cur.n++
      cur.p = cur.usd / cur.q
    } else {
      cur = { a0: t.a, a1: t.a, t: t.T, p, usd: p * q, q, side, n: 1 }
      out.push(cur)
    }
  }
  return out
}

const MIN_R = 3.5
const MAX_R = 36

/** Bubble radius: area ∝ notional, anchored so the threshold order is MIN_R. */
export function bubbleRadius(usd: number, min: number): number {
  return Math.min(MAX_R, Math.max(MIN_R, MIN_R * Math.sqrt(usd / Math.max(1, min))))
}
