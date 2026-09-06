// Analysis-tab analytics engine. Faithful extraction of the engine's
// runAnalytics / renderAnalysis blocks: collapses candles into the AI
// composite + indicator snapshot plus the liquidation / funding / volume
// profile math, stores the derived state (_ai/_atr/_sr/_liq), and renders
// the analysis tab DOM. computeAnalytics (pure math) and renderAnalysis
// (DOM) are separated so the engine only orchestrates the trigger.
import { $ } from '../../utils/dom'
import { pfmt, cfmt, nfmt } from '../../utils/format'
import { baseOf } from '../../utils/coins'
import { aiComposite, calcATR, forecastFrom, supportResistance } from '../../utils/indicators'
import { state } from '../../services/store'
import type { AIScore, Forecast, SupportResistance } from '../../types/market'

interface FrLike { markPrice: string; lastFundingRate: string; nextFundingTime?: number }
interface OiLike { openInterest: string }

interface LiqCalc {
  oiN: number
  oiRaw: number
  atr: number
  sup: number
  lzLo: number
  lzHi: number
  szLo: number
  szHi: number
  leLong: number
  leShort: number
  liqLBars: number
  liqSBars: number
  srDist: string
}

export interface AnalyticsSnapshot {
  last: number
  rsi: number
  rsiZone: [string, string]
  mBull: boolean
  histPct: string
  macdHist: number
  above: boolean
  e20: number
  e20Pct: string
  pb: number
  bbZone: [string, string]
  bbLo: number
  bbUp: number
  vt: string
  vtc: [string, string]
  score: number
  color: string
  label: string
  badge: string
  mkPos: number
  dv: number
  fc: Forecast
  mark: number
  liq: LiqCalc | null
  vpHtml: string | null
}

export function computeAnalytics(): AnalyticsSnapshot | null {
  if (state.candles.length < 30) return null
  const closes = state.candles.map((c) => c.c)
  const vols = state.candles.map((c) => c.v as number)
  const a: AIScore = aiComposite(state.candles, closes, vols)
  const last = a.last

  const rsiZone = a.rsi > 70 ? ['OVERBOUGHT', 'b-red'] : a.rsi < 30 ? ['OVERSOLD', 'b-green'] : a.rsi > 55 ? ['BULLISH', 'b-green'] : a.rsi < 45 ? ['BEARISH', 'b-red'] : ['NEUTRAL', 'b-gray']
  const mBull = a.macd.hist > 0
  const histPct = ((a.macd.hist / (last * 0.002)) * 100).toFixed(0)
  const above = last > a.e20
  const pb = a.bb.pctB
  const bbZone = pb > 95 ? ['UPPER BREAK', 'b-amber'] : pb > 70 ? ['HIGH', 'b-green'] : pb < 5 ? ['LOWER BREAK', 'b-amber'] : pb < 30 ? ['LOW', 'b-red'] : ['MID RANGE', 'b-gray']
  const vtc = a.vt === 'RISING' ? ['RISING ↑', 'b-green'] : a.vt === 'FALLING' ? ['FALLING ↓', 'b-red'] : ['FLAT →', 'b-gray']
  const mkPos = 50 + a.score / 2

  const rets: number[] = []
  for (let i = 1; i < closes.length; i++) rets.push(closes[i] / closes[i - 1] - 1)
  const mr = rets.reduce((x, y) => x + y, 0) / rets.length
  const sd = Math.sqrt(rets.reduce((x, y) => x + (y - mr) * (y - mr), 0) / rets.length)
  const dv = sd * Math.sqrt(96) * 100

  const fc = forecastFrom(closes)
  const sr = supportResistance(state.candles)
  if (sr) state._sr = sr
  state._atr = calcATR(state.candles)
  state._ai = a

  const mark = state.fr ? parseFloat((state.fr as FrLike).markPrice) : last
  let liq: LiqCalc | null = null
  if (state.oi && mark != null) {
    const oiN = parseFloat((state.oi as OiLike).openInterest) * mark
    const oiRaw = parseFloat((state.oi as OiLike).openInterest)
    const atr = (state._atr as number | undefined) || mark * 0.004
    const srs = (state._sr as SupportResistance | null) || { sup: mark * 0.97, res: mark * 1.03 }
    const lz = { lo: srs.sup - 1.1 * atr, hi: srs.sup - 0.3 * atr }
    const sz = { lo: srs.res + 0.3 * atr, hi: srs.res + 1.1 * atr }
    const leLong = oiN * 0.22, leShort = oiN * 0.16
    const liqSpan = Math.max(atr * 2.8 * 3, mark * 0.003)
    const liqLBars = Math.max(8, Math.min(100, Math.round(((lz.hi / mark - 1) * 100) / ((liqSpan / mark) * 100) * 100)))
    const liqSBars = Math.max(8, Math.min(100, Math.round(((sz.lo / mark - 1) * 100) / ((liqSpan / mark) * 100) * 100)))
    const srDist = ((srs.sup - mark) / mark * 100).toFixed(2)
    liq = {
      oiN,
      oiRaw,
      atr,
      sup: srs.sup,
      lzLo: lz.lo,
      lzHi: lz.hi,
      szLo: sz.lo,
      szHi: sz.hi,
      leLong,
      leShort,
      liqLBars,
      liqSBars,
      srDist,
    }
    state._liq = { lz, sz, oiN }
  }

  let vpHtml: string | null = null
  if (state.candles.length) {
    const w = state.candles.slice(-96)
    const lo = Math.min(...w.map((c) => c.l))
    const hi = Math.max(...w.map((c) => c.h))
    const bins = 22
    const buckets = new Array(bins).fill(0) as number[]
    w.forEach((c) => {
      let bi = Math.floor(((c.c - lo) / ((hi - lo) || 1)) * bins)
      bi = Math.min(bins - 1, bi)
      buckets[bi] += c.v as number
    })
    const maxB = Math.max(...buckets) || 1
    const pocIdx = buckets.indexOf(maxB)
    const lastP = w[w.length - 1].c
    let html = ''
    for (let i = bins - 1; i >= 0; i--) {
      const pl = lo + i * ((hi - lo) / bins)
      const midP = pl + ((hi - lo) / bins) / 2
      const wpct = (buckets[i] / maxB) * 100
      const isPoc = i === pocIdx, isCur = lastP >= pl && lastP <= pl + ((hi - lo) / bins)
      html += '<div class="vp-row' + (isPoc ? ' poc' : '') + (isCur ? ' cur' : '') + '"><span class="vp-lbl">' + pfmt(midP) + '</span><span class="vp-zone"><span class="vp-bar" style="width:' + Math.max(2, wpct).toFixed(1) + '%"></span></span><span class="vp-val">' + nfmt(buckets[i]) + '</span><span class="vp-flag">' + (isPoc ? '★POC' : isCur ? '◀ LIVE' : '') + '</span></div>'
    }
    vpHtml = html
  }

  return {
    last,
    rsi: a.rsi,
    rsiZone: rsiZone as [string, string],
    mBull,
    histPct,
    macdHist: a.macd.hist,
    above,
    e20: a.e20,
    e20Pct: (((last / a.e20) - 1) * 100).toFixed(2),
    pb,
    bbZone: bbZone as [string, string],
    bbLo: a.bb.lo,
    bbUp: a.bb.up,
    vt: a.vt,
    vtc: vtc as [string, string],
    score: a.score,
    color: a.color,
    label: a.label,
    badge: a.badge,
    mkPos,
    dv,
    fc,
    mark,
    liq,
    vpHtml,
  }
}

export function renderAnalysis(s: AnalyticsSnapshot): void {
  $('mRSI')!.textContent = s.rsi.toFixed(1)
  $('mRSI')!.style.color = s.rsiZone[0] === 'OVERBOUGHT' ? 'var(--red)' : s.rsiZone[0] === 'OVERSOLD' ? 'var(--green)' : 'var(--txt)'
  $('mRSIZone')!.textContent = s.rsiZone[0]; $('mRSIZone')!.className = 'badge ' + s.rsiZone[1]
  $('indRSI')!.textContent = s.rsi.toFixed(1)
  $('indRSIb')!.textContent = s.rsiZone[0]; $('indRSIb')!.className = 'badge ' + s.rsiZone[1]

  $('mMACD')!.textContent = (s.mBull ? '+' : '') + s.histPct + '%'
  $('mMACD')!.style.color = s.mBull ? 'var(--green)' : 'var(--red)'
  $('mMACDZone')!.textContent = s.mBull ? 'BULLISH' : 'BEARISH'; $('mMACDZone')!.className = 'badge ' + (s.mBull ? 'b-green' : 'b-red')
  $('indMACD')!.textContent = s.macdHist.toFixed(s.last > 100 ? 2 : 6)
  $('indMACDb')!.textContent = s.mBull ? 'HIST > 0' : 'HIST < 0'; $('indMACDb')!.className = 'badge ' + (s.mBull ? 'b-green' : 'b-red')

  $('mEMA')!.textContent = pfmt(s.e20)
  $('mEMAZone')!.textContent = s.above ? 'PRICE ABOVE' : 'PRICE BELOW'; $('mEMAZone')!.className = 'badge ' + (s.above ? 'b-green' : 'b-red')
  $('mEMASub')!.textContent = (s.above ? 'uptrend bias' : 'downtrend bias') + ' · Δ ' + s.e20Pct + '%'
  $('indEMA')!.textContent = pfmt(s.e20)
  $('indEMAb')!.textContent = s.above ? 'ABOVE ✓' : 'BELOW ✕'; $('indEMAb')!.className = 'badge ' + (s.above ? 'b-green' : 'b-red')

  $('mBB')!.textContent = s.pb.toFixed(1) + '%'
  $('mBBZone')!.textContent = s.bbZone[0]; $('mBBZone')!.className = 'badge ' + s.bbZone[1]
  $('indBB')!.textContent = s.pb.toFixed(1) + '%'
  $('indBBb')!.textContent = s.bbZone[0]; $('indBBb')!.className = 'badge ' + s.bbZone[1]
  $('indBBs')!.textContent = 'bands ' + pfmt(s.bbLo) + ' – ' + pfmt(s.bbUp)

  $('indVT')!.textContent = s.vt
  $('indVTb')!.textContent = s.vtc[0]; $('indVTb')!.className = 'badge ' + s.vtc[1]

  $('mAIScore')!.textContent = (s.score > 0 ? '+' : '') + s.score
  $('mAIScore')!.style.color = s.color
  $('mAIZone')!.textContent = s.label; $('mAIZone')!.className = 'badge ' + s.badge
  $('mAIMarker')!.style.left = 'calc(' + s.mkPos + '% - 2px)'
  $('indScoreMarker')!.style.left = 'calc(' + s.mkPos + '% - 2px)'
  $('indScoreLbl')!.textContent = (s.score > 0 ? '+' : '') + s.score + ' · ' + s.label
  $('indScoreLbl')!.style.color = s.color

  $('mVol')!.textContent = s.dv.toFixed(2) + '%'
  $('mVol')!.style.color = s.dv > 4 ? 'var(--red)' : s.dv > 1.5 ? 'var(--amber)' : 'var(--green)'

  $('fcBias')!.textContent = s.fc.bias
  $('fcBias')!.style.color = s.fc.bias.indexOf('UP') === 0 ? 'var(--green)' : 'var(--red)'
  $('fcConf')!.textContent = s.fc.rows[3].conf + '%'
  $('fcRows')!.innerHTML = s.fc.rows.map((r) => {
    const col = r.dp >= 0 ? 'var(--green)' : 'var(--red)'
    return '<tr><td>' + r.label + '</td><td><b>' + pfmt(r.pred) + '</b></td><td style="color:' + col + '">' + (r.dp > 0 ? '+' : '') + r.dp.toFixed(2) + '%</td><td>' + pfmt(r.lo) + ' – ' + pfmt(r.hi) + '</td><td>' + r.conf + '%<span class="conf-bar"><i style="width:' + r.conf + '%"></i></span></td></tr>'
  }).join('')

  $('liqSym')!.textContent = state.symbol
  $('vpSym')!.textContent = state.symbol + ' · 96 BARS'
  if (s.mark != null) $('liqMark')!.textContent = '$' + pfmt(s.mark)
  if (state.fr) {
    const rate = parseFloat((state.fr as FrLike).lastFundingRate)
    $('mFR')!.textContent = (rate * 100).toFixed(4) + '%'
    $('mFR')!.style.color = rate > 0 ? 'var(--green)' : rate < 0 ? 'var(--red)' : 'var(--txt)'
    $('mFRNext')!.textContent = rate > 0 ? 'longs pay shorts' : rate < 0 ? 'shorts pay longs' : 'flat'
    if ((state.fr as FrLike).nextFundingTime) {
      const upd = () => {
        const ms = (state.fr as FrLike).nextFundingTime! - Date.now()
        if (ms < 0) return
        const hh = Math.floor(ms / 3600000), mm = Math.floor((ms % 3600000) / 60000), ss = Math.floor((ms % 60000) / 1000)
        $('mFRNext')!.textContent = (rate > 0 ? 'longs pay · ' : 'shorts pay · ') + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0') + ' to funding'
      }
      upd()
      clearInterval(state._frTimer as number | undefined)
      state._frTimer = setInterval(upd, 1000)
    }
  }
  if (s.liq) {
    const oiN = s.liq.oiN
    $('mOI')!.textContent = cfmt(oiN)
    $('mOISub')!.textContent = nfmt(s.liq.oiRaw) + ' ' + baseOf(state.symbol) + ' contracts'
    $('liqOI')!.textContent = cfmt(oiN)
    $('liqATR')!.textContent = '$' + pfmt(s.liq.atr)
    $('liqLongRange')!.textContent = '$' + pfmt(s.liq.lzLo) + ' — $' + pfmt(s.liq.lzHi)
    $('liqShortRange')!.textContent = '$' + pfmt(s.liq.szLo) + ' — $' + pfmt(s.liq.szHi)
    $('liqLongEst')!.textContent = 'estimated trapped-notional magnet: ' + cfmt(s.liq.leLong) + ' (' + (((s.liq.lzHi / s.mark) - 1) * 100).toFixed(2) + '% below mark)'
    $('liqShortEst')!.textContent = 'estimated trapped-notional magnet: ' + cfmt(s.liq.leShort) + ' (' + (((s.liq.szLo / s.mark) - 1) * 100).toFixed(2) + '% above mark)'
    const lB = $('liqLongBar'), sB = $('liqShortBar')
    if (lB) lB.style.width = s.liq.liqLBars + '%'
    if (sB) sB.style.width = s.liq.liqSBars + '%'
    $('liqLev')!.textContent = Math.abs(parseFloat(s.liq.srDist)) + '% below support at $' + pfmt(s.liq.sup)
  }
  if (s.vpHtml != null) $('vpList')!.innerHTML = s.vpHtml
}