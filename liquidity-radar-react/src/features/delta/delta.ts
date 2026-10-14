// Aggressor-side delta (buy vs sell taker volume / "CVD"), built from the
// same @aggTrade stream the tape already consumes. Binance's aggTrade `m`
// flag is `isBuyerMaker`: when true the taker (aggressor) was a seller
// hitting a resting bid, so that trade counts as sell volume; when false the
// taker bought, so it counts as buy volume. This is the standard CVD
// definition for a single venue's tape, not exchange-wide net flow.
//
// Large-print ("whale") detection already exists — see state.whales in
// services/marketData.ts (REST-polled, $50k+ prints) — this module only adds
// the delta series; the chart panel reuses state.whales for bubbles instead
// of tracking large trades a second time.

export interface DeltaBar {
  /** Candle bucket start, ms — aligned 1:1 with state.candles[i].t */
  t: number
  buyVol: number
  sellVol: number
  delta: number
}

type Listener = () => void
const listeners: Listener[] = []
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}
export function onDeltaChange(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

const MAX_BARS = 2000

// Matches state.symbol's default so ticks landing before the first
// setSymbol() call (i.e. for the initial BTCUSDT session) aren't dropped.
let symbol = 'BTCUSDT'
let bars: DeltaBar[] = []
const byBucket = new Map<number, DeltaBar>()
// Kept in sync incrementally rather than summed fresh on every call —
// cumulativeDelta() is read from a UI badge that recomputes on every trade
// tick (coalesced to a frame, but still up to ~60x/sec on an active
// market), and re-summing up to MAX_BARS entries that often adds up.
let cvdTotal = 0

export function resetDelta(sym: string): void {
  symbol = sym
  bars = []
  byBucket.clear()
  cvdTotal = 0
  emit()
}

export function getDeltaBars(): DeltaBar[] {
  return bars
}

function bucketFor(t: number): DeltaBar {
  let bar = byBucket.get(t)
  if (bar) return bar
  bar = { t, buyVol: 0, sellVol: 0, delta: 0 }
  byBucket.set(t, bar)
  bars.push(bar)
  if (bars.length > MAX_BARS) {
    const dropped = bars.shift()
    if (dropped) {
      byBucket.delete(dropped.t)
      cvdTotal -= dropped.delta
    }
  }
  return bar
}

/**
 * Feed one aggTrade tick. `bucketStart` is the current candle's bucket start
 * (ms) for whatever timeframe is active, so delta bars stay aligned with the
 * price chart even when the timeframe is resampled.
 */
export function ingestTrade(
  sym: string,
  bucketStart: number,
  qty: number,
  isBuyerMaker: boolean,
): void {
  if (sym !== symbol || !(qty > 0)) return
  const bar = bucketFor(bucketStart)
  if (isBuyerMaker) bar.sellVol += qty
  else bar.buyVol += qty
  bar.delta = bar.buyVol - bar.sellVol
  cvdTotal += isBuyerMaker ? -qty : qty
  emit()
}

/** Sum of delta across all held bars — a quick "net flow" badge. O(1): kept
 * incrementally in sync rather than re-summed on every read. */
export function cumulativeDelta(): number {
  return cvdTotal
}
