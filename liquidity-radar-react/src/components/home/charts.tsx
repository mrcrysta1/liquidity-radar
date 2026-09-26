// Small SVG charts for the dashboard: an area sparkline and a two-sided bar
// chart. Plain SVG, no chart library — they are a few hundred points at most,
// and they stretch to their card through a viewBox.
import { useId } from 'react'

interface AreaProps {
  values: number[]
  /** Stroke/fill colour; defaults to green when the series rose, red when it fell. */
  color?: string
  height?: number
  /** Axis labels: y ticks on the right, x labels underneath. */
  yTicks?: string[]
  xTicks?: string[]
  /** Mark the last point with a dot. */
  dot?: boolean
  className?: string
}

export function AreaChart({
  values,
  color,
  height = 64,
  yTicks,
  xTicks,
  dot,
  className,
}: AreaProps) {
  const id = useId().replace(/:/g, '')
  const pts = values.filter((v) => isFinite(v))
  if (pts.length < 2) return <div className={'hc-empty ' + (className || '')} style={{ height }} />
  const W = 300
  const H = 100
  const lo = Math.min(...pts)
  const hi = Math.max(...pts)
  const span = hi - lo || 1
  const xy = pts.map(
    (v, i) => [(i / (pts.length - 1)) * W, H - 6 - ((v - lo) / span) * (H - 14)] as const,
  )
  const line = xy.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ')
  const up = pts[pts.length - 1] >= pts[0]
  const c = color || (up ? 'var(--green)' : 'var(--red)')
  const [lx, ly] = xy[xy.length - 1]
  return (
    <div className={'hc-area ' + (className || '')}>
      <div className="hc-plot" style={{ height }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={c} stopOpacity=".45" />
              <stop offset="1" stopColor={c} stopOpacity="0" />
            </linearGradient>
          </defs>
          {yTicks &&
            yTicks.map((_, i) => (
              <line
                key={i}
                x1="0"
                x2={W}
                y1={6 + (i / (yTicks.length - 1)) * (H - 14)}
                y2={6 + (i / (yTicks.length - 1)) * (H - 14)}
                className="hc-grid"
              />
            ))}
          <path d={line + ` L${W} ${H} L0 ${H} Z`} fill={`url(#${id})`} />
          <path
            d={line}
            fill="none"
            stroke={c}
            strokeWidth="1.6"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>
        {dot && (
          <i
            className="hc-dot"
            style={{ left: (lx / W) * 100 + '%', top: (ly / H) * 100 + '%', background: c }}
          />
        )}
        {yTicks && (
          <div className="hc-y">
            {yTicks.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
        )}
      </div>
      {xTicks && (
        <div className="hc-x">
          {xTicks.map((t, i) => (
            <span key={t + i}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Paired bars per bucket: longs liquidated (red) and shorts liquidated (green). */
export function PairBars({
  buckets,
  height = 78,
}: {
  buckets: Array<{ long: number; short: number }>
  height?: number
}) {
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.long, b.short)))
  return (
    <div className="hc-bars" style={{ height }} aria-hidden="true">
      {buckets.map((b, i) => (
        <span key={i} className="hc-pair">
          <i className="up" style={{ height: Math.max(2, (b.short / max) * 100) + '%' }} />
          <i className="dn" style={{ height: Math.max(2, (b.long / max) * 100) + '%' }} />
        </span>
      ))}
    </div>
  )
}
