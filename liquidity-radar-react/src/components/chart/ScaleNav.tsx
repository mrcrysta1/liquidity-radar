// TradingView-style price-scale and navigation controls for the main chart.
//
// <ChartNavOverlay/> sits inside #chartWrap: zoom/reset buttons on hover,
// "Scroll to real-time" while scrolled back, and the price-scale context
// menu. <ChartBottomBar/> sits under the chart: date-range buttons, a clock
// with the UTC offset, and the % / log / auto toggles. The state and the
// chart plumbing live in features/charts/scaleNav.
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  closeScaleMenu,
  resetChartView,
  resetPriceScale,
  scaleNavSnapshot,
  scrollToRealTime,
  selectRange,
  setAutoScale,
  setInvert,
  setLock,
  setScaleCell,
  setScaleMode,
  subscribeScaleNav,
  toggleScaleMode,
  zoomChart,
} from '../../features/charts/scaleNav'
import { RANGE_PRESETS, utcOffsetLabel } from '../../features/charts/scaleNavMath'
import type { ScaleMode } from '../../features/charts/scaleNavMath'
import { getActiveCell, subscribeLayout } from '../../features/charts/companionCharts'
import { addPriceRule, alertPriceText } from '../../features/alerts/alerts'
import { state } from '../../services/store'

function useScaleNav() {
  const [, force] = useState(0)
  useEffect(() => subscribeScaleNav(() => force((n) => n + 1)), [])
  return scaleNavSnapshot()
}

/** Close a popup on a press outside `ref` or on Escape. */
function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key)
    }
  }, [open, ref, close])
}

function Icon({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
const MINUS = 'M5 12h14'
const PLUS = 'M12 5v14M5 12h14'
const RESET = 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5'
const TO_END = 'M6 6l6 6-6 6M13 6l6 6-6 6'

const MODES: Array<{ id: ScaleMode; label: string }> = [
  { id: 'normal', label: 'Regular' },
  { id: 'percent', label: 'Percent' },
  { id: 'indexed', label: 'Indexed to 100' },
  { id: 'log', label: 'Logarithmic' },
]

function MenuItem(props: {
  on?: boolean
  radio?: boolean
  hint?: string
  onPick: () => void
  children: ReactNode
}) {
  const { on, radio, hint, onPick, children } = props
  const role = on === undefined ? 'menuitem' : radio ? 'menuitemradio' : 'menuitemcheckbox'
  return (
    <button
      type="button"
      role={role}
      aria-checked={on === undefined ? undefined : on}
      className={'sn-mi' + (on ? ' on' : '')}
      onClick={onPick}
    >
      <span className="sn-check" aria-hidden="true">
        {on ? '✓' : ''}
      </span>
      <span className="sn-mi-label">{children}</span>
      {hint ? <kbd className="sn-kbd">{hint}</kbd> : null}
    </button>
  )
}

/** Every scale option — the price-scale context menu and the bar's "more" menu. */
function ScaleMenuItems({ done }: { done: () => void }) {
  const s = useScaleNav()
  const pick = (fn: () => void) => () => {
    fn()
    done()
  }
  return (
    <>
      <MenuItem on={s.auto} onPick={pick(() => setAutoScale(!s.auto))}>
        Auto (fits data to screen)
      </MenuItem>
      <MenuItem on={s.lock} onPick={pick(() => setLock(!s.lock))}>
        Lock price to bar ratio
      </MenuItem>
      <div className="sn-msep" role="separator" />
      {MODES.map((m) => (
        <MenuItem key={m.id} radio on={s.mode === m.id} onPick={pick(() => setScaleMode(m.id))}>
          {m.label}
        </MenuItem>
      ))}
      <div className="sn-msep" role="separator" />
      <MenuItem on={s.invert} onPick={pick(() => setInvert(!s.invert))}>
        Invert scale
      </MenuItem>
      <div className="sn-msep" role="separator" />
      <MenuItem onPick={pick(resetPriceScale)}>Reset price scale</MenuItem>
      <MenuItem hint="Alt+R" onPick={pick(resetChartView)}>
        Reset chart view
      </MenuItem>
    </>
  )
}

/** Lives inside #chartWrap, over the main chart. */
export function ChartNavOverlay() {
  const s = useScaleNav()
  const menuRef = useRef<HTMLDivElement>(null)

  // The main chart moves between layout cells; scale settings follow the cell.
  useEffect(() => {
    const sync = () => setScaleCell(getActiveCell())
    sync()
    return subscribeLayout(sync)
  }, [])

  useDismiss(!!s.menu, menuRef, closeScaleMenu)

  if (!s.ready) return null
  return (
    <div className="sn-overlay">
      <div
        className="sn-zoom"
        role="group"
        aria-label="Chart navigation"
        style={{ bottom: s.tsH + 8, left: `calc(50% - ${s.psW / 2}px)` }}
      >
        <button type="button" title="Zoom out" aria-label="Zoom out" onClick={() => zoomChart(-1)}>
          <Icon d={MINUS} />
        </button>
        <button type="button" title="Zoom in" aria-label="Zoom in" onClick={() => zoomChart(1)}>
          <Icon d={PLUS} />
        </button>
        <button
          type="button"
          title="Reset chart view (Alt+R)"
          aria-label="Reset chart view"
          onClick={resetChartView}
        >
          <Icon d={RESET} />
        </button>
      </div>
      {s.away ? (
        <button
          type="button"
          className="sn-rt"
          title="Scroll to the most recent bar"
          aria-label="Scroll to real-time"
          style={{ bottom: s.tsH + 8, right: s.psW + 8 }}
          onClick={scrollToRealTime}
        >
          <Icon d={TO_END} />
        </button>
      ) : null}
      {s.menu ? (
        <div
          className="sn-menu"
          role="menu"
          aria-label="Price scale"
          ref={menuRef}
          style={{ left: s.menu.x, top: s.menu.y }}
        >
          {s.menu.price != null ? (
            <>
              <MenuItem
                onPick={() => {
                  const p = s.menu ? s.menu.price : null
                  closeScaleMenu()
                  if (p != null) addPriceRule(state.symbol, p)
                }}
              >
                Add alert at {alertPriceText(s.menu.price)}
              </MenuItem>
              <div className="sn-msep" role="separator" />
            </>
          ) : null}
          <ScaleMenuItems done={closeScaleMenu} />
        </div>
      ) : null}
    </div>
  )
}

function useClock(): { time: string; zone: string } {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Tick on the second boundary so the seconds change in step with the wall clock.
    let id: ReturnType<typeof setTimeout>
    const tick = () => {
      const d = new Date()
      setNow(d)
      id = setTimeout(tick, 1000 - d.getMilliseconds())
    }
    id = setTimeout(tick, 1000 - new Date().getMilliseconds())
    return () => clearTimeout(id)
  }, [])
  const p = (n: number) => String(n).padStart(2, '0')
  return {
    time: p(now.getHours()) + ':' + p(now.getMinutes()) + ':' + p(now.getSeconds()),
    zone: utcOffsetLabel(-now.getTimezoneOffset()),
  }
}

/** Under the chart: date ranges, clock, % / log / auto. */
export function ChartBottomBar() {
  const s = useScaleNav()
  const clock = useClock()
  const [rangeOpen, setRangeOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const rangeRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const closeRange = () => setRangeOpen(false)
  const closeMore = () => setMoreOpen(false)
  useDismiss(rangeOpen, rangeRef, closeRange)
  useDismiss(moreOpen, moreRef, closeMore)

  const sel = RANGE_PRESETS.find((p) => p.id === s.range)
  return (
    <div className="sn-bar" role="toolbar" aria-label="Chart range and scale">
      <div className="sn-ranges" role="group" aria-label="Date range">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={'sn-btn' + (s.range === p.id ? ' on' : '')}
            aria-pressed={s.range === p.id}
            title={p.title + ' · ' + p.tf}
            onClick={() => selectRange(p.id)}
          >
            {p.id}
          </button>
        ))}
      </div>
      <div className="sn-range-menu" ref={rangeRef}>
        <button
          type="button"
          className={'sn-btn sn-drop' + (rangeOpen ? ' open' : '') + (sel ? ' on' : '')}
          aria-haspopup="menu"
          aria-expanded={rangeOpen}
          onClick={() => setRangeOpen((o) => !o)}
        >
          {sel ? sel.id : 'Range'}
          <Icon d="M6 9l6 6 6-6" size={12} />
        </button>
        {rangeOpen ? (
          <div className="sn-menu up sn-range-list" role="menu" aria-label="Date range">
            {RANGE_PRESETS.map((p) => (
              <MenuItem
                key={p.id}
                radio
                on={s.range === p.id}
                hint={p.id}
                onPick={() => {
                  selectRange(p.id)
                  closeRange()
                }}
              >
                {p.title}
              </MenuItem>
            ))}
          </div>
        ) : null}
      </div>
      <span className="sn-spacer" />
      <span className="sn-clock" title="Local time">
        {clock.time} <i>({clock.zone})</i>
      </span>
      <span className="sn-sep" aria-hidden="true" />
      <button
        type="button"
        className={'sn-btn' + (s.mode === 'percent' ? ' on' : '')}
        aria-pressed={s.mode === 'percent'}
        title="Percent scale"
        onClick={() => toggleScaleMode('percent')}
      >
        %
      </button>
      <button
        type="button"
        className={'sn-btn' + (s.mode === 'log' ? ' on' : '')}
        aria-pressed={s.mode === 'log'}
        title="Logarithmic scale"
        onClick={() => toggleScaleMode('log')}
      >
        log
      </button>
      <button
        type="button"
        className={'sn-btn' + (s.auto ? ' on' : '')}
        aria-pressed={s.auto}
        title="Auto (fits data to screen)"
        onClick={() => setAutoScale(!s.auto)}
      >
        auto
      </button>
      <div className="sn-more" ref={moreRef}>
        <button
          type="button"
          className={'sn-btn sn-drop' + (moreOpen ? ' open' : '')}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-label="Price scale settings"
          title="Price scale settings"
          onClick={() => setMoreOpen((o) => !o)}
        >
          <Icon d="M5 12h.01M12 12h.01M19 12h.01" size={14} />
        </button>
        {moreOpen ? (
          <div className="sn-menu up right" role="menu" aria-label="Price scale">
            <ScaleMenuItems done={closeMore} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
