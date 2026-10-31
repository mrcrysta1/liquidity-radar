// The live footprint book and the lookup the footprint renderer uses.
//
// Kept apart from the stream wiring (./orderflow) so the renderer in
// series/customSeries — which the unit tests import under Node — reaches
// the book without pulling the store or the sockets in with it.
//
// The renderer only knows a bar's time and prices, not which chart it is on,
// and the footprint style is also drawn by the layout's companion cells
// (other symbols, other intervals). So a recorded bar is only used when it
// demonstrably belongs to the bar being drawn: same open time, same interval
// as its neighbours, and every recorded trade inside the bar's high-low.
import {
  barCoverage,
  createFootprintBook,
  rebucket,
  type FootprintBook,
  type FpRow,
} from './footprintBook.ts'

export const liveFootprint: FootprintBook = createFootprintBook()

export interface RealFootprint {
  rows: FpRow[]
  coverage: 'real' | 'partial'
}

export function realFootprint(
  bar: { ms: number; low: number; high: number },
  prevMs: number | null,
  nextMs: number | null,
  rows: number,
  book: FootprintBook = liveFootprint,
): RealFootprint | null {
  const fb = book.bars.get(bar.ms)
  if (!fb || !(fb.vol > 0)) return null
  const len = fb.end - fb.start
  if (nextMs != null) {
    if (nextMs !== fb.end) return null
  } else if (prevMs != null) {
    // Calendar months differ by a few days; anything else must match exactly.
    if (Math.abs(bar.ms - prevMs - len) > len * 0.12) return null
  }
  // The live candle's high/low follow trades a frame behind (streams paints
  // on rAF), so a little slack keeps the forming bar from flickering.
  const tol = (bar.high - bar.low) * 0.05 + bar.high * 1e-6
  if (fb.lo < bar.low - tol || fb.hi > bar.high + tol) return null
  return { rows: rebucket(fb, bar.low, bar.high, rows), coverage: barCoverage(book, fb) }
}
