// Order-book history for the depth heatmap: periodic snapshots of resting
// liquidity by price, kept in a rolling window.
//
// A snapshot merges the two books the app already holds: the live 15-level
// book from the depth stream (state.ob, refreshed every 100ms) for the prices
// near the touch, and the 500-level REST book (state.deepOb) for the walls
// further out, folded into a bounded number of price bins so the window costs
// a fixed amount of memory however deep the book is.
//
// Pure: no DOM, no store — scripts/test-engines.mjs runs it directly.

export interface DepthSnap {
  t: number
  price: Float32Array
  qty: Float32Array
}

export interface DepthHistory {
  max: number
  snaps: DepthSnap[]
}

export function createDepthHistory(max = 1200): DepthHistory {
  return { max, snaps: [] }
}

export function pushDepthSnap(h: DepthHistory, snap: DepthSnap): void {
  const last = h.snaps[h.snaps.length - 1]
  // Out of order (a clock step back): the window must stay sorted for the
  // renderer's time search, so drop it.
  if (last && snap.t <= last.t) return
  h.snaps.push(snap)
  if (h.snaps.length > h.max) h.snaps.splice(0, h.snaps.length - h.max)
}

type Level = [number, number]

/**
 * One snapshot from the live levels plus deep levels outside the live
 * band. Deep levels are summed into at most `deepBins` bins per side, each
 * placed at its volume-weighted price.
 */
export function mergeBook(
  t: number,
  live: Level[],
  deep: Level[] | null,
  deepBins = 80,
): DepthSnap {
  const px: number[] = []
  const qt: number[] = []
  let lo = Infinity
  let hi = -Infinity
  live.forEach(([p, q]) => {
    if (!(p > 0) || !(q > 0)) return
    px.push(p)
    qt.push(q)
    if (p < lo) lo = p
    if (p > hi) hi = p
  })
  if (deep && deep.length && isFinite(lo)) {
    const below = deep.filter(([p, q]) => p > 0 && q > 0 && p < lo)
    const above = deep.filter(([p, q]) => p > 0 && q > 0 && p > hi)
    ;[below, above].forEach((side) => {
      if (!side.length) return
      let a = Infinity
      let b = -Infinity
      side.forEach(([p]) => {
        if (p < a) a = p
        if (p > b) b = p
      })
      const bins = Math.min(deepBins, side.length)
      const w = (b - a) / bins || 1
      const sumQ = new Float64Array(bins)
      const sumPQ = new Float64Array(bins)
      side.forEach(([p, q]) => {
        const i = Math.min(bins - 1, Math.floor((p - a) / w))
        sumQ[i] += q
        sumPQ[i] += p * q
      })
      for (let i = 0; i < bins; i++) {
        if (!(sumQ[i] > 0)) continue
        px.push(sumPQ[i] / sumQ[i])
        qt.push(sumQ[i])
      }
    })
  }
  return { t, price: Float32Array.from(px), qty: Float32Array.from(qt) }
}

/**
 * Sum a snapshot's liquidity into pixel rows: `yOf` maps a price to a pixel
 * y (null when off the scale), rows are `rowPx` tall from y = 0. Adds into
 * `into` so several snapshots can share one column.
 */
export function binSnapshot(
  snap: DepthSnap,
  yOf: (price: number) => number | null,
  rowPx: number,
  into: Float32Array,
): void {
  const rows = into.length
  for (let i = 0; i < snap.price.length; i++) {
    const y = yOf(snap.price[i])
    if (y == null || !isFinite(y)) continue
    const r = Math.floor(y / rowPx)
    if (r < 0 || r >= rows) continue
    into[r] += snap.qty[i]
  }
}

/**
 * The value that maps to full intensity: the `pct` percentile of the non-zero
 * cells, so one huge wall does not wash every other level out to nothing.
 * Past `sample` non-zero cells it reads an even sample of them: a zoomed-out
 * grid holds tens of thousands, and this runs inside a paint.
 */
export function intensityCap(cells: ArrayLike<number>, pct = 0.95, sample = 4000): number {
  let n = 0
  for (let i = 0; i < cells.length; i++) if (cells[i] > 0) n++
  const stride = Math.max(1, Math.ceil(n / sample))
  const vals: number[] = []
  let seen = 0
  for (let i = 0; i < cells.length; i++)
    if (cells[i] > 0 && seen++ % stride === 0) vals.push(cells[i])
  if (!vals.length) return 0
  vals.sort((a, b) => a - b)
  return vals[Math.min(vals.length - 1, Math.floor(pct * (vals.length - 1)))]
}

/** Index of the last snapshot at or before `t` (-1 when all are later). */
export function snapAtOrBefore(snaps: DepthSnap[], t: number): number {
  let lo = 0
  let hi = snaps.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (snaps[mid].t <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
