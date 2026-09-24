// Plots large ("whale") prints directly on the price chart as sized markers.
// Two sources feed this, merged and deduped:
//  - state.whales: the REST poll (services/marketData.ts fetchWhales),
//    $50k+ prints, refreshed every 10s — same feed the Whale Tape side panel
//    already uses.
//  - getLiveWhales(): real-time detection straight off the aggTrade stream
//    (features/delta/liveWhales.ts), threshold relative to the symbol's own
//    recent trade size — catches prints between REST refreshes and scales to
//    low- and high-volume symbols alike.
import { state } from '../../services/store'
import { cfmt } from '../../utils/format'
import { getShowWhaleBubbles } from './overlayToggles'
import { getLiveWhales, onLiveWhalesChange } from '../delta/liveWhales'

type Any = any

interface WhalePrint {
  maker?: boolean
  usd: number
  price: number
  qty: number
  time: number
}

let candleSeries: Any = null
export function attachWhaleBubbles(series: Any): void {
  candleSeries = series
}

/** Live updates repaint the chart directly rather than waiting for the next
 * full redraw, so a fresh print appears within a frame of the tick. */
export function watchLiveWhales(): () => void {
  return onLiveWhalesChange(renderWhaleBubbles)
}

// Marker "size" on lightweight-charts isn't continuous, so the $ notional is
// bucketed into a few visual tiers instead — bigger prints get a taller
// marker (via size) rather than a genuinely scaled bubble.
function tier(usd: number): 1 | 2 | 3 {
  if (usd >= 500_000) return 3
  if (usd >= 150_000) return 2
  return 1
}

function clearMarkers(): void {
  try {
    candleSeries.setMarkers([])
  } catch (e) {
    /* series not ready */
  }
}

export function renderWhaleBubbles(): void {
  if (!candleSeries) return
  if (!getShowWhaleBubbles()) {
    clearMarkers()
    return
  }
  const rest = (state.whales as WhalePrint[]) || []
  const live = getLiveWhales()
  // Merge, deduping prints the REST poll and the live tape both caught
  // (same side, price within a hair, timestamps within 2s of each other).
  const merged: WhalePrint[] = rest.map((w) => ({ ...w }))
  live.forEach((w) => {
    const dup = merged.find(
      (m) =>
        Math.abs(m.time - w.t) < 2000 &&
        Math.abs(m.price - w.price) < w.price * 0.0001 &&
        !!m.maker === (w.side === 'sell'),
    )
    if (dup) return
    merged.push({ maker: w.side === 'sell', usd: w.value, price: w.price, qty: w.qty, time: w.t })
  })
  if (!merged.length) {
    clearMarkers()
    return
  }
  const markers = merged
    .sort((a, b) => b.time - a.time)
    .slice(0, 60)
    .map((w) => {
      const buy = !w.maker
      const t = tier(w.usd)
      return {
        time: Math.floor(w.time / 1000),
        position: buy ? 'belowBar' : 'aboveBar',
        color: buy ? 'rgba(0,230,118,.9)' : 'rgba(255,23,68,.9)',
        shape: buy ? 'arrowUp' : 'arrowDown',
        size: t,
        text: cfmt(w.usd),
      }
    })
    // lightweight-charts requires markers sorted ascending by time.
    .sort((a, b) => a.time - b.time)
  try {
    candleSeries.setMarkers(markers)
  } catch (e) {
    /* series not ready / candle times not loaded yet */
  }
}
