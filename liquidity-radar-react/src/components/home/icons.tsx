// Duotone card icons for the dashboard — each area has its own colour, as in
// the reference design, with a soft fill behind a crisp stroke. Colours come
// from the theme tokens so light mode gets its deeper variants.
export type HomeIconId =
  | 'radar'
  | 'signals'
  | 'liquidity'
  | 'movers'
  | 'venues'
  | 'liqs'
  | 'sentiment'
  | 'news'
  | 'star'
  | 'overview'
  | 'heatmap'
  | 'flow'
  | 'whale'
  | 'bubbles'
  | 'calendar'

const COLOR: Record<HomeIconId, string> = {
  radar: 'var(--primary)',
  signals: 'var(--cyan)',
  liquidity: 'var(--cyan)',
  movers: 'var(--primary)',
  venues: 'var(--amber)',
  liqs: 'var(--red)',
  sentiment: 'var(--amber)',
  news: 'var(--green)',
  star: 'var(--amber)',
  overview: 'var(--green)',
  heatmap: 'var(--green)',
  flow: 'var(--cyan)',
  whale: 'var(--cyan)',
  bubbles: 'var(--purple)',
  calendar: 'var(--green)',
}

export function HomeIcon({ id, size = 20 }: { id: HomeIconId; size?: number }) {
  const c = COLOR[id]
  const s = {
    fill: 'none',
    stroke: c,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const f = { fill: c, fillOpacity: 0.22, stroke: 'none' }
  let body
  switch (id) {
    case 'radar':
      body = (
        <>
          <circle cx="12" cy="12" r="9" {...s} />
          <circle cx="12" cy="12" r="5" {...s} strokeOpacity=".6" />
          <path d="M12 12 L12 3 A9 9 0 0 1 20.5 9 Z" {...f} fillOpacity={0.45} />
          <path d="M12 12 20.5 9" {...s} />
          <circle cx="16" cy="7.5" r="1.4" fill="var(--green)" />
        </>
      )
      break
    case 'signals':
      body = (
        <>
          <path d="M12 13v8" {...s} />
          <circle cx="12" cy="11" r="2.4" {...f} fillOpacity={0.5} />
          <path
            d="M7.8 6.8a6 6 0 0 0 0 8.4M16.2 6.8a6 6 0 0 1 0 8.4M5 4a10 10 0 0 0 0 14M19 4a10 10 0 0 1 0 14"
            {...s}
          />
        </>
      )
      break
    case 'liquidity':
      body = (
        <>
          <path
            d="M12 3c4 5 6.5 7.6 6.5 11a6.5 6.5 0 0 1-13 0C5.5 10.6 8 8 12 3Z"
            {...f}
            fillOpacity={0.35}
          />
          <path d="M12 3c4 5 6.5 7.6 6.5 11a6.5 6.5 0 0 1-13 0C5.5 10.6 8 8 12 3Z" {...s} />
          <path d="M9 15.5a3 3 0 0 0 3 3" {...s} />
        </>
      )
      break
    case 'movers':
      body = (
        <>
          <path
            d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.7 2.5-5 .3 1.6 1 2.4 2 2.8C11 8.6 11 6 12 3Z"
            {...f}
            fillOpacity={0.4}
          />
          <path
            d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-3.7 2.5-5 .3 1.6 1 2.4 2 2.8C11 8.6 11 6 12 3Z"
            {...s}
          />
        </>
      )
      break
    case 'venues':
      body = (
        <>
          <circle cx="12" cy="12" r="9" {...f} />
          <path d="M7 10h9.5l-2.5-2.5M17 14H7.5l2.5 2.5" {...s} />
        </>
      )
      break
    case 'liqs':
      body = (
        <>
          <path d="M5 20V12M10 20V7M15 20v-6M20 20V4" {...s} strokeWidth={2.6} />
          <path d="M3 20h18" {...s} strokeOpacity=".5" />
        </>
      )
      break
    case 'sentiment':
      body = (
        <>
          <rect x="4" y="4" width="16" height="16" rx="4" {...f} />
          <rect x="4" y="4" width="16" height="16" rx="4" {...s} />
          <path d="M8 14.5h8M8 10h3M13 10h3" {...s} />
        </>
      )
      break
    case 'news':
      body = (
        <>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...f} />
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" {...s} />
          <path d="M7 9h10M7 12.5h10M7 16h6" {...s} />
        </>
      )
      break
    case 'star':
      body = (
        <>
          <path
            d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"
            {...f}
            fillOpacity={0.5}
          />
          <path
            d="m12 3.5 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"
            {...s}
          />
        </>
      )
      break
    case 'overview':
      body = (
        <>
          <path d="M4 20h16" {...s} strokeOpacity=".5" />
          <path d="M4 16l4.5-4.5 3.5 3 7-7.5" {...s} />
          <path d="M15 7h4v4" {...s} />
        </>
      )
      break
    case 'heatmap':
      body = (
        <>
          <circle cx="12" cy="12" r="8.5" {...f} />
          <circle cx="12" cy="12" r="8.5" {...s} />
          <circle cx="12" cy="12" r="4.5" {...s} strokeOpacity=".7" />
          <circle cx="12" cy="12" r="1.2" fill={c} />
        </>
      )
      break
    case 'flow':
      body = <path d="M12 3v14M7 12l5 5 5-5M5 21h14" {...s} />
      break
    case 'whale':
      body = (
        <>
          <path
            d="M3 13c0 4 3.5 6 8 6 5 0 9-3 9-8 0-1 .5-2 1.5-2.5-1.4-.5-2.6.2-3.2 1.2C17 8 14 7 11 7 6.5 7 3 9.5 3 13Z"
            {...f}
            fillOpacity={0.35}
          />
          <path
            d="M3 13c0 4 3.5 6 8 6 5 0 9-3 9-8 0-1 .5-2 1.5-2.5-1.4-.5-2.6.2-3.2 1.2C17 8 14 7 11 7 6.5 7 3 9.5 3 13Z"
            {...s}
          />
          <circle cx="8" cy="12" r="1" fill={c} />
        </>
      )
      break
    case 'bubbles':
      body = (
        <>
          <circle cx="9" cy="10" r="5" {...f} />
          <circle cx="9" cy="10" r="5" {...s} />
          <circle cx="16.5" cy="15.5" r="3.5" {...s} />
          <circle cx="17" cy="6" r="2" {...s} />
        </>
      )
      break
    case 'calendar':
      body = (
        <>
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" {...f} />
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" {...s} />
          <path d="M3.5 10h17M8 3v4M16 3v4" {...s} />
        </>
      )
      break
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      {body}
    </svg>
  )
}
