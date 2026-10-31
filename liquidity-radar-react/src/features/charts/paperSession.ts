// The paper-trading session behind the replay bar's Buy / Sell / Flatten.
//
// The maths is the pure engine in ./paperTrading; this module holds the one
// live book, fills it at the replay bar's close (the price the user is
// looking at — never a bar they cannot see yet) and tells the UI and the
// chart's position line when it changes. A new replay session starts a fresh
// book, as TradingView's replay trading does; the last session's trades stay
// readable until then.
import { state } from '../../services/store'
import { isSelecting, replayInfo, subscribeReplay, visibleCandles } from './replay'
import { countAtOrBefore } from './replayMath'
import { buy, emptyBook, flatten, orderFill, sell, summary } from './paperTrading'
import type { Book, OrderType, Summary, WorkingOrder } from './paperTrading'

let book: Book = emptyBook()
let qty = 1
/** Limit / stop orders resting on the chart until a bar trades through them. */
let orders: WorkingOrder[] = []
let orderSeq = 0
/** The order ticket: Buy / Sell send this kind of order at this price. */
let ticketType: 'market' | OrderType = 'market'
let ticketPrice = 0
/** The next chart click sets the ticket price ("trade from chart"). */
let picking = false
/** The symbol the book was traded on: a different market's bars must not mark it. */
let bookSym = ''

type Listener = () => void
const listeners = new Set<Listener>()
export function subscribePaper(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function emit(): void {
  listeners.forEach((fn) => fn())
}

// Replay switched on: a fresh session. Every replay change also moves the
// mark price, so the P&L read-outs follow the tape.
let wasOn = false
subscribeReplay(() => {
  const on = replayInfo().on
  if (on && !wasOn) {
    book = emptyBook()
    orders = []
    bookSym = String(state.symbol || '')
  }
  if (!on) picking = false
  wasOn = on
  fillWorking()
  emit()
})

/** The bar fills happen on: the replay cursor, or null while there is none. */
function fillBar(): { t: number; c: number } | null {
  const r = replayInfo()
  if (!r.on || isSelecting() || !r.at) return null
  if (String(state.symbol || '') !== bookSym) return null
  return r.at
}

/** Whether an order would fill right now (replay on, a bar picked). */
export function canTrade(): boolean {
  return fillBar() != null
}

export function paperBook(): Book {
  return book
}

/** The price the open position is marked at, or null with nothing to mark. */
export function markPrice(): number | null {
  return fillBar()?.c ?? null
}

export function paperSummary(): Summary {
  return summary(book, markPrice() ?? book.avg)
}

export function paperQty(): number {
  return qty
}
export function setPaperQty(n: number): void {
  if (Number.isFinite(n) && n > 0) qty = n
  emit()
}

/**
 * Fill every working order a bar after its own has traded through, oldest
 * order first, at the price orderFill gives. The bar in progress counts as
 * far as it has formed, so an update-interval replay fills mid-bar.
 */
function fillWorking(): void {
  if (!orders.length || !fillBar()) return
  const bars = visibleCandles()
  const left: WorkingOrder[] = []
  for (const o of orders) {
    let hit: { price: number; t: number } | null = null
    for (let i = countAtOrBefore(bars, o.t); i < bars.length && !hit; i++) {
      const px = orderFill(o, bars[i])
      if (px != null) hit = { price: px, t: bars[i].t }
    }
    if (!hit) left.push(o)
    else book = o.side === 'buy' ? buy(book, o.qty, hit.price, hit.t) : sell(book, o.qty, hit.price, hit.t)
  }
  orders = left
}

function send(side: 'buy' | 'sell'): void {
  const b = fillBar()
  if (!b) return
  if (ticketType !== 'market' && ticketPrice > 0) {
    orders = orders.concat({ id: ++orderSeq, side, type: ticketType, price: ticketPrice, qty, t: b.t })
  } else book = side === 'buy' ? buy(book, qty, b.c, b.t) : sell(book, qty, b.c, b.t)
  emit()
}
export function paperBuy(): void {
  send('buy')
}
export function paperSell(): void {
  send('sell')
}

export function workingOrders(): WorkingOrder[] {
  return orders
}
export function cancelOrder(id: number): void {
  orders = orders.filter((o) => o.id !== id)
  emit()
}
export function cancelAllOrders(): void {
  orders = []
  emit()
}
export function orderTicket(): { type: 'market' | OrderType; price: number; picking: boolean } {
  return { type: ticketType, price: ticketPrice, picking }
}
export function setTicketType(t: 'market' | OrderType): void {
  ticketType = t === 'limit' || t === 'stop' ? t : 'market'
  // A fresh limit/stop starts at the price on screen.
  if (ticketType !== 'market' && !(ticketPrice > 0)) ticketPrice = markPrice() ?? 0
  emit()
}
export function setTicketPrice(p: number): void {
  if (Number.isFinite(p) && p > 0) ticketPrice = p
  emit()
}
/** Arm (or disarm) picking the ticket price with the next click on the chart. */
export function setPickingPrice(on: boolean): void {
  picking = on && canTrade()
  emit()
}
export function isPickingPrice(): boolean {
  return picking && canTrade()
}
/** A chart click while picking: that price becomes the ticket's (a limit if it was market). */
export function pickPrice(p: number): void {
  picking = false
  if (Number.isFinite(p) && p > 0) {
    ticketPrice = p
    if (ticketType === 'market') ticketType = 'limit'
  }
  emit()
}
export function paperFlatten(): void {
  const b = fillBar()
  if (!b) return
  book = flatten(book, b.c, b.t)
  emit()
}
export function resetPaper(): void {
  book = emptyBook()
  orders = []
  bookSym = String(state.symbol || '')
  emit()
}
