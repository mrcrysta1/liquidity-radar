import { jget2 } from '../../api/client'
import { $ } from '../../utils/dom'
import { esc } from '../../utils/format'

// Economic events calendar — live status panel ("analysis" tab).
// Source chain: ForexFactory feed -> Xoomar fallback -> offline note.
// Behavior preserved from the original inline script.

interface FxEv {
  title?: string
  event?: string
  country?: string
  impact?: string
  date?: string | null
  time?: string
  actual?: unknown
  forecast?: unknown
  previous?: unknown
  [key: string]: unknown
}

interface FxEntry {
  ev: FxEv
  t: Date
}

interface FxState {
  sorted: FxEntry[]
  now: number
  showAll: boolean
  source: string
  filter: string
}

export const _fx: FxState = {
  sorted: [],
  now: Date.now(),
  showAll: true,
  source: '',
  filter: 'All',
}

export function countryFlag(code: string): string {
  if (!code || /all|world|global/i.test(code)) return '🌐'
  const c = code.toUpperCase().slice(0, 2)
  if (!/^[A-Z]{2}$/.test(c)) return '🌐'
  let out = ''
  for (const ch of c) out += String.fromCodePoint(127397 + ch.charCodeAt(0))
  return out
}

export function fxTime(t: Date): string {
  return t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })
}

export function fxCountdown(t: Date): string {
  const s = Math.max(0, Math.floor((t.getTime() - Date.now()) / 1000))
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm'
  return Math.floor(s / 86400) + 'd'
}

export function fxDayLabel(t: Date): string {
  const d = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getDay()]
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    t.getMonth()
  ]
  return d + ' ' + m + ' ' + t.getDate()
}

async function fetchFromXoomar(): Promise<FxEv[]> {
  const r = await fetch('https://xoomar.com/api/markets/calendar')
  if (!r.ok) throw new Error('xoomar ' + r.status)
  const d = (await r.json()) as { data?: Array<Record<string, unknown>> }
  if (!d || !d.data || !d.data.length) throw new Error('xoomar empty')
  return d.data.map(function (e): FxEv {
    const country = 'US'
    return {
      title: (e.eventName as string) || 'Unknown',
      country: country,
      impact:
        e.importance === 'high'
          ? 'High'
          : e.importance === 'med'
            ? 'Medium'
            : e.importance === 'medium'
              ? 'Medium'
              : 'Low',
      date: (e.scheduledAt as string) || null,
      time: '',
      actual: e.actual || '',
      forecast: '',
      previous: e.previous || '',
    }
  })
}

export async function fetchForexEvents(): Promise<void> {
  let events: FxEv[] | null
  let source: string
  try {
    events = (await jget2('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      to: 15000,
      retries: 2,
      dedup: true,
    })) as FxEv[] | null
    if (!events || !events.length) throw new Error('empty')
    source = 'ForexFactory'
  } catch (e1) {
    try {
      const x = await fetchFromXoomar()
      if (!x || !x.length) throw new Error('xoomar empty', { cause: e1 })
      events = x
      source = 'Xoomar'
    } catch (e2) {
      const list = $('forexList')
      const count = $('fxCount')
      if (list)
        list.innerHTML = '<div class="fc-note">Economic calendar unavailable — will retry</div>'
      if (count) count.textContent = 'OFFLINE'
      return
    }
  }
  try {
    const now = Date.now()
    const parsed = events
      .map(function (e): { ev: FxEv; t: Date | null } {
        let t: Date | null = null
        const iso =
          e.date && /^\d{4}-\d{2}-\d{2}T/.test(e.date)
            ? e.date
            : e.date
              ? e.date + 'T' + (e.time || '00:00') + ':00'
              : null
        if (iso) {
          t = new Date(iso)
          if (isNaN(t.getTime())) t = null
        }
        return { ev: e, t: t }
      })
      .filter((o) => o.t !== null)
      .map((o) => ({ ev: o.ev, t: o.t as Date }))
    const sorted = parsed.slice().sort(function (a, b) {
      return a.t.getTime() - b.t.getTime()
    })
    const upcoming = sorted.filter(function (o) {
      return o.t.getTime() >= now
    })
    const showAll = !upcoming.length
    _fx.sorted = sorted
    _fx.now = now
    _fx.showAll = showAll
    _fx.source = source
    renderForex()
  } catch (e) {
    const list = $('forexList')
    const count = $('fxCount')
    if (list)
      list.innerHTML = '<div class="fc-note">Economic calendar render error — will retry</div>'
    if (count) count.textContent = 'ERROR'
  }
}

export function renderForex(): void {
  const { sorted, now, source, filter } = _fx
  let f = filter
  if (f !== 'All' && f !== 'High' && f !== 'Medium' && f !== 'Low') f = 'All'
  const upcoming = sorted.filter(function (o) {
    return o.t.getTime() >= now
  })
  const groups: Record<string, FxEntry[]> = {}
  sorted.forEach(function (o) {
    const k = o.t.getFullYear() + '|' + o.t.getMonth() + '|' + o.t.getDate()
    if (groups[k]) groups[k].push(o)
    else groups[k] = [o]
  })
  const srcLabel = source === 'Xoomar' ? 'LIVE · Xoomar' : 'LIVE · ForexFactory'
  const fCount = sorted.filter(function (o) {
    return o.t.getTime() >= now && (f === 'All' || o.ev.impact === f)
  }).length
  const countEl = $('fxCount')
  const listEl = $('forexList')
  if (countEl) countEl.textContent = fCount + ' EVENTS · ' + srcLabel
  let html = ''
  let lastDay: string | null = null
  let shownAny = false
  sorted.forEach(function (o) {
    const e = o.ev,
      t = o.t
    if (f !== 'All' && e.impact !== f) return
    shownAny = true
    const dk = t.getFullYear() + '|' + t.getMonth() + '|' + t.getDate()
    if (dk !== lastDay) {
      lastDay = dk
      const dayCount = (groups[dk] || []).filter(function (x) {
        return f === 'All' || x.ev.impact === f
      }).length
      const hd = upcoming.length ? 'due ' + fxCountdown(t) : t.getTime() < now ? 'ended' : ''
      html +=
        '<div class="fx-day"><span class="fx-day-lbl">' +
        fxDayLabel(t) +
        '</span><span class="fx-day-count">' +
        dayCount +
        ' events' +
        (hd ? ' · ' + hd : '') +
        '</span></div>'
    }
    const imp =
      e.impact === 'High'
        ? 'b-hi'
        : e.impact === 'Medium'
          ? 'b-md'
          : e.impact === 'Low'
            ? 'b-lo'
            : 'b-lo nn'
    const isPast = t.getTime() < now
    html +=
      '<div class="fx-row' +
      (isPast ? ' fx-past' : '') +
      '">' +
      '<span class="fx-time">' +
      fxTime(t) +
      '</span>' +
      '<span class="fx-curr"><span class="fx-flag">' +
      countryFlag(e.country || '') +
      '</span>' +
      esc(e.country === 'All' ? '—' : e.country || '') +
      '</span>' +
      '<span class="fx-impact ' +
      imp +
      '"><i></i></span>' +
      '<span class="fx-ev">' +
      esc(e.title || e.event || 'Unknown') +
      '</span>' +
      '<span class="fx-num fx-act ' +
      (isPast && e.actual ? '' : 'empty') +
      '">' +
      esc((e.actual as string) || '—') +
      '</span>' +
      '<span class="fx-num ' +
      (!e.forecast || !String(e.forecast).trim() ? 'empty' : '') +
      '">' +
      esc((e.forecast as string) || '—') +
      '</span>' +
      '<span class="fx-num ' +
      (!e.previous || !String(e.previous).trim() ? 'empty' : '') +
      '">' +
      esc((e.previous as string) || '—') +
      '</span>' +
      '</div>'
  })
  if (!shownAny)
    html =
      f === 'All'
        ? '<div class="fc-note">No events in this week\'s calendar</div>'
        : '<div class="fc-note">No events at this impact level</div>'
  if (listEl) listEl.innerHTML = html
  refreshFxFilters()
}

function refreshFxFilters(): void {
  document.querySelectorAll('.fx-impact-legend [data-fx-filter]').forEach(function (el) {
    const h = el as HTMLElement
    h.classList.toggle('on', h.dataset.fxFilter === _fx.filter)
  })
}

export function setFxFilter(f: string): void {
  _fx.filter = f
  renderForex()
}

// Wire the impact filter chips on load (script ran at end of <body> in v5; the
// engine module is dynamically imported after the DOM mounts, so this still runs
// after the shell exists).
;(function initFxFilter() {
  document.querySelectorAll('.fx-impact-legend [data-fx-filter]').forEach(function (el) {
    const h = el as HTMLElement
    h.addEventListener('click', function () {
      setFxFilter(h.dataset.fxFilter || 'All')
    })
  })
})()
