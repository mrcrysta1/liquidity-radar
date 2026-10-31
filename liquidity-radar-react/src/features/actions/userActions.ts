// Global navigation actions. Faithful extraction of the engine's switchTab /
// setSymbol handlers; the heavy lifting (market fetches, stream reconnect,
// chart renders) is injected by the engine via wireUserActions(), so this
// module stays free of UI/stream concerns. The classic-script globals are
// re-exposed on window by the engine's exposeGlobals().
import { $ } from '../../utils/dom'
import { isInstrument } from '../../constants/instruments'
import { isSynthetic } from '../../services/syntheticSymbol'
import { primeInstrument } from '../../services/instrumentFeed'
import { state } from '../../services/store'
import { resetCandles } from '../../services/marketData'
import { placeChartForTab } from '../charts/chartHost'
import type { StreamsCallbacks } from '../../services/streams'
import { resetDelta } from '../delta/delta'
import { resetWhaleFlow } from '../whales/whaleFlow'
import { resetConfluence } from '../analysis/confluence'
import { checkDivergence } from '../analysis/oiDivergence'
import { resetML } from '../ml/store'
import { resetRL } from '../ml/rlStore'

type Any = any

export interface UserActionCallbacks {
  fetchKlines(sym: string): Promise<Any>
  fetchOB(): Promise<Any>
  fetchFR(): Promise<Any>
  fetchOI(): Promise<Any>
  fetchWhales(): Promise<Any>
  connectStreams(cb: StreamsCallbacks): void
  disconnectStreams(cb?: StreamsCallbacks): void
  streamCb: StreamsCallbacks
  renderHero(): void
  renderTicker(): void
}

let cbs: UserActionCallbacks | null = null

export function wireUserActions(callbacks: UserActionCallbacks): void {
  cbs = callbacks
}

/**
 * Which tab is active, for React components that need to reflect it — e.g.
 * the sidebar's own nav highlight. switchTab() below still drives the actual
 * `.tab-section`/`.tab-btn` visibility imperatively (that part predates this
 * pub/sub and works fine); this only adds a way for React state to follow
 * along, since a component with no subscription has no way to know the tab
 * changed and would otherwise only show whatever it rendered on mount.
 */
let activeTab = 'home'
type TabListener = (tab: string) => void
const tabListeners: TabListener[] = []
export function getActiveTab(): string {
  return activeTab
}
export function subscribeActiveTab(fn: TabListener): () => void {
  tabListeners.push(fn)
  return () => {
    const i = tabListeners.indexOf(fn)
    if (i !== -1) tabListeners.splice(i, 1)
  }
}

export function switchTab(tab: string): void {
  state.tab = tab
  activeTab = tab
  tabListeners.slice().forEach((fn) => fn(tab))
  document.querySelectorAll<HTMLElement>('.tab-btn').forEach((b) => {
    const on = b.dataset.tab === tab
    b.classList.toggle('active', on)
    b.setAttribute('aria-selected', on ? 'true' : 'false')
  })
  document
    .querySelectorAll<HTMLElement>('.tab-section')
    .forEach((s) => s.classList.toggle('active', s.id === 'tab-' + tab))
  // The price-action chart is shown on both Radar and Charts — move the one
  // card into whichever of them is now visible.
  placeChartForTab(tab)
  window.scrollTo({ top: 0 })
}

/**
 * Make `sym` the app's coin. By default this also brings up the Radar tab;
 * `keepTab` leaves the user where they are (e.g. picking a chart in a layout).
 */
const symbolListeners: Array<() => void> = []
/** Called whenever the charted coin changes. */
export function subscribeSymbol(fn: () => void): () => void {
  symbolListeners.push(fn)
  return () => {
    const i = symbolListeners.indexOf(fn)
    if (i !== -1) symbolListeners.splice(i, 1)
  }
}

export async function setSymbol(sym: string, opts: { keepTab?: boolean } = {}): Promise<void> {
  if (!sym) return
  if (state.symbol === sym) {
    if (!opts.keepTab) switchTab('radar')
    return
  }
  state.symbol = sym
  // Everything below is per-symbol. Clear it before anyone (listeners, the
  // analytics, the alert engine) looks, so the previous coin's candles,
  // funding, open interest and books are never read as this coin's while the
  // new ones load — or forever, when this coin has no futures market.
  resetCandles()
  state.fr = null
  state.oi = null
  state.ob = { bids: [], asks: [] }
  state.deepOb = null
  state.oiHist = null
  state.ls = null
  state.crossEx = []
  symbolListeners.slice().forEach((fn) => fn())
  Object.keys(state.ctxCache).forEach((k) => delete state.ctxCache[k])
  state._liq = null
  state._sr = null
  state._ai = null
  state.whales = []
  resetDelta(sym)
  resetWhaleFlow()
  resetConfluence(sym)
  checkDivergence()
  resetML()
  resetRL()
  $('heroPrice')!.textContent = '—'
  $('heroPrice')!.dataset.p = '0'
  // The funding/OI cards are written straight into the DOM by the analytics
  // pass, which only runs once this coin's candles land. Dash them now so the
  // previous coin's numbers never sit under the new coin's name meanwhile.
  for (const id of ['mFR', 'mFRNext', 'mOI', 'mOISub', 'hsMark', 'liqMark']) {
    const el = $(id)
    if (el) el.textContent = '—'
  }
  $('wsKlineState')!.textContent = 'SYNCING'
  $('wsKlineState')!.className = 'badge b-amber'
  const sel = $('symSelect')! as HTMLSelectElement
  if (!sel.querySelector('option[value="' + sym + '"]')) {
    const base = sym.replace(/USDT$/, '')
    const opt = document.createElement('option')
    opt.value = sym
    opt.textContent = base + '/USDT'
    sel.appendChild(opt)
  }
  sel.value = sym
  cbs!.renderTicker()
  if (!opts.keepTab) switchTab('radar')
  // Stop the previous coin's streams now: left running through the fetches
  // below, they kept writing its prices into this coin's state.
  cbs!.disconnectStreams(cbs!.streamCb)
  // allSettled: one failed fetch (funding, OI...) must not stop the streams
  // from reconnecting below.
  await Promise.allSettled([
    // A Yahoo instrument has no websocket to fill in its price, so fetch one
    // up front rather than leaving the hero on a dash until the next poll.
    primeInstrument(sym),
    cbs!.fetchKlines(sym),
    cbs!.fetchOB(),
    cbs!.fetchFR(),
    cbs!.fetchOI(),
    cbs!.fetchWhales(),
  ])
  cbs!.connectStreams(cbs!.streamCb)
  // These instruments have no stream, so leaving the badge on "WS LIVE" or
  // "SYNCING" would claim a connection that does not exist.
  // A ratio / spread is re-polled too (services/marketData SYNTH_POLL_MS).
  if (isInstrument(sym) || isSynthetic(sym)) {
    const ks = $('wsKlineState')!
    ks.textContent = 'POLLED'
    ks.className = 'badge b-cyan'
  }
  cbs!.renderHero()
}
