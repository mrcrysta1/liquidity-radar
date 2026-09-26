// The Liquidity Radar mark, as vector: a round scope in radar green — a
// segmented outer ring, a ticked inner ring, and a glowing core holding the
// radar eye with its sweep arm and a blip where the beam found liquidity.
// Fixed greens rather than theme tokens: the mark is the brand, and it reads
// the same on every palette and in light mode. Crisp from favicon size up.
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
        <radialGradient id={id + 'bg'} cx="24" cy="24" r="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0B2A33" />
          <stop offset="1" stopColor="#061019" />
        </radialGradient>
        <linearGradient id={id + 'ring'} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3DF5C8" />
          <stop offset="1" stopColor="#12B886" />
        </linearGradient>
        <radialGradient id={id + 'core'} cx="21" cy="20" r="12" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7DFFE0" />
          <stop offset="1" stopColor="#19D3A2" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="23.5" fill={`url(#${id}bg)`} />
      {/* Segmented outer ring. */}
      <g fill="none" stroke={`url(#${id}ring)`} strokeWidth="3" strokeLinecap="round">
        <path d="M24 3.5 A20.5 20.5 0 0 1 43.5 18" />
        <path d="M44 24.5 A20.5 20.5 0 0 1 28 43.7" />
        <path d="M22 44.4 A20.5 20.5 0 0 1 3.6 26" />
        <path d="M3.8 21 A20.5 20.5 0 0 1 20 3.9" strokeOpacity=".55" />
      </g>
      {/* Ticked inner ring. */}
      <circle cx="24" cy="24" r="15" fill="none" stroke="#2EE6B8" strokeOpacity=".45" strokeWidth="1.2" />
      <path d="M24 9v3M24 36v3M9 24h3M36 24h3" stroke="#2EE6B8" strokeOpacity=".7" strokeWidth="1.4" strokeLinecap="round" />
      {/* Core with the radar eye. */}
      <circle cx="24" cy="24" r="10.5" fill={`url(#${id}core)`} className="logo-core" />
      <g className="logo-sweep">
        <path d="M24 24 L31.5 16.5" stroke="#062019" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="31.5" cy="16.5" r="2.2" fill="#062019" />
      </g>
      <circle cx="24" cy="24" r="4.6" fill="#062019" />
      <circle cx="24" cy="24" r="2" fill="#7DFFE0" className="logo-blip" />
    </svg>
  )
}
