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

  // Opening moves focus onto the chosen zone, so the keyboard can pick at once.
  useEffect(() => {
    if (!open) return
    const on = listRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    ;(on || listRef.current?.querySelector<HTMLElement>('button'))?.focus()
  }, [open])
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('button') || [])
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
