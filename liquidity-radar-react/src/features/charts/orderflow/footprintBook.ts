// Real footprint data: the charted symbol's aggTrades, bucketed per bar and
// per price, for every bar since the page started listening.
//
// The footprint style used to model a bar's intrabar volume from its OHLCV
// (series/customSeries distribute()). Binance's aggTrade stream says exactly
// what traded where and which side was the aggressor (`m`: the buyer was the
// maker, so the taker sold), so for bars the page watched live the footprint
// can show the real thing. Older bars stay modelled — the chart marks them.
//
// Each bar keeps its trades on a fine price grid and coarsens it (doubling
// the step) whenever it grows past `maxCells`, so a wide bar on a busy
// market costs a bounded amount of memory; at render time the cells are
// re-bucketed into however many rows the footprint draws.
//
// Pure: no DOM, no store — scripts/test-engines.mjs runs it directly.

export interface FpCell {
  buy: number
  sell: number
}

export interface FpBar {
  /** Bar open time (ms) — the candle's own `t`. */
  start: number
  /** Next bar's open time (ms): used to check a chart's bars are this interval. */
  end: number
  /** Price width of one cell; doubles as the bar coarsens. */
  step: number
  /** Cell index (floor(price / step)) → taker buy/sell volume. */
  cells: Map<number, FpCell>
  vol: number
  lo: number
  hi: number
}

export interface FootprintBook {
  /** Symbol|interval the bars belong to; a new key starts the book over. */
  key: string
  /** Time of the first trade recorded under this key: bars opening after it are complete. */
  since: number
  bars: Map<number, FpBar>
  /** Bar starts, oldest first, for eviction. */
  order: number[]
  maxBars: number
  maxCells: number
}

export interface FpTrade {
  key: string
  bar: number
  end: number
  price: number
  qty: number
  /** aggTrade `m`: the buyer was the maker, i.e. a taker sell. */
  buyerMaker: boolean
  time: number
}

export function createFootprintBook(maxBars = 500, maxCells = 240): FootprintBook {
  return { key: '', since: 0, bars: new Map(), order: [], maxBars, maxCells }
}

/** A tidy starting grid: the power of ten at or below 1/100,000th of the price. */
export function initialStep(price: number): number {
  if (!(price > 0) || !isFinite(price)) return 1
  return Math.pow(10, Math.floor(Math.log10(price * 1e-5)))
}

/** Halve the grid's resolution: cell k at step s lands in cell floor(k/2) at 2s. */
function coarsen(bar: FpBar): void {
  const next = new Map<number, FpCell>()
  bar.cells.forEach((c, k) => {
    const nk = Math.floor(k / 2)
    const n = next.get(nk)
    if (n) {
      n.buy += c.buy
      n.sell += c.sell
    } else next.set(nk, { buy: c.buy, sell: c.sell })
  })
  bar.cells = next
  bar.step *= 2
}

export function addFootprintTrade(book: FootprintBook, t: FpTrade): void {
  if (!(t.qty > 0) || !(t.price > 0) || !isFinite(t.price)) return
  if (t.key !== book.key) {
    book.key = t.key
    book.since = t.time
    book.bars.clear()
    book.order.length = 0
  }
  let bar = book.bars.get(t.bar)
  if (!bar) {
    bar = {
      start: t.bar,
      end: t.end,
      step: initialStep(t.price),
      cells: new Map(),
      vol: 0,
      lo: t.price,
      hi: t.price,
    }
    book.bars.set(t.bar, bar)
    book.order.push(t.bar)
    // Bars normally arrive in order; a late trade for an older bar must not
    // leave `order` unsorted, or eviction would drop the wrong bar.
    if (book.order.length > 1 && book.order[book.order.length - 2] > t.bar)
      book.order.sort((a, b) => a - b)
    while (book.order.length > book.maxBars) book.bars.delete(book.order.shift()!)
  }
  const k = Math.floor(t.price / bar.step + 1e-9)
  const cell = bar.cells.get(k)
  if (cell) {
    if (t.buyerMaker) cell.sell += t.qty
    else cell.buy += t.qty
  } else {
    bar.cells.set(k, t.buyerMaker ? { buy: 0, sell: t.qty } : { buy: t.qty, sell: 0 })
    while (bar.cells.size > book.maxCells) coarsen(bar)
  }
  bar.vol += t.qty
  if (t.price < bar.lo) bar.lo = t.price
  if (t.price > bar.hi) bar.hi = t.price
}

/** 'real' — every trade of the bar was seen; 'partial' — the page joined mid-bar. */
export function barCoverage(book: FootprintBook, bar: FpBar): 'real' | 'partial' {
  return bar.start >= book.since ? 'real' : 'partial'
}

export interface FpRow {
  lo: number
  hi: number
  buy: number
  sell: number
}

/**
 * The bar's cells summed into `rows` equal price rows from `lo` to `hi` (the
 * candle's own low/high, so the grid matches the modelled bars' layout).
 * A cell lands in the row holding its midpoint; cells outside are clamped in.
 */
export function rebucket(bar: FpBar, lo: number, hi: number, rows: number): FpRow[] {
  const n = Math.max(1, Math.floor(rows))
  const span = hi - lo
  const rowStep = span > 0 ? span / n : 1
  const out: FpRow[] = []
  for (let i = 0; i < n; i++)
    out.push({ lo: lo + rowStep * i, hi: lo + rowStep * (i + 1), buy: 0, sell: 0 })
  bar.cells.forEach((c, k) => {
    const mid = (k + 0.5) * bar.step
    const i = span > 0 ? Math.min(n - 1, Math.max(0, Math.floor((mid - lo) / rowStep))) : 0
    out[i].buy += c.buy
    out[i].sell += c.sell
  })
  return out
}

export interface Imbalance {
  buy: boolean
  sell: boolean
}

/**
 * Diagonal imbalances, as order-flow tools read a footprint: a row's buying
 * (lifting the offer) against the selling one row below it (hitting the bid
 * one tick lower), and a row's selling against the buying one row above.
 * `rows` is ordered low → high. A side must also reach `minVol`, so a few
 * contracts against an empty row do not light up.
 */
export function imbalances(rows: FpRow[], ratio = 3, minVol = 0): Imbalance[] {
  return rows.map((r, i) => {
    const below = i > 0 ? rows[i - 1].sell : null
    const above = i < rows.length - 1 ? rows[i + 1].buy : null
    return {
      buy: below != null && r.buy > 0 && r.buy >= minVol && r.buy >= ratio * below,
      sell: above != null && r.sell > 0 && r.sell >= minVol && r.sell >= ratio * above,
    }
  })
}

/** Runs of `min`+ consecutive rows imbalanced on the same side (inclusive row indices). */
export function stackedImbalances(
  flags: Imbalance[],
  min = 3,
): Array<{ side: 'buy' | 'sell'; from: number; to: number }> {
  const out: Array<{ side: 'buy' | 'sell'; from: number; to: number }> = []
  ;(['buy', 'sell'] as const).forEach((side) => {
    let start = -1
    for (let i = 0; i <= flags.length; i++) {
      const on = i < flags.length && flags[i][side]
      if (on && start < 0) start = i
      if (!on && start >= 0) {
        if (i - start >= min) out.push({ side, from: start, to: i - 1 })
        start = -1
      }
    }
  })
  return out
}

/** Point of control: the row with the most volume, or -1 for an empty bar. */
export function pocRow(rows: FpRow[]): number {
  let best = -1
  let most = 0
  rows.forEach((r, i) => {
    const v = r.buy + r.sell
    if (v > most) {
      most = v
      best = i
    }
  })
  return best
}
