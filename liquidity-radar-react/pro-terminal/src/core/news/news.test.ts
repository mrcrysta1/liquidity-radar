import { describe, it, expect } from 'vitest';
import { parseFF, groupByDay, actualTone } from './forexFactory';
import { dedupe, importance, type NewsItem } from './rss';
describe('forex factory', () => {
  const sample = JSON.stringify([
    { title: 'Core CPI m/m', country: 'USD', date: '2026-09-15T08:30:00-04:00', impact: 'High', forecast: '0.3%', previous: '0.2%', actual: '0.4%' },
    { title: 'Unemployment Claims', country: 'USD', date: '2026-09-17T08:30:00-04:00', impact: 'Medium', forecast: '230K', previous: '228K', actual: '240K' },
    { title: 'Bank Holiday', country: 'JPY', date: '2026-09-15T00:00:00-04:00', impact: 'Holiday' },
  ]);
  it('parses, sorts, groups by day', () => { const ev = parseFF(sample); expect(ev.length).toBe(3); expect(ev[0].title).toBe('Bank Holiday'); expect(groupByDay(ev).length).toBe(2); });
  it('actual tone (inverted for claims)', () => { const ev = parseFF(sample); expect(actualTone(ev.find(e => e.title.includes('CPI'))!)).toBe('better'); expect(actualTone(ev.find(e => e.title.includes('Claims'))!)).toBe('worse'); });
});
describe('rss utils', () => {
  const mk = (t: string, ts: number, source = 'a'): NewsItem => ({ id: t + ts, title: t, link: '', source, ts, category: 'crypto' });
  it('dedupes near-identical titles within 6h', () => { const out = dedupe([mk('SEC approves spot ETF for XRP today', 1000), mk('SEC approves spot ETF for XRP today - report', 2000, 'b'), mk('Other', 3000)]); expect(out.length).toBe(2); });
  it('importance heuristic', () => { expect(importance(mk('Fed holds rates, Powell signals cut', 0))).toBeGreaterThanOrEqual(2); expect(importance(mk('Weekly meme roundup', 0))).toBe(0); });
});
