// Chart-style picker: an icon button that opens a list of styles, each drawn
// as a small coloured preview of what it puts on the chart. No text label on
// the trigger — the icon is the label, and hovering names it.
import { useEffect, useRef, useState } from 'react'
import {
  CHART_STYLES,
  getChartStyle,
  setChartStyle,
  styleDef,
  subscribeChartStyle,
} from '../../features/charts/chartStyle'
import type { ChartStyleId } from '../../features/charts/chartStyle'

const UP = 'var(--green)'
const DN = 'var(--red)'
const PRI = 'var(--primary)'

/** A miniature of the style, in the palette's own colours. */
function StyleIcon({ id, size = 16 }: { id: ChartStyleId; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const }
  if (id === 'candle' || id === 'hollow') {
    const hollow = id === 'hollow'
    return (
      <svg {...p}>
        <path d="M7.5 3v4M7.5 17v4" stroke={UP} strokeWidth="1.6" strokeLinecap="round" />
        <rect
          x="4.5"
          y="7"
          width="6"
          height="10"
          rx="1"
          fill={hollow ? 'none' : UP}
          stroke={UP}
          strokeWidth="1.6"
        />
        <path d="M16.5 2v5M16.5 15v7" stroke={DN} strokeWidth="1.6" strokeLinecap="round" />
        <rect
          x="13.5"
          y="7"
          width="6"
          height="8"
          rx="1"
          fill={hollow ? 'none' : DN}
          stroke={DN}
          strokeWidth="1.6"
        />
      </svg>
    )
  }
  if (id === 'bar') {
    return (
      <svg {...p}>
        <path
          d="M7.5 3v18M7.5 7H4M7.5 14h3.5"
          stroke={UP}
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path
          d="M16.5 3v18M16.5 8h-3.5M16.5 16H20"
          stroke={DN}
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    )
  }
  if (id === 'line') {
    return (
      <svg {...p}>
        <path
          d="M3 17l5-6 4 4 4-8 5 5"
          fill="none"
          stroke={PRI}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (id === 'area') {
    const gid = 'ar' + size
    return (
      <svg {...p}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PRI} stopOpacity="0.55" />
            <stop offset="100%" stopColor={PRI} stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <path d="M3 17l5-6 4 4 4-8 5 5v9H3z" fill={`url(#${gid})`} />
        <path
          d="M3 17l5-6 4 4 4-8 5 5"
          fill="none"
          stroke={PRI}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (id === 'volcandle') {
    return (
      <svg {...p}>
        <path d="M5 4v3M5 15v5" stroke={UP} strokeWidth="1.4" strokeLinecap="round" />
        <rect x="3.5" y="7" width="3" height="8" fill={UP} />
        <path d="M12 2v4M12 16v6" stroke={DN} strokeWidth="1.4" strokeLinecap="round" />
        <rect x="8.5" y="6" width="7" height="10" fill={DN} />
        <path d="M19.5 5v3M19.5 14v5" stroke={UP} strokeWidth="1.4" strokeLinecap="round" />
        <rect x="18" y="8" width="3.2" height="6" fill={UP} />
      </svg>
    )
  }
  if (id === 'footprint') {
    return (
      <svg {...p}>
        <rect x="3" y="4" width="8" height="16" fill="none" stroke={DN} strokeWidth="1.2" />
        <rect x="13" y="4" width="8" height="16" fill="none" stroke={UP} strokeWidth="1.2" />
        <path d="M3 9h8M3 14h8M13 9h8M13 14h8" stroke="var(--dim)" strokeWidth="1" />
        <rect x="4" y="5" width="3" height="3" fill={DN} opacity=".55" />
        <rect x="7" y="10" width="3.5" height="3" fill={UP} opacity=".55" />
        <rect x="14" y="15" width="4" height="3" fill={UP} opacity=".55" />
      </svg>
    )
  }
  if (id === 'tpo') {
    return (
      <svg {...p}>
        <rect x="3" y="4" width="4" height="3" fill="var(--cyan)" opacity=".75" />
        <rect x="3" y="8" width="8" height="3" fill="var(--cyan)" opacity=".75" />
        <rect x="3" y="12" width="13" height="3" fill="var(--purple)" opacity=".75" />
        <rect x="3" y="16" width="7" height="3" fill="var(--purple)" opacity=".75" />
      </svg>
    )
  }
  if (id === 'sessionvp') {
    return (
      <svg {...p}>
        <rect x="3" y="5" width="5" height="2.6" fill="var(--cyan)" opacity=".6" />
        <rect x="3" y="9" width="10" height="2.6" fill="var(--amber)" opacity=".85" />
        <rect x="3" y="13" width="6" height="2.6" fill="var(--cyan)" opacity=".6" />
        <rect x="3" y="17" width="3" height="2.6" fill="var(--cyan)" opacity=".6" />
        <path d="M17 3v18M20.5 6v12" stroke={UP} strokeWidth="1.5" strokeLinecap="round" />
        <rect x="15.8" y="8" width="2.4" height="7" fill={UP} />
      </svg>
    )
  }
  // baseline
  const gid = 'bl' + size
  return (
    <svg {...p}>
      <defs>
        <linearGradient id={gid + 'u'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={UP} stopOpacity="0.5" />
          <stop offset="100%" stopColor={UP} stopOpacity="0.03" />
        </linearGradient>
        <linearGradient id={gid + 'd'} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor={DN} stopOpacity="0.5" />
          <stop offset="100%" stopColor={DN} stopOpacity="0.03" />
        </linearGradient>
      </defs>
      <path d="M3 12h7l3-6 3 4 5-3v5H3z" fill={`url(#${gid}u)`} />
      <path d="M3 12h7l3 6 3-4 5 3v-5H3z" fill={`url(#${gid}d)`} />
      <path d="M2.5 12h19" stroke="var(--dim)" strokeWidth="1" strokeDasharray="2 2" />
      <path
        d="M3 12h7l3-6 3 4 5-3"
        fill="none"
        stroke={UP}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ChartStylePicker() {
  const [, force] = useState(0)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeChartStyle(() => force((n) => n + 1)), [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Capture phase, so the engine's global Escape does not also fire.
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('keydown', onEsc, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onEsc, true)
    }
  }, [open])

  const current = getChartStyle()
  const def = styleDef(current)

  return (
    <div className="style-picker" ref={wrapRef}>
      <button
        type="button"
        className={'chart-tool-btn style-btn' + (open ? ' open' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={'Chart style: ' + def.name}
        onClick={() => setOpen((o) => !o)}
      >
        <StyleIcon id={current} size={17} />
        <svg viewBox="0 0 24 24" width="9" height="9" className="style-caret" aria-hidden="true">
          <path
            d="m6 9 6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="style-tip">{def.name}</span>
      </button>

      {open && (
        <div className="style-menu" role="menu" aria-label="Chart style">
          {CHART_STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="menuitemradio"
              aria-checked={s.id === current}
              className={'style-opt' + (s.id === current ? ' sel' : '')}
              onClick={() => {
                setChartStyle(s.id)
                setOpen(false)
              }}
            >
              <span className="style-opt-ico">
                <StyleIcon id={s.id} size={18} />
              </span>
              <span className="style-opt-text">
                <b>
                  {s.name}
                  {s.estimate && (
                    <i
                      className="style-est"
                      title="Built from a model of where volume traded inside each bar"
                    >
                      est
                    </i>
                  )}
                </b>
                <small>{s.hint}</small>
              </span>
              {s.id === current && (
                <svg
                  viewBox="0 0 24 24"
                  width="13"
                  height="13"
                  className="style-tick"
                  aria-hidden="true"
                >
                  <path
                    d="m5 13 4 4 10-10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
