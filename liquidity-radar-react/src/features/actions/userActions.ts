// Global navigation actions. Faithful extraction of the engine's switchTab /
// setSymbol handlers; the heavy lifting (market fetches, stream reconnect,
// chart renders) is injected by the engine via wireUserActions(), so this
// module stays free of UI/stream concerns. The classic-script globals are
// re-exposed on window by the engine's exposeGlobals().
import { $ } from '../../utils/dom'
import { state } from '../../services/store'
import type { StreamsCallbacks } from '../../services/streams'

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

export function switchTab(tab: string): void {
  state.tab = tab
  document.querySelectorAll<HTMLElement>('.tab-btn').forEach((b) => {
    const on = b.dataset.tab === tab
    b.classList.toggle('active', on)
    b.setAttribute('aria-selected', on ? 'true' : 'false')
  })
  document.querySelectorAll<HTMLElement>('.tab-section').forEach((s) =>
    s.classList.toggle('active', s.id === 'tab-' + tab),
  )
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
    cbs!.fetchKlines(sym),
    cbs!.fetchOB(),
    cbs!.fetchFR(),
    cbs!.fetchOI(),
    cbs!.fetchWhales(),
  ])
  cbs!.connectStreams(cbs!.streamCb)
  cbs!.renderHero()
}