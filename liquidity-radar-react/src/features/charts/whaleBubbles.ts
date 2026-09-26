// Whale orders drawn on the price chart as bubbles — the Coinglass-style
// "large trade" view. Each bubble is one real taker order (see
// features/whales/whaleFlow.ts): centred on the candle it traded in, at its
// average fill price, with its *area* proportional to the dollars traded, so a
// $5M order reads as five times the ink of a $1M one. Green = market buy,
// red = market sell.
//
// Time the tape has not been scanned for is shaded and labelled rather than
// left blank, so an empty stretch never passes for "no whales traded here".
//
// Its own canvas layer, the same pattern as the volume profile overlay:
// positions come from the chart's own coordinate conversions on every redraw.
import { state } from '../../services/store'
import { cfmt, pfmt } from '../../utils/format'
import { getShowWhaleBubbles } from './overlayToggles'
import { visibleCandles } from './replay'
import { getWhaleView, onWhaleFlowChange, syncWhaleSymbol } from '../whales/whaleFlow'
import type { WhaleOrder } from '../whales/whaleFlow'
import { bubbleRadius } from '../whales/whaleMath'


type Any = any

let chart: Any = null
let candleSeries: Any = null
let canvas: HTMLCanvasElement | null = null
let tip: HTMLDivElement | null = null
let drawn: Array<{ x: number; y: number; r: number; o: WhaleOrder }> = []
let frame = 0

export function attachWhaleBubbles(c: Any, series: Any, wrap: HTMLElement): void {
  chart = c
  candleSeries = series
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.id = 'whaleCanvas'
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;z-index:3;pointer-events:none;'
    wrap.style.position = 'relative'
    wrap.appendChild(canvas)
    tip = document.createElement('div')
    tip.className = 'whale-tip'
    wrap.appendChild(tip)
    chart.subscribeCrosshairMove(onHover)
  }
}

/** Repaint on every new order or backfill page, coalesced to one per frame. */
export function watchLiveWhales(): () => void {
  return onWhaleFlowChange(renderWhaleBubbles)
}

export function renderWhaleBubbles(): void {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    paint()
  })
}

function clear(ctx: CanvasRenderingContext2D, cw: number, ch: number): void {
  ctx.clearRect(0, 0, cw, ch)
  drawn = []
  if (tip) tip.style.display = 'none'
}

function paint(): void {
  if (!canvas || !chart || !candleSeries) return
  const dpr = window.devicePixelRatio || 1
  const cw = canvas.clientWidth
  const ch = canvas.clientHeight
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr)
    canvas.height = Math.round(ch * dpr)
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  clear(ctx, cw, ch)

  const candles = visibleCandles()
  if (!candles.length) return
  if (!getShowWhaleBubbles()) return
  // The book follows the chart's symbol; the backfill reaches back to its
  // first candle. Nothing is fetched while the bubbles are switched off.
  syncWhaleSymbol(state.symbol, candles[0].t)

  const v = getWhaleView()
  if (v.sym !== state.symbol) return
  const ts = chart.timeScale()
  const paneW: number = ts.width()
  const paneH: number = ch - ts.height()
  const spacing: number = ts.options().barSpacing || 6
  const dur =
    candles.length > 1 ? candles[candles.length - 1].t - candles[candles.length - 2].t : 60_000
  const endT = candles[candles.length - 1].t + dur

  // Pixel x of an instant: its candle's centre, nudged across the bar by how
  // far into the candle it traded.
  const xOf = (t: number): number | null => {
    let lo = 0
    let hi = candles.length - 1
    if (t < candles[0].t) return null
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (candles[mid].t <= t) lo = mid
      else hi = mid - 1
    }
    const c = candles[lo]
    const x = ts.timeToCoordinate(Math.floor(c.t / 1000))
    if (x == null) return null
    const span = lo + 1 < candles.length ? candles[lo + 1].t - c.t : dur
    return x + ((t - c.t) / span - 0.5) * spacing * 0.8
  }

  paintCoverage(ctx, v.coverage, candles[0].t, endT, xOf, paneW, paneH)

  const list = v.orders
    .filter((o) => o.usd >= v.min && o.t >= candles[0].t && o.t < endT)
    // Biggest first, so smaller bubbles stay visible on top of them.
    .sort((a, b) => b.usd - a.usd)
  for (const o of list) {
    const x = xOf(o.t)
    const y = candleSeries.priceToCoordinate(o.p)
    if (x == null || y == null) continue
    const r = bubbleRadius(o.usd, v.min)
    if (x + r < 0 || x - r > paneW || y + r < 0 || y - r > paneH) continue
    const buy = o.side === 'buy'
    const rgb = buy ? '0,230,118' : '255,23,68'
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
    g.addColorStop(0, 'rgba(' + rgb + ',.55)')
    g.addColorStop(1, 'rgba(' + rgb + ',.22)')
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = g
    ctx.fill()
    ctx.lineWidth = r > 12 ? 1.5 : 1
    ctx.strokeStyle = 'rgba(' + rgb + ',.95)'
    ctx.stroke()
    if (r >= 14) {
      ctx.font = '700 ' + (r >= 24 ? 11 : 9.5) + 'px "JetBrains Mono", monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#fff'
      ctx.fillText(cfmt(o.usd).replace('$', ''), x, y)
    }
    drawn.push({ x, y, r, o })
  }
}

/** Shade the stretches of the visible chart the tape was never scanned for. */
function paintCoverage(
  ctx: CanvasRenderingContext2D,
  cov: Array<{ t0: number; t1: number }>,
  from: number,
  to: number,
  xOf: (t: number) => number | null,
  paneW: number,
  paneH: number,
): void {
  const now = Date.now()
  const gaps: Array<[number, number]> = []
  let cur = from
  const sorted = cov.filter((c) => c.t1 >= from && c.t0 <= to).sort((a, b) => a.t0 - b.t0)
  for (const c of sorted) {
    // Small holes are a reconnect or a page edge, not a real gap.
    if (c.t0 - cur > 60_000) gaps.push([cur, c.t0])
    cur = Math.max(cur, c.t1)
  }
  // Nothing after the last scanned trade yet: only a gap once it is stale.
  if (Math.min(to, now) - cur > 120_000) gaps.push([cur, Math.min(to, now)])
  ctx.save()
  ctx.font = '600 10px "JetBrains Mono", monospace'
  ctx.textBaseline = 'top'
  for (const [a, b] of gaps) {
    const x0 = a <= from ? 0 : xOf(a)
    const x1 = xOf(b) ?? paneW
    if (x0 == null) continue
    const l = Math.max(0, x0)
    const w = Math.min(paneW, x1) - l
    if (w < 2) continue
    ctx.fillStyle = 'rgba(143,163,191,.07)'
    ctx.fillRect(l, 0, w, paneH)
    if (x1 < paneW) {
      ctx.strokeStyle = 'rgba(143,163,191,.35)'
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(x1 + 0.5, 0)
      ctx.lineTo(x1 + 0.5, paneH)
      ctx.stroke()
      ctx.setLineDash([])
    }
    if (w > 130) {
      ctx.fillStyle = 'rgba(143,163,191,.75)'
      ctx.textAlign = 'center'
      ctx.fillText('no whale data scanned', l + w / 2, paneH - 18)
    }
  }
  ctx.restore()
}

function onHover(param: Any): void {
  if (!tip) return
  const pt = param?.point
  if (!pt || !drawn.length || !getShowWhaleBubbles()) {
    tip.style.display = 'none'
    return
  }
  // Smallest bubble under the pointer wins — it is the one drawn on top.
  let hit: (typeof drawn)[number] | null = null
  for (const d of drawn) {
    const dx = pt.x - d.x
    const dy = pt.y - d.y
    if (dx * dx + dy * dy <= Math.max(d.r, 6) ** 2 && (!hit || d.r < hit.r)) hit = d
  }
  if (!hit) {
    tip.style.display = 'none'
    return
  }
  const o = hit.o
  const buy = o.side === 'buy'
  const base = state.symbol.replace(/USDT$/, '')
  const time = new Date(o.t).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  tip.innerHTML =
    '<b class="' +
    (buy ? 'up' : 'dn') +
    '">' +
    (buy ? 'Market BUY' : 'Market SELL') +
    ' · ' +
    cfmt(o.usd) +
    '</b><span>' +
    o.q.toLocaleString(undefined, { maximumFractionDigits: 4 }) +
    ' ' +
    base +
    ' @ ' +
    pfmt(o.p) +
    (o.n > 1 ? ' avg · ' + o.n + ' fills' : '') +
    '</span><small>' +
    time +
    ' · Binance spot</small>'
  tip.style.display = 'flex'
  const wrapW = canvas?.clientWidth || 0
  const left = hit.x + hit.r + 8
  tip.style.left = (left + 200 > wrapW ? Math.max(4, hit.x - hit.r - 208) : left) + 'px'
  tip.style.top = Math.max(4, hit.y - 24) + 'px'
}
