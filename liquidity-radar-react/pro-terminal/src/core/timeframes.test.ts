import { describe, it, expect } from 'vitest';
import { parseTimeframe, baseFor, fmtTf } from './timeframes';
describe('timeframes', () => {
  it('parses custom', () => { expect(parseTimeframe('45m')).toBe(2700); expect(parseTimeframe('7m')).toBe(420); expect(parseTimeframe('3d')).toBe(259200); expect(parseTimeframe('x')).toBeNull(); });
  it('base selection', () => { expect(baseFor(2700)).toEqual({ base: '15m', factor: 3 }); expect(baseFor(420)).toEqual({ base: '1m', factor: 7 }); expect(baseFor(15)).toEqual({ base: '1s', factor: 15 }); expect(baseFor(3600).base).toBe('1h'); });
  it('formats', () => { expect(fmtTf(2700)).toBe('45m'); expect(fmtTf(30)).toBe('30s'); });
});
