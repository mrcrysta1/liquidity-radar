import { describe, it, expect } from 'vitest';
import { parseFF, groupByDay, actualTone } from './forexFactory';
import { dedupe, importance, type NewsItem } from './rss';
// Node-only bits, loosely typed: pro-terminal's tsconfig carries no Node types.
const nodeMod = (id: string): Promise<any> => import(/* @vite-ignore */ id);
const proc = (globalThis as any).process;
const sample = JSON.stringify([
  { title: 'Core CPI m/m', country: 'USD', date: '2026-09-15T08:30:00-04:00', impact: 'High', forecast: '0.3%', previous: '0.2%', actual: '0.4%' },
  { title: 'Unemployment Claims', country: 'USD', date: '2026-09-17T08:30:00-04:00', impact: 'Medium', forecast: '230K', previous: '228K', actual: '240K' },
  { title: 'Bank Holiday', country: 'JPY', date: '2026-09-15T00:00:00-04:00', impact: 'Holiday' },
  // 01:00 New York = previous evening west of New York: lands a day before the holiday's FF date there.
  { title: 'Trade Balance', country: 'AUD', date: '2026-09-15T01:00:00-04:00', impact: 'Low' },
]);
type Grouped = { date: string; titles: string[] }[];
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Calendar day of `ts` in `timeZone`, independent of the process zone. */
const ymdIn = (ts: number, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts);
/** Timed rows sit under their local day in `zone`; the all-day holiday always sits first under its FF date; days ascend. */
function expectGrouping(groups: Grouped, zone: string) {
  const ev = parseFF(sample);
  const dates = groups.map(g => g.date);
  expect([...dates].sort()).toEqual(dates);
  expect(new Set(dates).size).toBe(dates.length);
  const want = new Map<string, string>();
  for (const e of ev) want.set(e.title, e.allDay ? '2026-09-15' : ymdIn(e.ts, zone));
  expect(dates).toEqual([...new Set(want.values())].sort());
  for (const g of groups) for (const t of g.titles) expect([t, g.date]).toEqual([t, want.get(t)]);
  const hol = groups.find(g => g.titles.includes('Bank Holiday'))!;
  expect(hol.date).toBe('2026-09-15');
  expect(hol.titles[0]).toBe('Bank Holiday');
}
describe('forex factory', () => {
  it('parses, sorts, flags the holiday as all-day on its FF date', () => {
    const ev = parseFF(sample); expect(ev.length).toBe(4); expect(ev[0].title).toBe('Bank Holiday');
    expect(ev[0].allDay).toBe(true); expect(ev[0].day).toBe('2026-09-15'); expect(ev.filter(e => e.allDay).length).toBe(1);
  });
  it('groups by day in the process zone', () => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expectGrouping(groupByDay(parseFF(sample)).map(g => ({ date: ymdLocal(g.date), titles: g.events.map(e => e.title) })), zone);
  });
  it('group key and label date agree', () => { for (const g of groupByDay(parseFF(sample))) expect(g.day).toBe(g.date.toDateString()); });
  // Re-run the real module in child processes pinned to each zone, so one `npm test` covers viewers east and west of New York.
  it.each(['America/Los_Angeles', 'America/Chicago', 'America/New_York', 'UTC', 'Asia/Karachi', 'Pacific/Auckland'])('groups by day under TZ=%s', async zone => {
    const { execFileSync } = await nodeMod('node:child_process');
    const mod = new URL('./forexFactory.ts', import.meta.url).href;
    const code = `const { parseFF, groupByDay } = await import(process.argv[1]); const p = n => String(n).padStart(2, '0');
      const groups = groupByDay(parseFF(process.argv[2])).map(g => ({ date: g.date.getFullYear() + '-' + p(g.date.getMonth() + 1) + '-' + p(g.date.getDate()), titles: g.events.map(e => e.title) }));
      console.log(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, groups }));`;
    const out: string = execFileSync(proc.execPath, ['--no-warnings', '--input-type=module', '-e', code, mod, sample], { env: { ...proc.env, TZ: zone }, encoding: 'utf8' });
    const { zone: seen, groups } = JSON.parse(out) as { zone: string; groups: Grouped };
    expect(seen).toBe(zone);
    expectGrouping(groups, zone);
  });
  it('actual tone (inverted for claims)', () => { const ev = parseFF(sample); expect(actualTone(ev.find(e => e.title.includes('CPI'))!)).toBe('better'); expect(actualTone(ev.find(e => e.title.includes('Claims'))!)).toBe('worse'); });
});
describe('rss utils', () => {
  const mk = (t: string, ts: number, source = 'a'): NewsItem => ({ id: t + ts, title: t, link: '', source, ts, category: 'crypto' });
  it('dedupes near-identical titles within 6h', () => { const out = dedupe([mk('SEC approves spot ETF for XRP today', 1000), mk('SEC approves spot ETF for XRP today - report', 2000, 'b'), mk('Other', 3000)]); expect(out.length).toBe(2); });
  it('importance heuristic', () => { expect(importance(mk('Fed holds rates, Powell signals cut', 0))).toBeGreaterThanOrEqual(2); expect(importance(mk('Weekly meme roundup', 0))).toBe(0); });
});
