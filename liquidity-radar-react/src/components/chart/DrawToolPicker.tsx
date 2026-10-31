// Drawing tools dropdown — the full catalogue grouped like TradingView's
// drawing toolbar, with a search box, favourite stars, the weak / strong
// magnet, "stay in drawing mode", undo and clear-all.
import { useEffect, useRef, useState } from 'react'
import { useFitMenu } from './useFitMenu'
import {
  DRAW_GROUPS,
  DRAW_TOOLS,
  clearAllDrawings,
  drawToolDef,
  drawingCount,
  favouriteTools,
  getDrawTool,
  getMagnetMode,
  isFavouriteTool,
  pendingPoints,
  setDrawTool,
  setMagnetMode,
  setStayInDrawingMode,
  stayInDrawingMode,
  subscribeDrawTools,
  toggleDrawTool,
  toggleFavouriteTool,
  undoDrawing,
} from '../../features/charts/drawTools'
import type { MagnetMode } from '../../features/charts/drawTools'

const S = {
  fill: 'none',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** A small coloured diagram of each tool. */
function ToolIcon({ id, size = 17 }: { id: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const }
  const c = drawToolDef(id)?.color || 'currentColor'
  const dot = (cx: number, cy: number) => <circle cx={cx} cy={cy} r="2.2" fill={c} />
  switch (id) {
    case 'trend':
      return (
        <svg {...p}>
          <path d="M4 19 20 5" stroke={c} {...S} />
          {dot(4, 19)}
          {dot(20, 5)}
        </svg>
      )
    case 'ray':
      return (
        <svg {...p}>
          <path d="M4 19 21 5" stroke={c} {...S} />
          <path d="M16.5 5H21v4.5" stroke={c} {...S} />
          {dot(4, 19)}
        </svg>
      )
    case 'extended':
      return (
        <svg {...p}>
          <path d="M2 21 22 3" stroke={c} {...S} />
          {dot(8, 15)}
          {dot(16, 8)}
        </svg>
      )
    case 'arrow':
      return (
        <svg {...p}>
          <path d="M4 19 19 6" stroke={c} {...S} />
          <path d="M12.5 5.5 19.5 5l-.5 7" stroke={c} {...S} />
        </svg>
      )
    case 'hline':
      return (
        <svg {...p}>
          <path d="M2.5 12h19" stroke={c} {...S} strokeDasharray="4 3" />
          {dot(12, 12)}
        </svg>
      )
    case 'hray':
      return (
        <svg {...p}>
          <path d="M6 12h15" stroke={c} {...S} />
          {dot(6, 12)}
        </svg>
      )
    case 'vline':
      return (
        <svg {...p}>
          <path d="M12 2.5v19" stroke={c} {...S} strokeDasharray="4 3" />
          {dot(12, 12)}
        </svg>
      )
    case 'cross':
      return (
        <svg {...p}>
          <path d="M2.5 12h19M12 2.5v19" stroke={c} {...S} strokeDasharray="3 3" />
          {dot(12, 12)}
        </svg>
      )
    case 'infoline':
      return (
        <svg {...p}>
          <path d="M4 19 20 7" stroke={c} {...S} />
          <path d="M13 3.5h8v5" stroke={c} strokeWidth="1.4" fill="none" />
        </svg>
      )
    case 'parallel':
      return (
        <svg {...p}>
          <path d="M3 16 18 4M6 20 21 8" stroke={c} {...S} />
        </svg>
      )
    case 'flatchannel':
      return (
        <svg {...p}>
          <path d="M2.5 8h19M2.5 16h19" stroke={c} {...S} />
        </svg>
      )
    case 'regression':
      return (
        <svg {...p}>
          <path d="M3 17 21 7" stroke={c} {...S} />
          <path
            d="M3 21 21 11M3 13 21 3"
            stroke={c}
            strokeWidth="1.2"
            strokeDasharray="3 3"
            fill="none"
          />
        </svg>
      )
    case 'pitchfork':
      return (
        <svg {...p}>
          <path d="M3 19 21 7" stroke={c} {...S} />
          <path d="M7 4 21 12M8 21 21 15" stroke={c} strokeWidth="1.3" fill="none" />
          {dot(3, 19)}
        </svg>
      )
    case 'schiff':
    case 'modschiff':
      return (
        <svg {...p}>
          <path d="M3 19 7 13M7 13 21 8" stroke={c} {...S} />
          <path d="M8 5 21 9M8 21 21 15" stroke={c} strokeWidth="1.3" fill="none" />
          {dot(7, 13)}
        </svg>
      )
    case 'fibretr':
      return (
        <svg {...p}>
          <path
            d="M3 5h18M3 10h18M3 14h18M3 19h18"
            stroke={c}
            strokeWidth="1.5"
            strokeDasharray="4 3"
            fill="none"
          />
        </svg>
      )
    case 'fibext':
      return (
        <svg {...p}>
          <path
            d="M3 4h18M3 9h18M3 15h18M3 20h18"
            stroke={c}
            strokeWidth="1.4"
            strokeDasharray="3 3"
            fill="none"
          />
          <path d="M4 20 11 9l5 6" stroke={c} strokeWidth="1.4" fill="none" />
        </svg>
      )
    case 'fibfan':
      return (
        <svg {...p}>
          <path
            d="M4 20 21 4M4 20 21 10M4 20 21 16M4 20 20 20"
            stroke={c}
            strokeWidth="1.4"
            fill="none"
          />
          {dot(4, 20)}
        </svg>
      )
    case 'fibtime':
      return (
        <svg {...p}>
          <path
            d="M4 3v18M8 3v18M14 3v18M21 3v18"
            stroke={c}
            strokeWidth="1.4"
            strokeDasharray="3 3"
            fill="none"
          />
        </svg>
      )
    case 'fibcircle':
      return (
        <svg {...p}>
          <circle cx="5" cy="19" r="5" stroke={c} strokeWidth="1.3" fill="none" />
          <circle
            cx="5"
            cy="19"
            r="10"
            stroke={c}
            strokeWidth="1.3"
            fill="none"
            strokeDasharray="3 3"
          />
          <circle
            cx="5"
            cy="19"
            r="15"
            stroke={c}
            strokeWidth="1.2"
            fill="none"
            strokeDasharray="3 3"
          />
        </svg>
      )
    case 'gannfan':
      return (
        <svg {...p}>
          <path
            d="M3 21 21 3M3 21 21 11M3 21 21 17M3 21 13 3M3 21 9 3"
            stroke={c}
            strokeWidth="1.3"
            fill="none"
          />
        </svg>
      )
    case 'gannbox':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="16" stroke={c} strokeWidth="1.5" fill="none" />
          <path
            d="M3 12h18M12 4v16M3 20 21 4"
            stroke={c}
            strokeWidth="1.1"
            strokeDasharray="3 3"
            fill="none"
          />
        </svg>
      )
    case 'rect':
      return (
        <svg {...p}>
          <rect x="3.5" y="6" width="17" height="12" rx="1.5" stroke={c} {...S} />
        </svg>
      )
    case 'ellipse':
      return (
        <svg {...p}>
          <ellipse cx="12" cy="12" rx="9" ry="6.5" stroke={c} {...S} />
        </svg>
      )
    case 'triangle':
      return (
        <svg {...p}>
          <path d="M12 4 21 19H3Z" stroke={c} {...S} />
        </svg>
      )
    case 'polyline':
      return (
        <svg {...p}>
          <path d="M3 18l5-7 4 4 4-8 5 5" stroke={c} {...S} />
          {dot(3, 18)}
          {dot(21, 12)}
        </svg>
      )
    case 'brush':
      return (
        <svg {...p}>
          <path d="M3 20c4 0 3-8 7-8s3 6 6 6 3-9 5-12" stroke={c} {...S} />
        </svg>
      )
    case 'abcd':
    case 'xabcd':
      return (
        <svg {...p}>
          <path d="M3 20 8 7l5 9 4-10 4 12" stroke={c} {...S} />
        </svg>
      )
    case 'headshoulders':
      return (
        <svg {...p}>
          <path d="M2 19l3-6 3 4 4-10 4 10 3-4 3 6" stroke={c} {...S} />
        </svg>
      )
    case 'trianglepat':
      return (
        <svg {...p}>
          <path d="M3 5l5 13 4-9 4 6 5-3" stroke={c} {...S} />
          <path d="M3 5l18 7M8 18l13-6" stroke={c} strokeWidth="1.2" strokeDasharray="3 3" fill="none" />
        </svg>
      )
    case 'elliott5':
    case 'elliottabc':
      return (
        <svg {...p}>
          <path d="M3 20l4-6 3 3 4-9 3 5 4-8" stroke={c} {...S} />
        </svg>
      )
    case 'long':
      return (
        <svg {...p}>
          <rect
            x="3"
            y="5"
            width="18"
            height="7"
            fill="rgba(0,230,118,.3)"
            stroke="#00E676"
            strokeWidth="1.2"
          />
          <rect
            x="3"
            y="12"
            width="18"
            height="6"
            fill="rgba(255,23,68,.3)"
            stroke="#FF1744"
            strokeWidth="1.2"
          />
        </svg>
      )
    case 'short':
      return (
        <svg {...p}>
          <rect
            x="3"
            y="5"
            width="18"
            height="6"
            fill="rgba(255,23,68,.3)"
            stroke="#FF1744"
            strokeWidth="1.2"
          />
          <rect
            x="3"
            y="11"
            width="18"
            height="7"
            fill="rgba(0,230,118,.3)"
            stroke="#00E676"
            strokeWidth="1.2"
          />
        </svg>
      )
    case 'measure':
      return (
        <svg {...p}>
          <rect
            x="4"
            y="6"
            width="16"
            height="12"
            stroke={c}
            strokeWidth="1.4"
            fill="rgba(79,195,247,.15)"
          />
          <path d="M4 18 20 6" stroke={c} strokeWidth="1.3" fill="none" />
        </svg>
      )
    case 'pricerange':
      return (
        <svg {...p}>
          <path d="M12 4v16M8 4h8M8 20h8" stroke={c} {...S} />
        </svg>
      )
    case 'daterange':
      return (
        <svg {...p}>
          <path d="M4 12h16M4 8v8M20 8v8" stroke={c} {...S} />
        </svg>
      )
    case 'avwap':
      return (
        <svg {...p}>
          <path d="M5 4v16" stroke={c} strokeWidth="1.3" strokeDasharray="2 2" fill="none" />
          <path d="M5 16c4-1 5-6 9-6s4 3 7 2" stroke={c} {...S} />
          {dot(5, 16)}
        </svg>
      )
    case 'fixedvp':
      return (
        <svg {...p}>
          <path d="M4 3v18M20 3v18" stroke={c} strokeWidth="1.2" strokeDasharray="2 2" fill="none" />
          <path d="M4 7h7M4 11h13M4 15h9M4 19h5" stroke={c} strokeWidth="2.2" strokeLinecap="round" fill="none" />
        </svg>
      )
    case 'note':
      return (
        <svg {...p}>
          <rect x="4" y="3.5" width="16" height="10" rx="2" stroke={c} {...S} />
          <path d="M12 13.5V21" stroke={c} {...S} />
        </svg>
      )
    case 'flag':
      return (
        <svg {...p}>
          <path d="M6 21V4" stroke={c} {...S} />
          <path d="M6 4h12l-3 4 3 4H6" stroke={c} {...S} fill={c} fillOpacity=".35" />
        </svg>
      )
    case 'stay':
      return (
        <svg {...p}>
          <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19l-4 1Z" stroke="currentColor" {...S} />
          <path d="M14 20h6" stroke="currentColor" {...S} />
        </svg>
      )
    case 'text':
      return (
        <svg {...p}>
          <path d="M5 6h14M12 6v13" stroke={c} {...S} />
        </svg>
      )
    case 'callout':
      return (
        <svg {...p}>
          <rect x="7" y="4" width="14" height="10" rx="2" stroke={c} {...S} />
          <path d="M10 14 3 20" stroke={c} {...S} strokeDasharray="3 3" />
        </svg>
      )
    case 'pricelabel':
      return (
        <svg {...p}>
          <rect x="3" y="8" width="14" height="8" rx="1.5" stroke={c} {...S} />
          <path d="M17 12h4" stroke={c} {...S} />
        </svg>
      )
    case 'markerup':
      return (
        <svg {...p}>
          <path d="M12 20V5M12 5 6 12M12 5l6 7" stroke={c} {...S} />
        </svg>
      )
    case 'markerdown':
      return (
        <svg {...p}>
          <path d="M12 4v15M12 19l-6-7M12 19l6-7" stroke={c} {...S} />
        </svg>
      )
    case 'erase':
      return (
        <svg {...p}>
          <path
            d="M8.5 20.5 3.5 15.5 14 5l5 5-10.5 10.5Z"
            stroke="var(--red)"
            fill="none"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M10.5 20.5H20" stroke="var(--red)" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      )
    case 'magnet':
    case 'magnet-strong':
      return (
        <svg {...p}>
          <path d="M6 4v8a6 6 0 0 0 12 0V4" stroke="currentColor" {...S} />
          <path d="M6 9h4M14 9h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          {id === 'magnet-strong' && <path d="M12 9.5v5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
        </svg>
      )
    default:
      return (
        <svg {...p}>
          <path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19l-4 1Z" stroke="currentColor" {...S} />
        </svg>
      )
  }
}

const MAGNETS: Array<{ id: Exclude<MagnetMode, 'off'>; name: string; hint: string }> = [
  { id: 'weak', name: 'Weak magnet', hint: 'Snap to open/high/low/close when near' },
  { id: 'strong', name: 'Strong magnet', hint: 'Always snap to the nearest open/high/low/close' },
]
const MAGNET_NEXT: Record<MagnetMode, MagnetMode> = { off: 'weak', weak: 'strong', strong: 'off' }
const MAGNET_TIP: Record<MagnetMode, string> = {
  off: 'Magnet off — click for weak',
  weak: 'Weak magnet — click for strong',
  strong: 'Strong magnet — click to turn off',
}

export function DrawToolPicker() {
  const [, force] = useState(0)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // It flies out beside the strip; low on a 768px screen its foot ran off the bottom.
  useFitMenu(menuRef, open)

  useEffect(() => subscribeDrawTools(() => force((n) => n + 1)), [])

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

  const active = getDrawTool()
  const def = drawToolDef(active)
  const magnet = getMagnetMode()
  const stay = stayInDrawingMode()
  const count = drawingCount()
  const pending = pendingPoints()
  const q = query.trim().toLowerCase()
  const shown = DRAW_TOOLS.filter(
    (t) => t.id !== 'erase' && (!q || t.name.toLowerCase().includes(q)),
  )

  const progress =
    def && pending > 0
      ? def.points > 0
        ? pending + '/' + def.points + ' points'
        : pending + ' points — double-click to finish'
      : null

  return (
    <div className="draw-picker" ref={wrapRef}>
      <button
        type="button"
        className={'chart-tool-btn draw-btn' + (open ? ' open' : '') + (active ? ' armed' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={def ? 'Drawing tool: ' + def.name : 'Drawing tools'}
        onClick={() => setOpen((o) => !o)}
      >
        <ToolIcon id={active ?? 'pencil'} size={17} />
        <svg viewBox="0 0 24 24" width="9" height="9" className="draw-caret" aria-hidden="true">
          <path
            d="m6 9 6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {count > 0 && <span className="draw-count">{count}</span>}
        <span className="draw-tip">{progress || (def ? def.name : 'Drawing tools')}</span>
      </button>

      {open && (
        <div className="draw-menu" role="menu" aria-label="Drawing tools" ref={menuRef}>
          <div className="draw-menu-head">
            <input
              className="draw-search"
              type="text"
              placeholder="Search tools…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search drawing tools"
            />
          </div>

          <div className="draw-scroll">
            {DRAW_GROUPS.filter((g) => g !== 'Edit').map((g) => {
              const list = shown.filter((t) => t.group === g)
              if (!list.length) return null
              return (
                <div key={g}>
                  <div className="draw-menu-lbl">{g}</div>
                  {list.map((t) => {
                    const fav = isFavouriteTool(t.id)
                    return (
                      <div key={t.id} className="draw-opt-row">
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={active === t.id}
                          className={'draw-opt' + (active === t.id ? ' sel' : '')}
                          onClick={() => toggleDrawTool(t.id)}
                        >
                          <span className="draw-opt-ico">
                            <ToolIcon id={t.id} />
                          </span>
                          <span className="draw-opt-text">
                            <b>{t.name}</b>
                            <small>{t.hint}</small>
                          </span>
                        </button>
                        {/* A sibling, not inside the option: a button in a button is invalid. */}
                        <button
                          type="button"
                          className={'draw-fav' + (fav ? ' on' : '')}
                          aria-pressed={fav}
                          aria-label={(fav ? 'Remove ' : 'Add ') + t.name + (fav ? ' from' : ' to') + ' favourites'}
                          title={fav ? 'Remove from favourites' : 'Add to favourites (left toolbar)'}
                          onClick={() => toggleFavouriteTool(t.id)}
                        >
                          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                            <path
                              d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"
                              fill={fav ? 'currentColor' : 'none'}
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )
            })}
            {!shown.length && <div className="draw-empty">No tool matches “{query}”.</div>}

            <div className="draw-menu-lbl">Edit</div>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={active === 'erase'}
              className={'draw-opt' + (active === 'erase' ? ' sel danger' : '')}
              onClick={() => toggleDrawTool('erase')}
            >
              <span className="draw-opt-ico">
                <ToolIcon id="erase" />
              </span>
              <span className="draw-opt-text">
                <b>Eraser</b>
                <small>Click a drawing to remove it</small>
              </span>
            </button>
            {MAGNETS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={magnet === m.id}
                className={'draw-opt' + (magnet === m.id ? ' sel' : '')}
                onClick={() => setMagnetMode(magnet === m.id ? 'off' : m.id)}
              >
                <span className="draw-opt-ico">
                  <ToolIcon id={m.id === 'strong' ? 'magnet-strong' : 'magnet'} />
                </span>
                <span className="draw-opt-text">
                  <b>{m.name}</b>
                  <small>{m.hint}</small>
                </span>
                <span className={'draw-switch' + (magnet === m.id ? ' on' : '')} aria-hidden="true">
                  <i />
                </span>
              </button>
            ))}
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={stay}
              className={'draw-opt' + (stay ? ' sel' : '')}
              onClick={() => setStayInDrawingMode(!stay)}
            >
              <span className="draw-opt-ico">
                <ToolIcon id="stay" />
              </span>
              <span className="draw-opt-text">
                <b>Stay in drawing mode</b>
                <small>Keep the tool after each drawing</small>
              </span>
              <span className={'draw-switch' + (stay ? ' on' : '')} aria-hidden="true">
                <i />
              </span>
            </button>
          </div>

          <div className="draw-menu-foot">
            <span>
              {count} drawing{count === 1 ? '' : 's'}
            </span>
            <span className="draw-foot-actions">
              <button
                type="button"
                className="draw-clear"
                disabled={!count && !pending}
                onClick={undoDrawing}
              >
                Undo
              </button>
              <button
                type="button"
                className="draw-clear"
                disabled={!count}
                onClick={clearAllDrawings}
              >
                Clear all
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/** Re-render whenever the armed tool, the magnet or the drawings change. */
function useDrawTools() {
  const [, force] = useState(0)
  useEffect(() => subscribeDrawTools(() => force((n) => n + 1)), [])
}

/** The tools TradingView keeps one click away on its left toolbar. */
const QUICK_TOOLS = ['trend', 'hline', 'fibretr', 'rect', 'text']

/**
 * Left drawing toolbar, top group: the cursor (disarms any tool) and the most
 * used tools. The full catalogue stays one button below, in DrawToolPicker.
 */
export function DrawQuickTools() {
  useDrawTools()
  const active = getDrawTool()
  // Starred tools follow the fixed ones (no duplicates).
  const ids = QUICK_TOOLS.concat(favouriteTools().filter((id) => !QUICK_TOOLS.includes(id)))
  return (
    <>
      <button
        type="button"
        className={'chart-tool-btn tvb-icon draw-quick' + (active ? '' : ' on')}
        aria-pressed={!active}
        aria-label="Cursor"
        onClick={() => setDrawTool(null)}
      >
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
          <path
            d="M6 3.5v15l4-3.6 2.6 5.6 2.4-1.1-2.6-5.5 5.4-.4Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
        <span className="tvb-tip">Cursor</span>
      </button>
      {ids.map((id) => {
        const def = drawToolDef(id)
        if (!def) return null
        const on = active === id
        return (
          <button
            key={id}
            type="button"
            className={'chart-tool-btn tvb-icon draw-quick' + (on ? ' on' : '')}
            aria-pressed={on}
            aria-label={def.name}
            onClick={() => toggleDrawTool(id)}
          >
            <ToolIcon id={id} size={18} />
            <span className="tvb-tip">{def.name}</span>
          </button>
        )
      })}
    </>
  )
}

/** Left drawing toolbar, edit group: magnet snapping, stay in drawing mode and the eraser. */
export function DrawEditTools() {
  useDrawTools()
  const magnet = getMagnetMode()
  const stay = stayInDrawingMode()
  const erasing = getDrawTool() === 'erase'
  return (
    <>
      {/* One button cycles off, weak, strong, as the dropdown's two rows set them. */}
      <button
        type="button"
        className={'chart-tool-btn tvb-icon draw-quick' + (magnet !== 'off' ? ' on' : '')}
        aria-pressed={magnet !== 'off'}
        aria-label={'Magnet mode: ' + magnet}
        onClick={() => setMagnetMode(MAGNET_NEXT[magnet])}
      >
        <ToolIcon id={magnet === 'strong' ? 'magnet-strong' : 'magnet'} size={18} />
        <span className="tvb-tip">{MAGNET_TIP[magnet]}</span>
      </button>
      <button
        type="button"
        className={'chart-tool-btn tvb-icon draw-quick' + (stay ? ' on' : '')}
        aria-pressed={stay}
        aria-label="Stay in drawing mode"
        onClick={() => setStayInDrawingMode(!stay)}
      >
        <ToolIcon id="stay" size={18} />
        <span className="tvb-tip">Stay in drawing mode</span>
      </button>
      <button
        type="button"
        className={'chart-tool-btn tvb-icon draw-quick' + (erasing ? ' on' : '')}
        aria-pressed={erasing}
        aria-label="Eraser"
        onClick={() => toggleDrawTool('erase')}
      >
        <ToolIcon id="erase" size={18} />
        <span className="tvb-tip">Eraser</span>
      </button>
    </>
  )
}
