// Drawing operations that are pure maths — angle constraint, stacking order,
// long/short position sums, the side check on a position's stop and the
// anchored VWAP. No chart, no DOM, so the tests can run them directly.
import type { Pt } from './geometry'

/**
 * Shift-constrain: snap the vector from (x0, y0) to (x, y) to the nearest of
 * 0°, 45° or 90° (and their mirrors), as TradingView does while Shift is held.
 * The length along the chosen direction is kept, so a 45° line still reaches
 * as far as the cursor got.
 */
export function constrainAngle(x0: number, y0: number, x: number, y: number): [number, number] {
  const dx = x - x0
  const dy = y - y0
  if (!dx && !dy) return [x, y]
  const ang = Math.atan2(dy, dx)
  const step = Math.PI / 4
  const snapped = Math.round(ang / step) * step
  const ux = Math.cos(snapped)
  const uy = Math.sin(snapped)
  // Project onto the chosen direction rather than keep the raw radius: a
  // nearly-flat drag then ends right under the cursor horizontally.
  const len = dx * ux + dy * uy
  const r = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v)
  return [x0 + r(len * ux), y0 + r(len * uy)]
}

/**
 * Move item `i` to the front (painted last, hit first) or the back of `list`,
 * in place. Returns its new index, so the selection can follow it.
 */
export function reorder<T>(list: T[], i: number, to: 'front' | 'back'): number {
  if (i < 0 || i >= list.length) return i
  const [item] = list.splice(i, 1)
  if (to === 'front') {
    list.push(item)
    return list.length - 1
  }
  list.unshift(item)
  return 0
}

/** Copy of a drawing for Ctrl+D: same anchors and style, never locked or hidden. */
export function cloneDrawing<T extends object>(d: T): T {
  const copy = JSON.parse(JSON.stringify(d))
  delete copy.locked
  delete copy.hidden
  return copy
}

export const POS_ACCOUNT_DEFAULT = 1000
export const POS_RISK_DEFAULT = 1

export interface PositionStats {
  /** Units that lose exactly the risked amount if the stop is hit. */
  qty: number
  /** Account currency at risk / to gain. */
  riskAmt: number
  rewardAmt: number
  rr: number
  /** Signed distance and percentage from entry to target / stop. */
  targetDist: number
  targetPct: number
  stopDist: number
  stopPct: number
  /** Open P&L at `last`, in account currency and as % of the account. */
  pnl: number | null
  pnlPct: number | null
}

/**
 * The numbers TradingView's long/short position tool shows. Quantity follows
 * from the account and the risk %: risk amount ÷ price distance to the stop,
 * so moving the stop resizes the position instead of changing the risk.
 */
export function positionStats(
  side: 'long' | 'short',
  entry: number,
  stop: number,
  target: number,
  last: number | null,
  account = POS_ACCOUNT_DEFAULT,
  riskPct = POS_RISK_DEFAULT,
): PositionStats {
  const dir = side === 'long' ? 1 : -1
  const perUnit = Math.abs(entry - stop)
  const riskAmt = Math.max(0, account) * (Math.max(0, riskPct) / 100)
  const qty = perUnit > 0 ? riskAmt / perUnit : 0
  const rewardAmt = qty * Math.abs(target - entry)
  const pct = (v: number) => (entry ? (v * 100) / entry : 0)
  const pnl = last != null && Number.isFinite(last) ? qty * (last - entry) * dir : null
  return {
    qty,
    riskAmt,
    rewardAmt,
    rr: perUnit > 0 ? Math.abs(target - entry) / perUnit : 0,
    targetDist: target - entry,
    targetPct: pct(target - entry),
    stopDist: stop - entry,
    stopPct: pct(stop - entry),
    pnl,
    pnlPct: pnl != null && account > 0 ? (pnl * 100) / account : null,
  }
}

/**
 * Keep a position's stop and target on the right sides of the entry: below /
 * above for a long, the other way round for a short. A level placed on the
 * wrong side is mirrored through the entry (same distance), so a click on the
 * wrong side still gives a usable position rather than a negative R:R.
 * While a handle is dragged (`clamp`) mirroring would make the level jump
 * across the box, so it stops just short of the entry instead.
 * Points are [entry, stop, target].
 */
export function fixPositionSides(type: string, pts: Pt[], clamp = false): Pt[] {
  if ((type !== 'long' && type !== 'short') || pts.length < 3) return pts
  const dir = type === 'long' ? 1 : -1
  const entry = pts[0].price
  const tick = Math.abs(entry) * 0.0005 || 1e-8
  const side = (p: Pt, want: number): Pt => {
    const d = p.price - entry
    if (d * want > 0) return p
    const gap = clamp ? tick : Math.abs(d) || Math.abs(entry) * 0.01 || tick
    return { ...p, price: entry + want * gap }
  }
  return [pts[0], side(pts[1], -dir), side(pts[2], dir), ...pts.slice(3)]
}

export interface VwapBar {
  h: number
  l: number
  c: number
  v: number
}

/**
 * Anchored VWAP: cumulative (typical price × volume) ÷ cumulative volume from
 * the anchor bar on. Bars with no volume carry the previous value (or their
 * typical price before any volume has traded) so the line has no holes.
 */
export function anchoredVwap(bars: VwapBar[]): number[] {
  let pv = 0
  let vol = 0
  return bars.map((b) => {
    const tp = (b.h + b.l + b.c) / 3
    const v = Number(b.v) || 0
    if (v > 0) {
      pv += tp * v
      vol += v
    }
    return vol > 0 ? pv / vol : tp
  })
}
