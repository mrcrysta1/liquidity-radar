// Axis-label helper for the dashboard charts (kept apart from the chart
// components so those files export components only).

/** Round, readable axis labels for a price series. */
export function priceTicks(values: number[], n = 4): string[] {
  const pts = values.filter((v) => isFinite(v))
  if (!pts.length) return []
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const fmt = (v: number) =>
    v >= 1000
      ? (v / 1000).toFixed(v >= 100_000 ? 0 : 1).replace(/\.0$/, '') + 'K'
      : v >= 1
        ? v.toFixed(2)
        : v.toPrecision(3)
  return Array.from({ length: n }, (_, i) => fmt(hi - (i / (n - 1)) * (hi - lo)))
}
