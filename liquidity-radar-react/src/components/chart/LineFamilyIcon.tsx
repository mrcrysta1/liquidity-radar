// Picker miniatures for the line styles added on top of Line / Area /
// Baseline: line with markers, step line and HLC area. Drawn in the same
// 24x24 grid and palette as the rest of ChartStylePicker's icons.
import type { ChartStyleId } from '../../features/charts/chartStyle'

const UP = 'var(--green)'
const DN = 'var(--red)'
const PRI = 'var(--primary)'

/** The icon for `id`, or null when it is not one of these styles. */
export function LineFamilyIcon({ id, size = 16 }: { id: ChartStyleId; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const }
  if (id === 'linemarkers') {
    const pts: Array<[number, number]> = [
      [3, 17],
      [8, 11],
      [12, 15],
      [16, 7],
      [21, 12],
    ]
    return (
      <svg {...p}>
        <path
          d="M3 17l5-6 4 4 4-8 5 5"
          fill="none"
          stroke={PRI}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {pts.map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="2" fill={PRI} />
        ))}
      </svg>
    )
  }
  if (id === 'stepline') {
    return (
      <svg {...p}>
        <path
          d="M3 17h4v-6h5v4h4V7h5"
          fill="none"
          stroke={PRI}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (id === 'hlcarea') {
    return (
      <svg {...p}>
        {/* High band (close up to high) and low band (close down to low). */}
        <path d="M3 10L8 5L12 8L16 3L21 7L21 13L16 11L12 15L8 12L3 14Z" fill={UP} opacity=".24" />
        <path
          d="M3 14L8 12L12 15L16 11L21 13L21 16L16 13L12 18L8 15L3 18Z"
          fill={DN}
          opacity=".24"
        />
        <path d="M3 10L8 5L12 8L16 3L21 7" fill="none" stroke={UP} strokeWidth="1" />
        <path d="M3 18L8 15L12 18L16 13L21 16" fill="none" stroke={DN} strokeWidth="1" />
        <path
          d="M3 14L8 12L12 15L16 11L21 13"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  return null
}
