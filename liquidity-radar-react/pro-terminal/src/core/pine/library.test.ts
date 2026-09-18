import { describe, it, expect } from 'vitest';
import { PINE_LIBRARY } from './library';
import { runPine } from './runtime';
const c = Array.from({ length: 400 }, (_, i) => { const o = 100 + Math.sin(i / 7) * 10 + i * 0.05; const cl = o + Math.cos(i / 3) * 2; return { time: 1_700_000_000 + i * 900, open: o, high: Math.max(o, cl) + 1, low: Math.min(o, cl) - 1, close: cl, volume: 100 + (i % 9) }; });
describe('Pine built-in library', () => {
  for (const item of PINE_LIBRARY) it(`${item.name} compiles, runs and plots finite values`, () => {
    const r = runPine(item.script, c);
    expect(r.plots.length).toBeGreaterThan(0);
    const anyFinite = r.plots.some(p => p.values.slice(-50).some(v => v != null && Number.isFinite(v)));
    expect(anyFinite).toBe(true);
  });
});
