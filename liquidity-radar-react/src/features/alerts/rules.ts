// Pure alert-rule logic: the rule model, migration of the old saved price
// alerts, condition evaluation and the fire/cooldown decision. Ported from the
// Pro Terminal's alert engine (core/alerts/engine.ts) onto this app's candle
// shape and indicator math. No DOM, network, storage or clock here — callers
// pass `now` — so scripts/test-engines.mjs runs it directly under Node.
//
// The indicator import carries its extension because Node's type stripping
// (used by the unit tests) resolves specifiers literally.
import { calcRSI, emaArr, macdSeries, smaArr } from '../../utils/indicators.ts'

export type AlertKind = 'price' | 'technical' | 'watchlist'
export const ALERT_LIMITS: Record<AlertKind, number> = { price: 1000, technical: 1000, watchlist: 15 }

export type PriceCond =
  | 'crosses_above'
  | 'crosses_below'
  | 'above'
  | 'below'
  | 'pct_change_24h_above'
  | 'pct_change_24h_below'
export type TechCond =
  | 'rsi_above'
  | 'rsi_below'
  | 'ema_cross_up'
  | 'ema_cross_down'
  | 'macd_cross_up'
  | 'macd_cross_down'
  | 'close_above_sma'
  | 'close_below_sma'
export type WatchCond = 'any_pct_24h_above' | 'any_pct_24h_below' | 'count_above_pct'
export type AlertCond = PriceCond | TechCond | WatchCond

export const PRICE_CONDS: PriceCond[] = [
  'crosses_above',
  'crosses_below',
  'above',
  'below',
  'pct_change_24h_above',
  'pct_change_24h_below',
]
export const TECH_CONDS: TechCond[] = [
  'rsi_above',
  'rsi_below',
  'ema_cross_up',
  'ema_cross_down',
  'macd_cross_up',
  'macd_cross_down',
  'close_above_sma',
  'close_below_sma',
]
export const WATCH_CONDS: WatchCond[] = ['any_pct_24h_above', 'any_pct_24h_below', 'count_above_pct']
export const CONDS_BY_KIND: Record<AlertKind, AlertCond[]> = {
  price: PRICE_CONDS,
  technical: TECH_CONDS,
  watchlist: WATCH_CONDS,
}

/** Price conditions that sit at a fixed price — drawn as lines on the chart. */
export const LEVEL_CONDS: AlertCond[] = ['crosses_above', 'crosses_below', 'above', 'below']

export const DEFAULT_COOLDOWN_MIN = 15

export interface AlertRule {
  id: string
  kind: AlertKind
  /** Pair, e.g. BTCUSDT. Absent for watchlist rules (they use the favourites). */
  sym?: string
  /** Candle interval for technical rules. */
  tf?: string
  condition: AlertCond
  value: number
  /** EMA slow length, or the symbol count for count_above_pct. */
  value2?: number
  /** Fire once then disable, or keep firing (at most once per cooldown). */
  once: boolean
  cooldownMin?: number
  enabled: boolean
  created: number
  lastTriggered?: number
  triggerCount: number
  /** Whether the condition held at the last evaluation (edge detection). */
  lastState?: boolean
  /** Watchlist "any" rules: symbols that matched last time. */
  lastMatched?: string[]
}

export interface AlertEvent {
  id: string
  ruleId: string
  name: string
  ts: number
  message: string
  sym?: string
}

/** The shape saved under lr_alerts_v1 before this engine: price above/below only. */
interface LegacyAlert {
  sym: string
  dir: string
  price: number
  fired?: boolean
  created?: number
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const ALL_CONDS = new Set<string>([...PRICE_CONDS, ...TECH_CONDS, ...WATCH_CONDS])

/**
 * Read whatever is saved under the alerts key — old price alerts, new rules,
 * or junk — into valid rules. Old alerts keep their meaning: "above" fired at
 * price >= target once, and a fired one stays spent (disabled). Ids for
 * migrated alerts are derived from their data so repeated loads agree.
 */
export function normalizeRules(raw: unknown): AlertRule[] {
  if (!Array.isArray(raw)) return []
  const out: AlertRule[] = []
  raw.forEach((x, i) => {
    if (!x || typeof x !== 'object') return
    const o = x as Record<string, unknown>
    if (typeof o.kind === 'string') {
      const kind = o.kind as AlertKind
      if (!(kind in ALERT_LIMITS)) return
      if (typeof o.condition !== 'string' || !ALL_CONDS.has(o.condition)) return
      if (!(CONDS_BY_KIND[kind] as string[]).includes(o.condition)) return
      if (!isNum(o.value)) return
      if (kind !== 'watchlist' && (typeof o.sym !== 'string' || !o.sym)) return
      out.push({
        id: typeof o.id === 'string' && o.id ? o.id : 'al-' + i + '-' + String(o.created ?? 0),
        kind,
        sym: kind === 'watchlist' ? undefined : String(o.sym),
        tf: kind === 'technical' ? (typeof o.tf === 'string' && o.tf ? o.tf : '15m') : undefined,
        condition: o.condition as AlertCond,
        value: o.value,
        value2: isNum(o.value2) ? o.value2 : undefined,
        once: o.once !== false,
        cooldownMin: isNum(o.cooldownMin) && o.cooldownMin >= 0 ? o.cooldownMin : undefined,
        enabled: o.enabled !== false,
        created: isNum(o.created) ? o.created : 0,
        lastTriggered: isNum(o.lastTriggered) ? o.lastTriggered : undefined,
        triggerCount: isNum(o.triggerCount) ? o.triggerCount : 0,
        lastState: typeof o.lastState === 'boolean' ? o.lastState : undefined,
        lastMatched: Array.isArray(o.lastMatched)
          ? o.lastMatched.filter((s): s is string => typeof s === 'string')
          : undefined,
      })
      return
    }
    // Legacy { sym, dir, price, fired, created }.
    const l = o as unknown as LegacyAlert
    if (typeof l.sym !== 'string' || !l.sym || !isNum(Number(l.price)) || !(Number(l.price) > 0)) return
    const fired = !!l.fired
    out.push({
      id: 'al-legacy-' + (isNum(l.created) ? l.created : 0) + '-' + i,
      kind: 'price',
      sym: l.sym.toUpperCase(),
      condition: l.dir === 'below' ? 'below' : 'above',
      value: Number(l.price),
      once: true,
      enabled: !fired,
      created: isNum(l.created) ? l.created : 0,
      triggerCount: fired ? 1 : 0,
      lastState: fired ? true : undefined,
    })
  })
  return out
}

export const condLabel = (c: string): string => c.replace(/_/g, ' ').replace('pct', '%')

/** Short human name, e.g. "BTCUSDT crosses above 70000" or "ETHUSDT 1h rsi above 70". */
export function ruleName(r: AlertRule): string {
  const v = r.value + (r.value2 != null ? '/' + r.value2 : '')
  if (r.kind === 'watchlist') return 'Watchlist: ' + condLabel(r.condition) + ' ' + v
  return r.sym + (r.kind === 'technical' ? ' ' + (r.tf || '15m') : '') + ' ' + condLabel(r.condition) + ' ' + v
}

// ---------------------------------------------------------------- conditions

/**
 * Whether a price condition holds now. "above"/"below" are levels (inclusive,
 * as the old alerts were); "crosses" needs the previous observed price on the
 * other side, so a crosses rule never fires on its very first sample.
 */
export function evalPrice(
  rule: Pick<AlertRule, 'condition' | 'value'>,
  price: number,
  prevPrice: number | undefined,
  pct24h: number | undefined,
): boolean {
  if (!isNum(price)) return false
  const v = rule.value
  switch (rule.condition) {
    case 'above':
      return price >= v
    case 'below':
      return price <= v
    case 'crosses_above':
      return prevPrice != null && prevPrice <= v && price > v
    case 'crosses_below':
      return prevPrice != null && prevPrice >= v && price < v
    case 'pct_change_24h_above':
      return isNum(pct24h) && pct24h > v
    case 'pct_change_24h_below':
      return isNum(pct24h) && pct24h < v
    default:
      return false
  }
}

/** Minimum candles before a technical condition is judged at all. */
export const MIN_TECH_CANDLES = 60

/** Whether a technical condition holds on the latest candle (candles oldest first, `c` = close). */
export function evalTechnical(
  rule: Pick<AlertRule, 'condition' | 'value' | 'value2'>,
  candles: { c: number }[],
): boolean {
  if (!candles || candles.length < MIN_TECH_CANDLES) return false
  const close = candles.map((k) => +k.c)
  const i = close.length - 1
  const j = i - 1
  switch (rule.condition) {
    case 'rsi_above':
      return calcRSI(close, 14) > rule.value
    case 'rsi_below':
      return calcRSI(close, 14) < rule.value
    case 'ema_cross_up':
    case 'ema_cross_down': {
      const f = emaArr(close, rule.value || 9)
      const s = emaArr(close, rule.value2 || 21)
      return rule.condition === 'ema_cross_up'
        ? f[j] <= s[j] && f[i] > s[i]
        : f[j] >= s[j] && f[i] < s[i]
    }
    case 'macd_cross_up':
    case 'macd_cross_down': {
      const h = macdSeries(close).hist
      return rule.condition === 'macd_cross_up' ? h[j] <= 0 && h[i] > 0 : h[j] >= 0 && h[i] < 0
    }
    case 'close_above_sma':
    case 'close_below_sma': {
      const m = smaArr(close, rule.value || 50)[i]
      if (m == null) return false
      return rule.condition === 'close_above_sma' ? close[i] > m : close[i] < m
    }
    default:
      return false
  }
}

export interface WatchResult {
  hit: boolean
  matched: string[]
  detail: string
}

/** Evaluate a watchlist rule over the favourites' 24h changes (symbols without data are skipped). */
export function evalWatchlist(
  rule: Pick<AlertRule, 'condition' | 'value' | 'value2'>,
  tickers: { symbol: string; pct: number }[],
): WatchResult {
  const t = tickers.filter((x) => isNum(x.pct))
  const fmt = (m: { symbol: string; pct: number }[]) =>
    m.map((x) => x.symbol + ' ' + x.pct.toFixed(2) + '%').join(', ')
  switch (rule.condition) {
    case 'any_pct_24h_above': {
      const m = t.filter((x) => x.pct > rule.value)
      return { hit: m.length > 0, matched: m.map((x) => x.symbol), detail: fmt(m) }
    }
    case 'any_pct_24h_below': {
      const m = t.filter((x) => x.pct < rule.value)
      return { hit: m.length > 0, matched: m.map((x) => x.symbol), detail: fmt(m) }
    }
    case 'count_above_pct': {
      const m = t.filter((x) => x.pct > rule.value)
      return {
        hit: m.length >= (rule.value2 ?? 3),
        matched: m.map((x) => x.symbol),
        detail: m.length + ' symbols above ' + rule.value + '%',
      }
    }
    default:
      return { hit: false, matched: [], detail: '' }
  }
}

// ---------------------------------------------------------------- firing

export interface StepResult {
  fire: boolean
  next: AlertRule
}

/**
 * Decide whether a rule fires given whether its condition holds now.
 *
 * Fires on the transition into "true" only, so a level that stays above does
 * not re-notify every tick. A repeating rule is additionally held to its
 * cooldown: an edge inside the cooldown is not consumed, so if the condition
 * still holds once the cooldown ends it fires then. A "once" rule disables
 * itself after firing. For "any symbol" watchlist rules a new symbol joining
 * the matching set counts as a fresh edge (`matched`).
 */
export function stepRule(rule: AlertRule, hit: boolean, now: number, matched?: string[]): StepResult {
  if (!rule.enabled) return { fire: false, next: rule }
  const perSymbol = rule.kind === 'watchlist' && rule.condition !== 'count_above_pct' && matched != null
  const prevMatched = rule.lastMatched || []
  const edge = perSymbol
    ? matched!.some((s) => !prevMatched.includes(s))
    : hit && !rule.lastState
  const cdMs = (rule.cooldownMin ?? DEFAULT_COOLDOWN_MIN) * 60000
  const cooling = !rule.once && rule.lastTriggered != null && now - rule.lastTriggered < cdMs
  if (edge && cooling) {
    // Hold the edge: keep the old state so it can fire when the cooldown ends.
    return { fire: false, next: rule }
  }
  const next: AlertRule = { ...rule, lastState: hit }
  if (perSymbol) next.lastMatched = matched!.slice()
  if (edge) {
    next.lastTriggered = now
    next.triggerCount = rule.triggerCount + 1
    if (rule.once) next.enabled = false
  }
  return { fire: edge, next }
}

/** Re-arming a rule clears its edge memory so it judges afresh. */
export function rearm(rule: AlertRule): AlertRule {
  return { ...rule, enabled: true, lastState: undefined, lastMatched: undefined }
}
