import { create } from 'zustand';
import { NEWS_SOURCES, parseFeed, dedupe, type NewsItem } from '@/core/news/rss';
import { parseFF, FF_URLS, type CalendarEvent } from '@/core/news/forexFactory';
import { fetchText } from '@/providers/proxy';

interface NewsState {
  items: NewsItem[]; sourceStatus: Record<string, 'ok' | 'error' | 'loading'>; lastNews?: number;
  calendar: CalendarEvent[]; calendarStatus: 'idle' | 'loading' | 'ok' | 'error'; calendarError?: string; lastCalendar?: number; calendarWeek: 'this' | 'next';
  refreshNews: () => Promise<void>; refreshCalendar: (week?: 'this' | 'next') => Promise<void>;
}
export const useNews = create<NewsState>()((set, get) => ({
  items: [], sourceStatus: {}, calendar: [], calendarStatus: 'idle', calendarWeek: 'this',
  refreshNews: async () => {
    const status = { ...get().sourceStatus }; NEWS_SOURCES.forEach(s => (status[s.id] = 'loading')); set({ sourceStatus: status });
    const results = await Promise.allSettled(NEWS_SOURCES.map(async s => parseFeed(await fetchText(s.url), s)));
    const all: NewsItem[] = []; const st: Record<string, 'ok' | 'error' | 'loading'> = {};
    results.forEach((r, i) => { const s = NEWS_SOURCES[i]; if (r.status === 'fulfilled') { st[s.id] = 'ok'; all.push(...r.value); } else st[s.id] = 'error'; });
    const merged = dedupe([...all, ...get().items.filter(i => Date.now() - i.ts < 3 * 86400e3)]).slice(0, 400);
    set({ items: merged, sourceStatus: st, lastNews: Date.now() });
  },
  refreshCalendar: async (week = get().calendarWeek) => {
    set({ calendarStatus: 'loading', calendarWeek: week });
    try { const ev = parseFF(await fetchText(week === 'next' ? FF_URLS.nextWeek : FF_URLS.thisWeek)); set({ calendar: ev, calendarStatus: 'ok', lastCalendar: Date.now(), calendarError: undefined }); }
    catch (e) { set({ calendarStatus: 'error', calendarError: e instanceof Error ? e.message : String(e) }); }
  },
}));
