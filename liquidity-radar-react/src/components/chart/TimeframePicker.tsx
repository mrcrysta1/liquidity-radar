// Timeframe picker for the Radar price-action chart: a row of pinned
// favourites plus a grouped dropdown holding every interval, each row with a
// heart that pins or unpins it — the TradingView arrangement.
import { useEffect, useRef, useState } from 'react'
import {
  TF_GROUPS,
  TIMEFRAMES,
  getFavourites,
  getTimeframe,
  isExpanded,
  isFavourite,
  setTimeframe,
  subscribeTimeframe,
  tfLabel,
  toggleFavourite,
  toggleGroup,
} from '../../features/charts/timeframes'

/** Intervals that get a chip: the pinned ones, plus the active one if unpinned. */
function pinnedIds(): string[] {
  const favs = getFavourites()
  const cur = getTimeframe()
  return isFavourite(cur) ? favs : favs.concat([cur])
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path
        d="M12 20.3 3.8 12.1a5 5 0 0 1 7.1-7.1l1.1 1.1 1.1-1.1a5 5 0 1 1 7.1 7.1Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function TimeframePicker() {
  const [, force] = useState(0)
  const [open, setOpen] = useState(false)
  // With every group expanded the list is taller than a short viewport, so the
  // menu is sized to the room it actually has and flips above the toolbar when
  // there is more room up there.
  const [fit, setFit] = useState({ max: 340, up: false })
  // The chip row is frozen for as long as the menu is up. `.chart-toolbar` is
  // right-aligned in `.sec-head`, so a chip appearing or disappearing grows the
  // row leftward and slides the picker — and the menu under the cursor — with
  // it. Hearts therefore only redraw the row once the menu is dismissed.
  const [frozen, setFrozen] = useState<string[] | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // The store outside React owns the interval and the favourites; re-render
  // whenever either moves (the engine can change the interval too).
  useEffect(() => subscribeTimeframe(() => force((n) => n + 1)), [])

  // Opening the menu takes the snapshot; closing it releases the row.
  const setMenu = (next: boolean) => {
    setFrozen(next ? pinnedIds() : null)
    setOpen(next)
  }

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenu(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Capture phase, so the engine's global Escape (which exits full screen)
      // does not also fire: closing the menu is the whole gesture here.
      e.stopPropagation()
      setMenu(false)
    }
    document.addEventListener('keydown', onEsc, true)
    document.addEventListener('mousedown', onDocDown, true)
    return () => {
      document.removeEventListener('mousedown', onDocDown, true)
      document.removeEventListener('keydown', onEsc, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const measure = () => {
      const el = wrapRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const below = window.innerHeight - r.bottom - 14
      const above = r.top - 14
      const up = below < 240 && above > below
      const room = (up ? above : below) - 46 // the menu's own header
      setFit({ max: Math.max(150, Math.min(340, room)), up })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  // On open, park focus on the active row so the arrow keys have somewhere to
  // start — its group is the one expanded by default.
  useEffect(() => {
    if (!open) return
    const el = menuRef.current?.querySelector<HTMLElement>('.tf-row.sel .tf-row-main')
    el?.focus()
  }, [open])

  const current = getTimeframe()
  const pinned = frozen ?? pinnedIds()
  const shown = TIMEFRAMES.filter((t) => pinned.indexOf(t.id) !== -1)

  // The engine's global key handler owns Escape and the single-letter tab
  // shortcuts; while the menu is up those keys belong to the menu.
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setMenu(false)
      wrapRef.current?.querySelector<HTMLElement>('.tf-more')?.focus()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      const rows = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('.tf-row-main') ?? [])
      const i = rows.indexOf(document.activeElement as HTMLElement)
      const next = e.key === 'ArrowDown' ? i + 1 : i - 1
      rows[(next + rows.length) % rows.length]?.focus()
      return
    }
    e.stopPropagation()
  }

  return (
    <div className="tf-picker" ref={wrapRef}>
      <div className="tf-switch" id="tfSwitch">
        {shown.map((t) => (
          <button
            key={t.id}
            type="button"
            className={'tf-btn' + (t.id === current ? ' active' : '')}
            data-tf={t.id}
            aria-pressed={t.id === current}
            title={t.long}
            onClick={() => setTimeframe(t.id)}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className={'tf-more' + (open ? ' open' : '')}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="All timeframes"
          title="All timeframes"
          onClick={() => setMenu(!open)}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path
              d="m6 9 6 6 6-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {open && (
        <div
          className={'tf-menu' + (fit.up ? ' up' : '')}
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
          style={{ '--tf-menu-max': fit.max + 'px' } as React.CSSProperties}
        >
          <div className="tf-menu-head">
            <span>Timeframe</span>
            <span className="tf-menu-hint">♥ pins to the toolbar</span>
          </div>
          <div className="tf-menu-scroll">
            {TF_GROUPS.map((group) => {
              const items = TIMEFRAMES.filter((t) => t.group === group)
              if (!items.length) return null
              const openGroup = isExpanded(group)
              const holdsCurrent = items.some((t) => t.id === current)
              const panelId = 'tf-panel-' + group
              return (
                <div className={'tf-acc' + (openGroup ? ' open' : '')} key={group}>
                  <button
                    type="button"
                    className="tf-acc-head"
                    aria-expanded={openGroup}
                    aria-controls={panelId}
                    onClick={() => toggleGroup(group)}
                  >
                    <svg
                      className="tf-acc-caret"
                      viewBox="0 0 24 24"
                      width="11"
                      height="11"
                      aria-hidden="true"
                    >
                      <path
                        d="m9 6 6 6-6 6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="tf-acc-name">{group}</span>
                    {holdsCurrent && !openGroup && (
                      <span className="tf-acc-badge">{tfLabel(current)}</span>
                    )}
                    <span className="tf-acc-count">{items.length}</span>
                  </button>
                  {openGroup && (
                    <div className="tf-acc-body" id={panelId} role="listbox" aria-label={group}>
                      {items.map((t) => {
                        const fav = isFavourite(t.id)
                        const sel = t.id === current
                        return (
                          <div className={'tf-row' + (sel ? ' sel' : '')} key={t.id}>
                            <button
                              type="button"
                              className="tf-row-main"
                              role="option"
                              aria-selected={sel}
                              onClick={() => setTimeframe(t.id)}
                            >
                              <span className="tf-row-id">{t.label}</span>
                              <span className="tf-row-long">{t.long}</span>
                            </button>
                            <button
                              type="button"
                              className={'tf-fav' + (fav ? ' on' : '')}
                              aria-pressed={fav}
                              aria-label={
                                (fav ? 'Unpin ' : 'Pin ') +
                                t.long +
                                (fav ? ' from' : ' to') +
                                ' toolbar'
                              }
                              title={fav ? 'Unpin from toolbar' : 'Pin to toolbar'}
                              onClick={() => toggleFavourite(t.id)}
                            >
                              <Heart filled={fav} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
