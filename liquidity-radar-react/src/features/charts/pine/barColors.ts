// Pine barcolor(): recolours the main chart's candles.
//
// The Pine drawings layer (./overlay) collects every visible script's
// barcolor per bar time and hands it here; the chart (chartRender) passes
// its price-series data through withPineBarColors on the way to the series,
// and repaints when the colours change (onPineBarColors). Only the candle
// and bar styles take per-bar colours; line, area and the custom styles
// ignore them, as TradingView's do.

type Any = any

/** Bar open time (seconds, the series' time) → colour. */
let colors = new Map<number, string>()
let sig = ''
const subs = new Set<() => void>()

const STYLES = new Set(['candle', 'hollow', 'heikin', 'bar', 'hlc'])

/** Repaint the price series when the colours change. */
export function onPineBarColors(fn: () => void): () => void {
  subs.add(fn)
  return () => subs.delete(fn)
}

/** The colours by bar time (ms); an empty map clears them. */
export function setPineBarColors(next: Map<number, string>): void {
  let s = String(next.size)
  // The signature: every entry, cheap next to a setData of the whole series.
  for (const [t, c] of next) s += '|' + t + c
  if (s === sig) return
  sig = s
  colors = new Map()
  for (const [t, c] of next) colors.set(Math.floor(t / 1000), c)
  subs.forEach((fn) => fn())
}

/** Price-series data with Pine's bar colours applied (as is when there are none). */
export function withPineBarColors<T>(items: T[], style: string): T[] {
  if (!colors.size || !STYLES.has(style)) return items
  return items.map((d) => {
    const c = colors.get((d as Any).time)
    if (!c) return d
    // Hollow candles keep their rising bodies empty.
    const hollowUp = style === 'hollow' && (d as Any).close >= (d as Any).open
    return { ...d, color: hollowUp ? 'rgba(0,0,0,0)' : c, borderColor: c, wickColor: c }
  })
}
