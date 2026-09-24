// Left navigation rail.
//
// These are still `.tab-btn` elements carrying `data-tab`, because the engine
// wires every one of them to switchTab at boot and the keyboard shortcuts read
// the same map. Moving navigation into a sidebar is a layout change, not a
// behaviour change — nothing downstream needs to know.
import { useCallback, useEffect, useRef, useState } from 'react'
import { storageGetRaw, storageSetRaw } from '../services/storage'
import { getActiveTab, subscribeActiveTab, switchTab } from '../features/actions/userActions'

type TabId =
  | 'home'
  | 'radar'
  | 'multichart'
  | 'signals'
  | 'market'
  | 'bubbles'
  | 'analysis'
  | 'news'
  | 'neuralnet'
  | 'pro'
  | 'settings'

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function NavIcon({ id }: { id: TabId }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': true as const }
  switch (id) {
    case 'home':
      return (
        <svg {...p}>
          <path d="M3.5 10.5 12 3.8l8.5 6.7" {...S} />
          <path d="M5.6 9.2v9.4a1.2 1.2 0 0 0 1.2 1.2h10.4a1.2 1.2 0 0 0 1.2-1.2V9.2" {...S} />
          <path d="M9.8 19.8v-5.2h4.4v5.2" {...S} />
        </svg>
      )
    case 'radar':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8.4" {...S} />
          <circle cx="12" cy="12" r="4.2" {...S} opacity=".55" />
          <path d="M12 12 18 7.4" {...S} />
          <circle cx="15.6" cy="9.2" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'multichart':
      return (
        <svg {...p}>
          <rect x="3.4" y="3.4" width="7.6" height="7.6" rx="1.6" {...S} />
          <rect x="13" y="3.4" width="7.6" height="7.6" rx="1.6" {...S} />
          <rect x="3.4" y="13" width="7.6" height="7.6" rx="1.6" {...S} />
          <rect x="13" y="13" width="7.6" height="7.6" rx="1.6" {...S} />
        </svg>
      )
    case 'signals':
      return (
        <svg {...p}>
          <path d="M13.2 2.8 4.6 13.4h5.6l-1.4 7.8 8.6-10.6h-5.6l1.4-7.8Z" {...S} />
        </svg>
      )
    case 'market':
      return (
        <svg {...p}>
          <path d="M3.4 19.6h17.2" {...S} />
          <rect x="5" y="11" width="3.4" height="6.6" rx="1" {...S} />
          <rect x="10.3" y="6.6" width="3.4" height="11" rx="1" {...S} />
          <rect x="15.6" y="9" width="3.4" height="8.6" rx="1" {...S} />
        </svg>
      )
    case 'bubbles':
      return (
        <svg {...p}>
          <circle cx="8.4" cy="9.6" r="4.6" {...S} />
          <circle cx="16.6" cy="15.4" r="3.4" {...S} />
          <circle cx="16.8" cy="7" r="2.1" {...S} opacity=".6" />
        </svg>
      )
    case 'analysis':
      return (
        <svg {...p}>
          <path d="M3.6 17.4 8.4 10l4 3.4 3-5.2 4.8 6.4" {...S} />
          <path d="M3.6 20.4h16.8" {...S} opacity=".5" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3.1" {...S} />
          <path d="M19.1 14.2a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.6 1.1v.3a1.8 1.8 0 1 1-3.6 0v-.2a1.5 1.5 0 0 0-2.7-1 1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1.1-2.6h-.3a1.8 1.8 0 1 1 0-3.6h.2a1.5 1.5 0 0 0 1-2.7l-.1-.1A1.8 1.8 0 1 1 7.7 4.4l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.3a1.8 1.8 0 1 1 3.6 0v.2a1.5 1.5 0 0 0 2.6 1.1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1.1 2.6h.3a1.8 1.8 0 1 1 0 3.6h-.2a1.5 1.5 0 0 0-1.4.9Z" {...S} strokeWidth={1.4} />
        </svg>
      )
    case 'news':
      return (
        <svg {...p}>
          <rect x="3.4" y="5" width="17.2" height="14" rx="2" {...S} />
          <path d="M6.8 9h6.4M6.8 12.4h6.4M6.8 15.6h4.2" {...S} />
          <path d="M16.2 9h1.4v3.4h-1.4z" {...S} />
        </svg>
      )
    case 'neuralnet':
      return (
        <svg {...p}>
          <circle cx="5" cy="7" r="1.8" {...S} />
          <circle cx="5" cy="17" r="1.8" {...S} />
          <circle cx="12" cy="12" r="1.8" {...S} />
          <circle cx="19" cy="7" r="1.8" {...S} />
          <circle cx="19" cy="17" r="1.8" {...S} />
          <path d="M6.6 8 10.6 11M6.6 16 10.6 13M13.4 11 17.4 8M13.4 13 17.4 16" {...S} opacity=".6" />
        </svg>
      )
    default:
      return (
        <svg {...p}>
          <path d="M12 2.9 20 7v10l-8 4.1L4 17V7l8-4.1Z" {...S} />
          <path d="M12 12.1 20 7.6M12 12.1v8.9M12 12.1 4 7.6" {...S} opacity=".55" />
        </svg>
      )
  }
}

const NAV: Array<{ id: TabId; label: string; key: string; group: string }> = [
  { id: 'home', label: 'Dashboard', key: 'H', group: 'main' },
  { id: 'radar', label: 'Radar', key: 'R', group: 'main' },
  { id: 'multichart', label: 'Charts', key: 'C', group: 'main' },
  { id: 'signals', label: 'Signals', key: 'S', group: 'trade' },
  { id: 'analysis', label: 'Analysis', key: 'A', group: 'trade' },
  { id: 'neuralnet', label: 'Neural net', key: '', group: 'trade' },
  { id: 'market', label: 'Market', key: 'M', group: 'explore' },
  { id: 'bubbles', label: 'Bubbles', key: 'B', group: 'explore' },
  { id: 'news', label: 'News', key: 'N', group: 'explore' },
  { id: 'pro', label: 'Pro Terminal', key: '', group: 'explore' },
  { id: 'settings', label: 'Settings', key: '', group: 'system' },
]

const GROUPS: Array<{ id: string; label: string }> = [
  { id: 'main', label: 'Overview' },
  { id: 'trade', label: 'Trade' },
  { id: 'explore', label: 'Explore' },
  { id: 'system', label: 'System' },
]

/** The destinations that earn a slot on a phone's bottom bar. */
const QUICK: TabId[] = ['home', 'radar', 'multichart', 'signals']
/** Everything else lives in the "More" sheet that rises from that bar. */
const REST = NAV.filter((n) => !QUICK.includes(n.id))

const KEY = 'lr-navCollapsed'

/** How far the sheet must be pulled down before letting go dismisses it. */
const DISMISS_PX = 90

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => storageGetRaw(KEY) === '1')
  const [sheet, setSheet] = useState(false)
  const [activeTab, setActiveTab] = useState(getActiveTab)
  // How far the finger has dragged the sheet down, in px. 0 = resting.
  const [drag, setDrag] = useState(0)
  const startY = useRef<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const closeSheet = useCallback(() => {
    startY.current = null
    setDrag(0)
    setSheet(false)
  }, [])

  const openSheet = useCallback(() => {
    startY.current = null
    setDrag(0)
    setSheet(true)
  }, [])

  useEffect(() => subscribeActiveTab(setActiveTab), [])

  // The rail is a plain element in the shell, so the body carries the state the
  // layout keys off.
  useEffect(() => {
    document.body.classList.toggle('nav-collapsed', collapsed)
    return () => document.body.classList.remove('nav-collapsed')
  }, [collapsed])

  // The sheet covers the page, so freeze what is behind it while it is up.
  useEffect(() => {
    document.body.classList.toggle('sheet-open', sheet)
    return () => document.body.classList.remove('sheet-open')
  }, [sheet])

  useEffect(() => {
    if (!sheet) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [sheet, closeSheet])

  const toggle = () => {
    setCollapsed((c) => {
      storageSetRaw(KEY, c ? '0' : '1')
      return !c
    })
  }

  const go = (id: TabId) => {
    switchTab(id)
    closeSheet()
  }

  // Swipe down to dismiss. The pull is ignored while the list is scrolled away
  // from its top, otherwise dragging back up through the list would move the
  // whole sheet instead of scrolling it.
  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = (listRef.current?.scrollTop ?? 0) <= 0 ? e.touches[0].clientY : null
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null) return
    const dy = e.touches[0].clientY - startY.current
    setDrag(dy > 0 ? dy : 0)
  }
  const onTouchEnd = () => {
    if (drag > DISMISS_PX) closeSheet()
    else {
      startY.current = null
      setDrag(0)
    }
  }

  // With the active section tucked away in the sheet, More is what is lit up.
  const restActive = REST.some((n) => n.id === activeTab)

  return (
    <>
      {/* Phone: the primary destinations, always reachable along the bottom. */}
      <nav className="tabbar" aria-label="Primary">
        {QUICK.map((id) => {
          const item = NAV.find((n) => n.id === id)!
          return (
            <button
              key={id}
              className={'tab-btn' + (id === activeTab ? ' active' : '')}
              data-tab={id}
              aria-label={item.label}
              aria-current={id === activeTab ? 'page' : undefined}
              onClick={() => go(id)}
            >
              <span className="tabbar-ico">
                <NavIcon id={id} />
              </span>
              <span className="tabbar-label">{item.label}</span>
            </button>
          )
        })}
        <button
          type="button"
          className={'tabbar-more' + (restActive ? ' active' : '')}
          aria-label="More sections"
          aria-expanded={sheet}
          aria-haspopup="dialog"
          onClick={openSheet}
        >
          <span className="tabbar-ico">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="5.5" cy="12" r="1.7" fill="currentColor" />
              <circle cx="12" cy="12" r="1.7" fill="currentColor" />
              <circle cx="18.5" cy="12" r="1.7" fill="currentColor" />
            </svg>
          </span>
          <span className="tabbar-label">More</span>
        </button>
      </nav>

      {/* Phone: the remaining sections, as a sheet that rises from that bar. */}
      <div
        className={'navsheet-scrim' + (sheet ? ' show' : '')}
        onClick={closeSheet}
        aria-hidden="true"
      />
      <div
        className={'navsheet' + (sheet ? ' show' : '')}
        role="dialog"
        aria-modal="true"
        aria-label="More sections"
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <button type="button" className="navsheet-grip" aria-label="Close" onClick={closeSheet}>
          <span aria-hidden="true" />
        </button>
        <div className="navsheet-head">
          <b>All sections</b>
          <button type="button" className="navsheet-x" aria-label="Close" onClick={closeSheet}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" {...S} strokeWidth={1.9} />
            </svg>
          </button>
        </div>
        <div className="navsheet-list" ref={listRef}>
          {GROUPS.map((g) => {
            const items = REST.filter((n) => n.group === g.id)
            if (!items.length) return null
            return (
              <div className="navsheet-group" key={g.id}>
                <span className="navsheet-group-label">{g.label}</span>
                <div className="navsheet-grid">
                  {items.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className={'navsheet-item' + (n.id === activeTab ? ' active' : '')}
                      aria-current={n.id === activeTab ? 'page' : undefined}
                      onClick={() => go(n.id)}
                    >
                      <span className="navsheet-ico">
                        <NavIcon id={n.id} />
                      </span>
                      <span className="navsheet-name">{n.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Tablet and up: the persistent rail. Hidden entirely on a phone. */}
      <aside className="sidenav" aria-label="Sections">
        <div className="sidenav-top">
          <span className="sidenav-mark" aria-hidden="true">
            📡
          </span>
          <span className="sidenav-brand">
            <b>LIQUIDITY</b>
            <span>RADAR</span>
          </span>
          <button
            type="button"
            className="sidenav-collapse"
            onClick={toggle}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path d={collapsed ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} {...S} />
            </svg>
          </button>
        </div>

        <nav className="tabs sidenav-list">
          {GROUPS.map((g) => (
            <div className="sidenav-group" key={g.id}>
              <span className="sidenav-group-label">{g.label}</span>
              {NAV.filter((n) => n.group === g.id).map((n) => (
                <button
                  key={n.id}
                  className={'tab-btn' + (n.id === activeTab ? ' active' : '')}
                  data-tab={n.id}
                  aria-label={n.label + ' tab'}
                  aria-selected={n.id === activeTab}
                  title={n.label}
                  onClick={() => go(n.id)}
                >
                  <span className="sidenav-ico">
                    <NavIcon id={n.id} />
                  </span>
                  <span className="sidenav-label">{n.label}</span>
                  {n.key && <span className="sidenav-key">{n.key}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}
