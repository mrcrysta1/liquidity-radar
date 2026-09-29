// Pine Script (v5 subset) — bar-by-bar interpreter, ported from the Pro
// terminal (pro-terminal/src/core/pine/runtime.ts) and extended.
//
// The script runs once per bar, oldest first, exactly like Pine: every
// series is a per-bar history, `x[n]` reads n bars back, `var` keeps its
// value across bars, and each ta.* call site keeps its own state (so two
// `ta.ema(close, 9)` calls in different places do not share a buffer).
//
// Output: plots (per-bar values + optional per-bar colours), hlines,
// plotshape/plotchar/plotarrow markers and the declared inputs. Drawing
// objects (label/line/box/table), fill/bgcolor/barcolor and strategy orders
// are accepted and ignored, and reported back as warnings.
//
// Kept free of app imports (Node runs it directly in the engine tests).
import { parse, PineError } from './parser.ts'
import type { Expr, Stmt } from './parser.ts'

/** One bar — the same shape as the app's CandleFlat (time in ms). */
export interface PineBar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}
export type PlotStyle = 'line' | 'histogram' | 'columns' | 'area' | 'circles' | 'stepline' | 'cross'
export interface PinePlot {
  key: string
  title: string
  style: PlotStyle
  color: string
  /** Per-bar colour where it differs from `color`. */
  colors?: Array<string | undefined>
  linewidth: number
  values: Array<number | null>
}
export interface PineHLine {
  title: string
  price: number
  color: string
  style: 'solid' | 'dashed' | 'dotted'
}
export type ShapeKind = 'arrowUp' | 'arrowDown' | 'circle' | 'square'
export interface PineShape {
  bar: number
  text?: string
  color: string
  position: 'above' | 'below'
  shape: ShapeKind
}
export type InputValue = number | boolean | string
export interface PineInput {
  key: string
  title: string
  type: 'int' | 'float' | 'bool' | 'string' | 'source' | 'color'
  def: InputValue
  min?: number
  max?: number
  step?: number
  options?: string[]
}
export interface PineResult {
  title: string
  shortTitle: string
  overlay: boolean
  plots: PinePlot[]
  hlines: PineHLine[]
  shapes: PineShape[]
  inputs: PineInput[]
  /** Functions the script calls that this engine accepts but ignores. */
  warnings: string[]
}
export interface RunOptions {
  /** Wall-clock budget; a script over it stops with an error. */
  maxMs?: number
}

type Val = number | boolean | string | Val[] | FnRef | null | undefined
interface FnRef {
  fn: true
  name: string
  params: string[]
  body: Stmt[]
}
const NA = NaN
const num = (v: Val): number =>
  typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN
const isNa = (v: Val) => v == null || (typeof v === 'number' && Number.isNaN(v))
const truthy = (v: Val) =>
  typeof v === 'boolean' ? v : typeof v === 'number' ? !Number.isNaN(v) && v !== 0 : !!v

const COLORS: Record<string, string> = {
  'color.red': '#f23645',
  'color.green': '#089981',
  'color.blue': '#2962ff',
  'color.orange': '#ff9800',
  'color.purple': '#9c27b0',
  'color.yellow': '#fdd835',
  'color.white': '#ffffff',
  'color.black': '#000000',
  'color.gray': '#787b86',
  'color.silver': '#b2b5be',
  'color.aqua': '#00bcd4',
  'color.lime': '#00e676',
  'color.maroon': '#880e4f',
  'color.navy': '#311b92',
  'color.olive': '#808000',
  'color.teal': '#00897b',
  'color.fuchsia': '#e040fb',
}
const CONSTS: Record<string, Val> = {
  true: true,
  false: false,
  na: NA,
  'math.pi': Math.PI,
  'math.e': Math.E,
  'math.phi': 1.618033988749895,
  'plot.style_line': 'line',
  'plot.style_linebr': 'line',
  'plot.style_histogram': 'histogram',
  'plot.style_columns': 'columns',
  'plot.style_area': 'area',
  'plot.style_areabr': 'area',
  'plot.style_circles': 'circles',
  'plot.style_cross': 'cross',
  'plot.style_stepline': 'stepline',
  'plot.style_stepline_diamond': 'stepline',
  'location.abovebar': 'above',
  'location.belowbar': 'below',
  'location.top': 'above',
  'location.bottom': 'below',
  'location.absolute': 'above',
  'shape.triangleup': 'arrowUp',
  'shape.triangledown': 'arrowDown',
  'shape.arrowup': 'arrowUp',
  'shape.arrowdown': 'arrowDown',
  'shape.labelup': 'arrowUp',
  'shape.labeldown': 'arrowDown',
  'shape.circle': 'circle',
  'shape.square': 'square',
  'shape.flag': 'square',
  'shape.cross': 'circle',
  'shape.xcross': 'circle',
  'shape.diamond': 'circle',
  'size.tiny': 'tiny',
  'size.small': 'small',
  'size.normal': 'normal',
  'size.large': 'large',
  'size.huge': 'huge',
  'size.auto': 'auto',
  'display.all': 'all',
  'display.none': 'none',
  'format.price': 'price',
  'format.volume': 'volume',
  'format.percent': 'percent',
  'format.inherit': 'inherit',
  'timeframe.period': '',
  'syminfo.tickerid': '',
  'syminfo.ticker': '',
  'syminfo.mintick': 0.01,
  'barmerge.gaps_off': 0,
  'barmerge.gaps_on': 1,
  'barmerge.lookahead_off': 0,
  'barmerge.lookahead_on': 1,
  'extend.none': 'none',
  'extend.both': 'both',
  'extend.left': 'left',
  'extend.right': 'right',
  'hline.style_solid': 'solid',
  'hline.style_dashed': 'dashed',
  'hline.style_dotted': 'dotted',
  'line.style_solid': 'solid',
  'line.style_dashed': 'dashed',
  'line.style_dotted': 'dotted',
  'xloc.bar_index': 0,
  'yloc.price': 0,
  'strategy.long': 'long',
  'strategy.short': 'short',
  ...COLORS,
}
/** Accepted and ignored — the script still runs, the user is told. */
const IGNORED = new Set([
  'fill',
  'bgcolor',
  'barcolor',
  'plotcandle',
  'plotbar',
  'alertcondition',
  'alert',
  'label.new',
  'label.set_text',
  'label.set_xy',
  'label.set_color',
  'label.delete',
  'line.new',
  'line.set_xy1',
  'line.set_xy2',
  'line.delete',
  'box.new',
  'box.delete',
  'table.new',
  'table.cell',
  'strategy.entry',
  'strategy.exit',
  'strategy.close',
  'strategy.close_all',
  'max_bars_back',
  'runtime.error',
])
/** Built-in ta.* series usable without parentheses (`ta.tr`, `ta.obv`, …). */
const TA_VARS = [
  'ta.tr',
  'ta.obv',
  'ta.vwap',
  'ta.accdist',
  'ta.pvt',
  'ta.nvi',
  'ta.pvi',
  'ta.iii',
  'ta.wad',
  'ta.wvad',
]
const SHAPES: ShapeKind[] = ['arrowUp', 'arrowDown', 'circle', 'square']

/** Per call-site state: the argument history plus whatever the function keeps. */
class CS {
  hist: number[] = []
  st: Record<string, any> = {}
  subs = new Map<string, CS>()
  sub(k: string): CS {
    let c = this.subs.get(k)
    if (!c) {
      c = new CS()
      this.subs.set(k, c)
    }
    return c
  }
}

function withAlpha(c: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha)).toFixed(2)
  if (/^#[0-9a-f]{6}$/i.test(c)) {
    const r = parseInt(c.slice(1, 3), 16)
    const g = parseInt(c.slice(3, 5), 16)
    const b = parseInt(c.slice(5, 7), 16)
    return `rgba(${r},${g},${b},${a})`
  }
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c)
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${a})`
  return c
}
/** #RRGGBBAA → rgba(); anything else passes through. */
function normColor(c: string): string {
  if (/^#[0-9a-f]{8}$/i.test(c)) return withAlpha(c.slice(0, 7), parseInt(c.slice(7, 9), 16) / 255)
  return c
}
const isColor = (v: Val): v is string => typeof v === 'string' && /^(#|rgba?\()/.test(v)

export function runPine(
  source: string,
  candles: PineBar[],
  inputOverrides: Record<string, InputValue> = {},
  opts: RunOptions = {},
): PineResult {
  const prog = parse(source)
  const n = candles.length
  const res: PineResult = {
    title: 'Pine script',
    shortTitle: '',
    overlay: false,
    plots: [],
    hlines: [],
    shapes: [],
    inputs: [],
    warnings: [],
  }
  const plotsByKey = new Map<string, PinePlot & { offset: number }>()
  const hlineKeys = new Set<string>()
  const inputKeys = new Map<string, PineInput>()
  let inputOrdinal = 0
  const fns = new Map<string, FnRef>()
  const globals = new Map<string, Val[]>()
  const varInit = new Set<string>()
  const nodeBuf = new Map<string, Val[]>()
  const calls = new Map<string, CS>()
  const fnScopes = new Map<string, Map<string, Val[]>>()
  let bar = 0
  let scopePath = ''
  let localScope: Map<string, Val[]> | null = null
  let loopIter = ''
  let curLine = 0
  let depth = 0
  const deadline = Date.now() + (opts.maxMs ?? 2500)
  let ops = 0
  const tick = () => {
    if ((++ops & 1023) === 0 && Date.now() > deadline)
      throw new PineError('Script took too long to run (loop too large?)', curLine)
  }

  const O = candles.map((c) => c.o)
  const Hh = candles.map((c) => c.h)
  const Ll = candles.map((c) => c.l)
  const Cc = candles.map((c) => c.c)
  const V = candles.map((c) => c.v)
  const seriesAt = (name: string, i: number): number | undefined => {
    if (i < 0) return NA
    switch (name) {
      case 'open':
        return O[i]
      case 'high':
        return Hh[i]
      case 'low':
        return Ll[i]
      case 'close':
        return Cc[i]
      case 'volume':
        return V[i]
      case 'time':
      case 'time_close':
        return candles[i].t
      case 'hl2':
        return (Hh[i] + Ll[i]) / 2
      case 'hlc3':
        return (Hh[i] + Ll[i] + Cc[i]) / 3
      case 'ohlc4':
        return (O[i] + Hh[i] + Ll[i] + Cc[i]) / 4
      case 'hlcc4':
        return (Hh[i] + Ll[i] + 2 * Cc[i]) / 4
      case 'bar_index':
        return i
      case 'last_bar_index':
        return n - 1
      case 'barstate.islast':
      case 'barstate.isrealtime':
        return i === n - 1 ? 1 : 0
      case 'barstate.isfirst':
        return i === 0 ? 1 : 0
      case 'barstate.ishistory':
        return i === n - 1 ? 0 : 1
      case 'barstate.isconfirmed':
      case 'barstate.isnew':
        return 1
      case 'year':
        return new Date(candles[i].t).getUTCFullYear()
      case 'month':
        return new Date(candles[i].t).getUTCMonth() + 1
      case 'dayofmonth':
        return new Date(candles[i].t).getUTCDate()
      case 'dayofweek':
        return new Date(candles[i].t).getUTCDay() + 1
      case 'hour':
        return new Date(candles[i].t).getUTCHours()
      case 'minute':
        return new Date(candles[i].t).getUTCMinutes()
      default:
        return undefined
    }
  }
  const cs = (id: number | string, extra = '') => {
    const k = `${scopePath}${loopIter}/${id}${extra}`
    let c = calls.get(k)
    if (!c) {
      c = new CS()
      calls.set(k, c)
    }
    return c
  }
  const store = (m: Map<string, Val[]>, name: string, v: Val) => {
    let a = m.get(name)
    if (!a) {
      a = []
      m.set(name, a)
    }
    a[bar] = v
  }
  const lookup = (name: string, back = 0, line?: number, col?: number): Val => {
    const i = bar - back
    if (i < 0) return NA
    if (localScope) {
      const a = localScope.get(name)
      if (a) return a[i] ?? NA
    }
    const g = globals.get(name)
    if (g) return g[i] ?? NA
    const s = seriesAt(name, i)
    if (s !== undefined) return s
    if (name in CONSTS) return CONSTS[name]
    if (fns.has(name)) return fns.get(name)!
    if (TA_VARS.includes(name)) {
      if (back) return NA
      return taVar(name)
    }
    throw new PineError(`Undeclared identifier '${name}'`, line ?? curLine, col)
  }

  // ---------- ta.* built-ins: all per call-site, incremental where it matters ----------
  const H = (c: CS, v: number) => {
    c.hist[bar] = v
    return c.hist
  }
  const hget = (h: number[], k: number) => (bar - k >= 0 ? (h[bar - k] ?? NA) : NA)
  const win = (h: number[], len: number): number[] | null => {
    len = Math.floor(len)
    if (!(len >= 1) || bar - len + 1 < 0) return null
    const w: number[] = []
    for (let k = 0; k < len; k++) {
      const v = hget(h, k)
      if (v == null || Number.isNaN(v)) return null
      w.push(v)
    }
    return w
  }
  const mean = (w: number[]) => w.reduce((a, b) => a + b, 0) / w.length
  const T = {
    sma(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      return w ? mean(w) : NA
    },
    ema(c: CS, src: number, len: number) {
      H(c, src)
      const a = 2 / (len + 1)
      if (Number.isNaN(src)) return c.st.prev ?? NA
      if (c.st.prev == null) {
        const w = win(c.hist, len)
        if (!w) return NA
        c.st.prev = mean(w)
        return c.st.prev
      }
      c.st.prev = src * a + c.st.prev * (1 - a)
      return c.st.prev
    },
    rma(c: CS, src: number, len: number) {
      H(c, src)
      const a = 1 / len
      if (Number.isNaN(src)) return c.st.prev ?? NA
      if (c.st.prev == null) {
        const w = win(c.hist, len)
        if (!w) return NA
        c.st.prev = mean(w)
        return c.st.prev
      }
      c.st.prev = src * a + c.st.prev * (1 - a)
      return c.st.prev
    },
    wma(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      if (!w) return NA
      let s = 0
      let d = 0
      for (let k = 0; k < w.length; k++) {
        s += w[k] * (w.length - k)
        d += w.length - k
      }
      return s / d
    },
    vwma(c: CS, src: number, len: number) {
      const pv = T.sma(c.sub('pv'), src * V[bar], len)
      const v = T.sma(c.sub('v'), V[bar], len)
      return pv / v
    },
    hma(c: CS, src: number, len: number) {
      const h = Math.max(1, Math.floor(len / 2))
      const r = Math.max(1, Math.round(Math.sqrt(len)))
      const d = 2 * T.wma(c.sub('a'), src, h) - T.wma(c.sub('b'), src, len)
      return T.wma(c.sub('c'), d, r)
    },
    swma(c: CS, src: number) {
      const w = win(H(c, src), 4)
      return w ? w[3] / 6 + (w[2] * 2) / 6 + (w[1] * 2) / 6 + w[0] / 6 : NA
    },
    alma(c: CS, src: number, len: number, offset = 0.85, sigma = 6) {
      const w = win(H(c, src), len)
      if (!w) return NA
      const m = offset * (len - 1)
      const s = len / sigma
      let sum = 0
      let norm = 0
      for (let k = 0; k < len; k++) {
        const wt = Math.exp(-((k - m) ** 2) / (2 * s * s))
        sum += wt * w[len - 1 - k]
        norm += wt
      }
      return sum / norm
    },
    change(c: CS, src: number, len = 1) {
      const h = H(c, src)
      return src - hget(h, len)
    },
    mom(c: CS, src: number, len: number) {
      return T.change(c, src, len)
    },
    roc(c: CS, src: number, len: number) {
      const h = H(c, src)
      const p = hget(h, len)
      return ((src - p) / p) * 100
    },
    highest(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      return w ? Math.max(...w) : NA
    },
    lowest(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      return w ? Math.min(...w) : NA
    },
    highestbars(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      if (!w) return NA
      let m = 0
      w.forEach((v, k) => {
        if (v > w[m]) m = k
      })
      return -m
    },
    lowestbars(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      if (!w) return NA
      let m = 0
      w.forEach((v, k) => {
        if (v < w[m]) m = k
      })
      return -m
    },
    max(c: CS, src: number) {
      if (!Number.isNaN(src)) c.st.m = c.st.m == null ? src : Math.max(c.st.m, src)
      return c.st.m ?? NA
    },
    min(c: CS, src: number) {
      if (!Number.isNaN(src)) c.st.m = c.st.m == null ? src : Math.min(c.st.m, src)
      return c.st.m ?? NA
    },
    sum(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      return w ? w.reduce((a, b) => a + b, 0) : NA
    },
    cum(c: CS, src: number) {
      c.st.s = (c.st.s ?? 0) + (Number.isNaN(src) ? 0 : src)
      return c.st.s
    },
    stdev(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      if (!w) return NA
      const m = mean(w)
      return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length)
    },
    variance(c: CS, src: number, len: number) {
      const s = T.stdev(c, src, len)
      return s * s
    },
    dev(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      if (!w) return NA
      const m = mean(w)
      return w.reduce((a, b) => a + Math.abs(b - m), 0) / w.length
    },
    tr(_c: CS, handleNa = false) {
      if (bar === 0) return handleNa ? Hh[0] - Ll[0] : NA
      const pc = Cc[bar - 1]
      return Math.max(Hh[bar] - Ll[bar], Math.abs(Hh[bar] - pc), Math.abs(Ll[bar] - pc))
    },
    atr(c: CS, len: number) {
      return T.rma(c, T.tr(c, true), len)
    },
    rsi(c: CS, src: number, len: number) {
      const ch = T.change(c.sub('ch'), src, 1)
      const up = T.rma(c.sub('u'), Number.isNaN(ch) ? NA : Math.max(ch, 0), len)
      const dn = T.rma(c.sub('d'), Number.isNaN(ch) ? NA : Math.max(-ch, 0), len)
      if (Number.isNaN(up)) return NA
      return dn === 0 ? 100 : up === 0 ? 0 : 100 - 100 / (1 + up / dn)
    },
    macd(c: CS, src: number, f: number, s: number, sig: number) {
      const m = T.ema(c.sub('f'), src, f) - T.ema(c.sub('s'), src, s)
      const g = T.ema(c.sub('g'), m, sig)
      return [m, g, m - g]
    },
    stoch(c: CS, src: number, hi: number, lo: number, len: number) {
      const hh = T.highest(c.sub('h'), hi, len)
      const ll = T.lowest(c.sub('l'), lo, len)
      H(c, src)
      return hh === ll ? 50 : ((src - ll) / (hh - ll)) * 100
    },
    bb(c: CS, src: number, len: number, mult: number) {
      const b = T.sma(c.sub('m'), src, len)
      const d = T.stdev(c.sub('s'), src, len) * mult
      return [b, b + d, b - d]
    },
    bbw(c: CS, src: number, len: number, mult: number) {
      const [b, u, l] = T.bb(c, src, len, mult) as number[]
      return (u - l) / b
    },
    kc(c: CS, src: number, len: number, mult: number, useTr = true) {
      const b = T.ema(c.sub('m'), src, len)
      const r = T.rma(c.sub('r'), useTr ? T.tr(c, true) : Hh[bar] - Ll[bar], len) * mult
      return [b, b + r, b - r]
    },
    kcw(c: CS, src: number, len: number, mult: number, useTr = true) {
      const [b, u, l] = T.kc(c, src, len, mult, useTr) as number[]
      return (u - l) / b
    },
    cci(c: CS, src: number, len: number) {
      const m = T.sma(c.sub('m'), src, len)
      const d = T.dev(c.sub('d'), src, len)
      return (src - m) / (0.015 * d)
    },
    cog(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      if (!w) return NA
      let nu = 0
      let de = 0
      w.forEach((v, k) => {
        nu += v * (k + 1)
        de += v
      })
      return -nu / de
    },
    wpr(c: CS, len: number) {
      const hh = T.highest(c.sub('h'), Hh[bar], len)
      const ll = T.lowest(c.sub('l'), Ll[bar], len)
      return ((hh - Cc[bar]) / (hh - ll)) * -100
    },
    mfi(c: CS, src: number, len: number) {
      const ch = T.change(c.sub('c'), src, 1)
      const mf = src * V[bar]
      const pos = T.sum(c.sub('p'), ch > 0 ? mf : 0, len)
      const neg = T.sum(c.sub('n'), ch < 0 ? mf : 0, len)
      if (Number.isNaN(ch)) return NA
      return 100 - 100 / (1 + pos / neg)
    },
    obv(c: CS) {
      const ch = T.change(c.sub('c'), Cc[bar], 1)
      return T.cum(c, Number.isNaN(ch) ? 0 : Math.sign(ch) * V[bar])
    },
    pvt(c: CS) {
      const ch = T.change(c.sub('c'), Cc[bar], 1)
      const prev = bar > 0 ? Cc[bar - 1] : NaN
      return T.cum(c, Number.isNaN(ch) ? 0 : (ch / prev) * V[bar])
    },
    accdist(c: CS) {
      const r = Hh[bar] - Ll[bar]
      const mfm = r === 0 ? 0 : (2 * Cc[bar] - Ll[bar] - Hh[bar]) / r
      return T.cum(c, mfm * V[bar])
    },
    iii() {
      const r = Hh[bar] - Ll[bar]
      return r === 0 || V[bar] === 0 ? 0 : (2 * Cc[bar] - Hh[bar] - Ll[bar]) / (r * V[bar])
    },
    nvi(c: CS) {
      c.st.v ??= 1
      if (bar > 0 && V[bar] < V[bar - 1]) c.st.v *= Cc[bar] / Cc[bar - 1]
      return c.st.v
    },
    pvi(c: CS) {
      c.st.v ??= 1
      if (bar > 0 && V[bar] > V[bar - 1]) c.st.v *= Cc[bar] / Cc[bar - 1]
      return c.st.v
    },
    wad(c: CS) {
      if (bar === 0) return T.cum(c, 0)
      const pc = Cc[bar - 1]
      const trh = Math.max(Hh[bar], pc)
      const trl = Math.min(Ll[bar], pc)
      const d = Cc[bar] > pc ? Cc[bar] - trl : Cc[bar] < pc ? Cc[bar] - trh : 0
      return T.cum(c, d)
    },
    wvad() {
      const r = Hh[bar] - Ll[bar]
      return r === 0 ? 0 : ((Cc[bar] - O[bar]) / r) * V[bar]
    },
    vwap(c: CS, src: number) {
      const d = Math.floor(candles[bar].t / 86400000)
      if (c.st.day !== d) {
        c.st.day = d
        c.st.pv = 0
        c.st.v = 0
      }
      c.st.pv += src * V[bar]
      c.st.v += V[bar]
      return c.st.v ? c.st.pv / c.st.v : NA
    },
    crossover(c: CS, a: number, b: number) {
      const ha = H(c.sub('a'), a)
      const hb = H(c.sub('b'), b)
      return a > b && hget(ha, 1) <= hget(hb, 1)
    },
    crossunder(c: CS, a: number, b: number) {
      const ha = H(c.sub('a'), a)
      const hb = H(c.sub('b'), b)
      return a < b && hget(ha, 1) >= hget(hb, 1)
    },
    cross(c: CS, a: number, b: number) {
      return T.crossover(c.sub('o'), a, b) || T.crossunder(c.sub('u'), a, b)
    },
    barssince(c: CS, cond: boolean) {
      if (cond) c.st.last = bar
      return c.st.last == null ? NA : bar - c.st.last
    },
    valuewhen(c: CS, cond: boolean, src: number, occ: number) {
      c.st.vals ??= []
      if (cond) {
        c.st.vals.unshift(src)
        if (c.st.vals.length > 500) c.st.vals.length = 500
      }
      return c.st.vals[occ] ?? NA
    },
    rising(c: CS, src: number, len: number) {
      const w = win(H(c, src), len + 1)
      if (!w) return false
      for (let k = 0; k < len; k++) if (!(w[k] > w[k + 1])) return false
      return true
    },
    falling(c: CS, src: number, len: number) {
      const w = win(H(c, src), len + 1)
      if (!w) return false
      for (let k = 0; k < len; k++) if (!(w[k] < w[k + 1])) return false
      return true
    },
    pivothigh(c: CS, src: number, l: number, r: number) {
      const h = H(c, src)
      const i = bar - r
      if (i - l < 0) return NA
      const v = h[i]
      for (let k = i - l; k <= i + r; k++) {
        if (k === i) continue
        if (!(h[k] < v)) return NA
      }
      return v
    },
    pivotlow(c: CS, src: number, l: number, r: number) {
      const h = H(c, src)
      const i = bar - r
      if (i - l < 0) return NA
      const v = h[i]
      for (let k = i - l; k <= i + r; k++) {
        if (k === i) continue
        if (!(h[k] > v)) return NA
      }
      return v
    },
    linreg(c: CS, src: number, len: number, off: number) {
      const w = win(H(c, src), len)
      if (!w) return NA
      const ys = w.slice().reverse()
      const xm = (ys.length - 1) / 2
      const ym = mean(ys)
      let nu = 0
      let de = 0
      ys.forEach((y, x) => {
        nu += (x - xm) * (y - ym)
        de += (x - xm) ** 2
      })
      const slope = de ? nu / de : 0
      return ym - slope * xm + slope * (ys.length - 1 - off)
    },
    percentrank(c: CS, src: number, len: number) {
      const w = win(H(c, src), len + 1)
      if (!w) return NA
      let cnt = 0
      for (let k = 1; k <= len; k++) if (w[k] <= src) cnt++
      return (cnt / len) * 100
    },
    percentile_nearest_rank(c: CS, src: number, len: number, pct: number) {
      const w = win(H(c, src), len)
      if (!w) return NA
      const s = w.slice().sort((a, b) => a - b)
      const k = Math.max(0, Math.min(s.length - 1, Math.ceil((pct / 100) * s.length) - 1))
      return s[k]
    },
    percentile_linear_interpolation(c: CS, src: number, len: number, pct: number) {
      const w = win(H(c, src), len)
      if (!w) return NA
      const s = w.slice().sort((a, b) => a - b)
      const pos = (pct / 100) * (s.length - 1)
      const lo = Math.floor(pos)
      const hi = Math.min(s.length - 1, lo + 1)
      return s[lo] + (s[hi] - s[lo]) * (pos - lo)
    },
    median(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      if (!w) return NA
      const s = w.slice().sort((a, b) => a - b)
      const m = s.length
      return m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2
    },
    mode(c: CS, src: number, len: number) {
      const w = win(H(c, src), len)
      if (!w) return NA
      const cnt = new Map<number, number>()
      let best = w[0]
      let bestN = 0
      for (const v of w) {
        const k = (cnt.get(v) ?? 0) + 1
        cnt.set(v, k)
        if (k > bestN || (k === bestN && v < best)) {
          best = v
          bestN = k
        }
      }
      return best
    },
    correlation(c: CS, a: number, b: number, len: number) {
      const wa = win(H(c.sub('a'), a), len)
      const wb = win(H(c.sub('b'), b), len)
      if (!wa || !wb) return NA
      const ma = mean(wa)
      const mb = mean(wb)
      let nu = 0
      let da = 0
      let db = 0
      for (let k = 0; k < wa.length; k++) {
        nu += (wa[k] - ma) * (wb[k] - mb)
        da += (wa[k] - ma) ** 2
        db += (wb[k] - mb) ** 2
      }
      return nu / Math.sqrt(da * db)
    },
    cmo(c: CS, src: number, len: number) {
      const ch = T.change(c.sub('c'), src, 1)
      const u = T.sum(c.sub('u'), ch > 0 ? ch : 0, len)
      const d = T.sum(c.sub('d'), ch < 0 ? -ch : 0, len)
      return ((u - d) / (u + d)) * 100
    },
    tsi(c: CS, src: number, s: number, l: number) {
      const ch = T.change(c.sub('c'), src, 1)
      const a = T.ema(c.sub('a'), T.ema(c.sub('b'), ch, l), s)
      const b = T.ema(c.sub('d'), T.ema(c.sub('e'), Math.abs(ch), l), s)
      return a / b
    },
    dmi(c: CS, len: number, adxLen: number) {
      const up = T.change(c.sub('u'), Hh[bar], 1)
      const dn = -T.change(c.sub('d'), Ll[bar], 1)
      const pdm = Number.isNaN(up) ? NA : up > dn && up > 0 ? up : 0
      const mdm = Number.isNaN(dn) ? NA : dn > up && dn > 0 ? dn : 0
      const tr = T.rma(c.sub('tr'), T.tr(c, true), len)
      const pdi = (T.rma(c.sub('p'), pdm, len) / tr) * 100
      const mdi = (T.rma(c.sub('m'), mdm, len) / tr) * 100
      const dx = (Math.abs(pdi - mdi) / (pdi + mdi)) * 100
      const adx = T.rma(c.sub('x'), Number.isNaN(dx) ? NA : dx, adxLen)
      return [pdi, mdi, adx]
    },
    sar(c: CS, start: number, inc: number, max: number) {
      const s = c.st
      if (bar < 1) return NA
      if (s.sar == null) {
        s.up = Cc[bar] > Cc[bar - 1]
        s.sar = s.up ? Ll[bar - 1] : Hh[bar - 1]
        s.ep = s.up ? Hh[bar] : Ll[bar]
        s.af = start
        return s.sar
      }
      let sar = s.sar + s.af * (s.ep - s.sar)
      if (s.up) {
        sar = Math.min(sar, Ll[bar - 1], Ll[bar - 2] ?? Ll[bar - 1])
        if (Ll[bar] < sar) {
          s.up = false
          sar = s.ep
          s.ep = Ll[bar]
          s.af = start
        } else if (Hh[bar] > s.ep) {
          s.ep = Hh[bar]
          s.af = Math.min(max, s.af + inc)
        }
      } else {
        sar = Math.max(sar, Hh[bar - 1], Hh[bar - 2] ?? Hh[bar - 1])
        if (Hh[bar] > sar) {
          s.up = true
          sar = s.ep
          s.ep = Hh[bar]
          s.af = start
        } else if (Ll[bar] < s.ep) {
          s.ep = Ll[bar]
          s.af = Math.min(max, s.af + inc)
        }
      }
      s.sar = sar
      return sar
    },
    supertrend(c: CS, factor: number, len: number) {
      const a = T.atr(c.sub('atr'), len)
      const hl2 = (Hh[bar] + Ll[bar]) / 2
      let up = hl2 + factor * a
      let lo = hl2 - factor * a
      const s = c.st
      if (Number.isNaN(a)) return [NA, NA]
      const pc = Cc[bar - 1] ?? NaN
      if (s.lo != null && !(lo > s.lo || pc < s.lo)) lo = s.lo
      if (s.up != null && !(up < s.up || pc > s.up)) up = s.up
      let dir: number
      if (s.dir == null) dir = 1
      else if (s.st === s.up) dir = Cc[bar] > up ? -1 : 1
      else dir = Cc[bar] < lo ? 1 : -1
      const st = dir === -1 ? lo : up
      s.lo = lo
      s.up = up
      s.dir = dir
      s.st = st
      return [st, dir]
    },
    range(c: CS, src: number, len: number) {
      return T.highest(c.sub('h'), src, len) - T.lowest(c.sub('l'), src, len)
    },
  }
  const M: Record<string, (...a: number[]) => number> = {
    abs: Math.abs,
    max: Math.max,
    min: Math.min,
    sqrt: Math.sqrt,
    pow: Math.pow,
    log: Math.log,
    log10: Math.log10,
    exp: Math.exp,
    floor: Math.floor,
    ceil: Math.ceil,
    sign: Math.sign,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    round: (x, p = 0) => {
      const m = 10 ** p
      return Math.round(x * m) / m
    },
    avg: (...a) => a.reduce((x, y) => x + y, 0) / a.length,
    round_to_mintick: (x) => Math.round(x / 0.01) * 0.01,
    todegrees: (x) => (x * 180) / Math.PI,
    toradians: (x) => (x * Math.PI) / 180,
    random: (lo = 0, hi = 1) => lo + Math.random() * (hi - lo),
  }

  function taVar(name: string): number {
    const c = cs('var:' + name)
    switch (name) {
      case 'ta.tr':
        return T.tr(c, false)
      case 'ta.obv':
        return T.obv(c)
      case 'ta.vwap':
        return T.vwap(c, seriesAt('hlc3', bar)!)
      case 'ta.accdist':
        return T.accdist(c)
      case 'ta.pvt':
        return T.pvt(c)
      case 'ta.nvi':
        return T.nvi(c)
      case 'ta.pvi':
        return T.pvi(c)
      case 'ta.iii':
        return T.iii()
      case 'ta.wad':
        return T.wad(c)
      default:
        return T.wvad()
    }
  }

  const UNHANDLED = Symbol('unhandled')
  function callBuiltin(
    node: Extract<Expr, { k: 'call' }>,
    args: Val[],
    named: Record<string, Val>,
  ): Val | typeof UNHANDLED {
    const f = node.f
    const a = (i: number, nm?: string, def?: Val): Val =>
      args[i] !== undefined ? args[i] : nm && named[nm] !== undefined ? named[nm] : def
    const an = (i: number, nm?: string, def?: number) => num(a(i, nm, def))
    const colorArg = (i: number, nm: string, def: string) => {
      const v = a(i, nm)
      return isColor(v) ? normColor(v) : def
    }
    if (f === 'indicator' || f === 'study' || f === 'strategy') {
      if (bar === 0) {
        res.title = String(a(0, 'title', res.title))
        res.shortTitle = String(a(1, 'shorttitle', ''))
        res.overlay = truthy(a(2, 'overlay', false))
      }
      return null
    }
    if (f === 'input' || f.startsWith('input.')) {
      const kind: PineInput['type'] =
        f === 'input.int'
          ? 'int'
          : f === 'input.bool'
            ? 'bool'
            : f === 'input.source'
              ? 'source'
              : f === 'input.color'
                ? 'color'
                : f === 'input.string' ||
                    f === 'input.timeframe' ||
                    f === 'input.session' ||
                    f === 'input.symbol'
                  ? 'string'
                  : typeof a(0, 'defval') === 'boolean'
                    ? 'bool'
                    : 'float'
      const def = a(0, 'defval', 0)
      const title = String(a(1, 'title', `Input ${inputOrdinal + 1}`))
      const key = title
      let inp = inputKeys.get(key)
      if (!inp) {
        inputOrdinal++
        const srcArg = node.args[0] ?? node.named.defval
        inp = {
          key,
          title,
          type: kind,
          def:
            kind === 'source'
              ? srcArg?.k === 'id'
                ? srcArg.v
                : 'close'
              : typeof def === 'number' || typeof def === 'boolean' || typeof def === 'string'
                ? def
                : 0,
          min: named.minval != null ? num(named.minval) : undefined,
          max: named.maxval != null ? num(named.maxval) : undefined,
          step: named.step != null ? num(named.step) : undefined,
          options: Array.isArray(named.options) ? (named.options as Val[]).map(String) : undefined,
        }
        inputKeys.set(key, inp)
      }
      const ov = inputOverrides[key]
      if (kind === 'source') {
        const nm = ov != null ? String(ov) : String(inp.def)
        return seriesAt(nm, bar) ?? num(lookup(nm))
      }
      if (ov != null)
        return kind === 'bool'
          ? !!ov
          : kind === 'string' || kind === 'color'
            ? String(ov)
            : Number(ov)
      return def
    }
    if (f === 'plot') {
      const key = `${scopePath}/${node.id}`
      let p = plotsByKey.get(key)
      const col = a(2, 'color')
      if (!p) {
        const style = String(a(4, 'style', 'line')) as PlotStyle
        p = {
          key,
          title: String(a(1, 'title', `Plot ${plotsByKey.size + 1}`)),
          style: style || 'line',
          color: isColor(col) ? normColor(col) : '#2962ff',
          linewidth: an(3, 'linewidth', 1) || 1,
          values: [],
          offset: Math.round(num(named.offset ?? 0)) || 0,
        }
        plotsByKey.set(key, p)
      }
      const v = a(0, 'series')
      p.values[bar] = isNa(v) || typeof v === 'boolean' ? null : num(v)
      const cv = isColor(col) ? normColor(col) : undefined
      if (cv && cv !== p.color) {
        p.colors ??= []
        p.colors[bar] = cv
      } else if (p.colors) p.colors[bar] = cv
      return null
    }
    if (f === 'hline') {
      const key = `${scopePath}/${node.id}`
      if (!hlineKeys.has(key)) {
        hlineKeys.add(key)
        const st = String(a(3, 'linestyle', 'dashed'))
        res.hlines.push({
          title: String(a(1, 'title', '')),
          price: an(0, 'price', 0),
          color: colorArg(2, 'color', '#787b86'),
          style: st === 'solid' || st === 'dotted' ? st : 'dashed',
        })
      }
      return null
    }
    if (f === 'plotshape' || f === 'plotchar' || f === 'plotarrow') {
      const cond = a(0, 'series')
      if (f === 'plotarrow') {
        const v = num(cond)
        if (!Number.isNaN(v) && v !== 0)
          res.shapes.push({
            bar,
            color: v > 0 ? colorArg(2, 'colorup', '#089981') : colorArg(3, 'colordown', '#f23645'),
            position: v > 0 ? 'below' : 'above',
            shape: v > 0 ? 'arrowUp' : 'arrowDown',
          })
        return null
      }
      if (truthy(cond)) {
        const loc = String(a(3, 'location', 'above'))
        const styleArg = String(a(2, f === 'plotchar' ? 'char' : 'style', ''))
        const shape = (SHAPES as string[]).includes(styleArg)
          ? (styleArg as ShapeKind)
          : f === 'plotchar'
            ? 'circle'
            : loc === 'below'
              ? 'arrowUp'
              : 'arrowDown'
        const text =
          named.text != null
            ? String(named.text)
            : f === 'plotchar' && styleArg
              ? styleArg
              : undefined
        res.shapes.push({
          bar,
          text,
          color: colorArg(4, 'color', '#2962ff'),
          position: loc === 'below' ? 'below' : 'above',
          shape,
        })
      }
      return null
    }
    if (
      IGNORED.has(f) ||
      f.startsWith('label.') ||
      f.startsWith('line.') ||
      f.startsWith('box.') ||
      f.startsWith('table.') ||
      f.startsWith('array.') ||
      f.startsWith('strategy.')
    ) {
      if (!res.warnings.includes(f)) res.warnings.push(f)
      return f.startsWith('array.') ? NA : null
    }
    if (f === 'na') return isNa(a(0))
    if (f === 'nz') {
      const v = a(0)
      return isNa(v) ? a(1, 'replacement', 0) : v
    }
    if (f === 'fixnan') {
      const c = cs(node.id)
      const v = num(a(0))
      if (!Number.isNaN(v)) c.st.p = v
      return c.st.p ?? NA
    }
    if (f === 'color.new') {
      const c = String(a(0, 'color'))
      return withAlpha(normColor(c), 1 - an(1, 'transp', 0) / 100)
    }
    if (f === 'color.rgb')
      return `rgba(${an(0)},${an(1)},${an(2)},${(1 - an(3, 'transp', 0) / 100).toFixed(2)})`
    if (f === 'color.from_gradient') {
      const v = an(0)
      const lo = an(1)
      const hi = an(2)
      return v <= (lo + hi) / 2 ? String(a(3)) : String(a(4))
    }
    if (f === 'str.tostring') {
      const v = a(0)
      return typeof v === 'number' ? String(Math.round(v * 1e4) / 1e4) : String(v)
    }
    if (f === 'str.format') return String(a(0))
    if (f === 'str.contains') return String(a(0)).includes(String(a(1)))
    if (f === 'str.length') return String(a(0)).length
    if (f === 'int') return Math.trunc(an(0))
    if (f === 'float') return an(0)
    if (f === 'bool') return truthy(a(0))
    if (f === 'math.sum') return T.sum(cs(node.id), an(0), an(1))
    if (f.startsWith('math.')) {
      const g = M[f.slice(5)]
      if (g) return g(...args.map(num))
    }
    if (f.startsWith('ta.')) {
      const name = f.slice(3)
      if (!(name in T)) return UNHANDLED
      const c = cs(node.id)
      const hlc3 = seriesAt('hlc3', bar)!
      switch (name) {
        case 'tr':
          return T.tr(c, truthy(a(0, 'handle_na', false)))
        case 'atr':
          return T.atr(c, an(0, 'length', 14))
        case 'obv':
        case 'pvt':
        case 'accdist':
        case 'nvi':
        case 'pvi':
        case 'wad':
          return T[name](c)
        case 'iii':
        case 'wvad':
          return T[name]()
        case 'wpr':
          return T.wpr(c, an(0, 'length', 14))
        case 'vwap':
          return T.vwap(c, an(0, 'source', hlc3))
        case 'macd':
          return T.macd(c, an(0), an(1), an(2), an(3))
        case 'stoch':
          return T.stoch(c, an(0), an(1), an(2), an(3))
        case 'bb':
          return T.bb(c, an(0), an(1), an(2))
        case 'bbw':
          return T.bbw(c, an(0), an(1), an(2))
        case 'kc':
          return T.kc(c, an(0), an(1), an(2), truthy(a(3, 'useTrueRange', true)))
        case 'kcw':
          return T.kcw(c, an(0), an(1), an(2), truthy(a(3, 'useTrueRange', true)))
        case 'dmi':
          return T.dmi(c, an(0), an(1))
        case 'sar':
          return T.sar(c, an(0), an(1), an(2))
        case 'supertrend':
          return T.supertrend(c, an(0), an(1))
        case 'crossover':
          return T.crossover(c, an(0), an(1))
        case 'crossunder':
          return T.crossunder(c, an(0), an(1))
        case 'cross':
          return T.cross(c, an(0), an(1))
        case 'barssince':
          return T.barssince(c, truthy(a(0)))
        case 'valuewhen':
          return T.valuewhen(c, truthy(a(0)), an(1), an(2, 'occurrence', 0))
        case 'pivothigh':
          return args.length >= 3
            ? T.pivothigh(c, an(0), an(1), an(2))
            : T.pivothigh(c, Hh[bar], an(0, 'leftbars'), an(1, 'rightbars'))
        case 'pivotlow':
          return args.length >= 3
            ? T.pivotlow(c, an(0), an(1), an(2))
            : T.pivotlow(c, Ll[bar], an(0, 'leftbars'), an(1, 'rightbars'))
        case 'linreg':
          return T.linreg(c, an(0), an(1), an(2, 'offset', 0))
        case 'alma':
          return T.alma(c, an(0), an(1), an(2, 'offset', 0.85), an(3, 'sigma', 6))
        case 'correlation':
          return T.correlation(c, an(0), an(1), an(2))
        case 'tsi':
          return T.tsi(c, an(0), an(1), an(2))
        case 'change':
          return T.change(c, an(0), an(1, 'length', 1))
        case 'swma':
          return T.swma(c, an(0))
        case 'cum':
          return T.cum(c, an(0))
        case 'max':
          return T.max(c, an(0))
        case 'min':
          return T.min(c, an(0))
        case 'rising':
          return T.rising(c, an(0), an(1))
        case 'falling':
          return T.falling(c, an(0), an(1))
        case 'percentile_nearest_rank':
        case 'percentile_linear_interpolation':
          return T[name](c, an(0), an(1), an(2))
        default:
          return (T as any)[name](c, an(0, 'source'), an(1, 'length'), an(2), an(3))
      }
    }
    return UNHANDLED
  }

  function evalExpr(e: Expr): Val {
    tick()
    switch (e.k) {
      case 'num':
        return e.v
      case 'str':
        return e.v
      case 'id':
        return lookup(e.v, 0, e.line, e.col)
      case 'tuple':
        return e.items.map(evalExpr)
      case 'un': {
        const v = evalExpr(e.e)
        return e.op === 'not' ? !truthy(v) : -num(v)
      }
      case 'tern':
        return truthy(evalExpr(e.c)) ? evalExpr(e.a) : evalExpr(e.b)
      case 'bin': {
        if (e.op === 'and') return truthy(evalExpr(e.l)) ? truthy(evalExpr(e.r)) : false
        if (e.op === 'or') return truthy(evalExpr(e.l)) ? true : truthy(evalExpr(e.r))
        const l = evalExpr(e.l)
        const r = evalExpr(e.r)
        if (e.op === '+' && (typeof l === 'string' || typeof r === 'string'))
          return String(l) + String(r)
        const str = typeof l === 'string' || typeof r === 'string'
        if (e.op === '==') return str ? l === r : num(l) === num(r)
        if (e.op === '!=') return str ? l !== r : num(l) !== num(r)
        const x = num(l)
        const y = num(r)
        switch (e.op) {
          case '+':
            return x + y
          case '-':
            return x - y
          case '*':
            return x * y
          case '/':
            return x / y
          case '%':
            return x % y
          case '<':
            return x < y
          case '>':
            return x > y
          case '<=':
            return x <= y
          case '>=':
            return x >= y
        }
        throw new PineError(`Bad operator ${e.op}`, curLine)
      }
      case 'idx': {
        const back = Math.max(0, Math.round(num(evalExpr(e.i))))
        if (e.e.k === 'id') return lookup(e.e.v, back, e.e.line, e.e.col)
        const key = `${scopePath}${loopIter}/idx${e.id}`
        let buf = nodeBuf.get(key)
        if (!buf) {
          buf = []
          nodeBuf.set(key, buf)
        }
        buf[bar] = evalExpr(e.e)
        const i = bar - back
        return i < 0 ? NA : (buf[i] ?? NA)
      }
      case 'call': {
        if (fns.has(e.f)) return callUser(fns.get(e.f)!, e)
        const args = e.args.map(evalExpr)
        const named: Record<string, Val> = {}
        for (const k in e.named) named[k] = evalExpr(e.named[k])
        const r = callBuiltin(e, args, named)
        if (r === UNHANDLED) throw new PineError(`Unsupported function '${e.f}'`, e.line, e.col)
        return r
      }
    }
  }
  function callUser(fn: FnRef, node: Extract<Expr, { k: 'call' }>): Val {
    if (depth > 64) throw new PineError(`Function '${fn.name}' calls itself too deeply`, node.line)
    const args = node.args.map(evalExpr)
    const saveScope = localScope
    const savePath = scopePath
    scopePath = `${scopePath}${loopIter}/${node.id}`
    let scope = fnScopes.get(scopePath)
    if (!scope) {
      scope = new Map()
      fnScopes.set(scopePath, scope)
    }
    localScope = scope
    fn.params.forEach((p, i) => store(scope!, p, args[i] ?? NA))
    let ret: Val = NA
    depth++
    try {
      for (const s of fn.body) ret = exec(s)
    } finally {
      depth--
      localScope = saveScope
      scopePath = savePath
    }
    return ret
  }
  function exec(s: Stmt): Val {
    const saveLine = curLine
    curLine = s.line
    try {
      return execInner(s)
    } finally {
      curLine = saveLine
    }
  }
  function execInner(s: Stmt): Val {
    switch (s.k) {
      case 'fn':
        fns.set(s.name, { fn: true, name: s.name, params: s.params, body: s.body })
        return NA
      case 'expr':
        return evalExpr(s.e)
      case 'assign': {
        const m = localScope ?? globals
        const key = `${localScope ? scopePath : ''}:${s.name}`
        if (s.mode === 'var' || s.mode === 'varip') {
          if (!varInit.has(key)) {
            varInit.add(key)
            store(m, s.name, evalExpr(s.e))
          }
          return NA
        }
        if (s.mode === 'reassign') {
          const target = localScope?.has(s.name) ? localScope : globals
          if (!target.has(s.name))
            throw new PineError(`Cannot use ':=' on undeclared variable '${s.name}'`, s.line)
          const v = evalExpr(s.e)
          store(target, s.name, v)
          return NA
        }
        store(m, s.name, evalExpr(s.e))
        return NA
      }
      case 'tassign': {
        const key = `${localScope ? scopePath : ''}:${s.names.join(',')}`
        if (s.mode === 'var' && varInit.has(key)) return NA
        if (s.mode === 'var') {
          varInit.add(key)
          s.names.forEach((nm) => varInit.add(`${localScope ? scopePath : ''}:${nm}`))
        }
        const v = evalExpr(s.e)
        const m = localScope ?? globals
        s.names.forEach((nm, i) => store(m, nm, Array.isArray(v) ? v[i] : NA))
        return NA
      }
      case 'if': {
        let ret: Val = NA
        for (const b of s.branches) {
          if (b.c === null || truthy(evalExpr(b.c))) {
            for (const st of b.body) ret = exec(st)
            break
          }
        }
        return ret
      }
      case 'for': {
        const from = num(evalExpr(s.from))
        const to = num(evalExpr(s.to))
        const step = s.step ? Math.abs(num(evalExpr(s.step))) || 1 : 1
        const dirn = from <= to ? 1 : -1
        let ret: Val = NA
        const m = localScope ?? globals
        const saveIter = loopIter
        let guard = 0
        for (let i = from; dirn > 0 ? i <= to : i >= to; i += step * dirn) {
          if (guard++ > 100000) throw new PineError('Loop ran more than 100000 times', s.line)
          store(m, s.v, i)
          loopIter = `${saveIter}#${s.line}:${guard}`
          for (const st of s.body) ret = exec(st)
        }
        loopIter = saveIter
        return ret
      }
      case 'while': {
        let ret: Val = NA
        let guard = 0
        const saveIter = loopIter
        while (truthy(evalExpr(s.c))) {
          if (guard++ > 100000) throw new PineError('Loop ran more than 100000 times', s.line)
          loopIter = `${saveIter}#w${s.line}:${guard}`
          for (const st of s.body) ret = exec(st)
        }
        loopIter = saveIter
        return ret
      }
    }
  }
  // `var` values (and a function's locals) carry forward to the next bar.
  const carry = () => {
    if (bar === 0) return
    for (const [k, arr] of globals)
      if (arr[bar] === undefined && arr[bar - 1] !== undefined && varInit.has(`:${k}`))
        arr[bar] = arr[bar - 1]
    for (const [, sc] of fnScopes)
      for (const [, arr] of sc)
        if (arr[bar] === undefined && arr[bar - 1] !== undefined) arr[bar] = arr[bar - 1]
  }
  for (bar = 0; bar < n; bar++) {
    carry()
    for (const s of prog) exec(s)
  }
  res.plots = [...plotsByKey.values()].map(({ offset, ...p }) => {
    const values: Array<number | null> = new Array(n).fill(null)
    const colors = p.colors ? new Array<string | undefined>(n).fill(undefined) : undefined
    for (let i = 0; i < n; i++) {
      const j = i + offset
      if (j < 0 || j >= n) continue
      const v = p.values[i]
      values[j] = v == null || !Number.isFinite(v) ? null : v
      if (colors) colors[j] = p.colors![i]
    }
    return { ...p, values, colors }
  })
  res.inputs = [...inputKeys.values()]
  return res
}

export { PineError }
