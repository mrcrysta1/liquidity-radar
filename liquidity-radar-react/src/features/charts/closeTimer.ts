// Countdown to the current candle's close, pinned to the price axis directly
// under the last-price label — where TradingView puts it.
//
// lightweight-charts cannot put custom content on the price scale, so this is a
// small absolutely-positioned element inside #chartWrap that tracks the last
// price's y coordinate and the scale's width.
import { $ } from '../../utils/dom'
import { state } from '../../services/store'
import { bucketEnd, tfDef } from '../../services/timeframe'
import { getTimeframe } from './timeframes'
import { isReplayOn } from './replay'

type Any = any

const ID = 'closeTimer'
let el: HTMLElement | null = null
let timer: ReturnType<typeof setInterval> | null = null
/** Set by the chart so the timer can ask where the last price sits. */
let deps: { chart: Any; series: () => Any } | null = null

function format(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (d > 0) return d + 'd ' + pad(h) + 'h'
  if (h > 0) return pad(h) + ':' + pad(m) + ':' + pad(sec)
  return pad(m) + ':' + pad(sec)
}

export function mountCloseTimer(chart: Any, series: () => Any): void {
  deps = { chart, series }
  const wrap = $('chartWrap')
  if (!wrap) return
  el = $(ID)
  if (!el) {
    el = document.createElement('div')
    el.id = ID
    el.className = 'close-timer'
    wrap.appendChild(el)
  }
  if (!timer) timer = setInterval(updateCloseTimer, 1000)
  updateCloseTimer()
}

export function updateCloseTimer(): void {
  if (!el || !deps) return
  const s = deps.series()
  const last = state.candles[state.candles.length - 1]
  // Nothing to count down to while replaying history, or before data arrives.
  if (!s || !last || isReplayOn()) {
    el.style.display = 'none'
    return
  }
  let y: number | null
  try {
    y = s.priceToCoordinate(last.c)
  } catch (e) {
    y = null
  }
  if (y == null) {
    el.style.display = 'none'
    return
  }
  let width = 56
  try {
    width = deps.chart.priceScale('right').width() || 56
  } catch (e) {
    /* scale not mounted */
  }
  const wrap = $('chartWrap')
  const maxY = wrap ? wrap.clientHeight - 20 : 400
  const def = tfDef(getTimeframe())
  const left = bucketEnd(last.t, def) - Date.now()

  el.style.display = 'block'
  el.style.width = width + 'px'
  // Sit just under the price label, which is centred on the price itself.
  el.style.top = Math.max(0, Math.min(maxY, y + 10)) + 'px'
  el.classList.toggle('soon', left > 0 && left < 10000)
  el.classList.toggle('stale', left < -2000)
  el.textContent = left < -2000 ? 'SYNC' : format(left)
}

export function unmountCloseTimer(): void {
  if (timer) clearInterval(timer)
  timer = null
}
