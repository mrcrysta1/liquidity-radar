// Alert engine runtime: storage, evaluation loop, notifications and the
// alerts modal's rule list + trigger log. The pure rule logic (conditions,
// migration, edge/cooldown) lives in ./rules.ts; on-chart lines in
// ./alertLines.ts.
//
// Evaluation piggybacks on data the app already has. checkAlerts() runs from
// the ticker poll (every 20s) against state.tickers; anything missing is
// fetched in the background at a gentle pace and the rules re-checked when it
// lands:
//   - 24h tickers for alert/favourite symbols outside the tracked universe
//     (one request per symbol, at most a few per pass, each refreshed ≤ 1/min);
//   - candles for technical rules — the charted symbol/interval reuses
//     state.candles, everything else loads a 200-bar window, refreshed at most
//     every minute (longer for slow intervals), capped per pass.
// Nothing is fetched while Binance has us in a rate-limit cooldown.
import { esc, fmt, pfmt } from '../../utils/format'
import { $, showToast } from '../../utils/dom'
import { storageGet, storageSet } from '../../services/storage'
import { state } from '../../services/store'
import { loadCandleWindow } from '../../services/marketData'
import { BASE_MS, tfDef } from '../../services/timeframe'
import { mdTf } from '../../services/market'
import type { CandleFlat } from '../../services/market'
import { jget } from '../../api/client'
import { isRateLimited } from '../../api/rateLimit'
import { COINS } from '../../constants/market'
import { isInstrument } from '../../constants/instruments'
import { isSynthetic } from '../../services/syntheticSymbol'
import { symOf, watchList } from '../favorites/favorites'
import {
  ALERT_LIMITS,
  DEFAULT_COOLDOWN_MIN,
  alertDecimals,
  MIN_TECH_CANDLES,
  chartedCandlesFit,
  condLabel,
  evalPrice,
  evalTechnical,
  evalWatchTech,
  evalWatchlist,
  freqOf,
  normalizeRules,
  notifyVia,
  rearm,
  ruleForPriceClick,
  ruleName,
  stepRule,
} from './rules'
import type { AlertCond, AlertEvent, AlertFreq, AlertKind, AlertRule, TechCond } from './rules'
import {
  MAX_CONDS,
  MAX_MESSAGE,
  condLookback,
  condText,
  condUids,
  evalConds,
  fillTemplate,
  isExpired,
  judgedBar,
  normalizeConds,
  validWebhookUrl,
} from './conditions'
import type { Cond } from './conditions'
import { condContext, forgetCondRule, onCondData, snapshotFor } from './condRuntime'

/** @deprecated old price-alert shape; kept for importers. Rules are AlertRule now. */
export type AlertItem = AlertRule

// Same key as before (it is in the account-sync list), now holding rules.
// Old saved alerts are migrated on read by normalizeRules().
const AL_KEY = 'lr_alerts_v1'
// The trigger log is per-device history, not a setting.
const LOG_KEY = 'lr_alert_log_v1'
const LOG_MAX = 100

let notifOk = false
const listeners = new Set<() => void>()

export function loadRules(): AlertRule[] {
  return normalizeRules(storageGet<unknown>(AL_KEY, []))
}
function saveRules(a: AlertRule[]): void {
  storageSet(AL_KEY, a)
  listeners.forEach((f) => f())
}
export function loadLog(): AlertEvent[] {
  const v = storageGet<unknown>(LOG_KEY, [])
  return Array.isArray(v) ? (v as AlertEvent[]).filter((e) => e && typeof e.ts === 'number') : []
}
/** Told whenever the saved rules change (the chart's alert lines listen). */
export function onAlertsChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

// ---------------------------------------------------------------- live data

const prevPrice: Record<string, number> = {}
/** Trade extremes per symbol since the last evaluation (the charted coin's tape). */
const tradeRange: Record<string, { hi: number; lo: number }> = {}
/** Every trade print of the charted coin: remembered for intrabar crosses. */
export function noteAlertTrade(sym: string, price: number): void {
  if (!Number.isFinite(price)) return
  const r = tradeRange[sym]
  if (!r) tradeRange[sym] = { hi: price, lo: price }
  else {
    if (price > r.hi) r.hi = price
    if (price < r.lo) r.lo = price
  }
}
/** A watchlist / alert quote; high, low and quote volume when the source had them. */
export interface TickQuote {
  last: number
  pct: number
  high?: number
  low?: number
  qvol?: number
}
const extraTickers: Record<string, TickQuote & { ts: number }> = {}
const badSymbols = new Set<string>()
const candleCache: Record<string, { ts: number; candles: CandleFlat[] }> = {}
let refreshing = false

function tickerOf(sym: string): TickQuote | null {
  const t = state.tickers && state.tickers[sym]
  if (t && Number.isFinite(+t.last))
    return { last: +t.last, pct: +t.pct, high: t.high, low: t.low, qvol: +t.qvol }
  const x = extraTickers[sym]
  return x && Number.isFinite(x.last) ? x : null
}
const watchSymbols = (): string[] => watchList().map(symOf)
const techKey = (r: AlertRule) => r.sym + '|' + (r.tf || '15m')
function isChartedKey(sym: string, tf: string): boolean {
  return chartedCandlesFit(
    {
      symbol: state.symbol,
      tf: state.tf,
      tfKey: mdTf(state.tf),
      candlesKey: state.candlesKey,
      bars: state.candles.length,
    },
    sym,
    tf,
  )
}
function candlesOf(sym: string, tf: string): CandleFlat[] | null {
  if (isChartedKey(sym, tf)) return state.candles
  return candleCache[sym + '|' + tf]?.candles ?? null
}
function candlesFor(r: AlertRule): CandleFlat[] | null {
  return r.sym ? candlesOf(r.sym, r.tf || '15m') : null
}
function tfMs(tf: string): number {
  const d = tfDef(tf)
  return (BASE_MS[d.base] || 86400000) * d.factor
}
function candleTtl(tf: string): number {
  return Math.min(10 * 60000, Math.max(60000, tfMs(tf) / 3))
}
/** Favourites a watchlist technical rule judges — capped, since each needs its own candles. */
const WATCH_TECH_MAX = 40
/** Every sym|tf whose candles a rule needs. */
function candleKeys(r: AlertRule): string[] {
  if (r.kind === 'technical' || r.kind === 'cond') return [techKey(r)]
  if (r.kind === 'watchlist' && r.tech)
    return watchSymbols()
      .slice(0, WATCH_TECH_MAX)
      .filter((s) => !isInstrument(s))
      .map((s) => s + '|' + (r.tf || '15m'))
  return []
}

/** 24h tickers for symbols state.tickers lacks: a few per pass, each at most once a minute. */
async function topUpTickers(syms: Iterable<string>, now: number): Promise<boolean> {
  let got = false
  const tk = [...syms]
    .filter((s) => !(state.tickers && state.tickers[s]) && !badSymbols.has(s) && !isInstrument(s) && !isSynthetic(s))
    .filter((s) => !extraTickers[s] || now - extraTickers[s].ts > 60000)
    .slice(0, 6)
  for (const s of tk) {
    if (isRateLimited()) break
    try {
      const d = (await jget(
        'https://api.binance.com/api/v3/ticker/24hr?symbol=' + encodeURIComponent(s),
      )) as Record<string, unknown>
      extraTickers[s] = {
        last: Number(d.lastPrice),
        pct: Number(d.priceChangePercent),
        high: Number(d.highPrice),
        low: Number(d.lowPrice),
        qvol: Number(d.quoteVolume),
        ts: Date.now(),
      }
      got = true
    } catch (e) {
      // A 400 means Binance has no such pair — stop asking.
      if (/HTTP 400/.test(String(e))) badSymbols.add(s)
    }
  }
  return got
}

/** A symbol's last price and 24h %: the tracked universe first, else a fetched extra ticker. */
export const liveTicker = tickerOf

/**
 * Fetch prices for symbols outside the tracked universe (the chart's
 * Watchlist panel), through the same paced top-up the alert rules use.
 */
export function ensureTickers(syms: string[]): void {
  if (refreshing || isRateLimited()) return
  refreshing = true
  void topUpTickers(syms, Date.now()).finally(() => {
    refreshing = false
  })
}

/** Background top-up of whatever the rules need that state.tickers lacks. */
async function refreshData(rules: AlertRule[]): Promise<void> {
  if (refreshing || isRateLimited()) return
  refreshing = true
  let got = false
  try {
    const now = Date.now()
    const needT = new Set<string>()
    rules.forEach((r) => {
      if (r.kind === 'watchlist' && !r.tech) watchSymbols().forEach((s) => needT.add(s))
      else if (r.kind === 'price' && r.sym) needT.add(r.sym)
    })
    if (await topUpTickers(needT, now)) got = true
    const keys = [...new Set(rules.flatMap(candleKeys))]
    const stale = keys
      .filter((k) => {
        const [s, tf] = k.split('|')
        if (isChartedKey(s, tf)) return false
        const c = candleCache[k]
        return !c || now - c.ts > candleTtl(tf)
      })
      // Oldest first, so a long watchlist is cycled through rather than its
      // first few symbols refreshed forever.
      .sort((a, b) => (candleCache[a]?.ts ?? 0) - (candleCache[b]?.ts ?? 0))
      .slice(0, 4)
    for (const k of stale) {
      if (isRateLimited()) break
      const [s, tf] = k.split('|')
      try {
        // 300 bars: enough warm-up for the usual indicator lengths on a
        // conditions rule (the charted market uses the chart's own history).
        const candles = await loadCandleWindow(s, tf, 300)
        if (candles.length) {
          candleCache[k] = { ts: Date.now(), candles }
          got = true
        }
      } catch {
        // Keep the previous window (if any); retried after the TTL.
        candleCache[k] = { ts: Date.now(), candles: candleCache[k]?.candles ?? [] }
      }
    }
  } finally {
    refreshing = false
  }
  if (got) evaluate(false)
}

// ---------------------------------------------------------------- evaluation

function notifyCtor(title: string, opts: NotificationOptions): void {
  try {
    new Notification(title, opts)
  } catch {
    /* Android Chrome: the constructor is not allowed — the toast still shows */
  }
}

function notify(title: string, body: string): void {
  try {
    const opts: NotificationOptions = { body: body, tag: 'lr-alert', icon: '/icon-192.png' }
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null
    // ready only settles once a worker controls the page (never in dev), so
    // the worker route is taken only when one does.
    const how = notifyVia({
      granted: notifOk && !!window.Notification && Notification.permission === 'granted',
      worker: !!(sw && sw.controller),
      ctor: typeof window.Notification === 'function',
    })
    if (how === 'worker' && sw) {
      sw.ready.then((reg) => reg.showNotification(title, opts)).catch(() => notifyCtor(title, opts))
    } else if (how === 'ctor') notifyCtor(title, opts)
    showToast(title + ' — ' + body)
  } catch (e) {
    /* ignore */
  }
}

/**
 * POST a fired alert's message to its webhook through our relay
 * (api/alert-webhook.mjs): the browser cannot call arbitrary hosts (CORS), and
 * the relay is where the URL is checked against private networks. Alerts are
 * evaluated here in the browser, so a webhook only fires while the app is
 * open somewhere — there is no server-side alert engine.
 */
function sendWebhook(url: string, message: string): void {
  try {
    void fetch('/api/alert-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, message }),
      keepalive: true,
    })
      .then((r) => {
        if (!r.ok) console.warn('[alerts] webhook relay answered', r.status)
      })
      .catch((e) => console.warn('[alerts] webhook failed', e))
  } catch {
    /* no fetch — nothing to send with */
  }
}

function evaluate(fetchMore: boolean): void {
  const rules = loadRules()
  const active = rules.filter((r) => r.enabled)
  if (!active.length) return
  const now = Date.now()
  const fired: AlertEvent[] = []
  let changed = false
  const hooks: Array<{ url: string; message: string }> = []
  const next = rules.map((r) => {
    if (!r.enabled) return r
    if (isExpired(r.expires, now)) {
      changed = true
      return { ...r, enabled: false }
    }
    let hit: boolean | null = null
    let matched: string[] | undefined
    let detail = ''
    /** Open time of the bar judged — for the once-per-bar frequencies. */
    let barT: number | undefined
    /** Price the {{close}} placeholder reports. */
    let close: number | undefined
    if (r.kind === 'price' && r.sym) {
      const t = tickerOf(r.sym)
      if (t) {
        hit = evalPrice(r, t.last, prevPrice[r.sym], t.pct, tradeRange[r.sym])
        close = t.last
        detail = /pct/.test(r.condition)
          ? r.sym + ' 24h ' + t.pct.toFixed(2) + '% · $' + pfmt(t.last)
          : r.sym + ' now $' + pfmt(t.last)
      }
    } else if (r.kind === 'technical' && r.sym) {
      const c = candlesFor(r)
      if (c && c.length >= MIN_TECH_CANDLES) {
        hit = evalTechnical(r, c)
        barT = c[judgedBar(c.length, r.onClose)]?.t
        close = c[c.length - 1].c
        detail = r.sym + ' ' + (r.tf || '15m') + ' close $' + pfmt(close)
      }
    } else if (r.kind === 'cond' && r.sym) {
      const c = candlesFor(r)
      const conds = r.conds || []
      if (c && c.length > condLookback(conds) + 1) {
        const ctx = condContext(r, c)
        if (ctx) {
          const i = judgedBar(c.length, freqOf(r) === 'close')
          hit = evalConds(conds, ctx, i)
          barT = c[i]?.t
          close = c[c.length - 1].c
          detail = r.sym + ' ' + (r.tf || '15m') + ' close $' + pfmt(close)
        }
      }
    } else if (r.kind === 'watchlist' && r.tech) {
      const tf = r.tf || '15m'
      const bySym = watchSymbols()
        .slice(0, WATCH_TECH_MAX)
        .map((s) => ({ symbol: s, candles: candlesOf(s, tf) }))
        .filter((x): x is { symbol: string; candles: CandleFlat[] } => !!x.candles && x.candles.length >= MIN_TECH_CANDLES)
      if (bySym.length) {
        const res = evalWatchTech(r, bySym)
        hit = res.hit
        matched = res.matched
        detail = res.detail
        // Favourites' bars share the interval grid: bucket the clock.
        const ms = tfMs(tf)
        barT = Math.floor(now / ms) * ms - (r.onClose ? ms : 0)
      }
    } else if (r.kind === 'watchlist') {
      const tk = watchSymbols()
        .map((s) => {
          const t = tickerOf(s)
          return t ? { symbol: s, pct: t.pct } : null
        })
        .filter((x): x is { symbol: string; pct: number } => !!x)
      if (tk.length) {
        const res = evalWatchlist(r, tk)
        hit = res.hit
        matched = res.matched
        detail = res.detail
      }
    }
    if (hit == null) return r // no data yet — judge next time
    const st = stepRule(r, hit, now, matched, barT)
    if (JSON.stringify(st.next) !== JSON.stringify(r)) changed = true
    if (st.fire) {
      const ticker = r.sym || (matched && matched.length ? matched.join(',') : 'WATCHLIST')
      const message = r.message
        ? fillTemplate(r.message, {
            ticker,
            close: close != null ? pfmt(close) : undefined,
            interval: r.tf || '',
            time: new Date(now).toISOString(),
          })
        : (r.kind === 'cond'
            ? (r.conds || []).map(condText).join(' AND ')
            : condLabel(r.tech || r.condition) + ' ' + r.value + (r.value2 != null ? '/' + r.value2 : '')) +
          ' — ' +
          detail
      fired.push({ id: 'ev-' + now + '-' + r.id, ruleId: r.id, name: ruleName(r), ts: now, message, sym: r.sym })
      if (r.webhook) hooks.push({ url: r.webhook, message })
    }
    return st.next
  })
  // Crosses compare against the previous sample, so remember this one.
  const seen = new Set<string>()
  rules.forEach((r) => {
    if (r.sym) seen.add(r.sym)
  })
  seen.forEach((s) => {
    const t = tickerOf(s)
    if (t) prevPrice[s] = t.last
    delete tradeRange[s]
  })
  if (changed) saveRules(next)
  if (fired.length) {
    storageSet(LOG_KEY, [...fired, ...loadLog()].slice(0, LOG_MAX))
    fired.forEach((e) => notify(e.name, e.message))
  }
  hooks.forEach((h) => sendWebhook(h.url, h.message))
  if (changed || fired.length) renderAlerts()
  if (fetchMore) void refreshData(next.filter((r) => r.enabled))
}

// A Pine run for a conditions rule landed: judge with it now, not in 20s.
onCondData(() => evaluate(false))

/** Called from the ticker loop: judge every enabled rule on current data. */
export function checkAlerts(): void {
  evaluate(true)
}

// ---------------------------------------------------------------- editing

export interface NewRule {
  kind: AlertKind
  sym?: string
  tf?: string
  condition: AlertCond
  value: number
  value2?: number
  once: boolean
  cooldownMin?: number
  onClose?: boolean
  /** Overrides once/onClose when set (see AlertFreq). */
  freq?: AlertFreq
  expires?: number
  message?: string
  webhook?: string
  /** Watchlist any_technical. */
  tech?: TechCond
  /** cond kind; the indicator instances they read are snapshotted from the chart. */
  conds?: Cond[]
}

export function normSym(sym: string): string {
  let s = (sym || '').trim().toUpperCase()
  // A bare "BTC" is the natural typo — treat it as shorthand for the pair.
  if (s && !isInstrument(s) && !/USDT$/.test(s)) s += 'USDT'
  return s
}

/** Is this pair priced by the app's own feeds (tracked coins or the chart)? */
function isTrackable(sym: string): boolean {
  if (sym === state.symbol) return true
  return Object.values(COINS).some((c) => c.sym === sym)
}

/** Add a rule; returns an error message, or null when it was saved. */
export function addRule(n: NewRule): string | null {
  const rules = loadRules()
  const count = rules.filter((r) => r.kind === n.kind).length
  if (count >= ALERT_LIMITS[n.kind]) return 'Limit of ' + ALERT_LIMITS[n.kind] + ' ' + n.kind + ' alerts reached'
  if (!Number.isFinite(n.value)) return 'Enter a numeric value'
  const sym = n.kind === 'watchlist' ? undefined : normSym(n.sym || '')
  if (n.kind !== 'watchlist' && !sym) return 'Enter a symbol'
  if (n.kind === 'price' && !/pct/.test(n.condition) && !(n.value > 0)) return 'Enter the alert price'
  const conds = n.kind === 'cond' ? normalizeConds(n.conds) : null
  if (n.kind === 'cond' && !conds) return 'Complete every condition (1–' + MAX_CONDS + ')'
  if (n.condition === 'any_technical' && !n.tech) return 'Pick a technical condition'
  const webhook = n.webhook && n.webhook.trim() ? validWebhookUrl(n.webhook) : undefined
  if (webhook === null) return 'Webhook must be a public https:// URL'
  if (n.expires != null && !(n.expires > Date.now())) return 'Expiry must be in the future'
  const freq: AlertFreq = n.freq ?? (n.once ? 'once' : 'every')
  const once = freq === 'once'
  // Bar-based kinds judge the closed bar under "once per bar close".
  const barBased = n.kind === 'technical' || n.kind === 'cond' || !!n.tech
  const r: AlertRule = {
    id: 'al-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    kind: n.kind,
    sym,
    tf: barBased ? n.tf || '15m' : undefined,
    condition: n.condition,
    value: n.value,
    value2: n.value2 != null && Number.isFinite(n.value2) ? n.value2 : undefined,
    once,
    cooldownMin: freq === 'every' ? (n.cooldownMin ?? DEFAULT_COOLDOWN_MIN) : undefined,
    onClose: barBased ? freq === 'close' || !!n.onClose : undefined,
    freq: n.freq,
    expires: n.expires,
    message: n.message && n.message.trim() ? n.message.slice(0, MAX_MESSAGE) : undefined,
    webhook: webhook || undefined,
    tech: n.condition === 'any_technical' ? n.tech : undefined,
    conds: conds ?? undefined,
    inds: conds ? snapshotFor(condUids(conds)) : undefined,
    enabled: true,
    created: Date.now(),
    triggerCount: 0,
  }
  if (r.conds && condUids(r.conds).some((u) => !r.inds?.some((i) => i.uid === u)))
    return 'An indicator in the conditions is no longer on the chart'
  // A cross is judged against the previous sample: seed it with the current
  // price, or a rule could fire at once on a crossing from before it existed.
  if (sym) {
    const t = tickerOf(sym)
    if (t) prevPrice[sym] = t.last
    delete tradeRange[sym]
  }
  saveRules([...rules, r])
  renderAlerts()
  // Judge it straight away (and start fetching its data) rather than in 20s.
  evaluate(true)
  return null
}

/** Legacy entry point (window.addAlert): a price alert above/below a level. */
export function addAlert(sym: string, dir: string, price: string): void {
  const err = addRule({
    kind: 'price',
    sym,
    condition: dir === 'below' ? 'below' : 'above',
    value: parseFloat(price),
    once: true,
  })
  showToast(err || 'Alert set for ' + normSym(sym) + ' ' + (dir || 'above') + ' $' + pfmt(parseFloat(price)))
}

/** The latest price known for `sym`: its ticker, else the charted candles. */
function lastPriceOf(sym: string): number {
  const t = tickerOf(sym)
  if (t) return t.last
  const c = sym === state.symbol ? state.candles : null
  return c && c.length ? +c[c.length - 1].c : NaN
}

/** An alert level as text, with every decimal the level keeps (tiny coins included). */
export function alertPriceText(p: number): string {
  return fmt(p, alertDecimals(p))
}

/**
 * "Add alert at {price}" from the chart's price axis: a repeating crosses
 * rule (default cooldown) toward `price` from the last price. Returns whether
 * it was saved; either way a toast says what happened.
 */
export function addPriceRule(sym: string, price: number): boolean {
  const s = normSym(sym)
  const pick = ruleForPriceClick(price, lastPriceOf(s))
  if (!pick) {
    showToast('No price for ' + (s || 'this chart') + ' yet — try again in a moment')
    return false
  }
  const err = addRule({ kind: 'price', sym: s, condition: pick.condition, value: pick.value, once: false })
  showToast(
    err ||
      'Alert set: ' + s + ' ' + (pick.condition === 'crosses_above' ? 'crosses above' : 'crosses below') + ' $' + alertPriceText(pick.value),
  )
  return !err
}

/** Remove a rule by id (or, for old callers, by list index). */
export function removeAlert(idOrIndex: string | number): void {
  const rules = loadRules()
  const next =
    typeof idOrIndex === 'number'
      ? rules.filter((_, i) => i !== idOrIndex)
      : rules.filter((r) => r.id !== idOrIndex)
  rules.filter((r) => !next.includes(r) && r.kind === 'cond').forEach(forgetCondRule)
  saveRules(next)
  renderAlerts()
  showToast('Alert removed')
}

/** Pause/resume a rule. Resuming re-arms it (a spent "once" alert can fire again). */
export function toggleAlert(id: string): void {
  saveRules(loadRules().map((r) => (r.id !== id ? r : r.enabled ? { ...r, enabled: false } : rearm(r))))
  renderAlerts()
}

export function clearAlertLog(): void {
  storageSet(LOG_KEY, [])
  renderAlerts()
}

// ---------------------------------------------------------------- UI

const FREQ_TEXT: Record<AlertFreq, string> = {
  once: 'once',
  bar: 'once per bar',
  close: 'once per bar close',
  every: 'every time',
}

function statusOf(r: AlertRule): string {
  if (!r.enabled) {
    if (isExpired(r.expires, Date.now())) return '<span style="color:var(--muted)"> · expired</span>'
    return r.once && r.triggerCount
      ? '<span style="color:var(--muted)"> · fired</span>'
      : '<span style="color:var(--muted)"> · paused</span>'
  }
  if (r.kind === 'price' && r.sym && !isTrackable(r.sym) && !tickerOf(r.sym)) {
    return '<span style="color:var(--amber,#ffc107)" title="Not tracked yet — fetching its price in the background"> · waiting for price</span>'
  }
  return ''
}

function ruleRow(r: AlertRule): string {
  const t = r.sym ? tickerOf(r.sym) : null
  const isPct = /pct/.test(r.condition)
  const tgt = (r.kind === 'price' && !isPct ? '$' + pfmt(r.value) : String(r.value) + (isPct ? '%' : '')) +
    (r.value2 != null ? ' / ' + r.value2 : '')
  const head =
    r.kind === 'watchlist'
      ? '<b>Watchlist</b> <span class="al-cur">(' + watchList().length + ' coins' +
        (r.tech ? ', ' + esc(r.tf || '15m') : '') + ')</span>'
      : '<b>' + esc(r.sym || '') + '</b>' +
        (r.tf ? ' <span class="al-cur">' + esc(r.tf) + '</span>' : '')
  const freq = freqOf(r)
  const meta =
    ' <span class="al-cur">· ' +
    (freq === 'every' ? 'every time, ' + (r.cooldownMin ?? DEFAULT_COOLDOWN_MIN) + 'm cooldown' : FREQ_TEXT[freq]) +
    (r.expires ? ' · until ' + new Date(r.expires).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '') +
    (r.webhook ? ' · webhook' : '') +
    (r.triggerCount ? ' · fired ' + r.triggerCount + '×' : '') +
    '</span>'
  const what =
    r.kind === 'cond'
      ? '<span class="al-tgt">' + esc((r.conds || []).map(condText).join(' AND ')) + '</span>'
      : esc(condLabel(r.tech || r.condition).toUpperCase()) + ' <span class="al-tgt">' + tgt + '</span>'
  return (
    '<div class="al-item" data-al-id="' + esc(r.id) + '"' + (r.enabled ? '' : ' style="opacity:.55"') + '>' +
    '<div style="flex:1;min-width:0">' + head + ' ' + what +
    (t && r.kind === 'price' ? ' <span class="al-cur">· now $' + pfmt(t.last) + '</span>' : '') +
    meta + statusOf(r) + '</div>' +
    '<button type="button" class="al-act" data-al-act="toggle" title="' + (r.enabled ? 'Pause' : 'Resume / re-arm') + '">' +
    (r.enabled ? 'Pause' : 'Resume') + '</button>' +
    '<button type="button" class="al-act al-del" data-al-act="remove" title="Delete" aria-label="Delete alert">X</button>' +
    '</div>'
  )
}

export function renderAlerts(): void {
  const list = $('alList')
  if (list) {
    const a = loadRules()
    list.innerHTML = a.length ? a.map(ruleRow).join('') : '<div class="fc-note">No alerts set.</div>'
  }
  const logEl = $('alLog')
  if (logEl) {
    const log = loadLog()
    logEl.innerHTML = log.length
      ? log
          .slice(0, 50)
          .map(
            (e) =>
              '<div class="al-item"><span style="color:var(--green)">●</span><div style="flex:1;min-width:0"><b>' +
              esc(e.name) + '</b> <span class="al-cur">' + esc(e.message) + '</span></div><span class="al-cur">' +
              new Date(e.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
              '</span></div>',
          )
          .join('')
      : '<div class="fc-note">Nothing triggered yet.</div>'
  }
  const ok = 'Notification' in window && Notification.permission === 'granted'
  notifOk = ok
  const st = $('alPermState')
  if (st) {
    st.textContent = notifOk ? 'on' : 'off'
    st.style.color = notifOk ? 'var(--green)' : 'var(--dim)'
  }
}

export function enableAlerts(): void {
  if (!('Notification' in window)) { showToast('Desktop notifications not supported in this browser'); return }
  Notification.requestPermission().then(function (p) {
    if (p === 'granted') { notifOk = true; renderAlerts(); showToast('Desktop notifications enabled') }
    else { showToast('Notifications blocked by browser') }
  })
}
