// Ported from pro-terminal/src/store/useNews.ts (Pro Terminal news store) as a
// plain React hook so no zustand dependency is introduced in the main app.
import { useCallback, useEffect, useRef, useState } from 'react'
import { NEWS_SOURCES, parseFeed, dedupe, type NewsItem } from './rss'
import { parseFF, FF_URLS, XOOMAR_URL, MONTH_MS, mergeCalendar, calendarSpanDays, parseXoomar, type CalendarEvent } from './forexFactory'
import { fetchText } from './fetchText'

export type SourceStatus = Record<string, 'ok' | 'error' | 'loading'>
export type CalendarStatus = 'idle' | 'loading' | 'ok' | 'error'

export interface ProNewsState {
  items: NewsItem[]
  sourceStatus: SourceStatus
  lastNews?: number
  calendar: CalendarEvent[]
  calendarStatus: CalendarStatus
  calendarError?: string
  lastCalendar?: number
  refreshNews: () => Promise<void>
  refreshCalendar: () => Promise<void>
}

export function useProNews(): ProNewsState {
  const [items, setItems] = useState<NewsItem[]>([])
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>({})
  const [lastNews, setLastNews] = useState<number>()
  const [calendar, setCalendar] = useState<CalendarEvent[]>([])
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>('idle')
  const [calendarError, setCalendarError] = useState<string>()
  const [lastCalendar, setLastCalendar] = useState<number>()
  const itemsRef = useRef(items)

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const refreshNews = useCallback(async () => {
    const status: SourceStatus = {}
    NEWS_SOURCES.forEach((s) => (status[s.id] = 'loading'))
    setSourceStatus({ ...status })
    const results = await Promise.allSettled(
      NEWS_SOURCES.map(async (s) => parseFeed(await fetchText(s.url), s)),
    )
    const all: NewsItem[] = []
    const st: SourceStatus = {}
    results.forEach((r, i) => {
      const s = NEWS_SOURCES[i]
      if (r.status === 'fulfilled') {
        st[s.id] = 'ok'
        all.push(...r.value)
      } else st[s.id] = 'error'
    })
    const merged = dedupe([
      ...all,
      ...itemsRef.current.filter((i) => Date.now() - i.ts < 3 * 86400e3),
    ]).slice(0, 400)
    setItems(merged)
    setSourceStatus(st)
    setLastNews(Date.now())
  }, [])

  const refreshCalendar = useCallback(async () => {
    setCalendarStatus('loading')
    try {
      // Forex Factory publishes one JSON file per week; last/next are only
      // guaranteed around week boundaries, so tolerate missing files and merge.
      const weeks = await Promise.allSettled(
        [FF_URLS.lastWeek, FF_URLS.thisWeek, FF_URLS.nextWeek].map((u) => fetchText(u)),
      )
      const parsed = weeks.flatMap((r) => (r.status === 'fulfilled' ? parseFF(r.value) : []))
      let merged = mergeCalendar(parsed)
      // Guarantee ≥ one month of data: top up with a month-depth feed if the
      // FF files alone don't span 28 days.
      if (calendarSpanDays(merged) < MONTH_MS / 86400e3) {
        try {
          merged = mergeCalendar(parsed, parseXoomar(await fetchText(XOOMAR_URL)))
        } catch {
          /* keep the week(s) we already have */
        }
      }
      setCalendar(merged)
      setCalendarStatus('ok')
      setLastCalendar(Date.now())
      setCalendarError(undefined)
    } catch (e) {
      setCalendarStatus('error')
      setCalendarError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  return {
    items,
    sourceStatus,
    lastNews,
    calendar,
    calendarStatus,
    calendarError,
    lastCalendar,
    refreshNews,
    refreshCalendar,
  }
}