// The paper-trading session behind the replay bar's Buy / Sell / Flatten.
//
// The maths is the pure engine in ./paperTrading; this module holds the one
// live book, fills it at the replay bar's close (the price the user is
// looking at — never a bar they cannot see yet) and tells the UI and the
// chart's position line when it changes. A new replay session starts a fresh
// book, as TradingView's replay trading does; the last session's trades stay
// readable until then.
import { state } from '../../services/store'
import { isSelecting, replayInfo, subscribeReplay } from './replay'
import { buy, emptyBook, flatten, sell, summary } from './paperTrading'
import type { Book, Summary } from './paperTrading'

let book: Book = emptyBook()
let qty = 1
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
    bookSym = String(state.symbol || '')
  }
  wasOn = on
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

export function paperBuy(): void {
  const b = fillBar()
  if (!b) return
  book = buy(book, qty, b.c, b.t)
  emit()
}
export function paperSell(): void {
  const b = fillBar()
  if (!b) return
  book = sell(book, qty, b.c, b.t)
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
  bookSym = String(state.symbol || '')
  emit()
}
