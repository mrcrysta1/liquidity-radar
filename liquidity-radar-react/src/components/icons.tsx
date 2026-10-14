// Line icons for the app chrome, drawn on a 24px grid with a 1.8 stroke so
// they sit together as one set. They inherit currentColor.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function Base({ size = 18, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const BellIcon = (p: P) => (
  <Base {...p}>
    <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Base>
)

export const PaletteIcon = (p: P) => (
  <Base {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.8 2-1.8 0-1.3-1.2-1.7-1.2-3 0-1 .8-1.7 1.8-1.7H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.9 16.7 3.5 12 3.5z" />
    <circle cx="7.6" cy="11.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="10.2" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="14.6" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
  </Base>
)

export const SunIcon = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Base>
)

export const MoonIcon = (p: P) => (
  <Base {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </Base>
)

export const SearchIcon = (p: P) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Base>
)
