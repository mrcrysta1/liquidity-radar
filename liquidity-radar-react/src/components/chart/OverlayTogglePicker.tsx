// Panes dropdown for the price-action chart: every on/off overlay and side
// pane this session adds — Delta (CVD), whale bubbles, volume profile, MTF
// confluence, book imbalance, ML and RL — grouped behind one rail button the
// way chart style, drawing tools and indicators are.
import { useEffect, useRef, useState } from 'react'
import { CvdBadge } from './CvdBadge'
import {
  getShowConfluence,
  getShowDelta,
  getShowMLPrediction,
  getShowOBGauge,
  getShowRLPolicy,
  getShowVolumeProfile,
  getShowWhaleBubbles,
  onOverlayTogglesChange,
  setShowConfluence,
  setShowDelta,
  setShowMLPrediction,
  setShowOBGauge,
  setShowRLPolicy,
  setShowVolumeProfile,
  setShowWhaleBubbles,
} from '../../features/charts/overlayToggles'

type Pane = {
  id: string
  glyph: string
  name: string
  hint: string
  group: 'On the chart' | 'Panels'
  get: () => boolean
  set: (on: boolean) => void
}

const PANES: Pane[] = [
  {
    id: 'delta',
    glyph: 'Δ',
    name: 'Delta (CVD)',
    hint: 'Taker buy/sell delta pane',
    group: 'On the chart',
    get: getShowDelta,
    set: setShowDelta,
  },
  {
    id: 'whales',
    glyph: '🐋',
    name: 'Whale bubbles',
    hint: 'Large prints marked on the candles',
    group: 'On the chart',
    get: getShowWhaleBubbles,
    set: setShowWhaleBubbles,
  },
  {
    id: 'vp',
    glyph: 'VP',
    name: 'Volume profile',
    hint: 'POC / VAH / VAL levels',
    group: 'On the chart',
    get: getShowVolumeProfile,
    set: setShowVolumeProfile,
  },
  {
    id: 'mtf',
    glyph: 'MTF',
    name: 'MTF confluence',
    hint: 'Trend agreement across timeframes',
    group: 'Panels',
    get: getShowConfluence,
    set: setShowConfluence,
  },
  {
    id: 'ob',
    glyph: 'OB',
    name: 'Book imbalance',
    hint: 'Bid/ask pressure gauge',
    group: 'Panels',
    get: getShowOBGauge,
    set: setShowOBGauge,
  },
  {
    id: 'ml',
    glyph: 'ML',
    name: 'ML direction',
    hint: 'In-browser direction model',
    group: 'Panels',
    get: getShowMLPrediction,
    set: setShowMLPrediction,
  },
  {
    id: 'rl',
    glyph: 'RL',
    name: 'RL policy',
    hint: 'Q-learning trading policy',
    group: 'Panels',
    get: getShowRLPolicy,
    set: setShowRLPolicy,
  },
]

function PanesIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <rect
        x="3.5"
        y="4"
        width="17"
        height="16"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M3.5 13.5h17M13 4v9.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export function OverlayTogglePicker() {
  const [, force] = useState(0)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => onOverlayTogglesChange(() => force((n) => n + 1)), [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Capture phase, so the engine's global Escape (which exits full screen)
      // does not also fire: closing the menu is the whole gesture here.
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

  const onCount = PANES.filter((p) => p.get()).length

  return (
    <div className="panes-picker" ref={wrapRef}>
      <button
        type="button"
        className={'cs-rail-btn panes-btn' + (open ? ' on' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Panes"
        onClick={() => setOpen((o) => !o)}
      >
        <PanesIcon />
        {onCount > 0 && <span className="rail-count">{onCount}</span>}
        <span className="cs-rail-tip">Panes</span>
      </button>

      {open && (
        <div className="panes-menu rail-menu" role="menu" aria-label="Panes">
          <div className="rail-menu-head">
            <span>Panes</span>
            <small>{onCount} on</small>
          </div>
          {(['On the chart', 'Panels'] as const).map((g) => (
            <div key={g}>
              <div className="draw-menu-lbl">{g}</div>
              {PANES.filter((p) => p.group === g).map((p) => {
                const on = p.get()
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    className={'pane-opt' + (on ? ' sel' : '')}
                    onClick={() => p.set(!on)}
                  >
                    <span className="pane-glyph">{p.glyph}</span>
                    <span className="pane-text">
                      <b>
                        {p.name}
                        {p.id === 'delta' && on && <CvdBadge />}
                      </b>
                      <small>{p.hint}</small>
                    </span>
                    <span className={'draw-switch' + (on ? ' on' : '')} aria-hidden="true">
                      <i />
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
