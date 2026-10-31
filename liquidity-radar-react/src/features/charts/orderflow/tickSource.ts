// The live trade tape behind the Tick chart style, and the bars it draws.
//
// ./orderflow feeds the tape from the aggTrade stream; series/reversalSettings
// asks for bars through tickBarsFor(). Tick bars exist only for the focused
// symbol — the only one with a trade stream — so another source (a layout
// companion's candles, a replay slice) gets no bars rather than this
// symbol's.
import { state } from '../../../services/store'
import type { CandleFlat } from '../../../services/market'
import { buildTickBars, clearTape, createTradeTape, pushTrade } from './tickBars'

const tape = createTradeTape()
let tapeSym = ''

export function recordTick(sym: string, price: number, qty: number, time: number): void {
  if (sym !== tapeSym) {
    // A new coin: its trades must never extend the last one's bars.
    clearTape(tape)
    tapeSym = sym
  }
  pushTrade(tape, price, qty, time)
}

/** Changes whenever the bars would: rangeView keys its memo on it. */
export function tickKey(n: number): string {
  return 'tk' + n + ':' + tapeSym + ':' + tape.total
}

let memoKey = ''
let memo: CandleFlat[] = []
export function tickBarsFor(src: CandleFlat[], n: number): CandleFlat[] {
  if (src !== state.candles || tapeSym !== state.symbol) return []
  const key = tickKey(n)
  if (key !== memoKey) {
    memoKey = key
    memo = buildTickBars(tape, n)
  }
  return memo
}
