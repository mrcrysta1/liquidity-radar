// Real-time large-print detection from the aggTrade stream, filling the gap
// between the REST whale poll's 10s refreshes (see state.whales in
// services/marketData.ts). Threshold is relative — a multiple of this
// symbol's own recent average trade size — rather than one fixed dollar
// figure, so it means roughly the same thing on a micro-cap and on BTC.
export interface LiveWhale {
  id: string
  t: number
  price: number
  qty: number
  value: number
  side: 'buy' | 'sell'
}

const WINDOW = 300
const MAX_KEEP = 60
let mult = 10

let symbol = 'BTCUSDT'
let recentNotional: number[] = []
let live: LiveWhale[] = []
let seq = 0

type Listener = () => void
const listeners: Listener[] = []
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}
export function onLiveWhalesChange(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

export function getLiveWhales(): LiveWhale[] {
  return live
}

export function getWhaleMultiplier(): number {
  return mult
}
export function setWhaleMultiplier(m: number): void {
  mult = Math.max(3, Math.min(50, m))
}

export function resetLiveWhales(sym: string): void {
  symbol = sym
  recentNotional = []
  live = []
  emit()
}

export function ingestForWhaleDetection(
  sym: string,
  price: number,
  qty: number,
  isBuyerMaker: boolean,
): void {
  if (sym !== symbol || !(price > 0) || !(qty > 0)) return
  const value = price * qty
  recentNotional.push(value)
  if (recentNotional.length > WINDOW) recentNotional.shift()
  // Need a settled sample first, otherwise the opening trades of a fresh
  // session would all look "huge" against an empty average.
  if (recentNotional.length < 30) return
  const avg = recentNotional.reduce((a, b) => a + b, 0) / recentNotional.length
  if (value < avg * mult) return
  live.push({
    id: 'lw' + seq++,
    t: Date.now(),
    price,
    qty,
    value,
    side: isBuyerMaker ? 'sell' : 'buy',
  })
  if (live.length > MAX_KEEP) live.shift()
  emit()
}
