// Economic calendar for the News tab — the advanced Forex Factory feed
// (last/this/next week, topped up to a month) with the filter set the basic
// card never had: search, date range, impact, currency and upcoming-only.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useProNews } from '../../features/news/pro/useNews'
import {
  actualTone,
  calendarRangeLabel,
  groupByDay,
  type CalendarEvent,
  type Impact,
} from '../../features/news/pro/forexFactory'

const IMPACTS: Impact[] = ['High', 'Medium', 'Low', 'Holiday']
const CCY = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY']
const MAJORS = ['USD', 'EUR', 'GBP', 'JPY']
const RANGES = [
  { id: 'today', label: 'Today', days: 0 },
  { id: 'week', label: '7 days', days: 7 },
  { id: 'month', label: '30 days', days: 30 },
  { id: 'all', label: 'All', days: 0 },
]

const ago = (ts: number) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000))
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ago'
}
const until = (ts: number) => {
  const s = Math.max(0, Math.round((ts - Date.now()) / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return d + 'd ' + h + 'h'
  if (h > 0) return h + 'h ' + m + 'm'
  return m + 'm'
}

export function EconomicCalendar() {
  const { calendar, calendarStatus, calendarError, lastCalendar, refreshCalendar } = useProNews()
  const [q, setQ] = useState('')
  const [range, setRange] = useState('week')
  const [imp, setImp] = useState<Set<Impact>>(new Set(IMPACTS))
  const [ccy, setCcy] = useState<Set<string>>(new Set(CCY))
  const [upcomingOnly, setUpcomingOnly] = useState(false)
  const [ccyOpen, setCcyOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const ccyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    refreshCalendar()
    const a = setInterval(() => refreshCalendar(), 5 * 60_000)
    const b = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      clearInterval(a)
      clearInterval(b)
    }
  }, [refreshCalendar])

  useEffect(() => {
    if (!ccyOpen) return
    const onDown = (e: MouseEvent) => {
      if (!ccyRef.current?.contains(e.target as Node)) setCcyOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setCcyOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onEsc, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onEsc, true)
    }
  }, [ccyOpen])

  // Everything except the impact filter, so the impact chips can show honest counts.
  const preImpact = useMemo(() => {
    const r = RANGES.find((x) => x.id === range) ?? RANGES[1]
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const from = start.getTime()
    const to =
      range === 'today' ? from + 86400e3 : range === 'all' ? Infinity : from + r.days * 86400e3
    const needle = q.trim().toLowerCase()
    return calendar.filter(
      (e) =>
        (range === 'all' || (e.ts >= from && e.ts < to)) &&
        (!upcomingOnly || e.ts >= now) &&
        (ccy.has(e.currency) || !CCY.includes(e.currency)) &&
        (!needle || e.title.toLowerCase().includes(needle)),
    )
  }, [calendar, range, q, ccy, upcomingOnly, now])

  const counts = useMemo(() => {
    const c: Record<string, number> = { High: 0, Medium: 0, Low: 0, Holiday: 0 }
    preImpact.forEach((e) => {
      const k = e.impact === 'Non-Economic' ? 'Low' : e.impact
      if (k in c) c[k]++
    })
    return c
  }, [preImpact])

  const shown = useMemo(
    () =>
      preImpact.filter((e) => imp.has(e.impact) || (e.impact === 'Non-Economic' && imp.has('Low'))),
    [preImpact, imp],
  )
  const days = useMemo(() => groupByDay(shown), [shown])
  const nextEvent = useMemo(
    () => calendar.find((e) => e.ts > now && e.impact !== 'Holiday'),
    [calendar, now],
  )

  const toggle = <T,>(set: Set<T>, v: T, fn: (s: Set<T>) => void) => {
    const n = new Set(set)
    if (n.has(v)) n.delete(v)
    else n.add(v)
    fn(n)
  }
  const highOnly = imp.size === 1 && imp.has('High')

  return (
    <div className="card ec-card">
      <div className="ec-head">
        <div className="ec-title-wrap">
          <div className="ec-icon">🗓️</div>
          <div>
            <div className="ec-title">Economic Calendar</div>
            <div className="ec-sub">
              Forex Factory · {calendarRangeLabel(calendar)} · your local timezone
            </div>
          </div>
        </div>
        <div className="ec-head-right">
          <span className="ec-stat">
            <i
              className={
                'ec-dot ' +
                (calendarStatus === 'ok' ? 'ok' : calendarStatus === 'error' ? 'bad' : '')
              }
            />
            {calendarStatus === 'ok' && lastCalendar
              ? ago(lastCalendar)
              : calendarStatus === 'error'
                ? 'unavailable'
                : 'loading…'}
          </span>
          <span className="badge b-amber">{shown.length} events</span>
          <button
            type="button"
            className="chart-tool-btn ec-refresh"
            onClick={() => refreshCalendar()}
            title="Refresh calendar"
            aria-label="Refresh calendar"
          >
            ↻
          </button>
        </div>
      </div>

      {nextEvent && (
        <div className="ec-next">
          <span className={'ff-impact ' + nextEvent.impact.toLowerCase()} />
          <b>Next</b>
          <span className="ec-next-ccy">{nextEvent.currency}</span>
          <span className="ec-next-title">{nextEvent.title}</span>
          <span className="ec-next-in">in {until(nextEvent.ts)}</span>
        </div>
      )}

      <div className="ec-filters">
        <input
          className="ec-search"
          type="text"
          placeholder="🔍 Search events…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search events"
        />

        <div className="ec-seg" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className={range === r.id ? 'on' : ''}
              aria-pressed={range === r.id}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="ec-imps" role="group" aria-label="Impact">
          {IMPACTS.map((i) => (
            <button
              key={i}
              type="button"
              className={'ec-imp ec-imp-' + i.toLowerCase() + (imp.has(i) ? ' on' : '')}
              aria-pressed={imp.has(i)}
              title={i + ' impact'}
              onClick={() => toggle(imp, i, setImp)}
            >
              <i />
              {i}
              <b>{counts[i] ?? 0}</b>
            </button>
          ))}
          <button
            type="button"
            className={'ec-only' + (highOnly ? ' on' : '')}
            aria-pressed={highOnly}
            title="Show only high-impact events"
            onClick={() => setImp(highOnly ? new Set(IMPACTS) : new Set<Impact>(['High']))}
          >
            High only
          </button>
        </div>

        <div className="ec-ccy" ref={ccyRef}>
          <button
            type="button"
            className={'ec-ccy-btn' + (ccyOpen ? ' open' : '')}
            aria-haspopup="true"
            aria-expanded={ccyOpen}
            onClick={() => setCcyOpen((o) => !o)}
          >
            Currencies
            <b>
              {ccy.size}/{CCY.length}
            </b>
            <svg viewBox="0 0 24 24" width="9" height="9" aria-hidden="true">
              <path
                d="m6 9 6 6 6-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {ccyOpen && (
            <div className="ec-ccy-menu">
              <div className="ec-ccy-presets">
                <button type="button" onClick={() => setCcy(new Set(CCY))}>
                  All
                </button>
                <button type="button" onClick={() => setCcy(new Set(MAJORS))}>
                  Majors
                </button>
                <button type="button" onClick={() => setCcy(new Set())}>
                  None
                </button>
              </div>
              <div className="ec-ccy-grid">
                {CCY.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={ccy.has(c)}
                    className={ccy.has(c) ? 'on' : ''}
                    onClick={() => toggle(ccy, c, setCcy)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div className="ec-ccy-note">Other currencies always show.</div>
            </div>
          )}
        </div>

        <label className={'ec-toggle' + (upcomingOnly ? ' on' : '')}>
          <input
            type="checkbox"
            checked={upcomingOnly}
            onChange={(e) => setUpcomingOnly(e.target.checked)}
          />
          Upcoming only
        </label>
      </div>

      <div className="ec-scroll">
        {calendarStatus === 'error' && (
          <div className="fc-note">
            Calendar unavailable: {calendarError}. The feed is fetched via the proxy (allow-listed
            host nfs.faireconomy.media).
          </div>
        )}
        <table className="ff-table ec-table">
          <thead>
            <tr>
              <th className="ff-time">Time</th>
              <th className="ff-ccy">Cur.</th>
              <th className="ff-imp">Imp.</th>
              <th className="ff-event">Event</th>
              <th className="ff-num">Actual</th>
              <th className="ff-num">Forecast</th>
              <th className="ff-num">Previous</th>
            </tr>
          </thead>
          <tbody>
            {days.map((g) => {
              const isToday = g.date.toDateString() === new Date().toDateString()
              let lastTime = ''
              return [
                <tr key={g.day} className={'ff-day ' + (isToday ? 'today' : '')}>
                  <td colSpan={7}>
                    {g.date.toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                    {isToday ? ' · Today' : ''}
                    <span className="ec-day-count">{g.events.length}</span>
                  </td>
                </tr>,
                ...g.events.map((e: CalendarEvent) => {
                  const t =
                    e.allDay || e.impact === 'Holiday'
                      ? 'All Day'
                      : new Date(e.ts).toLocaleTimeString(undefined, {
                          hour: 'numeric',
                          minute: '2-digit',
                        })
                  const showTime = t !== lastTime
                  lastTime = t
                  const tone = actualTone(e)
                  const isNext = nextEvent?.id === e.id
                  const past = e.ts < now
                  return (
                    <tr
                      key={e.id}
                      className={'ff-row ' + (isNext ? 'next ' : '') + (past ? 'past' : '')}
                      title={e.title + ' · ' + e.currency + ' · ' + e.impact + ' impact'}
                    >
                      <td className="ff-time">
                        {showTime ? t : ''}
                        {isNext && <span className="ff-next">next</span>}
                      </td>
                      <td className="ff-ccy">
                        <b>{e.currency}</b>
                      </td>
                      <td className="ff-imp">
                        <span className={'ff-impact ' + e.impact.toLowerCase()} />
                      </td>
                      <td className="ff-event">{e.title}</td>
                      <td className={'ff-num ' + tone}>{e.actual ?? ''}</td>
                      <td className="ff-num">{e.forecast ?? ''}</td>
                      <td className="ff-num">{e.previous ?? ''}</td>
                    </tr>
                  )
                }),
              ]
            })}
          </tbody>
        </table>
        {calendarStatus === 'ok' && days.length === 0 && (
          <div className="fc-note">No events match these filters.</div>
        )}
      </div>

      <div className="ff-legend">
        <span className="ff-impact high" /> High <span className="ff-impact medium" /> Medium{' '}
        <span className="ff-impact low" /> Low <span className="ff-impact holiday" /> Holiday ·
        actual turns green when better than forecast for that currency, red when worse
      </div>
    </div>
  )
}
