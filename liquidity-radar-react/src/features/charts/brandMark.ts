// Our radar mark in the corner of each chart, where lightweight-charts would
// put the TradingView logo. The library's licence asks for a link to
// tradingview.com somewhere users can see it; that link lives in the sidebar
// footer (components/Sidebar.tsx, "Charts by TradingView"), which is what
// lets every chart turn `attributionLogo` off.

/** Library options that hide the TradingView logo; merge into createChart options. */
export const NO_TV_LOGO = { layout: { attributionLogo: false } } as const

/** Add the Liquidity Radar mark to a chart container (once). */
export function addBrandMark(el: HTMLElement): void {
  if (el.querySelector(':scope > .chart-brand')) return
  const mark = document.createElement('img')
  mark.className = 'chart-brand'
  mark.src = '/icon.svg'
  mark.alt = ''
  mark.setAttribute('aria-hidden', 'true')
  mark.draggable = false
  // The library positions its canvases inside `el`; the mark needs a box to sit in.
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
  el.appendChild(mark)
}
