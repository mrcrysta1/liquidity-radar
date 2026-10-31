// Paper trading for bar replay — TradingView's replay trading panel.
//
// One netted position per book: a buy against a short covers it first and
// only the remainder opens a long, the way a real exchange account nets. Each
// covered slice becomes a closed trade with its own P&L, so the win rate
// counts round trips rather than button presses. No fees or slippage: the
// fill is the price passed in (the replay bar's close).
//
// Pure: no DOM, no store, no clock — scripts/test-engines.mjs runs it. Every
// function returns a new book; the caller keeps the current one.

export type Side = 'long' | 'short'

export interface Fill {
  side: 'buy' | 'sell'
  qty: number
  price: number
  /** Bar open time (ms) the fill happened on. */
  t: number
}

export interface ClosedTrade {
  side: Side
  qty: number
  entry: number
  exit: number
  entryT: number
  exitT: number
  pnl: number
}

export interface Book {
  /** Signed size: positive long, negative short, 0 flat. */
  pos: number
  /** Average entry of the open position (0 when flat). */
  avg: number
  /** When the open position was opened (0 when flat). */
  openT: number
  realized: number
  fills: Fill[]
  trades: ClosedTrade[]
}

export interface Summary {
  trades: number
  wins: number
  losses: number
  /** 0..1, or 0 with no closed trades. */
  winRate: number
  realized: number
  unrealized: number
  net: number
  /** Largest closed win and loss (loss is negative or 0). */
  best: number
  worst: number
}

/** Below this a size is float noise from a partial cover, not a position. */
const EPS = 1e-12

export function emptyBook(): Book {
  return { pos: 0, avg: 0, openT: 0, realized: 0, fills: [], trades: [] }
}

function valid(qty: number, price: number): boolean {
  return Number.isFinite(qty) && qty > 0 && Number.isFinite(price) && price > 0
}

/**
 * Apply one order. `signed` is positive for a buy, negative for a sell. An
 * invalid size or price leaves the book untouched rather than throwing — the
 * quantity box is free text.
 */
function apply(b: Book, signed: number, price: number, t: number): Book {
  const qty = Math.abs(signed)
  if (!valid(qty, price)) return b
  const fill: Fill = { side: signed > 0 ? 'buy' : 'sell', qty, price, t }
  let pos = b.pos
  let avg = b.avg
  let openT = b.openT
  let realized = b.realized
  const trades = b.trades.slice()
  let left = signed
  // Opposite direction: cover first, booking each covered slice.
  if (pos !== 0 && Math.sign(left) !== Math.sign(pos)) {
    const cover = Math.min(Math.abs(left), Math.abs(pos))
    const dir = pos > 0 ? 1 : -1
    const pnl = (price - avg) * cover * dir
    realized += pnl
    trades.push({
      side: dir > 0 ? 'long' : 'short',
      qty: cover,
      entry: avg,
      exit: price,
      entryT: openT,
      exitT: t,
      pnl,
    })
    pos -= cover * dir
    left += cover * dir
    if (Math.abs(pos) < EPS) {
      pos = 0
      avg = 0
      openT = 0
    }
    if (Math.abs(left) < EPS) left = 0
  }
  // Same direction (or what is left after flipping): add, averaging in.
  if (left !== 0) {
    if (pos === 0) {
      avg = price
      openT = t
    } else {
      avg = (avg * Math.abs(pos) + price * Math.abs(left)) / (Math.abs(pos) + Math.abs(left))
    }
    pos += left
  }
  return { pos, avg, openT, realized, fills: b.fills.concat(fill), trades }
}

export function buy(b: Book, qty: number, price: number, t: number): Book {
  return apply(b, Math.abs(qty), price, t)
}

export function sell(b: Book, qty: number, price: number, t: number): Book {
  return apply(b, -Math.abs(qty), price, t)
}

/** Close whatever is open at `price`. Flat stays flat. */
export function flatten(b: Book, price: number, t: number): Book {
  if (b.pos === 0) return b
  return apply(b, -b.pos, price, t)
}

/** Open P&L of the position marked at `price`. */
export function unrealized(b: Book, price: number): number {
  if (b.pos === 0 || !Number.isFinite(price)) return 0
  return (price - b.avg) * b.pos
}

export function summary(b: Book, price: number): Summary {
  let wins = 0
  let losses = 0
  let best = 0
  let worst = 0
  for (const tr of b.trades) {
    if (tr.pnl > 0) wins++
    else if (tr.pnl < 0) losses++
    if (tr.pnl > best) best = tr.pnl
    if (tr.pnl < worst) worst = tr.pnl
  }
  const n = b.trades.length
  const u = unrealized(b, price)
  return {
    trades: n,
    wins,
    losses,
    winRate: n ? wins / n : 0,
    realized: b.realized,
    unrealized: u,
    net: b.realized + u,
    best,
    worst,
  }
}

// ------------------------------------------------------- working orders
// "Trade from chart": a limit or stop order resting at a price until a bar
// trades through it. A bar that opens beyond the price fills at the open (a
// gap gives the better price to a limit, the worse one to a stop), otherwise
// at the order's price.

export type OrderType = 'limit' | 'stop'

export interface WorkingOrder {
  id: number
  side: 'buy' | 'sell'
  type: OrderType
  price: number
  qty: number
  /** Bar open time (ms) it was placed on: it can only fill on later bars. */
  t: number
}

/** The fill price of `o` on `bar`, or null when the bar does not reach it. */
export function orderFill(
  o: Pick<WorkingOrder, 'side' | 'type' | 'price'>,
  bar: { o: number; h: number; l: number },
): number | null {
  const p = o.price
  if (!(p > 0)) return null
  // A buy limit and a sell stop wait below; a sell limit and a buy stop above.
  const below = (o.side === 'buy') === (o.type === 'limit')
  if (below) {
    if (bar.l > p) return null
    return bar.o < p ? bar.o : p
  }
  if (bar.h < p) return null
  return bar.o > p ? bar.o : p
}

/**
 * Which side of the market a price is for an order type: a buy below the
 * market is a limit, above it a stop (and the reverse for a sell) — so a
 * price picked on the chart becomes the right kind of order.
 */
export function orderTypeFor(side: 'buy' | 'sell', price: number, market: number): OrderType {
  const below = price < market
  return (side === 'buy') === below ? 'limit' : 'stop'
}

export interface FillMarker {
  /** Seconds, as the chart's time axis counts. */
  time: number
  position: 'belowBar' | 'aboveBar'
  shape: 'arrowUp' | 'arrowDown'
  color: string
  text: string
}

/**
 * Entry/exit arrows for the chart: a buy below its bar, a sell above, each
 * on the bar it filled in (the bar opening at or before the fill — which
 * also places it on range bars). Fills after `upTo` (ms, the replay cursor)
 * or before the first bar are not drawn; the result is time-sorted, as the
 * series markers require.
 */
export function fillMarkers(
  fills: ReadonlyArray<Fill>,
  bars: ReadonlyArray<{ t: number }>,
  upTo: number,
  colors: { up: string; dn: string },
  label: (n: number) => string = String,
): FillMarker[] {
  if (!bars.length) return []
  const out: Array<FillMarker & { k: number }> = []
  fills.forEach((f, k) => {
    if (f.t > upTo) return
    let lo = 0
    let hi = bars.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (bars[mid].t <= f.t) lo = mid + 1
      else hi = mid
    }
    if (lo === 0) return
    const buy = f.side === 'buy'
    out.push({
      k,
      time: Math.floor(bars[lo - 1].t / 1000),
      position: buy ? 'belowBar' : 'aboveBar',
      shape: buy ? 'arrowUp' : 'arrowDown',
      color: buy ? colors.up : colors.dn,
      text: (buy ? 'Buy ' : 'Sell ') + Number(f.qty.toPrecision(6)) + ' @ ' + label(f.price),
    })
  })
  out.sort((a, b) => a.time - b.time || a.k - b.k)
  return out.map(({ k: _k, ...m }) => m)
}
