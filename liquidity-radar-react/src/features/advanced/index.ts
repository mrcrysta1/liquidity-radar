// Advanced (Pro-adopted) Radar panels: the cross-exchange radar and the live
// liquidation feed.
//
// The liquidity score, futures positioning and market structure this module
// used to render are now the chart side panel's tabs, running on the single
// shared engine in charts/sidePanels/metrics. There is deliberately no second
// copy of those formulas here — this module still owns the *fetching* the
// panel depends on (deep book, OI history, long/short), because those polls
// must run whether or not the panel happens to be open.
// Data lives in ./advancedData and ./liquidations; this module orchestrates and
// renders into the Radar tab DOM (the app's established pattern).
import { $ } from '../../utils/dom'
import { poll } from '../../services/pollScheduler'
import { fmtUsd as fmt } from '../charts/sidePanels/metrics'
import { state } from '../../services/store'
import {
  fetchCrossExchange,
  fetchDeepOB,
  fetchLongShort,
  fetchOIHist,
} from './advancedData'
import { initLiquidations, type Liq } from './liquidations'

export function renderLiquidations(): void {
  const body = $('advLiqBody')
  const totals = $('advLiqTotals')
  const badge = $('advLiqBadge')
  if (!body) return
  const liqs = (state.liqs as Liq[]) || []
  const st = String(state.liqWs || 'closed')
  if (badge) {
    badge.textContent = st === 'open' ? 'LIVE' : 'ws ' + st
    badge.className = 'badge ' + (st === 'open' ? 'b-green' : 'b-gray')
  }
  const recent = liqs.filter((l) => Date.now() - l.ts < 5 * 60_000)
  const longs = recent.filter((l) => l.side === 'SELL').reduce((s, l) => s + l.price * l.qty, 0)
  const shorts = recent.filter((l) => l.side === 'BUY').reduce((s, l) => s + l.price * l.qty, 0)
  const mine = liqs.filter((l) => l.symbol === state.symbol).length
  if (totals)
    totals.innerHTML =
      '5m: <span class="down">longs $' +
      (longs / 1e3).toFixed(0) +
      'k</span> · <span class="up">shorts $' +
      (shorts / 1e3).toFixed(0) +
      'k</span> · ' +
      mine +
      ' on ' +
      state.symbol
  if (!liqs.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted">Listening for forced orders…</td></tr>'
    return
  }
  body.innerHTML = liqs
    .slice(0, 60)
    .map(
      (l) =>
        '<tr class="row-hover" style="font-weight:' +
        (l.price * l.qty > 100_000 ? 600 : 400) +
        '"><td>' +
        l.symbol +
        '</td><td style="color:' +
        (l.side === 'SELL' ? 'var(--red)' : 'var(--green)') +
        '">' +
        (l.side === 'SELL' ? 'long liq' : 'short liq') +
        '</td><td>' +
        l.price +
        '</td><td>$' +
        ((l.price * l.qty) / 1e3).toFixed(1) +
        'k</td><td class="muted">' +
        new Date(l.ts).toLocaleTimeString() +
        '</td></tr>',
    )
    .join('')
}

export function renderAdvanced(): void {
  // Cross-exchange renders itself from state (components/analysis).
  const badge = $('advXexBadge')
  if (badge) badge.textContent = state.symbol
}

let lastSym = ''

export function advancedSymbolChanged(): void {
  state.liqs = []
  fetchDeepOB()
  fetchOIHist()
  fetchLongShort()
  fetchCrossExchange()
  renderAdvanced()
  renderLiquidations()
}

export function initAdvanced(): void {
  lastSym = state.symbol
  fetchDeepOB()
  fetchOIHist()
  fetchLongShort()
  fetchCrossExchange()
  initLiquidations()
  renderAdvanced()
  renderLiquidations()
  poll(fetchDeepOB, 3_000)
  poll(fetchOIHist, 60_000)
  poll(fetchLongShort, 60_000)
  poll(fetchCrossExchange, 15_000)
  poll(renderAdvanced, 2_000)
  poll(renderLiquidations, 1_000)
  poll(() => {
    if (state.symbol !== lastSym) {
      lastSym = state.symbol
      advancedSymbolChanged()
    }
  }, 1_000, { always: true })
}
