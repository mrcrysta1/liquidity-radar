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
import { esc, pfmt } from '../../utils/format'
import { $, showToast } from '../../utils/dom'
import { storageGet, storageSet } from '../../services/storage'
import { state } from '../../services/store'
import { loadCandleWindow } from '../../services/marketData'
import { BASE_MS, tfDef } from '../../services/timeframe'
import type { CandleFlat } from '../../services/market'
import { jget } from '../../api/client'
import { isRateLimited } from '../../api/rateLimit'
import { COINS } from '../../constants/market'
import { isInstrument } from '../../constants/instruments'
import { symOf, watchList } from '../favorites/favorites'
import {
  ALERT_LIMITS,
  DEFAULT_COOLDOWN_MIN,
  MIN_TECH_CANDLES,
  condLabel,
  evalPrice,
  evalTechnical,
  evalWatchlist,
  normalizeRules,
  rearm,
  ruleName,
  stepRule,
} from './rules'
import type { AlertCond, AlertEvent, AlertKind, AlertRule } from './rules'

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
const extraTickers: Record<string, { last: number; pct: number; ts: number }> = {}
const badSymbols = new Set<string>()
const candleCache: Record<string, { ts: number; candles: CandleFlat[] }> = {}
let refreshing = false

function tickerOf(sym: string): { last: number; pct: number } | null {
  const t = state.tickers && state.tickers[sym]
  if (t && Number.isFinite(+t.last)) return { last: +t.last, pct: +t.pct }
  const x = extraTickers[sym]
  return x && Number.isFinite(x.last) ? { last: x.last, pct: x.pct } : null
}
const watchSymbols = (): string[] => watchList().map(symOf)
const techKey = (r: AlertRule) => r.sym + '|' + (r.tf || '15m')
function isChartedKey(sym: string, tf: string): boolean {
  return sym === state.symbol && tf === state.tf && state.candles.length >= MIN_TECH_CANDLES
}
function candlesFor(r: AlertRule): CandleFlat[] | null {
  if (r.sym && isChartedKey(r.sym, r.tf || '15m')) return state.candles
  return candleCache[techKey(r)]?.candles ?? null
}
function candleTtl(tf: string): number {
  const d = tfDef(tf)
  const ms = (BASE_MS[d.base] || 86400000) * d.factor
  return Math.min(10 * 60000, Math.max(60000, ms / 3))
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
      if (r.kind === 'watchlist') watchSymbols().forEach((s) => needT.add(s))
      else if (r.kind === 'price' && r.sym) needT.add(r.sym)
    })
    const tk = [...needT]
      .filter((s) => !(state.tickers && state.tickers[s]) && !badSymbols.has(s) && !isInstrument(s))
      .filter((s) => !extraTickers[s] || now - extraTickers[s].ts > 60000)
      .slice(0, 6)
    for (const s of tk) {
      if (isRateLimited()) break
      try {
        const d = (await jget(
          'https://api.binance.com/api/v3/ticker/24hr?symbol=' + encodeURIComponent(s),
        )) as Record<string, unknown>
        extraTickers[s] = { last: Number(d.lastPrice), pct: Number(d.priceChangePercent), ts: Date.now() }
        got = true
      } catch (e) {
        // A 400 means Binance has no such pair — stop asking.
        if (/HTTP 400/.test(String(e))) badSymbols.add(s)
      }
    }
    const keys = [...new Set(rules.filter((r) => r.kind === 'technical').map(techKey))]
    const stale = keys
      .filter((k) => {
        const [s, tf] = k.split('|')
        if (isChartedKey(s, tf)) return false
        const c = candleCache[k]
        return !c || now - c.ts > candleTtl(tf)
      })
      .slice(0, 4)
    for (const k of stale) {
      if (isRateLimited()) break
      const [s, tf] = k.split('|')
      try {
        const candles = await loadCandleWindow(s, tf, 200)
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

function notify(title: string, body: string): void {
  try {
    if (notifOk && window.Notification && Notification.permission === 'granted') {
      new Notification(title, { body: body, tag: 'lr-alert' })
    }
    showToast(title + ' — ' + body)
  } catch (e) {
    /* ignore */
  }
}

function evaluate(fetchMore: boolean): void {
  const rules = loadRules()
  const active = rules.filter((r) => r.enabled)
  if (!active.length) return
  const now = Date.now()
  const fired: AlertEvent[] = []
  let changed = false
  const next = rules.map((r) => {
    if (!r.enabled) return r
    let hit: boolean | null = null
    let matched: string[] | undefined
    let detail = ''
    if (r.kind === 'price' && r.sym) {
      const t = tickerOf(r.sym)
      if (t) {
        hit = evalPrice(r, t.last, prevPrice[r.sym], t.pct)
        detail = /pct/.test(r.condition)
          ? r.sym + ' 24h ' + t.pct.toFixed(2) + '% · $' + pfmt(t.last)
          : r.sym + ' now $' + pfmt(t.last)
      }
    } else if (r.kind === 'technical' && r.sym) {
      const c = candlesFor(r)
      if (c && c.length >= MIN_TECH_CANDLES) {
        hit = evalTechnical(r, c)
        detail = r.sym + ' ' + (r.tf || '15m') + ' close $' + pfmt(c[c.length - 1].c)
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
    const st = stepRule(r, hit, now, matched)
    if (JSON.stringify(st.next) !== JSON.stringify(r)) changed = true
    if (st.fire) {
      fired.push({
        id: 'ev-' + now + '-' + r.id,
        ruleId: r.id,
        name: ruleName(r),
        ts: now,
        message:
          condLabel(r.condition) + ' ' + r.value + (r.value2 != null ? '/' + r.value2 : '') + ' — ' + detail,
        sym: r.sym,
      })
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
  })
  if (changed) saveRules(next)
  if (fired.length) {
    storageSet(LOG_KEY, [...fired, ...loadLog()].slice(0, LOG_MAX))
    fired.forEach((e) => notify(e.name, e.message))
  }
  if (changed || fired.length) renderAlerts()
  if (fetchMore) void refreshData(next.filter((r) => r.enabled))
}

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
  const r: AlertRule = {
    id: 'al-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    kind: n.kind,
    sym,
    tf: n.kind === 'technical' ? n.tf || '15m' : undefined,
    condition: n.condition,
    value: n.value,
    value2: n.value2 != null && Number.isFinite(n.value2) ? n.value2 : undefined,
    once: n.once,
    cooldownMin: n.once ? undefined : (n.cooldownMin ?? DEFAULT_COOLDOWN_MIN),
    enabled: true,
    created: Date.now(),
    triggerCount: 0,
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

/** Remove a rule by id (or, for old callers, by list index). */
export function removeAlert(idOrIndex: string | number): void {
  const rules = loadRules()
  const next =
    typeof idOrIndex === 'number'
      ? rules.filter((_, i) => i !== idOrIndex)
      : rules.filter((r) => r.id !== idOrIndex)
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

function statusOf(r: AlertRule): string {
  if (!r.enabled) {
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
      ? '<b>Watchlist</b> <span class="al-cur">(' + watchList().length + ' coins)</span>'
      : '<b>' + esc(r.sym || '') + '</b>' +
        (r.kind === 'technical' ? ' <span class="al-cur">' + esc(r.tf || '15m') + '</span>' : '')
  const meta =
    ' <span class="al-cur">· ' +
    (r.once ? 'once' : 'repeat, ' + (r.cooldownMin ?? DEFAULT_COOLDOWN_MIN) + 'm cooldown') +
    (r.triggerCount ? ' · fired ' + r.triggerCount + '×' : '') +
    '</span>'
  return (
    '<div class="al-item" data-al-id="' + esc(r.id) + '"' + (r.enabled ? '' : ' style="opacity:.55"') + '>' +
    '<div style="flex:1;min-width:0">' + head + ' ' + esc(condLabel(r.condition).toUpperCase()) +
    ' <span class="al-tgt">' + tgt + '</span>' +
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
