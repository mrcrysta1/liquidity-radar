// Chart-layout picker: an icon button that names itself on hover and opens a
// grid of layout choices, TradingView-style. Each choice's glyph is drawn from
// the same spec that lays out the real grid, so the preview cannot drift from
// what you get.
import { useEffect, useRef, useState } from 'react'
import { LAYOUTS, cells, rowCount } from '../../features/charts/layouts'
import type { LayoutSpec } from '../../features/charts/layouts'
import { getLayout, setLayout, subscribeLayout } from '../../features/charts/companionCharts'
import { isCrosshairSyncOn, setCrosshairSync } from '../../features/charts/crosshairSync'
import { SavedLayouts } from './SavedLayouts'

const GLYPH = 26
const GAP = 1.6

function Glyph({ spec }: { spec: LayoutSpec }) {
  const rows = rowCount(spec)
  const cw = (GLYPH - GAP * (spec.cols - 1)) / spec.cols
  const ch = (GLYPH - GAP * (rows - 1)) / rows
  return (
    <svg viewBox={`0 0 ${GLYPH} ${GLYPH}`} width="19" height="19" aria-hidden="true">
      {cells(spec).map((c, i) => (
        <rect
          key={i}
          x={c.col * (cw + GAP)}
          y={c.row * (ch + GAP)}
          width={cw * c.span + GAP * (c.span - 1)}
          height={ch}
          rx="1.2"
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

export function LayoutPicker() {
  const [, force] = useState(0)
  const [open, setOpen] = useState(false)
  const [syncOn, setSyncOn] = useState(isCrosshairSyncOn)
  const wrapRef = useRef<HTMLDivElement>(null)
  /** Cancels a name edit in the saved-layouts list; true when there was one. */
  const cancelEditRef = useRef<(() => boolean) | null>(null)

  useEffect(() => subscribeLayout(() => force((n) => n + 1)), [])

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
      // Escape while naming a layout cancels the name, not the menu.
      if (cancelEditRef.current?.()) return
      setOpen(false)
    }
    document.addEventListener('keydown', onEsc, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onEsc, true)
    }
  }, [open])

  const current = getLayout()
  const currentSpec = LAYOUTS.find((l) => l.n === current) ?? LAYOUTS[0]

  // The engine's global key handler owns Escape and the letter shortcuts;
  // while this menu is up those keys belong to it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
      wrapRef.current?.querySelector<HTMLElement>('.layout-btn')?.focus()
      return
    }
    e.stopPropagation()
  }

  return (
    <div className="layout-picker" ref={wrapRef}>
      <button
        type="button"
        className={'chart-tool-btn layout-btn' + (open ? ' open' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Chart layout"
        onClick={() => setOpen((o) => !o)}
      >
        {cells(currentSpec).length > 1 ? (
          <Glyph spec={currentSpec} />
        ) : (
          // One chart: its single-cell glyph read as an empty checkbox, so
          // the button shows the split-window icon TradingView uses.
          <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" className="layout-ico">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M12 4.5v15M12 12h8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        )}
        <span className="layout-tip">Chart layout</span>
      </button>

      {open && (
        <div className="layout-menu" onKeyDown={onKeyDown}>
          <div className="layout-menu-head">
            <span>Chart layout</span>
            <span className="layout-menu-hint">{current} on screen</span>
          </div>
          <div className="layout-grid" role="menu" aria-label="Chart layouts">
            {LAYOUTS.map((spec) => (
              <button
                key={spec.n}
                type="button"
                role="menuitemradio"
                aria-checked={spec.n === current}
                className={'layout-opt' + (spec.n === current ? ' sel' : '')}
                title={spec.n + (spec.n > 1 ? ' charts' : ' chart')}
                onClick={() => setLayout(spec.n)}
              >
                <Glyph spec={spec} />
                <span className="layout-opt-n">{spec.n}</span>
              </button>
            ))}
          </div>
          <label className="layout-sync" title="Move the crosshair on every chart together">
            <input
              type="checkbox"
              checked={syncOn}
              onChange={(e) => {
                setCrosshairSync(e.target.checked)
                setSyncOn(e.target.checked)
              }}
            />
            <span>Sync crosshair</span>
          </label>
          <SavedLayouts
            cancelRef={cancelEditRef}
            onLoaded={() => {
              setOpen(false)
              wrapRef.current?.querySelector<HTMLElement>('.layout-btn')?.focus()
            }}
          />
        </div>
      )}
    </div>
  )
}
