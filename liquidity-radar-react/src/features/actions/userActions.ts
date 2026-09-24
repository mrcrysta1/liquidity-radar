// Global navigation actions. Faithful extraction of the engine's switchTab /
// setSymbol handlers; the heavy lifting (market fetches, stream reconnect,
// chart renders) is injected by the engine via wireUserActions(), so this
// module stays free of UI/stream concerns. The classic-script globals are
// re-exposed on window by the engine's exposeGlobals().
import { $ } from '../../utils/dom'
import { primeInstrument } from '../../services/instrumentFeed'
import { state } from '../../services/store'
import { placeChartForTab } from '../charts/chartHost'
import type { StreamsCallbacks } from '../../services/streams'
import { resetDelta } from '../delta/delta'
import { resetLiveWhales } from '../delta/liveWhales'
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

export async function setSymbol(sym: string): Promise<void> {
  if (!sym) return
  if (state.symbol === sym) {
    switchTab('radar')
    return
  }
  state.symbol = sym
  Object.keys(state.ctxCache).forEach((k) => delete state.ctxCache[k])
  state._liq = null
  state._sr = null
  state._ai = null
  state.whales = []
  resetDelta(sym)
  resetLiveWhales(sym)
  resetConfluence(sym)
  checkDivergence()
  resetML()
  resetRL()
  $('heroPrice')!.textContent = '—'
  $('heroPrice')!.dataset.p = '0'
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
  switchTab('radar')
  await Promise.all([
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
  cbs!.renderHero()
}
