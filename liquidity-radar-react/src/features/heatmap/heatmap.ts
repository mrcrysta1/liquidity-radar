// Live liquidation heat map. Faithful extraction of the engine's LIVE
// LIQUIDATION HEAT MAP block — a synthetic liquidation-level canvas chart
// driven off state (mark price, OI, breadth) on a 1s loop. Kept offline/no-op
// when the canvas is absent. init() calls initHeatMap() once at boot.
import { COINS } from '../../constants/market'
import { pfmt, cfmt } from '../../utils/format'
import { $ } from '../../utils/dom'
import { state } from '../../services/store'

interface HeatEntry { t: number; lo: number[]; hi: number[]; mark: number }
interface HeatState {
  sym: string | null
  hist: HeatEntry[]
  lastMark: number | null
  lastOIN: number | null
  sweepAt: number
  rows: number
  range: number
  cap: number
}
const hm: HeatState = {
  sym: null,
  hist: [],
  lastMark: null,
  lastOIN: null,
  sweepAt: 0,
  rows: 65,
  range: 6,
  cap: 110,
}

function frAs(): { markPrice?: string | number } | null | undefined {
  return state.fr as { markPrice?: string | number } | null | undefined
}
function oiAs(): { openInterest?: string | number } | null | undefined {
  return state.oi as { openInterest?: string | number } | null | undefined
}

function hmCurMark(): number | null {
  const fr = frAs()
  if (fr && typeof fr.markPrice !== 'undefined' && isFinite(+fr.markPrice)) return +fr.markPrice
  const t = state.tickers[state.symbol]
  if (t && isFinite(+t.last)) return +t.last
  const c = state.candles[state.candles.length - 1]
  return c ? +c.c : null
}
function hmBreadth(): { adv: number; dec: number; total: number; net: number } | null {
  let adv = 0
  let dec = 0
  let total = 0
  Object.keys(COINS).forEach(function (k) {
    const t = state.tickers[COINS[k].sym]
    if (!t || !isFinite(t.pct)) return
    total++
    if (t.pct > 0.005) adv++
    else if (t.pct < -0.005) dec++
  })
  return total ? { adv, dec, total, net: (adv - dec) / total } : null
}
interface HmMetrics {
  mark: number | null
  oin: number | null
  atrPct: number | null
  br: { adv: number; dec: number; total: number; net: number } | null
  oiF: number
  atrF: number
  mom: number
  stress: number
  sign: string
}
function hmMetrics(): HmMetrics {
  const mark = hmCurMark()
  const oi = oiAs()
  const oin = oi && typeof oi.openInterest !== 'undefined' && isFinite(+oi.openInterest) ? +oi.openInterest * (mark as number) : null
  const atr = state._atr as number | undefined
  const atrPct = atr && mark ? atr / mark * 100 : null
  const br = hmBreadth()
  const oiF = oin ? Math.max(0.5, Math.min(1.8, Math.log10(oin) / 9)) : 0.85
  const atrF = atrPct ? Math.max(0.6, Math.min(1.5, atrPct / 1.5)) : 0.9
  const mom = hm.lastMark && mark ? ((mark / hm.lastMark - 1) * 100) : 0
  const momF = Math.max(-1, Math.min(1, mom * 6))
  const bf = br ? Math.max(-1, Math.min(1, br.net * 3)) : 0
  const stress = Math.round(Math.max(0, Math.min(100, 35 + ((oiF - 1) * 38) + (atrF - 1) * 28 + Math.abs(bf) * 30 + Math.abs(momF) * 22)))
  const sign = stress >= 55 ? 'HIGH' : stress >= 35 ? 'ELEVATED' : 'NORMAL'
  return { mark, oin, atrPct, br, oiF, atrF, mom, stress, sign }
}
function hmSweep(): void {
  const mark = hmCurMark()
  if (mark === null || !isFinite(mark)) return
  if (hm.sym !== state.symbol) { hm.sym = state.symbol; hm.hist = []; hm.lastMark = mark; hm.lastOIN = null }
  const m = hmMetrics()
  const rows = hm.rows
  const range = hm.range
  const sigma = Math.max(0.7, m.atrPct ? m.atrPct * 1.5 : 0.9)
  const pulse = 0.12 + 0.1 * Math.sin(Date.now() / 2600)
  const momF = Math.max(-1, Math.min(1, m.mom * 6))
  const bf = m.br ? m.br.net : 0
  const gBoost = Math.max(-0.4, Math.min(0.7, 0.42 * (-momF) + 0.30 * (-bf)))
  const rBoost = Math.max(-0.4, Math.min(0.7, 0.42 * momF + 0.30 * bf))
  const lo: number[] = []
  const hi: number[] = []
  for (let i = 0; i < rows; i++) {
    const pct = range - (i / (rows - 1)) * 2 * range
    const dist = Math.abs(pct)
    const k = Math.exp(-dist / sigma)
    const jit = 0.85 + Math.random() * 0.3
    let lv = k * (m.oiF * (0.6 + pulse)) * jit * (1 + gBoost)
    let hv = k * (m.oiF * (0.6 + pulse)) * jit * (1 + rBoost)
    if (pct >= 0) lv *= 0.18
    if (pct < 0) hv *= 0.18
    lo.push(Math.max(0, Math.min(1, lv)))
    hi.push(Math.max(0, Math.min(1, hv)))
  }
  hm.hist.push({ t: Date.now(), lo, hi, mark })
  if (hm.hist.length > hm.cap) hm.hist.shift()
  hm.lastMark = mark
  if (isFinite(m.oin || NaN)) hm.lastOIN = m.oin
}
function cssRGB(cs: CSSStyleDeclaration, prop: string): number[] {
  const s = cs.getPropertyValue(prop).trim()
  const parts = s.split(/\s+/).map(Number)
  if (parts.length >= 3 && parts[0] >= 0 && parts[1] >= 0 && parts[2] >= 0 && parts.every(isFinite)) return parts.slice(0, 3)
  return [0, 230, 118]
}
function hexRGB(hex: string): number[] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim())
  if (!m) return [255, 179, 0]
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}
function hmFillRect(c2: CanvasRenderingContext2D, x: number, y: number, wd: number, ht: number, rgb: number[], a: number): void {
  if (a <= 0.02) return
  c2.fillStyle = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + Math.min(0.95, a).toFixed(3) + ')'
  c2.fillRect(x, y, wd, ht)
}
function hmRender(): void {
  if (!hm.hist.length) return
  const cv = $('hmCanvas') as HTMLCanvasElement | null
  if (!cv) return
  const dpr = window.devicePixelRatio || 1
  const w = cv.clientWidth || 0
  const th = cv.clientHeight || 0
  if (!w || !th) return
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(th * dpr)) {
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(th * dpr)
  }
  const c2 = cv.getContext('2d')!
  c2.setTransform(dpr, 0, 0, dpr, 0, 0)
  c2.clearRect(0, 0, w, th)
  const cs = getComputedStyle(document.documentElement)
  const g = cssRGB(cs, '--gRGB')
  const r = cssRGB(cs, '--rRGB')
  const amber = hexRGB(cs.getPropertyValue('--amber').trim() || '#FFB300')
  const n = hm.cap
  const colW = w / n
  const rows = hm.rows
  const cellH = th / rows
  const lastMark = hm.hist[hm.hist.length - 1].mark
  hm.hist.forEach(function (col, cx) {
    const ageF = 0.55 + 0.45 * (cx / (n - 1))
    const x = cx * colW
    const shiftPx = lastMark ? ((lastMark - col.mark) / lastMark) * 100 / (2 * hm.range) * th : 0
    for (let i = 0; i < rows; i++) {
      const y = i * cellH + shiftPx
      const lv = col.lo[i] * ageF
      const hv = col.hi[i] * ageF
      if (lv > 0.02) hmFillRect(c2, x, y, colW + 1.5, cellH + 0.5, g, lv)
      if (hv > 0.02) hmFillRect(c2, x, y, colW + 1.5, cellH + 0.5, r, hv)
    }
  })
  c2.strokeStyle = 'rgba(143,163,191,.13)'
  c2.lineWidth = 1
  for (let g2 = -4; g2 <= 4; g2 += 2) {
    const gy = (1 - (g2 + hm.range) / (2 * hm.range)) * th
    c2.beginPath()
    c2.moveTo(0, gy)
    c2.lineTo(w, gy)
    c2.stroke()
  }
  const markY = th / 2
  c2.strokeStyle = 'rgba(255,179,0,.85)'
  c2.setLineDash([4, 4])
  c2.beginPath()
  c2.moveTo(0, markY)
  c2.lineTo(w, markY)
  c2.stroke()
  c2.setLineDash([])
  c2.font = '600 10px Inter,system-ui,sans-serif'
  c2.fillStyle = 'rgba(255,179,0,.95)'
  const lbl = 'MARK $' + pfmt(lastMark)
  c2.fillText(lbl, w - c2.measureText(lbl).width - 6, markY - 5)
  const newest = hm.hist.length - 1
  c2.fillStyle = 'rgba(143,163,191,.25)'
  c2.fillRect(newest * colW, 0, Math.max(2, colW * 0.4), th)
}
function hmMetaTxt(): void {
  const m = hmMetrics()
  const oiEl = $('hmOI')
  const stEl = $('hmStress')
  const brEl = $('hmBreadth')
  const upEl = $('hmUpd')
  const symEl = $('liqHmSym')
  if (symEl) symEl.textContent = state.symbol
  if (oiEl) {
    let html = 'OI <b>' + (m.oin ? cfmt(m.oin) : '—') + '</b>'
    if (hm.lastOIN && m.oin && isFinite(hm.lastOIN)) {
      const d = (m.oin / hm.lastOIN - 1) * 100
      html += ' <span style="color:' + (d >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (d > 0 ? '+' : '') + d.toFixed(1) + '%</span>'
    }
    oiEl.innerHTML = html
  }
  if (stEl) {
    const col = m.sign === 'HIGH' ? 'var(--red)' : m.sign === 'ELEVATED' ? 'var(--amber)' : 'var(--green)'
    stEl.innerHTML = 'Stress <b style="color:' + col + '">' + m.stress + '% · ' + m.sign + '</b>'
  }
  if (brEl) {
    if (m.br) {
      const netPct = m.br.net * 100
      const col = m.br.net >= 0 ? 'var(--green)' : 'var(--red)'
      const sign = m.br.net >= 0 ? '+' : ''
      brEl.innerHTML = 'Breadth <b>' + m.br.adv + 'A</b> / <b>' + m.br.dec + 'D</b> <span style="color:' + col + ';font-weight:700">' + sign + netPct.toFixed(0) + '%</span>'
    } else {
      brEl.textContent = 'Breadth —'
    }
  }
  if (upEl) upEl.textContent = 'live · sweep every 4s · ' + new Date().toLocaleTimeString()
}
function hmLoop(): void {
  try {
    const now = Date.now()
    if (state.symbol !== hm.sym) { hm.hist = []; hm.sym = state.symbol }
    if (now >= hm.sweepAt) {
      hmSweep()
      hm.sweepAt = now + 4000
    }
    hmMetaTxt()
    hmRender()
  } catch (e) { console.warn('heatmap', e) }
}
export function initHeatMap(): void {
  const cv = $('hmCanvas')
  if (!cv) return
  hm.sweepAt = 0
  hmLoop()
  setInterval(hmLoop, 1000)
  if (window.ResizeObserver) {
    const par = cv.parentElement
    if (par) new ResizeObserver(function () { if (hm.hist.length) hmRender() }).observe(par)
  }
}