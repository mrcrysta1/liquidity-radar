import { describe, it, expect } from 'vitest';
import { runPine } from './runtime';
import { rsi, ema, sma, macd } from '../indicators';
const c = Array.from({ length: 300 }, (_, i) => { const o = 100 + Math.sin(i / 7) * 10 + i * 0.05; const cl = o + Math.cos(i / 3) * 2; return { time: 1_700_000_000 + i * 900, open: o, high: Math.max(o, cl) + 1, low: Math.min(o, cl) - 1, close: cl, volume: 100 + (i % 9) }; });
const close = c.map(k => k.close);
const last = (a: (number | null)[]) => a[a.length - 1] as number;
describe('Pine runtime', () => {
  it('RSI script matches native implementation', () => {
    const r = runPine(`//@version=5
indicator("RSI", overlay=false)
len = input.int(14, "Length", minval=1)
src = input.source(close, "Source")
up = ta.rma(math.max(ta.change(src), 0), len)
down = ta.rma(-math.min(ta.change(src), 0), len)
rsi = down == 0 ? 100 : up == 0 ? 0 : 100 - (100 / (1 + up / down))
plot(rsi, "RSI", color=color.purple)
hline(70)
hline(30)
plot(ta.rsi(src, len), "RSI builtin")`, c);
    expect(r.overlay).toBe(false); expect(r.inputs.map(i => i.title)).toEqual(['Length', 'Source']); expect(r.hlines.length).toBe(2);
    expect(last(r.plots[0].values)).toBeCloseTo(last(rsi(close, 14)), 6); expect(last(r.plots[1].values)).toBeCloseTo(last(r.plots[0].values), 9);
  });
  it('input overrides, var/:=, history, user function, tuple', () => {
    const r = runPine(`indicator("t", overlay=true)
f = input(12, "Fast")
myema(s, l) => ta.ema(s, l)
var int count = 0
count := count + 1
[m, sg, h] = ta.macd(close, f, 26, 9)
plot(myema(close, 20), "e20")
plot(close[1], "prev")
plot(count, "count")
plot(h, "hist", style=plot.style_histogram)`, c, { Fast: 10 });
    expect(r.overlay).toBe(true);
    expect(last(r.plots[0].values)).toBeCloseTo(last(ema(close, 20)), 6);
    expect(last(r.plots[1].values)).toBeCloseTo(close[close.length - 2], 9);
    expect(last(r.plots[2].values)).toBe(300);
    expect(last(r.plots[3].values)).toBeCloseTo(last(macd(close, 10, 26, 9).hist), 6);
  });
  it('if/else blocks, for loop, crossover, plotshape', () => {
    const r = runPine(`indicator("x")
fast = ta.sma(close, 5)
slow = ta.sma(close, 20)
col = fast > slow ? color.green : color.red
sum = 0.0
for i = 0 to 4
    sum := sum + close[i]
avg5 = sum / 5
sig = 0
if ta.crossover(fast, slow)
    sig := 1
else if ta.crossunder(fast, slow)
    sig := -1
plot(fast, "fast", color=col)
plot(avg5, "avg5")
plotshape(sig == 1, style=shape.triangleup, location=location.belowbar, color=color.green)`, c);
    expect(last(r.plots[0].values)).toBeCloseTo(last(sma(close, 5)), 6);
    expect(last(r.plots[1].values)).toBeCloseTo(last(sma(close, 5)), 6);
    expect(r.shapes.length).toBeGreaterThan(2); expect(r.plots[0].colors?.some(Boolean)).toBe(true);
  });
  it('supertrend / dmi / stoch tuples run without error', () => {
    const r = runPine(`indicator("st", overlay=true)
[st, dir] = ta.supertrend(3, 10)
[dp, dm, adx] = ta.dmi(14, 14)
k = ta.stoch(close, high, low, 14)
plot(st)
plot(adx)
plot(k)`, c);
    expect(r.plots.length).toBe(3); r.plots.forEach(p => expect(Number.isFinite(last(p.values)!)).toBe(true));
  });
  it('reports syntax and unknown-identifier errors with line numbers', () => {
    expect(() => runPine('indicator("e")\nplot(ta.sma(close, 14)', c)).toThrow(/Line 2/);
    expect(() => runPine('indicator("e")\nplot(foo)', c)).toThrow(/Undeclared identifier 'foo'/);
  });
});
