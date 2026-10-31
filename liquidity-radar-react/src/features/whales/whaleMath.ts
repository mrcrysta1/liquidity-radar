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

// ---- unscanned-gap label and legend layout ---------------------------------

/** Where to draw the label of an unscanned stretch, in pane pixels. */
export interface GapLabelSpot {
  x: number
  y: number
  align: 'center' | 'right'
}

const GAP_LABEL_MIN_W = 130
// Clear of the OHLC legend at the top and of the whale legend and the
// zoom/reset buttons at the bottom of the pane.
const GAP_LABEL_TOP = 64
const GAP_LABEL_BOTTOM = 100

/**
 * The "no whale data scanned" label for one unscanned stretch of the pane, or
 * null to leave it shaded but unlabelled.
 *
 * - While the backfill is still running the stretch is being scanned, not
 *   missing: the legend already shows that progress ("Scanned from …" with a
 *   spinner), so a label claiming there is no data would contradict it.
 * - The symbol watermark is centred in the pane, so the label sits just below
 *   (or, in a short pane, above) its band rather than on top of it.
 * - When the stretch ends inside the pane, the label is right-aligned against
 *   that edge — the dashed line where scanning starts.
 */
export function gapLabelSpot(g: {
  left: number
  width: number
  /** The stretch ends inside the pane (its right edge is drawn). */
  edge: boolean
  paneH: number
  loading: boolean
}): GapLabelSpot | null {
  if (g.loading || !(g.width >= GAP_LABEL_MIN_W)) return null
  const mid = g.paneH / 2
  const y = [mid + 36, mid - 48].find((v) => v >= GAP_LABEL_TOP && v + 12 <= g.paneH - GAP_LABEL_BOTTOM)
  if (y === undefined) return null
  return g.edge
    ? { x: g.left + g.width - 8, y, align: 'right' }
    : { x: g.left + g.width / 2, y, align: 'center' }
}

/** Chart widths under this collapse the whale legend into a one-line chip. */
export const WHALE_LEGEND_COMPACT_W = 520

export function whaleLegendCompact(chartWidth: number): boolean {
  return chartWidth > 0 && chartWidth < WHALE_LEGEND_COMPACT_W
}

/** Collector heartbeat silence that counts as "offline" (it beats every ~10s). */
export const COLLECTOR_OFFLINE_MS = 120_000
/** Past this the collector is not coming back soon: no stale date is shown. */
export const COLLECTOR_GONE_MS = 48 * 3600_000

/**
 * The history collector's state for the whale legend: 'none' when this
 * symbol has no server history, 'live', 'offline' (silent for minutes — the
 * last-seen time is worth showing), or 'unavailable' (silent for days — a
 * "last seen" date that old only alarms, so the legend just says history is
 * unavailable).
 */
export function collectorState(
  server: boolean,
  updated: number,
  now: number,
): 'none' | 'live' | 'offline' | 'unavailable' {
  if (!server) return 'none'
  const age = Math.max(now, updated) - updated
  if (!(updated > 0) || age > COLLECTOR_GONE_MS) return 'unavailable'
  return age > COLLECTOR_OFFLINE_MS ? 'offline' : 'live'
}
