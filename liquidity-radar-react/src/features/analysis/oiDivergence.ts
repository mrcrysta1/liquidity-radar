// Turns the price/OI regime math that already exists (classifyPriceOI, used
// passively in the Futures side-tab) into a proactive alert: watches for the
// two "divergence" quadrants — price up while OI falls (short covering, a
// rally that tends to fade) and price down while OI falls (long capitulation,
// a drop that tends to exhaust) — plus funding-rate extremes that flag squeeze
// risk regardless of regime. Polls the same state the Futures tab already
// reads (state.oiHist, state.fr, state.candles); no new network calls.
import { state } from '../../services/store'
import { classifyPriceOI } from '../charts/sidePanels/metrics'
import type { Regime } from '../charts/sidePanels/metrics'
import { poll } from '../../services/pollScheduler'

export type DivergenceKind = 'shorts_closing' | 'longs_closing' | 'funding_extreme' | null

export interface DivergenceAlert {
  kind: DivergenceKind
  symbol: string
  title: string
  detail: string
  severity: 'info' | 'warn'
  t: number
}

/** ±0.05%/8h ≈ ±54%/yr annualised — well outside the normal ±0.01% range. */
const FUNDING_EXTREME = 0.0005
/** However often the regime actually flips, don't surface a fresh banner
 * more than this often — a choppy market bouncing between quadrants would
 * otherwise repaint the alert every 20s poll. */
const MIN_GAP_MS = 5 * 60 * 1000

let current: DivergenceAlert | null = null
let lastKind: DivergenceKind = null
let lastSymbol = ''
let lastShownAt = 0

type Listener = () => void
const listeners: Listener[] = []
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}
export function onDivergenceChange(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

export function getDivergenceAlert(): DivergenceAlert | null {
  return current
}

export function dismissDivergenceAlert(): void {
  current = null
  emit()
}

function regimeFromState(): Regime | null {
  const oiH = state.oiHist
  const candles = state.candles
  if (!oiH || oiH.length < 5 || !candles || candles.length < 5) return null
  const a = oiH[oiH.length - 5].openInterest
  const b = oiH[oiH.length - 1].openInterest
  if (!a) return null
  const oiChg = ((b - a) / a) * 100
  const from = oiH[oiH.length - 5].ts
  const k0 = candles.find((c) => c.t >= from) ?? candles[Math.max(0, candles.length - 17)]
  const priceChg = k0.c ? ((candles[candles.length - 1].c - k0.c) / k0.c) * 100 : 0
  return classifyPriceOI(priceChg, oiChg)
}

/** Re-evaluate and, if a new alert-worthy condition appeared, publish it. A
 * symbol switch or leaving the alert condition clears the "already shown"
 * memory so the same regime can alert again later rather than being
 * permanently silenced for the session. */
export function checkDivergence(): void {
  const sym = state.symbol
  if (sym !== lastSymbol) {
    lastSymbol = sym
    lastKind = null
    current = null
  }

  const fr = state.fr as { lastFundingRate?: string } | null
  const rate = fr?.lastFundingRate != null ? Number(fr.lastFundingRate) : null
  const regime = regimeFromState()

  let kind: DivergenceKind = null
  let alert: DivergenceAlert | null = null

  if (rate != null && Math.abs(rate) >= FUNDING_EXTREME) {
    kind = 'funding_extreme'
    const annual = rate * 3 * 365 * 100
    alert = {
      kind,
      symbol: sym,
      title: rate > 0 ? 'Funding extreme — longs paying' : 'Funding extreme — shorts paying',
      detail:
        (rate * 100).toFixed(4) +
        '%/8h (~' +
        annual.toFixed(0) +
        '%/yr) — crowded ' +
        (rate > 0 ? 'long' : 'short') +
        ' side, squeeze risk against it.',
      severity: 'warn',
      t: Date.now(),
    }
  } else if (regime && regime.regime === 'SHORTS_CLOSING') {
    kind = 'shorts_closing'
    alert = {
      kind,
      symbol: sym,
      title: 'Rally on falling OI',
      detail: 'Price up while open interest falls — short covering, not fresh demand. ' + regime.meaning,
      severity: 'info',
      t: Date.now(),
    }
  } else if (regime && regime.regime === 'LONGS_CLOSING') {
    kind = 'longs_closing'
    alert = {
      kind,
      symbol: sym,
      title: 'Drop on falling OI',
      detail: 'Price down while open interest falls — long capitulation, not fresh selling. ' + regime.meaning,
      severity: 'info',
      t: Date.now(),
    }
  }

  if (kind !== lastKind) {
    lastKind = kind
    // A real condition change always updates the memory (so it doesn't
    // reappear the moment the cooldown ends for a state that already
    // passed), but the banner itself only repaints if the cooldown cleared.
    const now = Date.now()
    if (alert && now - lastShownAt < MIN_GAP_MS) return
    current = alert
    if (alert) lastShownAt = now
    emit()
  }
}

let started = false
export function startDivergenceWatch(): void {
  if (started) return
  started = true
  checkDivergence()
  // Pure state read, no network of its own — but state.oiHist only updates
  // while its own poll is running, so keeping this in lockstep with the
  // visibility-aware scheduler avoids spinning on stale data while hidden.
  poll(checkDivergence, 20_000)
}
