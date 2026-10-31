// Pure condition logic for TradingView-style "Conditions" alerts: a rule holds
// up to MAX_CONDS conditions joined with AND, each comparing a left series
// (a price field, any indicator output, a Pine alertcondition) against a right
// side (a fixed value, another series, a drawing's line, or a channel made of
// two of those). Plus the pieces every kind shares: message templates, expiry
// and webhook URL checks.
//
// No DOM, storage, network or clock: the runtime (./condRuntime) resolves the
// series over candles and passes them in, so scripts/test-engines.mjs runs
// this file directly under Node. Imports carry their extension for that.

/** TradingView caps a multi-condition alert at five. */
export const MAX_CONDS = 5

export type PriceField = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'volume'
export const PRICE_FIELDS: PriceField[] = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4', 'volume']

/** A straight line in time/price space, from a drawing. */
export interface LineGeom {
  t1: number
  p1: number
  t2: number
  p2: number
  /**
   * segment: only between its two points (a plain trend line ends where it was
   * drawn, so a cross after its end is no cross) · ray: from t1 forward ·
   * extended: both ways · level: a fixed price from t1 forward (hline/hray;
   * an hline uses t1 = 0 so it holds everywhere).
   */
  span: 'segment' | 'ray' | 'extended' | 'level'
}

export type Operand =
  | { t: 'value'; v: number }
  | { t: 'price'; field: PriceField }
  /** An indicator instance output, `uid` from the rule's own snapshot. */
  | { t: 'out'; uid: string; key: string; label?: string }
  /** A drawing's line (a channel side is one line too). */
  | { t: 'line'; line: LineGeom; label?: string }
  /** A Pine script's alertcondition(), by index with its title as a check. */
  | { t: 'pine'; uid: string; idx: number; title: string }

export type CondOp =
  | 'cross'
  | 'cross_up'
  | 'cross_down'
  | 'gt'
  | 'lt'
  | 'enter'
  | 'exit'
  | 'inside'
  | 'outside'
  | 'up_pct'
  | 'down_pct'
  /** Pine alertcondition: fires on bars where the script's condition is true. */
  | 'true'

export const COND_OPS: CondOp[] = [
  'cross',
  'cross_up',
  'cross_down',
  'gt',
  'lt',
  'enter',
  'exit',
  'inside',
  'outside',
  'up_pct',
  'down_pct',
]
export const OP_LABEL: Record<CondOp, string> = {
  cross: 'Crossing',
  cross_up: 'Crossing up',
  cross_down: 'Crossing down',
  gt: 'Greater than',
  lt: 'Less than',
  enter: 'Entering channel',
  exit: 'Exiting channel',
  inside: 'Inside channel',
  outside: 'Outside channel',
  up_pct: 'Moving up %',
  down_pct: 'Moving down %',
  true: 'Is true',
}
/** Ops whose right side is a channel: `b` and `c` are its two bounds. */
export const CHANNEL_OPS: CondOp[] = ['enter', 'exit', 'inside', 'outside']
/** Ops whose right side is a percentage over `bars` bars. */
export const PCT_OPS: CondOp[] = ['up_pct', 'down_pct']

export interface Cond {
  a: Operand
  op: CondOp
  /** Right side; channel ops: one bound. Unused by 'true'. */
  b?: Operand
  /** Channel ops: the other bound. */
  c?: Operand
  /** up_pct/down_pct: the look-back in bars (default 1). */
  bars?: number
}

export interface Bar {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

/**
 * Everything a condition can read, over one candle array. `outputs` is keyed
 * `uid.key` (indicator outputs computed over these candles); `pine` is keyed
 * by Pine instance uid, the alertconditions' per-bar values.
 */
export interface CondCtx {
  candles: Bar[]
  outputs: Record<string, ReadonlyArray<number | null | undefined>>
  pine: Record<string, Array<{ title: string; values: ReadonlyArray<boolean | null | undefined> }>>
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function priceAt(f: PriceField, k: Bar): number {
  switch (f) {
    case 'open':
      return k.o
    case 'high':
      return k.h
    case 'low':
      return k.l
    case 'hl2':
      return (k.h + k.l) / 2
    case 'hlc3':
      return (k.h + k.l + k.c) / 3
    case 'ohlc4':
      return (k.o + k.h + k.l + k.c) / 4
    case 'volume':
      return k.v
    default:
      return k.c
  }
}

/** The line's price at time `t`, or null where the line does not reach. */
export function linePriceAt(g: LineGeom, t: number): number | null {
  if (!fin(t) || !fin(g.p1)) return null
  if (g.span === 'level') return t >= g.t1 ? g.p1 : null
  if (!fin(g.p2) || !fin(g.t1) || !fin(g.t2)) return null
  const lo = Math.min(g.t1, g.t2)
  const hi = Math.max(g.t1, g.t2)
  if (g.span === 'segment' && (t < lo || t > hi)) return null
  // A ray runs from its first point through its second and on.
  if (g.span === 'ray' && (g.t2 >= g.t1 ? t < g.t1 : t > g.t1)) return null
  if (g.t2 === g.t1) return g.p1
  return g.p1 + ((g.p2 - g.p1) * (t - g.t1)) / (g.t2 - g.t1)
}

/** An operand's value on bar `i`, or null when it has none there. */
export function operandAt(op: Operand | undefined, ctx: CondCtx, i: number): number | null {
  const k = ctx.candles[i]
  if (!op || !k) return null
  switch (op.t) {
    case 'value':
      return fin(op.v) ? op.v : null
    case 'price': {
      const v = priceAt(op.field, k)
      return fin(v) ? v : null
    }
    case 'out': {
      const v = ctx.outputs[op.uid + '.' + op.key]?.[i]
      return fin(v) ? v : null
    }
    case 'line':
      return linePriceAt(op.line, k.t)
    case 'pine': {
      const v = pineConditionOf(op, ctx)?.[i]
      return v == null ? null : v ? 1 : 0
    }
  }
}

/**
 * A Pine operand's per-bar values. The index is the primary key, but scripts
 * get edited: when the title at that index no longer matches, look the title
 * up instead, so an inserted alertcondition() does not silently retarget.
 */
function pineConditionOf(
  op: Extract<Operand, { t: 'pine' }>,
  ctx: CondCtx,
): ReadonlyArray<boolean | null | undefined> | null {
  const list = ctx.pine[op.uid]
  if (!list) return null
  const at = list[op.idx]
  if (at && at.title === op.title) return at.values
  const byTitle = list.find((x) => x.title === op.title)
  return byTitle ? byTitle.values : (at?.values ?? null)
}

/** The channel bounds on bar `i`, low first; null when either is missing. */
function bandAt(cond: Cond, ctx: CondCtx, i: number): [number, number] | null {
  const b = operandAt(cond.b, ctx, i)
  const c = operandAt(cond.c, ctx, i)
  if (b == null || c == null) return null
  return b <= c ? [b, c] : [c, b]
}

/**
 * Whether one condition holds on bar `i` (crosses compare with bar i-1, as
 * TradingView does). A cross needs both bars: it never fires on the first
 * bar, nor across a gap where either side had no value.
 */
export function evalCond(cond: Cond, ctx: CondCtx, i: number): boolean {
  if (i < 0 || i >= ctx.candles.length) return false
  const a = operandAt(cond.a, ctx, i)
  if (cond.op === 'true') return a === 1
  if (a == null) return false
  switch (cond.op) {
    case 'gt':
    case 'lt': {
      const b = operandAt(cond.b, ctx, i)
      if (b == null) return false
      return cond.op === 'gt' ? a > b : a < b
    }
    case 'cross':
    case 'cross_up':
    case 'cross_down': {
      const b = operandAt(cond.b, ctx, i)
      const a0 = operandAt(cond.a, ctx, i - 1)
      const b0 = operandAt(cond.b, ctx, i - 1)
      if (b == null || a0 == null || b0 == null) return false
      const up = a0 <= b0 && a > b
      const down = a0 >= b0 && a < b
      return cond.op === 'cross_up' ? up : cond.op === 'cross_down' ? down : up || down
    }
    case 'inside':
    case 'outside': {
      const band = bandAt(cond, ctx, i)
      if (!band) return false
      const inside = a >= band[0] && a <= band[1]
      return cond.op === 'inside' ? inside : !inside
    }
    case 'enter':
    case 'exit': {
      const band = bandAt(cond, ctx, i)
      const band0 = bandAt(cond, ctx, i - 1)
      const a0 = operandAt(cond.a, ctx, i - 1)
      if (!band || !band0 || a0 == null) return false
      const now = a >= band[0] && a <= band[1]
      const before = a0 >= band0[0] && a0 <= band0[1]
      return cond.op === 'enter' ? now && !before : !now && before
    }
    case 'up_pct':
    case 'down_pct': {
      const n = Math.max(1, Math.round(cond.bars || 1))
      const a0 = operandAt(cond.a, ctx, i - n)
      const pct = operandAt(cond.b, ctx, i)
      if (a0 == null || pct == null || a0 === 0) return false
      const move = ((a - a0) / Math.abs(a0)) * 100
      return cond.op === 'up_pct' ? move >= pct : move <= -pct
    }
    default:
      return false
  }
}

/** All conditions on bar `i` (AND). An empty list never holds. */
export function evalConds(conds: Cond[], ctx: CondCtx, i: number): boolean {
  return conds.length > 0 && conds.every((c) => evalCond(c, ctx, i))
}

/**
 * The bar a rule is judged on: the forming bar, or — on bar close — the last
 * closed one (so a cross that un-crosses inside the bar never fires).
 */
export const judgedBar = (n: number, onClose: boolean | undefined): number => (onClose ? n - 2 : n - 1)

// ---------------------------------------------------------------- validation

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object'
const SPANS = ['segment', 'ray', 'extended', 'level']
const ALL_OPS = new Set<string>([...COND_OPS, 'true'])
const label = (x: unknown) => (typeof x === 'string' ? x.slice(0, 60) : undefined)

function normOperand(x: unknown): Operand | null {
  if (!isObj(x)) return null
  switch (x.t) {
    case 'value':
      return fin(x.v) ? { t: 'value', v: x.v } : null
    case 'price':
      return PRICE_FIELDS.includes(x.field as PriceField) ? { t: 'price', field: x.field as PriceField } : null
    case 'out':
      return typeof x.uid === 'string' && x.uid && typeof x.key === 'string' && x.key
        ? { t: 'out', uid: x.uid, key: x.key, label: label(x.label) }
        : null
    case 'line': {
      const g = x.line
      if (!isObj(g) || !SPANS.includes(String(g.span)) || !fin(g.t1) || !fin(g.p1)) return null
      return {
        t: 'line',
        line: { t1: g.t1, p1: g.p1, t2: fin(g.t2) ? g.t2 : g.t1, p2: fin(g.p2) ? g.p2 : g.p1, span: g.span as LineGeom['span'] },
        label: label(x.label),
      }
    }
    case 'pine':
      return typeof x.uid === 'string' && x.uid && fin(x.idx) && typeof x.title === 'string'
        ? { t: 'pine', uid: x.uid, idx: Math.max(0, Math.round(x.idx)), title: x.title.slice(0, 120) }
        : null
    default:
      return null
  }
}

/** Saved conditions back into valid ones; null when any is unusable. */
export function normalizeConds(raw: unknown): Cond[] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_CONDS) return null
  const out: Cond[] = []
  for (const x of raw) {
    if (!isObj(x) || typeof x.op !== 'string' || !ALL_OPS.has(x.op)) return null
    const op = x.op as CondOp
    const a = normOperand(x.a)
    if (!a) return null
    const c: Cond = { a, op }
    if (op !== 'true') {
      const b = normOperand(x.b)
      if (!b) return null
      c.b = b
    }
    if (CHANNEL_OPS.includes(op)) {
      const cc = normOperand(x.c)
      if (!cc) return null
      c.c = cc
    }
    if (PCT_OPS.includes(op)) c.bars = fin(x.bars) ? Math.max(1, Math.min(500, Math.round(x.bars))) : 1
    out.push(c)
  }
  return out
}

/** Every indicator / Pine uid the conditions read. */
export function condUids(conds: Cond[]): string[] {
  const s = new Set<string>()
  conds.forEach((c) =>
    [c.a, c.b, c.c].forEach((o) => {
      if (o && (o.t === 'out' || o.t === 'pine')) s.add(o.uid)
    }),
  )
  return [...s]
}

/** The look-back the conditions need beyond the judged bar. */
export function condLookback(conds: Cond[]): number {
  return conds.reduce((m, c) => Math.max(m, PCT_OPS.includes(c.op) ? c.bars || 1 : 1), 1)
}

// ---------------------------------------------------------------- display

const num = (v: number) => (Math.abs(v) >= 1000 ? String(+v.toFixed(2)) : String(+v.toPrecision(8)))

export function operandLabel(o: Operand | undefined): string {
  if (!o) return '?'
  switch (o.t) {
    case 'value':
      return num(o.v)
    case 'price':
      return o.field === 'hl2' ? 'HL/2' : o.field === 'hlc3' ? 'HLC/3' : o.field === 'ohlc4' ? 'OHLC/4' : o.field[0].toUpperCase() + o.field.slice(1)
    case 'out':
      return o.label || o.key
    case 'line':
      return o.label || 'Line'
    case 'pine':
      return o.title || 'Pine condition'
  }
}

export function condText(c: Cond): string {
  if (c.op === 'true') return operandLabel(c.a)
  const rhs = CHANNEL_OPS.includes(c.op)
    ? operandLabel(c.b) + ' – ' + operandLabel(c.c)
    : PCT_OPS.includes(c.op)
      ? operandLabel(c.b) + '% in ' + (c.bars || 1) + ' bar' + ((c.bars || 1) === 1 ? '' : 's')
      : operandLabel(c.b)
  return operandLabel(c.a) + ' ' + OP_LABEL[c.op].toLowerCase() + ' ' + rhs
}

// ---------------------------------------------------------------- drawings

/** The drawing as alerts see it (the chart's own shape, see drawings/geometry). */
export interface DrawingLike {
  type: string
  points: Array<{ time: number; price: number }>
}

/**
 * The lines a drawing offers to an alert, named for the picker: one for a
 * trend line / ray / extended line / level, two for a channel. Drawings are
 * anchored in chart time (seconds); lines come out in candle time (ms).
 * The chart interpolates between bars in bar-index space, which is the same
 * as time space for a 24/7 market — on markets with session gaps the line an
 * alert follows can sit slightly off the drawn one between distant anchors.
 *
 * A parallel channel's width is the third point's offset from the base line
 * at that time, in price — what the chart draws on a linear scale.
 */
export function drawingLines(d: DrawingLike): Array<{ label: string; line: LineGeom }> {
  const p = (d.points || []).map((x) => ({ time: x.time * 1000, price: x.price }))
  const ok = (i: number) => p[i] && fin(p[i].time) && fin(p[i].price)
  if (!ok(0)) return []
  const A = p[0]
  const two = (span: LineGeom['span']): LineGeom | null =>
    ok(1) ? { t1: A.time, p1: A.price, t2: p[1].time, p2: p[1].price, span } : null
  const out: Array<{ label: string; line: LineGeom }> = []
  const push = (lbl: string, g: LineGeom | null) => {
    if (g) out.push({ label: lbl, line: g })
  }
  switch (d.type) {
    case 'trend':
    case 'arrow':
    case 'infoline':
      push('Trend line', two('segment'))
      break
    case 'ray':
      push('Ray', two('ray'))
      break
    case 'extended':
      push('Extended line', two('extended'))
      break
    case 'hline':
      push('Horizontal line', { t1: 0, p1: A.price, t2: 0, p2: A.price, span: 'level' })
      break
    case 'hray':
      push('Horizontal ray', { t1: A.time, p1: A.price, t2: A.time, p2: A.price, span: 'level' })
      break
    case 'parallel': {
      const base = two('segment')
      if (!base || !ok(2)) break
      const at = linePriceAt({ ...base, span: 'extended' }, p[2].time)
      if (at == null) break
      const dy = p[2].price - at
      const hi = dy >= 0
      push('Channel ' + (hi ? 'bottom' : 'top'), base)
      push('Channel ' + (hi ? 'top' : 'bottom'), { ...base, p1: base.p1 + dy, p2: base.p2 + dy })
      break
    }
    case 'flatchannel': {
      if (!ok(1)) break
      const top = Math.max(A.price, p[1].price)
      const bot = Math.min(A.price, p[1].price)
      push('Channel top', { t1: 0, p1: top, t2: 0, p2: top, span: 'level' })
      push('Channel bottom', { t1: 0, p1: bot, t2: 0, p2: bot, span: 'level' })
      break
    }
  }
  return out
}

// ---------------------------------------------------------------- shared rule extras

/**
 * A custom alert message: {{ticker}}, {{close}}, {{interval}}, {{time}} (and
 * {{open}}/{{high}}/{{low}}/{{volume}} when known) as on TradingView.
 * Placeholders without a value stay as written, so a typo is visible.
 */
export function fillTemplate(tpl: string, vars: Record<string, string | number | undefined>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => {
    const v = vars[k.toLowerCase()]
    return v == null || v === '' ? m : String(v)
  })
}

/** True once an expiry time has passed. */
export const isExpired = (expires: number | undefined, now: number): boolean => expires != null && now >= expires

/** Longest custom message and webhook URL kept. */
export const MAX_MESSAGE = 500
export const MAX_WEBHOOK_URL = 500

/**
 * A webhook target the relay will accept: https only, a real host name (no
 * credentials, no IP literal, no localhost). The relay (api/alert-webhook.mjs)
 * checks again — and resolves the host — since the browser can be bypassed.
 */
export function validWebhookUrl(raw: string): string | null {
  const s = (raw || '').trim()
  if (!s || s.length > MAX_WEBHOOK_URL) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null
  const h = u.hostname.toLowerCase()
  if (!h.includes('.') || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return null
  if (/^[\d.]+$/.test(h) || h.startsWith('[')) return null
  return u.href
}
