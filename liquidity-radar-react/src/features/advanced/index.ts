// Advanced (Pro-adopted) Radar panels: Liquidity Score, Futures positioning,
// Market structure, Cross-exchange radar and the live liquidation feed.
// Pure engines live in ./liquidityScore, ./structure, ./priceOI; data in
// ./advancedData and ./liquidations. This module only orchestrates + renders
// into the Radar tab DOM (the app's established pattern).
import { $ } from '../../utils/dom'
import { calcATR, calcRSI } from '../../utils/indicators'
import { state } from '../../services/store'
import { bookMetrics, fmt, liquidityScore } from './liquidityScore'
import { swings, structureEvents, type Candle } from './structure'
import { classifyPriceOI, type PriceOI } from './priceOI'
import {
  fetchCrossExchange,
  fetchDeepOB,
  fetchLongShort,
  fetchOIHist,
  type CrossExRow,
  type DeepOb,
  type LongShortRow,
  type OiPoint,
} from './advancedData'
import { initLiquidations, type Liq } from './liquidations'

interface FrLike {
  markPrice?: string
  indexPrice?: string
  lastFundingRate?: string
  nextFundingTime?: number
}
interface OiLike {
  openInterest?: string
}

function setTxt(id: string, text: string): void {
  const el = $(id)
  if (el) el.textContent = text
}

function toCandle(c: { t?: number; time?: number; o?: number; open?: number; h?: number; high?: number; l?: number; low?: number; c?: number; close?: number; v?: number; volume?: number }): Candle {
  return {
    time: (c.t ?? c.time) as number,
    open: (c.o ?? c.open) as number,
    high: (c.h ?? c.high) as number,
    low: (c.l ?? c.low) as number,
    close: (c.c ?? c.close) as number,
    volume: (c.v ?? c.volume) as number,
  }
}

export function renderLiquidityScore(): void {
  const val = $('advLiqVal')
  const comps = $('advLiqComps')
  const dial = $('advLiqDial')
  if (!val || !comps) return
  const book = state.deepOb as DeepOb | null
  const tk = state.tickers[state.symbol] as { qvol?: number } | undefined
  if (!book || !book.bids.length || !book.asks.length || !tk) {
    val.textContent = '—'
    comps.innerHTML = '<div class="fc-note">Waiting for deep order book…</div>'
    return
  }
  const m = bookMetrics(book)
  const s = liquidityScore(m, tk.qvol || 0)
  val.textContent = String(s.value)
  if (dial) dial.style.setProperty('--v', String(s.value))
  comps.innerHTML = s.components
    .map(
      (c) =>
        '<div class="adv-comp"><div class="adv-comp-top"><span>' +
        c.label +
        ' <span class="muted">×' +
        c.weight +
        '</span></span><span>' +
        Math.round(c.score) +
        '</span></div><div class="adv-bar"><i style="width:' +
        c.score.toFixed(1) +
        '%"></i></div><small>' +
        c.reason +
        '</small></div>',
    )
    .join('')
}

export function renderFutures(): void {
  const fr = state.fr as FrLike | null
  const oi = state.oi as OiLike | null
  const oiH = state.oiHist as OiPoint[] | null
  const ls = state.ls as LongShortRow[] | null
  const candles = state.candles.map(toCandle)
  const last = candles.length ? candles[candles.length - 1].close : undefined
  const rate = fr?.lastFundingRate != null ? +fr.lastFundingRate : undefined
  const mark = fr?.markPrice != null ? +fr.markPrice : last
  const index = fr?.indexPrice != null ? +fr.indexPrice : undefined
  const annual = rate != null ? rate * 3 * 365 * 100 : undefined
  const oiVal = oi?.openInterest != null ? +oi.openInterest : undefined
  const lsLast = ls && ls.length ? ls[ls.length - 1] : undefined

  let regime: PriceOI | undefined
  if (oiH && oiH.length >= 5 && candles.length >= 5) {
    const n = oiH.length
    const oiChg =
      ((oiH[n - 1].openInterest - oiH[n - 5].openInterest) / oiH[n - 5].openInterest) * 100
    const t4 = oiH[n - 5].ts
    const k0 = candles.find((x) => x.time >= t4) ?? candles[Math.max(0, candles.length - 17)]
    const priceChg = ((candles[candles.length - 1].close - k0.close) / k0.close) * 100
    regime = classifyPriceOI(priceChg, oiChg)
  }

  const mins = fr?.nextFundingTime
    ? Math.max(0, Math.round((fr.nextFundingTime - Date.now()) / 60000))
    : undefined

  setTxt('advFunding', rate != null ? (rate * 100).toFixed(4) + '%' : '—')
  setTxt(
    'advFundingSub',
    annual != null ? annual.toFixed(1) + '% annualised · next in ' + mins + 'm' : '',
  )
  const frEl = $('advFunding')
  if (frEl) frEl.style.color = rate == null ? '' : rate > 0 ? 'var(--red)' : rate < 0 ? 'var(--green)' : 'var(--txt)'
  setTxt('advOI', oiVal != null ? fmt(oiVal) : '—')
  setTxt('advOISub', oiVal != null ? state.symbol.replace(/USDT$/i, '') + ' contracts' : '')
  setTxt('advLS', lsLast ? lsLast.ratio.toFixed(2) : '—')
  setTxt(
    'advLSSub',
    lsLast
      ? (lsLast.longAccount * 100).toFixed(0) +
          '% long · ' +
          (lsLast.shortAccount * 100).toFixed(0) +
          '% short'
      : '',
  )
  setTxt('advMark', mark != null ? mark.toLocaleString() : '—')
  setTxt('advIndex', index != null ? index.toLocaleString() : '—')
  setTxt(
    'advBasis',
    mark != null && index ? (((mark - index) / index) * 1e4).toFixed(2) + ' bps' : '—',
  )
  setTxt('advOIchg', regime ? (regime.oiChg > 0 ? '+' : '') + regime.oiChg.toFixed(2) + '%' : '—')
  setTxt('advPriceChg', regime ? (regime.priceChg > 0 ? '+' : '') + regime.priceChg.toFixed(2) + '%' : '—')
  const oc = $('advOIchg')
  if (oc) oc.className = regime ? (regime.oiChg > 0 ? 'up' : 'down') : ''
  const pc = $('advPriceChg')
  if (pc) pc.className = regime ? (regime.priceChg > 0 ? 'up' : 'down') : ''
  const reg = $('advRegime')
  if (reg) {
    if (regime && regime.regime !== 'FLAT') {
      reg.style.display = 'block'
      reg.innerHTML = '<b>' + regime.title + '</b>' + regime.meaning
    } else {
      reg.style.display = 'none'
    }
  }
}

export function renderStructure(): void {
  const events = $('advStEvents')
  if (!events) return
  const c = state.candles.map(toCandle)
  if (c.length < 30) {
    setTxt('advStSeq', '—')
    events.innerHTML = '<span class="muted">Needs ≥30 candles.</span>'
    return
  }
  const sw = swings(c)
  const ev = structureEvents(c, sw)
  const close = c.map((x) => x.close)
  const r = calcRSI(close, 14)
  const a = calcATR(state.candles as never, 14) as number
  const lastH = [...sw].reverse().find((s) => s.type === 'high')
  const lastL = [...sw].reverse().find((s) => s.type === 'low')
  const seq = sw.slice(-6).map((s) => s.label ?? (s.type === 'high' ? 'H' : 'L'))
  const last = close[close.length - 1]
  setTxt('advStSeq', seq.length ? seq.join(' → ') : '—')
  setTxt(
    'advStRes',
    lastH
      ? lastH.price.toLocaleString() + '  (+' + (((lastH.price - last) / last) * 100).toFixed(2) + '%)'
      : '—',
  )
  setTxt(
    'advStSup',
    lastL
      ? lastL.price.toLocaleString() + '  (' + (((lastL.price - last) / last) * 100).toFixed(2) + '%)'
      : '—',
  )
  setTxt('advStRsi', r.toFixed(1))
  const rsiEl = $('advStRsi')
  if (rsiEl) rsiEl.style.color = r > 70 ? 'var(--red)' : r < 30 ? 'var(--green)' : ''
  setTxt('advStAtr', a.toFixed(4) + '  (' + ((a / last) * 100).toFixed(2) + '%)')
  const recent = ev.slice(-5).reverse()
  events.innerHTML = recent.length
    ? recent
        .map(
          (e) =>
            '<div class="adv-ev"><span class="' +
            (e.direction === 'bull' ? 'up' : 'down') +
            '">' +
            e.type +
            ' ' +
            e.direction +
            '</span> through ' +
            e.price.toLocaleString() +
            ' <span class="muted">bar ' +
            e.index +
            '</span></div>',
        )
        .join('')
    : '<span class="muted">none</span>'
}

export function renderCrossExchange(): void {
  const body = $('advXexBody')
  const foot = $('advXexFoot')
  const badge = $('advXexBadge')
  if (!body) return
  const rows = (state.crossEx as CrossExRow[]) || []
  if (badge) badge.textContent = state.symbol
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="muted">Loading venues…</td></tr>'
    return
  }
  const prices = rows.map((r) => r.last).filter((x): x is number => !!x)
  const lo = prices.length ? Math.min(...prices) : 0
  const hi = prices.length ? Math.max(...prices) : 0
  const gapBps = prices.length > 1 ? ((hi - lo) / lo) * 1e4 : 0
  const fr = rows.map((r) => r.funding).filter((x): x is number => x != null)
  const fSpread = fr.length > 1 ? (Math.max(...fr) - Math.min(...fr)) * 100 : 0
  body.innerHTML = rows
    .map(
      (r) =>
        '<tr class="row-hover"><td>' +
        r.id +
        '</td><td class="' +
        (r.last === hi ? 'up' : r.last === lo ? 'down' : '') +
        '">' +
        (r.last != null ? r.last.toLocaleString() : '—') +
        '</td><td>' +
        (r.vol ? '$' + fmt(r.vol) : '—') +
        '</td><td>' +
        (r.spread != null ? r.spread.toFixed(2) + ' bps' : '—') +
        '</td><td style="color:' +
        (r.funding != null ? (r.funding > 0 ? 'var(--red)' : 'var(--green)') : 'inherit') +
        '">' +
        (r.funding != null ? (r.funding * 100).toFixed(4) + '%' : '—') +
        '</td></tr>',
    )
    .join('')
  if (foot)
    foot.innerHTML =
      'Price gap across venues: <b>' +
      gapBps.toFixed(2) +
      ' bps</b> · funding dispersion: <b>' +
      fSpread.toFixed(4) +
      '%</b>' +
      (gapBps > 10
        ? ' · <span class="up">discrepancy signal</span> — check fees and withdrawal status before acting.'
        : '')
}

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
  renderLiquidityScore()
  renderFutures()
  renderStructure()
  renderCrossExchange()
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
  setInterval(fetchDeepOB, 3_000)
  setInterval(fetchOIHist, 60_000)
  setInterval(fetchLongShort, 60_000)
  setInterval(fetchCrossExchange, 15_000)
  setInterval(renderAdvanced, 2_000)
  setInterval(renderLiquidations, 1_000)
  setInterval(() => {
    if (state.symbol !== lastSym) {
      lastSym = state.symbol
      advancedSymbolChanged()
    }
  }, 1_000)
}
