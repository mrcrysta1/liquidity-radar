import { useEffect, useMemo, useState } from 'react';
import { useNews } from '@/store/useNews';
import { NEWS_SOURCES, importance, type NewsItem } from '@/core/news/rss';
import { groupByDay, actualTone, type CalendarEvent, type Impact } from '@/core/news/forexFactory';

const ago = (ts: number) => { const m = Math.max(0, Math.round((Date.now() - ts) / 60000)); return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };
const CATS: { id: NewsItem['category'] | 'all'; l: string }[] = [{ id: 'all', l: 'All' }, { id: 'crypto', l: 'Crypto' }, { id: 'markets', l: 'Markets' }, { id: 'macro', l: 'Macro' }, { id: 'regulatory', l: 'Regulatory' }];
const IMPACTS: Impact[] = ['High', 'Medium', 'Low', 'Holiday'];
const CCY = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'CNY'];

export function NewsView({ compact = false }: { compact?: boolean }) {
  const { items, sourceStatus, lastNews, refreshNews, calendar, calendarStatus, calendarError, lastCalendar, refreshCalendar, calendarWeek } = useNews();
  const [tab, setTab] = useState<'news' | 'calendar'>('news'); const [q, setQ] = useState(''); const [cat, setCat] = useState<typeof CATS[number]['id']>('all'); const [src, setSrc] = useState('all');
  const [imp, setImp] = useState<Set<Impact>>(new Set(['High', 'Medium', 'Low', 'Holiday'])); const [ccy, setCcy] = useState<Set<string>>(new Set(CCY)); const [now, setNow] = useState(Date.now());
  useEffect(() => { refreshNews(); refreshCalendar(); const a = setInterval(refreshNews, 60_000); const b = setInterval(() => refreshCalendar(), 5 * 60_000); const c = setInterval(() => setNow(Date.now()), 30_000); return () => { clearInterval(a); clearInterval(b); clearInterval(c); }; }, []);
  const list = useMemo(() => items.filter(i => (cat === 'all' || i.category === cat) && (src === 'all' || i.source === src) && (!q || (i.title + ' ' + (i.summary ?? '')).toLowerCase().includes(q.toLowerCase()))), [items, cat, src, q]);
  const days = useMemo(() => groupByDay(calendar.filter(e => imp.has(e.impact) && (ccy.has(e.currency) || !CCY.includes(e.currency)))), [calendar, imp, ccy]);
  const nextEvent = calendar.find(e => e.ts > now && e.impact !== 'Holiday');
  const okCount = Object.values(sourceStatus).filter(s => s === 'ok').length;
  const toggle = <T,>(set: Set<T>, v: T, fn: (s: Set<T>) => void) => { const n = new Set(set); n.has(v) ? n.delete(v) : n.add(v); fn(n); };
  return (
    <section className={`news ${compact ? 'compact' : ''}`} aria-label="News and calendar">
      <header className="news-head">
        <div className="seg"><button className={tab === 'news' ? 'on' : ''} onClick={() => setTab('news')}>Live news</button><button className={tab === 'calendar' ? 'on' : ''} onClick={() => setTab('calendar')}>Economic calendar</button></div>
        {tab === 'news' ? <>
          <input className="q" placeholder="Search headlines" value={q} onChange={e => setQ(e.target.value)} />
          <div className="seg">{CATS.map(c => <button key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.l}</button>)}</div>
          <select value={src} onChange={e => setSrc(e.target.value)}><option value="all">All sources</option>{NEWS_SOURCES.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select>
          <span className="spacer" /><span className="stat-chip"><i className={okCount ? 'dot ok' : 'dot bad'} />{okCount}/{NEWS_SOURCES.length} feeds · {lastNews ? `updated ${ago(lastNews)} ago` : 'loading…'}</span>
          <button onClick={refreshNews}>Refresh</button>
        </> : <>
          <div className="seg"><button className={calendarWeek === 'this' ? 'on' : ''} onClick={() => refreshCalendar('this')}>This week</button><button className={calendarWeek === 'next' ? 'on' : ''} onClick={() => refreshCalendar('next')}>Next week</button></div>
          <div className="seg impact-filter">{IMPACTS.map(i => <button key={i} className={imp.has(i) ? 'on' : ''} onClick={() => toggle(imp, i, setImp)} title={`${i} impact`}><span className={`ff-impact ${i.toLowerCase()}`} />{i}</button>)}</div>
          <div className="seg ccy-filter">{CCY.map(c => <button key={c} className={ccy.has(c) ? 'on' : ''} onClick={() => toggle(ccy, c, setCcy)}>{c}</button>)}</div>
          <span className="spacer" /><span className="stat-chip"><i className={`dot ${calendarStatus === 'ok' ? 'ok' : calendarStatus === 'error' ? 'bad' : ''}`} />Forex Factory · {calendarStatus === 'ok' && lastCalendar ? `updated ${ago(lastCalendar)} ago` : calendarStatus === 'error' ? 'unavailable' : 'loading…'}</span>
          <button onClick={() => refreshCalendar()}>Refresh</button>
        </>}
      </header>
      {tab === 'news' ? (
        <div className="news-list">
          {list.length === 0 && <div className="empty">{lastNews ? 'No headlines match.' : 'Loading feeds… (RSS is fetched through the local proxy; run `npm run dev` or `node server/proxy.mjs`).'}</div>}
          {list.map(it => { const s = importance(it); return (
            <a key={it.id} className={`news-row imp${s}`} href={it.link} target="_blank" rel="noreferrer noopener">
              <span className="news-time">{ago(it.ts)}</span>
              <span className="news-body"><span className="news-title">{it.title}</span>{!compact && it.summary && <span className="news-sum">{it.summary}</span>}</span>
              <span className="news-src">{it.source}</span>
              <span className={`news-cat ${it.category}`}>{it.category}</span>
            </a>); })}
        </div>
      ) : (
        <div className="ff">
          {calendarStatus === 'error' && <div className="empty">Calendar unavailable: {calendarError}. The feed is fetched via the proxy (allow-listed host nfs.faireconomy.media).</div>}
          <table className="ff-table">
            <thead><tr><th className="ff-date">Date</th><th className="ff-time">Time</th><th className="ff-ccy">Currency</th><th className="ff-imp">Impact</th><th className="ff-event">Event</th><th className="ff-num">Actual</th><th className="ff-num">Forecast</th><th className="ff-num">Previous</th></tr></thead>
            <tbody>
              {days.map(g => {
                const isToday = g.date.toDateString() === new Date().toDateString(); let lastTime = '';
                return [<tr key={g.day} className={`ff-day ${isToday ? 'today' : ''}`}><td colSpan={8}>{g.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}{isToday ? ' · Today' : ''}</td></tr>,
                  ...g.events.map(e => { const t = e.allDay || e.impact === 'Holiday' ? 'All Day' : new Date(e.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); const showTime = t !== lastTime; lastTime = t; const tone = actualTone(e); const isNext = nextEvent?.id === e.id; const past = e.ts < now;
                    return <tr key={e.id} className={`ff-row ${isNext ? 'next' : ''} ${past ? 'past' : ''}`} title={`${e.title} · ${e.currency} · ${e.impact} impact`}>
                      <td className="ff-date" />
                      <td className="ff-time">{showTime ? t : ''}{isNext && <span className="ff-next">next</span>}</td>
                      <td className="ff-ccy"><b>{e.currency}</b></td>
                      <td className="ff-imp"><span className={`ff-impact ${e.impact.toLowerCase()}`} /></td>
                      <td className="ff-event">{e.title}</td>
                      <td className={`ff-num ${tone}`}>{e.actual ?? ''}</td>
                      <td className="ff-num">{e.forecast ?? ''}</td>
                      <td className="ff-num">{e.previous ?? ''}</td>
                    </tr>; })];
              })}
            </tbody>
          </table>
          {calendarStatus === 'ok' && days.length === 0 && <div className="empty">No events for the selected filters.</div>}
          <div className="ff-legend"><span className="ff-impact high" /> High <span className="ff-impact medium" /> Medium <span className="ff-impact low" /> Low <span className="ff-impact holiday" /> Holiday · times in your local timezone · actual shown green when better than forecast for the currency, red when worse</div>
        </div>
      )}
    </section>
  );
}
