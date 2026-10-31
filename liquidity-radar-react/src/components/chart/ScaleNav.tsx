// TradingView-style price-scale and navigation controls for the main chart.
//
// <ChartNavOverlay/> sits inside #chartWrap: zoom/reset buttons on hover,
// "Scroll to real-time" while scrolled back, and the price-scale context
// menu. <ChartBottomBar/> sits under the chart: date-range buttons, a clock
// with the UTC offset (which opens the chart time-zone menu, as on
// TradingView), and the % / log / auto toggles. The state and the
// chart plumbing live in features/charts/scaleNav.
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
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
import { RANGE_PRESETS } from '../../features/charts/scaleNavMath'
import {
  LOCAL_TZ,
  TZ_OPTIONS,
  browserZone,
  chartZone,
  getChartTzSetting,
  setChartTz,
  subscribeChartTz,
  tzOffsetLabel,
} from '../../features/charts/timezone'
import type { ScaleMode } from '../../features/charts/scaleNavMath'
import { getActiveCell, subscribeLayout } from '../../features/charts/companionCharts'
import { addPriceRule, alertPriceText } from '../../features/alerts/alerts'
import { state } from '../../services/store'
import { useFitMenu } from './useFitMenu'

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
    // Captured and stopped: the global handler also binds Escape (it leaves
    // full screen), and closing a menu must not do that too.
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [open, ref, close])
}

/**
 * Keyboard for a popup menu: opening moves focus onto the checked item (or
 * the first), and the arrows, Home and End move between items.
 */
function useMenuKeys(open: boolean, menuRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const on = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    ;(on || menuRef.current?.querySelector<HTMLElement>('button'))?.focus()
  }, [open, menuRef])
  return (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button') || [])
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? items.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next].focus()
  }
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

  // On a narrow chart (1366px with the side panel) the bottom-centre zoom bar
  // landed on the whale-orders legend in the bottom-left corner. Sit just
  // above the legend whenever the two would overlap; measured as the cursor
  // enters the chart (the bar only shows on hover) and on resize.
  const zoomRef = useRef<HTMLDivElement>(null)
  const [lift, setLift] = useState(0)
  const base = s.tsH + 8
  useEffect(() => {
    const wrap = document.getElementById('chartWrap')
    if (!wrap || !s.ready) return
    const measure = () => {
      const z = zoomRef.current
      const wl = wrap.querySelector('.whale-legend')
      let next = 0
      if (z && wl) {
        const wr = wrap.getBoundingClientRect()
        const lr = wl.getBoundingClientRect()
        const zr = z.getBoundingClientRect()
        // Where the bar sits unlifted: `base` above the wrap's bottom.
        const zBottom = wr.bottom - base
        const zTop = zBottom - zr.height
        const overlap =
          lr.height > 0 &&
          zr.left < lr.right + 6 &&
          zr.right > lr.left - 6 &&
          zTop < lr.bottom &&
          zBottom > lr.top
        if (overlap) next = Math.round(wr.bottom - lr.top + 6)
      }
      setLift((cur) => (cur === next ? cur : next))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    wrap.addEventListener('pointerenter', measure)
    return () => {
      ro.disconnect()
      wrap.removeEventListener('pointerenter', measure)
    }
  }, [s.ready, base, s.psW])

  if (!s.ready) return null
  return (
    <div className="sn-overlay">
      <div
        className="sn-zoom"
        role="group"
        aria-label="Chart navigation"
        ref={zoomRef}
        style={{ bottom: lift || base, left: `calc(50% - ${s.psW / 2}px)` }}
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

/** Re-render when the chart time zone changes. */
function useChartTz(): string {
  const [, force] = useState(0)
  useEffect(() => subscribeChartTz(() => force((n) => n + 1)), [])
  return getChartTzSetting()
}

/** The bar's clock, in the chart time zone. */
function useClock(): { time: string; zone: string; ms: number } {
  useChartTz()
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
  const zone = chartZone()
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now)
  return { time, zone: tzOffsetLabel(zone, now.getTime()), ms: now.getTime() }
}

/** The zone menu's rows: the presets, plus a stored zone that is not one of them. */
function tzRows(setting: string): Array<{ id: string; label: string; zone: string }> {
  const rows = TZ_OPTIONS.map((o) => ({
    id: o.id,
    label: o.id === LOCAL_TZ ? 'Browser time (' + browserZone().replace(/_/g, ' ') + ')' : o.label,
    zone: o.id === LOCAL_TZ ? browserZone() : o.id,
  }))
  if (!rows.some((r) => r.id === setting))
    rows.push({ id: setting, label: setting.replace(/_/g, ' '), zone: setting })
  return rows
}

/** The clock, as a button that opens the chart time-zone menu. */
function TimeZoneMenu() {
  const setting = useChartTz()
  const clock = useClock()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const close = () => {
    setOpen(false)
    btnRef.current?.focus()
  }
  useDismiss(open, ref, close)
  // Eighteen zones, opening up and leftwards: on a phone it ran off the top and left.
  useFitMenu(listRef, open)

  // Opening moves focus onto the chosen zone, so the keyboard can pick at once.
  const onKey = useMenuKeys(open, listRef)

  const now = clock.ms
  return (
    <div className="sn-tz" ref={ref}>
      <button
        type="button"
        ref={btnRef}
        className={'sn-btn sn-clock' + (open ? ' open' : '')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={'Chart time zone: ' + chartZone().replace(/_/g, ' ') + ' (' + clock.zone + ')'}
        title="Chart time zone"
        onClick={() => setOpen((o) => !o)}
      >
        {clock.time} <i>({clock.zone})</i>
      </button>
      {open ? (
        <div
          className="sn-menu up right sn-tz-list"
          role="menu"
          aria-label="Chart time zone"
          ref={listRef}
          onKeyDown={onKey}
        >
          {tzRows(setting).map((r) => (
            <MenuItem
              key={r.id}
              radio
              on={r.id === setting}
              hint={tzOffsetLabel(r.zone, now)}
              onPick={() => {
                setChartTz(r.id)
                close()
              }}
            >
              {r.label}
            </MenuItem>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Under the chart: date ranges, clock, % / log / auto. */
export function ChartBottomBar() {
  const s = useScaleNav()
  const [rangeOpen, setRangeOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const rangeRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const rangeBtnRef = useRef<HTMLButtonElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  // Closing hands focus back to the button that opened the menu.
  const closeRange = () => {
    setRangeOpen(false)
    rangeBtnRef.current?.focus()
  }
  const closeMore = () => {
    setMoreOpen(false)
    moreBtnRef.current?.focus()
  }
  useDismiss(rangeOpen, rangeRef, closeRange)
  useDismiss(moreOpen, moreRef, closeMore)
  const rangeMenuRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  useFitMenu(rangeMenuRef, rangeOpen)
  useFitMenu(moreMenuRef, moreOpen)
  const rangeKeys = useMenuKeys(rangeOpen, rangeMenuRef)
  const moreKeys = useMenuKeys(moreOpen, moreMenuRef)

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
          ref={rangeBtnRef}
          className={'sn-btn sn-drop' + (rangeOpen ? ' open' : '') + (sel ? ' on' : '')}
          aria-haspopup="menu"
          aria-expanded={rangeOpen}
          onClick={() => setRangeOpen((o) => !o)}
        >
          {sel ? sel.id : 'Range'}
          <Icon d="M6 9l6 6 6-6" size={12} />
        </button>
        {rangeOpen ? (
          <div
            className="sn-menu up sn-range-list"
            role="menu"
            aria-label="Date range"
            ref={rangeMenuRef}
            onKeyDown={rangeKeys}
          >
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
      <TimeZoneMenu />
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
          ref={moreBtnRef}
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
          <div
            className="sn-menu up right"
            role="menu"
            aria-label="Price scale"
            ref={moreMenuRef}
            onKeyDown={moreKeys}
          >
            <ScaleMenuItems done={closeMore} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
