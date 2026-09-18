// Ported from pro-terminal/src/store/useNews.ts (Pro Terminal news store) as a
// plain React hook so no zustand dependency is introduced in the main app.
import { useCallback, useEffect, useRef, useState } from 'react'
import { NEWS_SOURCES, parseFeed, dedupe, type NewsItem } from './rss'
import { parseFF, FF_URLS, type CalendarEvent } from './forexFactory'
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
  calendarWeek: 'this' | 'next'
  refreshNews: () => Promise<void>
  refreshCalendar: (week?: 'this' | 'next') => Promise<void>
}

export function useProNews(): ProNewsState {
  const [items, setItems] = useState<NewsItem[]>([])
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>({})
  const [lastNews, setLastNews] = useState<number>()
  const [calendar, setCalendar] = useState<CalendarEvent[]>([])
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>('idle')
  const [calendarError, setCalendarError] = useState<string>()
  const [lastCalendar, setLastCalendar] = useState<number>()
  const [calendarWeek, setCalendarWeek] = useState<'this' | 'next'>('this')
  const itemsRef = useRef(items)
  const weekRef = useRef(calendarWeek)

  useEffect(() => {
    itemsRef.current = items
  }, [items])
  useEffect(() => {
    weekRef.current = calendarWeek
  }, [calendarWeek])

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

  const refreshCalendar = useCallback(async (week: 'this' | 'next' = weekRef.current) => {
    setCalendarStatus('loading')
    setCalendarWeek(week)
    try {
      const ev = parseFF(await fetchText(week === 'next' ? FF_URLS.nextWeek : FF_URLS.thisWeek))
      setCalendar(ev)
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
    calendarWeek,
    refreshNews,
    refreshCalendar,
  }
}