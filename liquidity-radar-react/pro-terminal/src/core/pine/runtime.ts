import type { Candle } from '../providers/types';
import { parse, PineError, type Expr, type Stmt } from './parser';

export interface PinePlot { key: string; title: string; style: 'line' | 'histogram' | 'columns' | 'area' | 'circles' | 'stepline' | 'cross'; color: string; colors?: (string | undefined)[]; linewidth: number; values: (number | null)[] }
export interface PineHLine { title: string; price: number; color: string }
export interface PineShape { bar: number; text?: string; color: string; position: 'above' | 'below'; shape: string }
export interface PineInput { key: string; title: string; type: 'int' | 'float' | 'bool' | 'string' | 'source'; def: number | boolean | string; min?: number; max?: number; step?: number; options?: string[] }
export interface PineResult { title: string; overlay: boolean; plots: PinePlot[]; hlines: PineHLine[]; shapes: PineShape[]; inputs: PineInput[]; warnings: string[] }

type Val = number | boolean | string | Val[] | FnRef | null | undefined;
interface FnRef { fn: true; name: string; params: string[]; body: Stmt[] }
const NA = NaN;
const num = (v: Val): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN);
const isNa = (v: Val) => v == null || (typeof v === 'number' && Number.isNaN(v));
const truthy = (v: Val) => (typeof v === 'boolean' ? v : typeof v === 'number' ? !Number.isNaN(v) && v !== 0 : !!v);

const COLORS: Record<string, string> = { 'color.red': '#f23645', 'color.green': '#089981', 'color.blue': '#2962ff', 'color.orange': '#ff9800', 'color.purple': '#9c27b0', 'color.yellow': '#fdd835', 'color.white': '#ffffff', 'color.black': '#000000', 'color.gray': '#787b86', 'color.silver': '#b2b5be', 'color.aqua': '#00bcd4', 'color.lime': '#00e676', 'color.maroon': '#880e4f', 'color.navy': '#311b92', 'color.olive': '#808000', 'color.teal': '#00897b', 'color.fuchsia': '#e040fb' };
const CONSTS: Record<string, Val> = { true: true, false: false, na: NA, 'math.pi': Math.PI, 'math.e': Math.E, 'plot.style_line': 'line', 'plot.style_histogram': 'histogram', 'plot.style_columns': 'columns', 'plot.style_area': 'area', 'plot.style_circles': 'circles', 'plot.style_stepline': 'stepline', 'plot.style_cross': 'cross', 'plot.style_linebr': 'line', 'plot.style_areabr': 'area', 'plot.style_stepline_diamond': 'stepline', 'location.abovebar': 'above', 'location.belowbar': 'below', 'location.top': 'above', 'location.bottom': 'below', 'location.absolute': 'above', 'shape.triangleup': 'arrowUp', 'shape.triangledown': 'arrowDown', 'shape.arrowup': 'arrowUp', 'shape.arrowdown': 'arrowDown', 'shape.circle': 'circle', 'shape.square': 'square', 'shape.cross': 'circle', 'shape.xcross': 'circle', 'shape.labelup': 'arrowUp', 'shape.labeldown': 'arrowDown', 'shape.flag': 'square', 'shape.diamond': 'circle', 'size.tiny': 'tiny', 'size.small': 'small', 'size.normal': 'normal', 'size.large': 'large', 'size.huge': 'huge', 'size.auto': 'auto', 'display.all': 'all', 'display.none': 'none', 'format.price': 'price', 'format.volume': 'volume', 'format.percent': 'percent', 'format.inherit': 'inherit', 'timeframe.period': '', 'syminfo.tickerid': '', 'syminfo.ticker': '', 'syminfo.mintick': 0.01, 'barmerge.gaps_off': 0, 'barmerge.gaps_on': 1, 'barmerge.lookahead_off': 0, 'barmerge.lookahead_on': 1, 'extend.none': 'none', 'extend.both': 'both', 'hline.style_dashed': 'dashed', 'hline.style_dotted': 'dotted', 'hline.style_solid': 'solid', 'line.style_dashed': 'dashed', 'line.style_solid': 'solid', 'xloc.bar_index': 0, 'yloc.price': 0, 'strategy.long': 'long', 'strategy.short': 'short', ...COLORS };

class CS { hist: number[] = []; st: Record<string, any> = {}; subs = new Map<string, CS>(); sub(k: string) { let c = this.subs.get(k); if (!c) { c = new CS(); this.subs.set(k, c); } return c; } }

export function runPine(source: string, candles: Candle[], inputOverrides: Record<string, number | boolean | string> = {}): PineResult {
  const prog = parse(source);
  const n = candles.length;
  const res: PineResult = { title: 'Pine script', overlay: false, plots: [], hlines: [], shapes: [], inputs: [], warnings: [] };
  const plotsByKey = new Map<string, PinePlot>(); const hlineKeys = new Set<string>(); const inputKeys = new Map<string, PineInput>(); let inputOrdinal = 0;
  const fns = new Map<string, FnRef>(); const globals = new Map<string, Val[]>(); const varInit = new Set<string>();
  const nodeBuf = new Map<string, Val[]>(); const calls = new Map<string, CS>();
  let bar = 0; let scopePath = ''; let localScope: Map<string, Val[]> | null = null; let loopIter = '';
  const C = { open: candles.map(c => c.open), high: candles.map(c => c.high), low: candles.map(c => c.low), close: candles.map(c => c.close), volume: candles.map(c => c.volume), time: candles.map(c => c.time * 1000) };
  const seriesAt = (name: string, i: number): number | undefined => {
    if (i < 0) return NA;
    switch (name) { case 'open': return C.open[i]; case 'high': return C.high[i]; case 'low': return C.low[i]; case 'close': return C.close[i]; case 'volume': return C.volume[i]; case 'time': return C.time[i];
      case 'hl2': return (C.high[i] + C.low[i]) / 2; case 'hlc3': return (C.high[i] + C.low[i] + C.close[i]) / 3; case 'ohlc4': return (C.open[i] + C.high[i] + C.low[i] + C.close[i]) / 4; case 'hlcc4': return (C.high[i] + C.low[i] + 2 * C.close[i]) / 4;
      case 'bar_index': return i; case 'last_bar_index': return n - 1; case 'barstate.islast': return i === n - 1 ? 1 : 0; case 'barstate.isfirst': return i === 0 ? 1 : 0; case 'barstate.isconfirmed': return 1; default: return undefined; }
  };
  const cs = (id: number, extra = '') => { const k = `${scopePath}${loopIter}/${id}${extra}`; let c = calls.get(k); if (!c) { c = new CS(); calls.set(k, c); } return c; };
  const store = (m: Map<string, Val[]>, name: string, v: Val) => { let a = m.get(name); if (!a) { a = []; m.set(name, a); } a[bar] = v; };
  const lookup = (name: string, back = 0): Val => {
    const i = bar - back; if (i < 0) return NA;
    if (localScope) { const a = localScope.get(name); if (a) return a[i] ?? NA; }
    const g = globals.get(name); if (g) return g[i] ?? NA;
    const s = seriesAt(name, i); if (s !== undefined) return s;
    if (name in CONSTS) return CONSTS[name];
    if (fns.has(name)) return fns.get(name)!;
    throw new PineError(`Undeclared identifier '${name}'`);
  };

  // ---------- ta / math built-ins (all per call-site, incremental where it matters) ----------
  const H = (c: CS, v: number) => { c.hist[bar] = v; return c.hist; };
  const hget = (h: number[], k: number) => (bar - k >= 0 ? h[bar - k] ?? NA : NA);
  const window = (h: number[], len: number) => { if (bar - len + 1 < 0) return null; const w: number[] = []; for (let k = 0; k < len; k++) { const v = hget(h, k); if (Number.isNaN(v) || v == null) return null; w.push(v); } return w; };
  const T = {
    sma(c: CS, src: number, len: number) { const h = H(c, src); const w = window(h, len); return w ? w.reduce((a, b) => a + b, 0) / len : NA; },
    ema(c: CS, src: number, len: number) { H(c, src); const a = 2 / (len + 1); if (Number.isNaN(src)) return c.st.prev ?? NA; if (c.st.prev == null) { const w = window(c.hist, len); if (!w) return NA; c.st.prev = w.reduce((x, y) => x + y, 0) / len; return c.st.prev; } c.st.prev = src * a + c.st.prev * (1 - a); return c.st.prev; },
    rma(c: CS, src: number, len: number) { H(c, src); const a = 1 / len; if (Number.isNaN(src)) return c.st.prev ?? NA; if (c.st.prev == null) { const w = window(c.hist, len); if (!w) return NA; c.st.prev = w.reduce((x, y) => x + y, 0) / len; return c.st.prev; } c.st.prev = src * a + c.st.prev * (1 - a); return c.st.prev; },
    wma(c: CS, src: number, len: number) { const w = window(H(c, src), len); if (!w) return NA; let s = 0, d = 0; for (let k = 0; k < len; k++) { s += w[k] * (len - k); d += len - k; } return s / d; },
    vwma(c: CS, src: number, len: number) { const pv = T.sma(c.sub('pv'), src * C.volume[bar], len); const v = T.sma(c.sub('v'), C.volume[bar], len); return pv / v; },
    hma(c: CS, src: number, len: number) { const h = Math.max(1, Math.floor(len / 2)), r = Math.max(1, Math.round(Math.sqrt(len))); const d = 2 * T.wma(c.sub('a'), src, h) - T.wma(c.sub('b'), src, len); return T.wma(c.sub('c'), d, r); },
    swma(c: CS, src: number) { const w = window(H(c, src), 4); return w ? w[3] / 6 + w[2] * 2 / 6 + w[1] * 2 / 6 + w[0] / 6 : NA; },
    change(c: CS, src: number, len = 1) { const h = H(c, src); const p = hget(h, len); return src - p; },
    mom(c: CS, src: number, len: number) { return T.change(c, src, len); },
    roc(c: CS, src: number, len: number) { const h = H(c, src); const p = hget(h, len); return ((src - p) / p) * 100; },
    highest(c: CS, src: number, len: number) { const w = window(H(c, src), len); return w ? Math.max(...w) : NA; },
    lowest(c: CS, src: number, len: number) { const w = window(H(c, src), len); return w ? Math.min(...w) : NA; },
    highestbars(c: CS, src: number, len: number) { const w = window(H(c, src), len); if (!w) return NA; let m = 0; w.forEach((v, k) => { if (v > w[m]) m = k; }); return -m; },
    lowestbars(c: CS, src: number, len: number) { const w = window(H(c, src), len); if (!w) return NA; let m = 0; w.forEach((v, k) => { if (v < w[m]) m = k; }); return -m; },
    sum(c: CS, src: number, len: number) { const w = window(H(c, src), len); return w ? w.reduce((a, b) => a + b, 0) : NA; },
    cum(c: CS, src: number) { c.st.s = (c.st.s ?? 0) + (Number.isNaN(src) ? 0 : src); return c.st.s; },
    stdev(c: CS, src: number, len: number) { const w = window(H(c, src), len); if (!w) return NA; const m = w.reduce((a, b) => a + b, 0) / len; return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / len); },
    variance(c: CS, src: number, len: number) { const s = T.stdev(c, src, len); return s * s; },
    dev(c: CS, src: number, len: number) { const w = window(H(c, src), len); if (!w) return NA; const m = w.reduce((a, b) => a + b, 0) / len; return w.reduce((a, b) => a + Math.abs(b - m), 0) / len; },
    tr(_c: CS, handleNa = false) { if (bar === 0) return handleNa ? C.high[0] - C.low[0] : NA; const pc = C.close[bar - 1]; return Math.max(C.high[bar] - C.low[bar], Math.abs(C.high[bar] - pc), Math.abs(C.low[bar] - pc)); },
    atr(c: CS, len: number) { return T.rma(c, T.tr(c, true), len); },
    rsi(c: CS, src: number, len: number) { const ch = T.change(c.sub('ch'), src, 1); const up = T.rma(c.sub('u'), Number.isNaN(ch) ? NA : Math.max(ch, 0), len); const dn = T.rma(c.sub('d'), Number.isNaN(ch) ? NA : Math.max(-ch, 0), len); if (Number.isNaN(up)) return NA; return dn === 0 ? 100 : up === 0 ? 0 : 100 - 100 / (1 + up / dn); },
    macd(c: CS, src: number, f: number, s: number, sig: number) { const m = T.ema(c.sub('f'), src, f) - T.ema(c.sub('s'), src, s); const g = T.ema(c.sub('g'), m, sig); return [m, g, m - g]; },
    stoch(c: CS, src: number, hi: number, lo: number, len: number) { const hh = T.highest(c.sub('h'), hi, len), ll = T.lowest(c.sub('l'), lo, len); H(c, src); return hh === ll ? 50 : ((src - ll) / (hh - ll)) * 100; },
    bb(c: CS, src: number, len: number, mult: number) { const b = T.sma(c.sub('m'), src, len); const d = T.stdev(c.sub('s'), src, len) * mult; return [b, b + d, b - d]; },
    bbw(c: CS, src: number, len: number, mult: number) { const [b, u, l] = T.bb(c, src, len, mult) as number[]; return (u - l) / b; },
    kc(c: CS, src: number, len: number, mult: number, useTr = true) { const b = T.ema(c.sub('m'), src, len); const r = T.rma(c.sub('r'), useTr ? T.tr(c, true) : C.high[bar] - C.low[bar], len) * mult; return [b, b + r, b - r]; },
    cci(c: CS, src: number, len: number) { const m = T.sma(c.sub('m'), src, len); const d = T.dev(c.sub('d'), src, len); return (src - m) / (0.015 * d); },
    wpr(c: CS, len: number) { const hh = T.highest(c.sub('h'), C.high[bar], len), ll = T.lowest(c.sub('l'), C.low[bar], len); return ((hh - C.close[bar]) / (hh - ll)) * -100; },
    mfi(c: CS, src: number, len: number) { const ch = T.change(c.sub('c'), src, 1); const mf = src * C.volume[bar]; const pos = T.sum(c.sub('p'), ch > 0 ? mf : 0, len), neg = T.sum(c.sub('n'), ch < 0 ? mf : 0, len); if (Number.isNaN(ch)) return NA; return 100 - 100 / (1 + pos / neg); },
    obv(c: CS) { const ch = T.change(c.sub('c'), C.close[bar], 1); return T.cum(c, Number.isNaN(ch) ? 0 : Math.sign(ch) * C.volume[bar]); },
    vwap(c: CS, src: number) { const d = Math.floor(candles[bar].time / 86400); if (c.st.day !== d) { c.st.day = d; c.st.pv = 0; c.st.v = 0; } c.st.pv += src * C.volume[bar]; c.st.v += C.volume[bar]; return c.st.v ? c.st.pv / c.st.v : NA; },
    crossover(c: CS, a: number, b: number) { const ha = H(c.sub('a'), a), hb = H(c.sub('b'), b); const pa = hget(ha, 1), pb = hget(hb, 1); return a > b && pa <= pb; },
    crossunder(c: CS, a: number, b: number) { const ha = H(c.sub('a'), a), hb = H(c.sub('b'), b); const pa = hget(ha, 1), pb = hget(hb, 1); return a < b && pa >= pb; },
    cross(c: CS, a: number, b: number) { return T.crossover(c.sub('o'), a, b) || T.crossunder(c.sub('u'), a, b); },
    barssince(c: CS, cond: boolean) { if (cond) c.st.last = bar; return c.st.last == null ? NA : bar - c.st.last; },
    valuewhen(c: CS, cond: boolean, src: number, occ: number) { c.st.vals ??= []; if (cond) c.st.vals.unshift(src); return c.st.vals[occ] ?? NA; },
    rising(c: CS, src: number, len: number) { const w = window(H(c, src), len + 1); if (!w) return false; for (let k = 0; k < len; k++) if (!(w[k] > w[k + 1])) return false; return true; },
    falling(c: CS, src: number, len: number) { const w = window(H(c, src), len + 1); if (!w) return false; for (let k = 0; k < len; k++) if (!(w[k] < w[k + 1])) return false; return true; },
    pivothigh(c: CS, src: number, l: number, r: number) { const h = H(c, src); const i = bar - r; if (i - l < 0) return NA; const v = h[i]; for (let k = i - l; k <= i + r; k++) { if (k === i) continue; if (!(h[k] < v)) return NA; } return v; },
    pivotlow(c: CS, src: number, l: number, r: number) { const h = H(c, src); const i = bar - r; if (i - l < 0) return NA; const v = h[i]; for (let k = i - l; k <= i + r; k++) { if (k === i) continue; if (!(h[k] > v)) return NA; } return v; },
    linreg(c: CS, src: number, len: number, off: number) { const w = window(H(c, src), len); if (!w) return NA; const ys = w.slice().reverse(); const xm = (len - 1) / 2; const ym = ys.reduce((a, b) => a + b, 0) / len; let nu = 0, de = 0; ys.forEach((y, x) => { nu += (x - xm) * (y - ym); de += (x - xm) ** 2; }); const slope = de ? nu / de : 0; const inter = ym - slope * xm; return inter + slope * (len - 1 - off); },
    percentrank(c: CS, src: number, len: number) { const w = window(H(c, src), len + 1); if (!w) return NA; let cnt = 0; for (let k = 1; k <= len; k++) if (w[k] <= src) cnt++; return (cnt / len) * 100; },
    median(c: CS, src: number, len: number) { const w = window(H(c, src), len); if (!w) return NA; const s = w.slice().sort((a, b) => a - b); return len % 2 ? s[(len - 1) / 2] : (s[len / 2 - 1] + s[len / 2]) / 2; },
    correlation(c: CS, a: number, b: number, len: number) { const wa = window(H(c.sub('a'), a), len), wb = window(H(c.sub('b'), b), len); if (!wa || !wb) return NA; const ma = wa.reduce((x, y) => x + y, 0) / len, mb = wb.reduce((x, y) => x + y, 0) / len; let nu = 0, da = 0, db = 0; for (let k = 0; k < len; k++) { nu += (wa[k] - ma) * (wb[k] - mb); da += (wa[k] - ma) ** 2; db += (wb[k] - mb) ** 2; } return nu / Math.sqrt(da * db); },
    cmo(c: CS, src: number, len: number) { const ch = T.change(c.sub('c'), src, 1); const u = T.sum(c.sub('u'), ch > 0 ? ch : 0, len), d = T.sum(c.sub('d'), ch < 0 ? -ch : 0, len); return ((u - d) / (u + d)) * 100; },
    tsi(c: CS, src: number, s: number, l: number) { const ch = T.change(c.sub('c'), src, 1); const a = T.ema(c.sub('a'), T.ema(c.sub('b'), ch, l), s); const b = T.ema(c.sub('d'), T.ema(c.sub('e'), Math.abs(ch), l), s); return (a / b); },
    dmi(c: CS, len: number, adxLen: number) { const up = T.change(c.sub('u'), C.high[bar], 1), dn = -T.change(c.sub('d'), C.low[bar], 1); const pdm = Number.isNaN(up) ? NA : up > dn && up > 0 ? up : 0, mdm = Number.isNaN(dn) ? NA : dn > up && dn > 0 ? dn : 0; const tr = T.rma(c.sub('tr'), T.tr(c, true), len); const pdi = (T.rma(c.sub('p'), pdm, len) / tr) * 100, mdi = (T.rma(c.sub('m'), mdm, len) / tr) * 100; const dx = (Math.abs(pdi - mdi) / (pdi + mdi)) * 100; const adx = T.rma(c.sub('x'), Number.isNaN(dx) ? NA : dx, adxLen); return [pdi, mdi, adx]; },
    sar(c: CS, start: number, inc: number, max: number) { const s = c.st; if (bar < 1) { return NA; } if (s.sar == null) { s.up = C.close[bar] > C.close[bar - 1]; s.sar = s.up ? C.low[bar - 1] : C.high[bar - 1]; s.ep = s.up ? C.high[bar] : C.low[bar]; s.af = start; return s.sar; }
      let sar = s.sar + s.af * (s.ep - s.sar); if (s.up) { sar = Math.min(sar, C.low[bar - 1], C.low[bar - 2] ?? C.low[bar - 1]); if (C.low[bar] < sar) { s.up = false; sar = s.ep; s.ep = C.low[bar]; s.af = start; } else if (C.high[bar] > s.ep) { s.ep = C.high[bar]; s.af = Math.min(max, s.af + inc); } }
      else { sar = Math.max(sar, C.high[bar - 1], C.high[bar - 2] ?? C.high[bar - 1]); if (C.high[bar] > sar) { s.up = true; sar = s.ep; s.ep = C.high[bar]; s.af = start; } else if (C.low[bar] < s.ep) { s.ep = C.low[bar]; s.af = Math.min(max, s.af + inc); } }
      s.sar = sar; return sar; },
    supertrend(c: CS, factor: number, len: number) { const a = T.atr(c.sub('atr'), len); const hl2 = (C.high[bar] + C.low[bar]) / 2; let up = hl2 + factor * a, lo = hl2 - factor * a; const s = c.st; if (Number.isNaN(a)) return [NA, NA];
      const pc = C.close[bar - 1] ?? NaN; if (s.lo != null && !(lo > s.lo || pc < s.lo)) lo = s.lo; if (s.up != null && !(up < s.up || pc > s.up)) up = s.up;
      let dir: number; if (s.dir == null) dir = 1; else if (s.st === s.up) dir = C.close[bar] > up ? -1 : 1; else dir = C.close[bar] < lo ? 1 : -1;
      const st = dir === -1 ? lo : up; s.lo = lo; s.up = up; s.dir = dir; s.st = st; return [st, dir]; },
    range(c: CS, src: number, len: number) { return T.highest(c.sub('h'), src, len) - T.lowest(c.sub('l'), src, len); },
  };
  const M: Record<string, (...a: number[]) => number> = { abs: Math.abs, max: Math.max, min: Math.min, sqrt: Math.sqrt, pow: Math.pow, log: Math.log, log10: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, sign: Math.sign, sin: Math.sin, cos: Math.cos, tan: Math.tan, round: (x, p = 0) => { const m = 10 ** p; return Math.round(x * m) / m; }, avg: (...a) => a.reduce((x, y) => x + y, 0) / a.length, round_to_mintick: x => Math.round(x / 0.01) * 0.01, todegrees: x => (x * 180) / Math.PI, toradians: x => (x * Math.PI) / 180, random: () => Math.random() };

  function callBuiltin(node: Extract<Expr, { k: 'call' }>, args: Val[], named: Record<string, Val>): Val | typeof UNHANDLED {
    const f = node.f; const a = (i: number, nm?: string, def?: Val) => (args[i] !== undefined ? args[i] : nm && named[nm] !== undefined ? named[nm] : def);
    const an = (i: number, nm?: string, def?: number) => num(a(i, nm, def) as Val);
    if (f === 'indicator' || f === 'study' || f === 'strategy') { if (bar === 0) { res.title = String(a(0, 'title', res.title)); res.overlay = truthy(a(2, 'overlay', false) as Val) || truthy(named.overlay as Val); } return null; }
    if (f.startsWith('input')) {
      const kind = f === 'input' || f === 'input.float' ? 'float' : f === 'input.int' ? 'int' : f === 'input.bool' ? 'bool' : f === 'input.string' || f === 'input.timeframe' || f === 'input.session' || f === 'input.symbol' ? 'string' : f === 'input.source' ? 'source' : f === 'input.color' ? 'string' : 'float';
      const def = a(0, 'defval', 0) as Val; const title = String(a(1, 'title', `Input ${inputOrdinal + 1}`));
      const key = title; let inp = inputKeys.get(key);
      if (!inp) { inputOrdinal++; inp = { key, title, type: kind, def: kind === 'source' ? String(node.args[0]?.k === 'id' ? (node.args[0] as any).v : 'close') : (def as any), min: named.minval != null ? num(named.minval) : undefined, max: named.maxval != null ? num(named.maxval) : undefined, step: named.step != null ? num(named.step) : undefined, options: Array.isArray(named.options) ? (named.options as Val[]).map(String) : undefined }; inputKeys.set(key, inp); }
      const ov = inputOverrides[key];
      if (kind === 'source') { const nm = ov != null ? String(ov) : String(inp.def); return seriesAt(nm, bar) ?? num(lookup(nm)); }
      if (ov != null) return kind === 'bool' ? !!ov : kind === 'string' ? String(ov) : Number(ov);
      return def;
    }
    if (f === 'plot') { const key = `${scopePath}/${node.id}`; let p = plotsByKey.get(key); const col = a(2, 'color'); const style = String(a(4, 'style', 'line'));
      if (!p) { p = { key, title: String(a(1, 'title', `Plot ${plotsByKey.size + 1}`)), style: (style as any) || 'line', color: typeof col === 'string' ? col : '#2962ff', linewidth: an(3, 'linewidth', 1), values: [] }; plotsByKey.set(key, p); }
      const v = a(0, 'series'); p.values[bar] = isNa(v) || typeof v === 'boolean' ? null : num(v); if (typeof col === 'string' && col !== p.color) { p.colors ??= []; p.colors[bar] = col; } else if (p.colors) p.colors[bar] = typeof col === 'string' ? col : undefined; return null; }
    if (f === 'hline') { const key = `${scopePath}/${node.id}`; if (!hlineKeys.has(key)) { hlineKeys.add(key); res.hlines.push({ title: String(a(1, 'title', '')), price: an(0, 'price', 0), color: typeof a(2, 'color') === 'string' ? (a(2, 'color') as string) : '#787b86' }); } return null; }
    if (f === 'plotshape' || f === 'plotchar' || f === 'plotarrow') { const cond = a(0, 'series'); if (truthy(cond as Val) && !(typeof cond === 'number' && Number.isNaN(cond))) { const loc = String(a(3, 'location', f === 'plotarrow' ? (num(cond) > 0 ? 'below' : 'above') : 'above')); res.shapes.push({ bar, text: named.text != null ? String(named.text) : undefined, color: typeof a(4, 'color') === 'string' ? (a(4, 'color') as string) : '#2962ff', position: loc === 'below' ? 'below' : 'above', shape: String(a(2, 'style', f === 'plotchar' ? 'circle' : 'arrowUp')) }); } return null; }
    if (['fill', 'bgcolor', 'barcolor', 'plotcandle', 'plotbar', 'alertcondition', 'alert', 'label.new', 'line.new', 'box.new', 'table.new', 'table.cell', 'label.set_text', 'label.delete', 'line.delete', 'strategy.entry', 'strategy.exit', 'strategy.close', 'array.new_float', 'max_bars_back'].includes(f)) { if (bar === 0 && !res.warnings.includes(f)) res.warnings.push(f); return null; }
    if (f === 'na') return isNa(a(0)); if (f === 'nz') { const v = a(0); return isNa(v) ? (a(1, 'replacement', 0) as Val) : v; } if (f === 'fixnan') { const c = cs(node.id); const v = num(a(0)); if (!Number.isNaN(v)) c.st.p = v; return c.st.p ?? NA; }
    if (f === 'color.new') { const c = String(a(0, 'color')); const t = an(1, 'transp', 0); return withAlpha(c, 1 - t / 100); } if (f === 'color.rgb') return `rgba(${an(0)},${an(1)},${an(2)},${1 - an(3, 'transp', 0) / 100})`; if (f === 'color.from_gradient') { const v = an(0), lo = an(1), hi = an(2); return v <= lo ? String(a(3)) : v >= hi ? String(a(4)) : String(a(3)); }
    if (f === 'str.tostring') { const v = a(0); return typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4) : String(v); } if (f === 'str.format') return String(a(0)); if (f === 'str.contains') return String(a(0)).includes(String(a(1)));
    if (f === 'int') return Math.trunc(an(0)); if (f === 'float') return an(0); if (f === 'bool') return truthy(a(0) as Val);
    if (f === 'math.sum') return T.sum(cs(node.id), an(0), an(1));
    if (f.startsWith('math.')) { const g = M[f.slice(5)]; if (g) return g(...args.map(num)); }
    if (f.startsWith('ta.')) {
      const name = f.slice(3) as keyof typeof T; const fn = T[name] as any; if (!fn) return UNHANDLED; const c = cs(node.id);
      switch (name) {
        case 'tr': return T.tr(c, truthy(a(0, 'handle_na', false) as Val)); case 'atr': return T.atr(c, an(0, 'length', 14)); case 'obv': return T.obv(c); case 'wpr': return T.wpr(c, an(0, 'length', 14)); case 'vwap': return T.vwap(c, an(0, 'source', seriesAt('hlc3', bar)!));
        case 'macd': return T.macd(c, an(0), an(1), an(2), an(3)); case 'stoch': return T.stoch(c, an(0), an(1), an(2), an(3)); case 'bb': return T.bb(c, an(0), an(1), an(2)); case 'bbw': return T.bbw(c, an(0), an(1), an(2)); case 'kc': return T.kc(c, an(0), an(1), an(2), truthy(a(3, 'useTrueRange', true) as Val)); case 'dmi': return T.dmi(c, an(0), an(1)); case 'sar': return T.sar(c, an(0), an(1), an(2)); case 'supertrend': return T.supertrend(c, an(0), an(1));
        case 'crossover': return T.crossover(c, an(0), an(1)); case 'crossunder': return T.crossunder(c, an(0), an(1)); case 'cross': return T.cross(c, an(0), an(1)); case 'barssince': return T.barssince(c, truthy(a(0) as Val)); case 'valuewhen': return T.valuewhen(c, truthy(a(0) as Val), an(1), an(2, 'occurrence', 0));
        case 'pivothigh': return args.length >= 3 ? T.pivothigh(c, an(0), an(1), an(2)) : T.pivothigh(c, C.high[bar], an(0), an(1)); case 'pivotlow': return args.length >= 3 ? T.pivotlow(c, an(0), an(1), an(2)) : T.pivotlow(c, C.low[bar], an(0), an(1));
        case 'linreg': return T.linreg(c, an(0), an(1), an(2, 'offset', 0)); case 'correlation': return T.correlation(c, an(0), an(1), an(2)); case 'tsi': return T.tsi(c, an(0), an(1), an(2)); case 'change': return T.change(c, an(0), an(1, 'length', 1)); case 'swma': return T.swma(c, an(0)); case 'cum': return T.cum(c, an(0)); case 'rising': return T.rising(c, an(0), an(1)); case 'falling': return T.falling(c, an(0), an(1));
        default: return (fn as any)(c, an(0), an(1), an(2), an(3));
      }
    }
    return UNHANDLED;
  }
  const UNHANDLED = Symbol('unhandled');
  function withAlpha(c: string, alpha: number) { if (c.startsWith('#') && c.length === 7) { const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16); return `rgba(${r},${g},${b},${alpha.toFixed(2)})`; } return c; }

  function evalExpr(e: Expr): Val {
    switch (e.k) {
      case 'num': return e.v; case 'str': return e.v;
      case 'id': return lookup(e.v);
      case 'tuple': return e.items.map(evalExpr);
      case 'un': { const v = evalExpr(e.e); return e.op === 'not' ? !truthy(v) : -num(v); }
      case 'tern': return truthy(evalExpr(e.c)) ? evalExpr(e.a) : evalExpr(e.b);
      case 'bin': {
        if (e.op === 'and') { const l = evalExpr(e.l); return truthy(l) ? truthy(evalExpr(e.r)) : false; } if (e.op === 'or') { const l = evalExpr(e.l); return truthy(l) ? true : truthy(evalExpr(e.r)); }
        const l = evalExpr(e.l), r = evalExpr(e.r);
        if (e.op === '+' && (typeof l === 'string' || typeof r === 'string')) return String(l) + String(r);
        if (e.op === '==') return typeof l === 'string' || typeof r === 'string' ? l === r : num(l) === num(r); if (e.op === '!=') return typeof l === 'string' || typeof r === 'string' ? l !== r : num(l) !== num(r);
        const a = num(l), b = num(r);
        switch (e.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b; case '%': return a % b; case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; }
        throw new PineError(`Bad operator ${e.op}`);
      }
      case 'idx': {
        const back = Math.max(0, Math.round(num(evalExpr(e.i))));
        if (e.e.k === 'id') return lookup(e.e.v, back);
        const key = `${scopePath}${loopIter}/idx${JSON.stringify(e).length}_${(e as any).__id ??= Math.random()}`; let buf = nodeBuf.get(key); if (!buf) { buf = []; nodeBuf.set(key, buf); }
        buf[bar] = evalExpr(e.e); const i = bar - back; return i < 0 ? NA : buf[i] ?? NA;
      }
      case 'call': {
        if (fns.has(e.f)) return callUser(fns.get(e.f)!, e);
        const args = e.args.map(evalExpr); const named: Record<string, Val> = {}; for (const k in e.named) named[k] = evalExpr(e.named[k]);
        const r = callBuiltin(e, args, named); if (r === UNHANDLED) throw new PineError(`Unsupported function '${e.f}'`, e.line); return r;
      }
    }
  }
  function callUser(fn: FnRef, node: Extract<Expr, { k: 'call' }>): Val {
    const args = node.args.map(evalExpr); const saveScope = localScope, savePath = scopePath; scopePath = `${scopePath}${loopIter}/${node.id}`;
    const key = scopePath; let scope = fnScopes.get(key); if (!scope) { scope = new Map(); fnScopes.set(key, scope); } localScope = scope;
    fn.params.forEach((p, i) => store(scope!, p, args[i] ?? NA));
    let ret: Val = NA; for (const s of fn.body) ret = exec(s);
    localScope = saveScope; scopePath = savePath; return ret;
  }
  const fnScopes = new Map<string, Map<string, Val[]>>();
  function exec(s: Stmt): Val {
    switch (s.k) {
      case 'fn': fns.set(s.name, { fn: true, name: s.name, params: s.params, body: s.body }); return NA;
      case 'expr': return evalExpr(s.e);
      case 'assign': {
        const m = localScope ?? globals; const key = `${localScope ? scopePath : ''}:${s.name}`;
        if (s.mode === 'var' || s.mode === 'varip') { if (!varInit.has(key)) { varInit.add(key); store(m, s.name, evalExpr(s.e)); } return NA; }
        if (s.mode === 'reassign') { const target = localScope?.has(s.name) ? localScope : globals; store(target, s.name, evalExpr(s.e)); return NA; }
        store(m, s.name, evalExpr(s.e)); return NA;
      }
      case 'tassign': { const key = `${localScope ? scopePath : ''}:${s.names.join(',')}`; if (s.mode === 'var' && varInit.has(key)) return NA; if (s.mode === 'var') varInit.add(key); const v = evalExpr(s.e); const m = localScope ?? globals; s.names.forEach((nm, i) => store(m, nm, Array.isArray(v) ? v[i] : NA)); return NA; }
      case 'if': { let ret: Val = NA; for (const b of s.branches) { if (b.c === null || truthy(evalExpr(b.c))) { for (const st of b.body) ret = exec(st); break; } } return ret; }
      case 'for': { const from = num(evalExpr(s.from)), to = num(evalExpr(s.to)); const step = s.step ? num(evalExpr(s.step)) : from <= to ? 1 : -1; let ret: Val = NA; const m = localScope ?? globals; const saveIter = loopIter; let guard = 0;
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) { if (guard++ > 100000) break; store(m, s.v, i); loopIter = `${saveIter}#${s.line}:${guard}`; for (const st of s.body) ret = exec(st); }
        loopIter = saveIter; return ret; }
      case 'while': { let ret: Val = NA; let guard = 0; const saveIter = loopIter; while (truthy(evalExpr(s.c)) && guard++ < 100000) { loopIter = `${saveIter}#w${s.line}:${guard}`; for (const st of s.body) ret = exec(st); } loopIter = saveIter; return ret; }
    }
  }
  // carry `var` globals forward each bar
  const carry = () => { if (bar === 0) return; for (const [k, arr] of globals) if (arr[bar] === undefined && arr[bar - 1] !== undefined && varInit.has(`:${k}`)) arr[bar] = arr[bar - 1]; for (const [, sc] of fnScopes) for (const [, arr] of sc) if (arr[bar] === undefined && arr[bar - 1] !== undefined) arr[bar] = arr[bar - 1]; };
  for (bar = 0; bar < n; bar++) { carry(); for (const s of prog) exec(s); }
  res.plots = [...plotsByKey.values()].map(p => ({ ...p, values: Array.from({ length: n }, (_, i) => (p.values[i] == null || Number.isNaN(p.values[i] as number) ? null : (p.values[i] as number))) }));
  res.inputs = [...inputKeys.values()];
  return res;
}
export { PineError };
