// The Liquidity Radar mark, as vector: a radar scope — two range rings and a
// crosshair — with an ember sweep trailing its beam, and a green return where
// the beam has just found liquidity. Colours come from the theme tokens, so
// the mark follows the palette, and it stays crisp from favicon size up.
import { useId } from 'react'

export function LogoMark({ size = 32, animated = false }: { size?: number; animated?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg
      className={'logo-mark' + (animated ? ' is-live' : '')}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Liquidity Radar"
    >
      <defs>
        <linearGradient id={id + 'bg'} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--logo-bg-1, #1A1410)" />
          <stop offset="1" stopColor="var(--logo-bg-2, #0B0D10)" />
        </linearGradient>
        <radialGradient id={id + 'sw'} cx="24" cy="24" r="17" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--primary, #FF7A1A)" stopOpacity=".95" />
          <stop offset="1" stopColor="var(--primary, #FF7A1A)" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id + 'clip'}>
          <circle cx="24" cy="24" r="17" />
        </clipPath>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="13" fill={`url(#${id}bg)`} />
      <rect
        x="1.5"
        y="1.5"
        width="45"
        height="45"
        rx="12.5"
        fill="none"
        stroke="var(--primary, #FF7A1A)"
        strokeOpacity=".45"
      />
      <g fill="none" stroke="var(--logo-ring, #FFB27A)" strokeOpacity=".5" strokeWidth="1.4">
        <circle cx="24" cy="24" r="17" />
        <circle cx="24" cy="24" r="10.5" />
        <path d="M24 7v34M7 24h34" strokeOpacity=".22" strokeWidth="1" />
      </g>
      {/* The sweep: a 70° wedge fading back from the beam. */}
      <g clipPath={`url(#${id}clip)`} className="logo-sweep">
        <path d="M24 24 L24 7 A17 17 0 0 1 40 18.2 Z" fill={`url(#${id}sw)`} opacity=".85" />
        <path
          d="M24 24 L40 18.2"
          stroke="var(--primary, #FF7A1A)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      {/* A return: liquidity found. */}
      <circle cx="31.5" cy="15.5" r="2.6" fill="var(--green, #16C784)" className="logo-blip" />
      <circle
        cx="31.5"
        cy="15.5"
        r="5"
        fill="none"
        stroke="var(--green, #16C784)"
        strokeOpacity=".45"
        className="logo-blip-ring"
      />
      <circle cx="24" cy="24" r="2.2" fill="var(--primary, #FF7A1A)" />
    </svg>
  )
}
