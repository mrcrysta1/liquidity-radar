// Pop-out chart window: the main chart alone in a window of its own,
// following (and leading) the window that opened it.
//
// The popout is the same app at `?popout=1&sym=…&tf=…&ch=…` (./popoutMath).
// It boots exactly like the full app — the engine expects the whole shell —
// but starts on the chart in the CSS-only full-screen layout (html.radar-fs),
// so only the chart card shows. Symbol and interval changes travel both ways
// over a BroadcastChannel named for the opener, so two ordinary tabs of the
// app never steer each other.
import { state } from '../../services/store'
import { setSymbol, subscribeSymbol, switchTab } from '../actions/userActions'
import { getTimeframe, setTimeframe, subscribeTimeframe } from './timeframes'
import { parsePopout, popoutSearch, readSyncMsg } from './popoutMath'
import type { SyncMsg } from './popoutMath'

const params = typeof location !== 'undefined' ? parsePopout(location.search) : null

/** True in the pop-out window. */
export const isPopout = (): boolean => params != null

let channel: BroadcastChannel | null = null
/** Set while a change from the other window is applied, so it is not echoed back. */
let remote = false

function post(m: SyncMsg): void {
  if (remote || !channel) return
  try {
    channel.postMessage(m)
  } catch {
    /* closed */
  }
}

function join(name: string): void {
  if (channel || typeof BroadcastChannel === 'undefined') return
  channel = new BroadcastChannel('lr-chart-' + name)
  channel.onmessage = (e) => {
    const m = readSyncMsg(e.data)
    if (!m) return
    remote = true
    try {
      if (m.k === 'sym') {
        if (m.v !== state.symbol) void setSymbol(m.v, { keepTab: true })
      } else if (m.v !== getTimeframe()) setTimeframe(m.v)
    } finally {
      remote = false
    }
  }
  subscribeSymbol(() => post({ k: 'sym', v: state.symbol }))
  let tf = getTimeframe()
  subscribeTimeframe(() => {
    // Favourite edits emit too; only an interval change is news.
    if (getTimeframe() === tf) return
    tf = getTimeframe()
    post({ k: 'tf', v: tf })
  })
}

/**
 * Before the shell mounts: in the popout, take the symbol and interval from
 * the URL and lay the page out as the chart alone.
 */
export function bootPopout(): void {
  if (!params) return
  const root = document.documentElement
  root.classList.add('lr-popout', 'radar-fs')
  // The full-screen key / button would drop back to the whole app.
  new MutationObserver(() => {
    if (root.classList.contains('radar-fs')) return
    root.classList.add('radar-fs')
    window.dispatchEvent(new Event('resize'))
  }).observe(root, { attributes: true, attributeFilter: ['class'] })
  if (params.sym) state.symbol = params.sym
  if (params.tf) setTimeframe(params.tf, { reload: false })
  document.title = params.sym + ' · Liquidity Radar'
}

/** After the engine boots: show the chart and start syncing with the opener. */
export function afterEngineBoot(): void {
  if (!params) return
  switchTab('radar')
  if (params.ch) join(params.ch)
}

// One channel per opening window, shared by every popout it opens.
const ownChannel = Math.random().toString(36).slice(2, 12).padEnd(4, '0')

/** Open the chart in a new window on the current symbol and interval. */
export function openPopout(): void {
  join(ownChannel)
  const url =
    location.origin +
    location.pathname +
    popoutSearch({ sym: state.symbol, tf: getTimeframe(), ch: ownChannel })
  window.open(url, '_blank', 'popup,width=1100,height=700')
}
