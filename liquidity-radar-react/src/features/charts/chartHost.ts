// The price-action chart section appears on both the Radar and Charts tabs.
//
// It is one chart, not two: the engine, the indicator store, the drawings and
// the layout are all single-instance and bound to fixed element ids, so a
// second copy of the markup would collide on every one of them. Instead the
// card itself is moved into whichever tab is showing — only one is ever
// visible, so the chart, its drawings and its settings carry across intact.
import { $ } from '../../utils/dom'
import { resizeChart } from './chartRender'
import { resizeAll } from './companionCharts'

/** Tabs that host the price-action chart, in id order. */
const HOSTS: Record<string, string> = {
  radar: 'chartHostRadar',
  multichart: 'chartHostCharts',
}

export function placeChartForTab(tab: string): void {
  const card = $('radarChartCard')
  const host = $(HOSTS[tab] || HOSTS.radar)
  if (!card || !host || card.parentElement === host) return
  host.appendChild(card)
  // The new host is a different width, so the chart and any companions need
  // to measure again once the browser has laid them out.
  requestAnimationFrame(() => {
    resizeChart()
    resizeAll()
  })
}
