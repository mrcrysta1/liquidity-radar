// Pure alert-rule logic: the rule model, migration of the old saved price
// alerts, condition evaluation and the fire/cooldown decision. Ported from the
// Pro Terminal's alert engine (core/alerts/engine.ts) onto this app's candle
// shape and indicator math. No DOM, network, storage or clock here — callers
// pass `now` — so scripts/test-engines.mjs runs it directly under Node.
//
// The indicator import carries its extension because Node's type stripping
// (used by the unit tests) resolves specifiers literally.
import { calcRSI, emaArr, macdSeries, smaArr } from '../../utils/indicators.ts'
import { candlesMatch } from '../../services/symbolScope.ts'
import { MAX_MESSAGE, condText, isExpired, normalizeConds, validWebhookUrl } from './conditions.ts'
import type { Cond } from './conditions.ts'

/** 'cond': TradingView-style conditions (indicator outputs, drawings, Pine
 *  alertconditions; up to five joined with AND) — see ./conditions. */
export type AlertKind = 'price' | 'technical' | 'watchlist' | 'cond'
export const ALERT_LIMITS: Record<AlertKind, number> = {
  price: 1000,
  technical: 1000,
  watchlist: 15,
  cond: 400,
}

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
  | 'move_up_pct'
  | 'move_down_pct'
/** any_technical: a technical condition (`tech`) on any favourite. */
export type WatchCond = 'any_pct_24h_above' | 'any_pct_24h_below' | 'count_above_pct' | 'any_technical'
export type AlertCond = PriceCond | TechCond | WatchCond | 'conditions'

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
  'move_up_pct',
  'move_down_pct',
]
export const WATCH_CONDS: WatchCond[] = [
  'any_pct_24h_above',
  'any_pct_24h_below',
  'count_above_pct',
  'any_technical',
]
export const CONDS_BY_KIND: Record<AlertKind, AlertCond[]> = {
  price: PRICE_CONDS,
  technical: TECH_CONDS,
  watchlist: WATCH_CONDS,
  cond: ['conditions'],
}

/**
 * How often a rule may fire (TradingView's options):
 *  once  — the first time, then the rule switches off;
 *  bar   — at most once per bar, as soon as it holds (intrabar);
 *  close — at most once per bar, judged when the bar closes;
 *  every — on every new trigger, held to the rule's cooldown.
 * Rules saved before this field derive it from `once`.
 */
export type AlertFreq = 'once' | 'bar' | 'close' | 'every'
export const FREQS: AlertFreq[] = ['once', 'bar', 'close', 'every']
export const freqOf = (r: Pick<AlertRule, 'freq' | 'once'>): AlertFreq =>
  r.freq ?? (r.once ? 'once' : 'every')

/** An indicator instance as a conditions rule keeps it (indicators/store's
 *  IndicatorInstance, copied so the alert outlives edits to the chart). */
export interface IndSnap {
  uid: string
  type: string
  params: Record<string, number>
  source: string
  visible: boolean
  script?: string
  title?: string
  pineInputs?: Record<string, unknown>
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
  /** Technical rules: judge only closed bars, so a cross that un-crosses inside the bar never fires. */
  onClose?: boolean
  /** Whether the condition held at the last evaluation (edge detection). */
  lastState?: boolean
  /** Watchlist "any" rules: symbols that matched last time. */
  lastMatched?: string[]
  /** See AlertFreq; absent on rules saved before it existed. */
  freq?: AlertFreq
  /** bar / close frequency: open time of the bar it last fired on. */
  lastBar?: number
  /** Stop judging (and switch off) from this time, ms. */
  expires?: number
  /** Custom notification text with {{ticker}} {{close}} {{interval}} {{time}}. */
  message?: string
  /** https URL each fire is POSTed to, through api/alert-webhook. */
  webhook?: string
  /** Watchlist any_technical: the technical condition judged per symbol. */
  tech?: TechCond
  /** cond kind: the conditions (AND) and the indicator instances they read. */
  conds?: Cond[]
  inds?: IndSnap[]
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
const ALL_CONDS = new Set<string>([...PRICE_CONDS, ...TECH_CONDS, ...WATCH_CONDS, 'conditions'])

/** A saved indicator snapshot, minimally checked (the indicator code
 *  re-validates params when it computes). Pine scripts keep their cap. */
function normalizeInds(raw: unknown): IndSnap[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .filter((x) => typeof x.uid === 'string' && !!x.uid && typeof x.type === 'string' && !!x.type)
    .slice(0, 20)
    .map((x) => ({
      uid: String(x.uid),
      type: String(x.type),
      params: x.params && typeof x.params === 'object' ? (x.params as Record<string, number>) : {},
      source: typeof x.source === 'string' ? x.source : 'close',
      visible: true,
      script: typeof x.script === 'string' ? x.script.slice(0, 32000) : undefined,
      title: typeof x.title === 'string' ? x.title.slice(0, 80) : undefined,
      pineInputs:
        x.pineInputs && typeof x.pineInputs === 'object'
          ? (x.pineInputs as Record<string, unknown>)
          : undefined,
    }))
}

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
      const conds = kind === 'cond' ? normalizeConds(o.conds) : null
      if (kind === 'cond' && !conds) return
      const tech = o.condition === 'any_technical' ? TECH_CONDS.find((c) => c === o.tech) : undefined
      if (o.condition === 'any_technical' && !tech) return
      const usesTf = kind === 'technical' || kind === 'cond' || !!tech
      out.push({
        id: typeof o.id === 'string' && o.id ? o.id : 'al-' + i + '-' + String(o.created ?? 0),
        kind,
        sym: kind === 'watchlist' ? undefined : String(o.sym),
        tf: usesTf ? (typeof o.tf === 'string' && o.tf ? o.tf : '15m') : undefined,
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
        // Dropped before this engine knew about it, so on-close technicals
        // reloaded as intrabar; kept now.
        onClose: typeof o.onClose === 'boolean' ? o.onClose : undefined,
        freq: FREQS.find((f) => f === o.freq),
        lastBar: isNum(o.lastBar) ? o.lastBar : undefined,
        expires: isNum(o.expires) ? o.expires : undefined,
        message:
          typeof o.message === 'string' && o.message.trim() ? o.message.slice(0, MAX_MESSAGE) : undefined,
        webhook: typeof o.webhook === 'string' ? (validWebhookUrl(o.webhook) ?? undefined) : undefined,
        tech,
        conds: conds ?? undefined,
        inds: kind === 'cond' ? normalizeInds(o.inds) : undefined,
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
  if (r.kind === 'cond') return r.sym + ' ' + (r.tf || '15m') + ' ' + (r.conds || []).map(condText).join(' AND ')
  if (r.kind === 'watchlist' && r.tech)
    return 'Watchlist ' + (r.tf || '15m') + ': any ' + condLabel(r.tech) + ' ' + v
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
  /** Highest and lowest trade since the previous sample, when known: a wick
   *  through the level between two samples is a cross too (TradingView
   *  triggers intrabar). */
  range?: { hi: number; lo: number },
): boolean {
  if (!isNum(price)) return false
  const v = rule.value
  switch (rule.condition) {
    case 'above':
      return price >= v
    case 'below':
      return price <= v
    case 'crosses_above':
      return prevPrice != null && prevPrice <= v && (price > v || (range != null && range.hi > v))
    case 'crosses_below':
      return prevPrice != null && prevPrice >= v && (price < v || (range != null && range.lo < v))
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

/** What the main chart currently holds, as far as alert evaluation cares. */
export interface ChartedCandles {
  symbol: string
  tf: string
  /** mdTf(tf): the interval form the candles tag is written with. */
  tfKey: string
  /** state.candlesKey — which market the candles actually belong to. */
  candlesKey: string
  bars: number
}

/**
 * Whether a technical rule on `sym`/`tf` may read the main chart's candles.
 * Symbol and interval matching is not enough: right after a switch the array
 * can still hold the previous market's bars, so the candles' own tag must
 * agree too.
 */
export function chartedCandlesFit(c: ChartedCandles, sym: string, tf: string): boolean {
  return (
    sym === c.symbol &&
    tf === c.tf &&
    candlesMatch(c.candlesKey, sym, c.tfKey) &&
    c.bars >= MIN_TECH_CANDLES
  )
}

/** Whether a technical condition holds on the latest candle (candles oldest first, `c` = close). */
export function evalTechnical(
  rule: Pick<AlertRule, 'condition' | 'value' | 'value2' | 'onClose'>,
  candles: { c: number }[],
): boolean {
  if (!candles || candles.length < MIN_TECH_CANDLES) return false
  // On bar close: the last candle is still forming, judge the one before.
  const bars = rule.onClose ? candles.slice(0, -1) : candles
  if (bars.length < MIN_TECH_CANDLES) return false
  const close = bars.map((k) => +k.c)
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
    case 'move_up_pct':
    case 'move_down_pct': {
      // TradingView's "moving up/down %": close vs the close N bars back.
      const n = Math.max(1, Math.round(rule.value2 || 1))
      const base = close[i - n]
      if (!(base > 0)) return false
      const move = ((close[i] - base) / base) * 100
      return rule.condition === 'move_up_pct' ? move >= rule.value : move <= -rule.value
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

/**
 * A watchlist any_technical rule: its technical condition on each favourite's
 * candles (symbols whose candles have not loaded yet are skipped).
 */
export function evalWatchTech(
  rule: Pick<AlertRule, 'tech' | 'value' | 'value2' | 'onClose'>,
  bySymbol: Array<{ symbol: string; candles: { c: number }[] }>,
): WatchResult {
  if (!rule.tech) return { hit: false, matched: [], detail: '' }
  const tr = { condition: rule.tech, value: rule.value, value2: rule.value2, onClose: rule.onClose }
  const m = bySymbol.filter((x) => evalTechnical(tr, x.candles)).map((x) => x.symbol)
  return { hit: m.length > 0, matched: m, detail: m.join(', ') }
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
 *
 * The "bar" and "close" frequencies fire whenever the condition holds, at most
 * once per bar (`barT`: open time of the bar judged) — a level that stays
 * above fires again on the next bar, as on TradingView. Without a bar time
 * they fall back to the edge rule. A rule past its expiry switches off unfired.
 */
export function stepRule(
  rule: AlertRule,
  hit: boolean,
  now: number,
  matched?: string[],
  barT?: number,
): StepResult {
  if (!rule.enabled) return { fire: false, next: rule }
  if (isExpired(rule.expires, now)) return { fire: false, next: { ...rule, enabled: false } }
  const freq = freqOf(rule)
  const perSymbol = rule.kind === 'watchlist' && rule.condition !== 'count_above_pct' && matched != null
  const prevMatched = rule.lastMatched || []
  if ((freq === 'bar' || freq === 'close') && barT != null) {
    const fire = hit && rule.lastBar !== barT
    const next: AlertRule = { ...rule, lastState: hit }
    if (perSymbol) next.lastMatched = matched!.slice()
    if (fire) {
      next.lastBar = barT
      next.lastTriggered = now
      next.triggerCount = rule.triggerCount + 1
    }
    return { fire, next }
  }
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

/**
 * Decimals an alert level keeps: at least what the price axis shows (pfmt's
 * steps) and at least six significant digits, so tiny-priced coins (1e-8)
 * keep their precision while the pixel noise of a click is dropped.
 */
export function alertDecimals(p: number): number {
  if (!Number.isFinite(p) || !(p > 0)) return 2
  const axis = p >= 100 ? 2 : p >= 1 ? 4 : p >= 0.01 ? 5 : p >= 0.0001 ? 6 : 8
  return Math.min(20, Math.max(axis, 5 - Math.floor(Math.log10(p))))
}

/**
 * A price picked on the chart's price axis ("Add alert at …"): a crosses rule
 * in the direction the market has to travel to reach it — above the last
 * price it must cross up, at or below it cross down. The level is rounded to
 * alertDecimals. Null when either price is unusable.
 */
export function ruleForPriceClick(
  price: number,
  last: number,
): { condition: 'crosses_above' | 'crosses_below'; value: number } | null {
  if (!Number.isFinite(price) || !(price > 0) || !Number.isFinite(last) || !(last > 0)) return null
  const value = Number(price.toFixed(alertDecimals(price)))
  return { condition: value > last ? 'crosses_above' : 'crosses_below', value }
}

/**
 * How to show a system notification. Android Chrome throws on
 * `new Notification()` — only a service-worker registration may show one — so
 * the worker is preferred whenever there is one; the constructor is the
 * fallback; without permission there is only the in-app toast.
 */
export function notifyVia(o: { granted: boolean; worker: boolean; ctor: boolean }): 'worker' | 'ctor' | 'none' {
  if (!o.granted) return 'none'
  if (o.worker) return 'worker'
  return o.ctor ? 'ctor' : 'none'
}
