// Zone heading for the dashboard.
//
// The Radar tab is a long column of cards; without labelled groups it reads as
// one undifferentiated list. These split it into what you look at first (the
// price), what you trade on (the chart), what you reason with (the analytics)
// and what the rest of the market is doing.
type Zone = 'overview' | 'chart' | 'analytics' | 'flow'

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function ZoneIcon({ zone }: { zone: Zone }) {
  const p = { width: 16, height: 16, viewBox: '0 0 24 24', 'aria-hidden': true as const }
  if (zone === 'overview')
    return (
      <svg {...p} style={{ color: 'var(--primary)' }}>
        <circle cx="12" cy="12" r="8.2" {...S} />
        <circle cx="12" cy="12" r="3.1" {...S} />
        <path d="M12 3.8v-1.6M12 21.8v-1.6M3.8 12H2.2M21.8 12h-1.6" {...S} />
      </svg>
    )
  if (zone === 'chart')
    return (
      <svg {...p} style={{ color: 'var(--primary)' }}>
        <path d="M3 18.5 8.5 12l4 3.6L21 5.5" {...S} />
        <path d="M15.4 5.5H21v5.6" {...S} />
      </svg>
    )
  if (zone === 'analytics')
    return (
      <svg {...p} style={{ color: 'var(--purple)' }}>
        <path d="M12 3.2a8.8 8.8 0 1 1-8.8 8.8" {...S} />
        <path d="M12 3.2V12l6.2 6.2" {...S} />
      </svg>
    )
  return (
    <svg {...p} style={{ color: 'var(--cyan)' }}>
      <path d="M3.5 16.5c3-5.5 6-5.5 9 0s6 5.5 9 0" {...S} />
      <path d="M3.5 9c3-5.5 6-5.5 9 0s6 5.5 9 0" {...S} opacity="0.55" />
    </svg>
  )
}

export function DashHead({ zone, name, sub }: { zone: Zone; name: string; sub: string }) {
  return (
    <div className="dash-head">
      <span className="dash-ico">
        <ZoneIcon zone={zone} />
      </span>
      <span className="dash-txt">
        <span className="dash-name">{name}</span>
        <span className="dash-sub">{sub}</span>
      </span>
      <span className="dash-rule" />
    </div>
  )
}
