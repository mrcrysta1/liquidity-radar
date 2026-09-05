// Signal scanner + per-coin analysis. Faithful extraction of the engine's
// SIGNAL SCANNER / SIGNAL COIN ANALYSIS blocks; the classic-script globals
// (switchSigMode/onSigSearch/analyzeSigCoin) are re-exposed on window by the
// engine's exposeGlobals(), and startAutoScan drives the 2-minute scan loop.
// signalData is exported as a live binding so the engine's AI chat can keep
// reading the latest scan results without a copy.
import * as LightweightCharts from 'lightweight-charts'
import { COINS } from '../../constants/market'
import { esc, pfmt, cfmt, chgHtml } from '../../utils/format'
import { aiComposite, calcRSI, forecastFrom } from '../../utils/indicators'
import { baseOf } from '../../utils/coins'
import { $ } from '../../utils/dom'
import { jget } from '../../api/client'
import { state } from '../../services/store'
import { md, mdTf, mdVal } from '../../services/market'
import { storageGet, storageSet } from '../../services/storage'
import { chartTheme, mapCandle } from '../charts/chartRender'

type Any = any

const SIGNAL_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'SUIUSDT', 'LINKUSDT']
const TF_LIST = [
  { key: '1h', label: '1H', limit: 100, weight: 0.5 },
  { key: '1d', label: '1D', limit: 60, weight: 0.5 },
]
export let signalData: Any[] = []
const whaleFlowCache: Record<string, Any> = {}
let patternHistory: Record<string, { correct: number; total: number }> = {}
const modelWeights: Record<string, number> = {
  rsi: 25,
  macdCross: 30,
  macdTrend: 10,
  ema: 12,
  bb: 18,
  vol: 5,
  diverge: 20,
  whale: 15,
  forecast: 10,
  master: 30,
}

function loadPatternHistory(): void {
  try {
    const d = storageGet<Any>('lr-patternHist', undefined)
    if (d) patternHistory = d
  } catch (e) {
    /* ignore */
  }
}
function savePatternHistory(): void {
  try {
    storageSet('lr-patternHist', patternHistory)
  } catch (e) {
    /* ignore */
  }
}
function loadModelWeights(): void {
  try {
    const d = storageGet<Any>('lr-modelW', undefined)
    if (d) Object.keys(d).forEach((k) => { if (modelWeights[k] !== undefined) modelWeights[k] = d[k] })
  } catch (e) {
    /* ignore */
  }
}
function saveModelWeights(): void {
  try {
    storageSet('lr-modelW', modelWeights)
  } catch (e) {
    /* ignore */
  }
}

function recordPatternOutcome(key: string, wrong: number): void {
  if (!patternHistory[key]) patternHistory[key] = { correct: 0, total: 0 }
  patternHistory[key].total++
  if (!wrong) patternHistory[key].correct++
  if (patternHistory[key].total % 10 === 0) adjustWeights()
  savePatternHistory()
}

function adjustWeights(): void {
  const totalPatterns = Object.keys(patternHistory).length
  if (totalPatterns < 5) return
  Object.keys(patternHistory).forEach((k) => {
    const h = patternHistory[k]
    if (h.total < 5) return
    const hitRate = h.correct / h.total
    // map outcome keys like "master_BUY" / "rsi_15m" back to a valid model-weight key
    const wKey = k.split('_')[0]
    if (modelWeights[wKey] === undefined) return
    if (hitRate > 0.6) {
      modelWeights[wKey] = Math.min(45, (modelWeights[wKey] || 1) * 1.06)
    } else if (hitRate < 0.42) {
      modelWeights[wKey] = Math.max(5, (modelWeights[wKey] || 1) * 0.94)
    }
  })
  saveModelWeights()
}

function scoreTimeframe(candles: Any[]): Any {
  const closes = candles.map((c) => c.c)
  const vols = candles.map((c) => c.v)
  if (closes.length < 30) return null
  const a = aiComposite(candles, closes, vols)
  const fc = forecastFrom(closes)
  const last = closes[closes.length - 1]
  const reasons: string[] = []
  let score = 0
  if (a.rsi < 30) {
    reasons.push('RSI oversold (' + a.rsi.toFixed(0) + ')')
    score += modelWeights.rsi
  } else if (a.rsi > 70) {
    reasons.push('RSI overbought (' + a.rsi.toFixed(0) + ')')
    score -= modelWeights.rsi
  } else if (a.rsi < 45) {
    reasons.push('RSI bearish (' + a.rsi.toFixed(0) + ')')
    score += Math.round(modelWeights.rsi * 0.3)
  } else if (a.rsi > 55) {
    reasons.push('RSI bullish (' + a.rsi.toFixed(0) + ')')
    score -= Math.round(modelWeights.rsi * 0.3)
  }
  if (a.macd.hist > 0 && closes[closes.length - 2] < closes[closes.length - 3]) {
    reasons.push('MACD bullish cross')
    score += modelWeights.macdCross
  } else if (a.macd.hist < 0 && closes[closes.length - 2] > closes[closes.length - 3]) {
    reasons.push('MACD bearish cross')
    score -= modelWeights.macdCross
  } else if (a.macd.hist > 0) {
    reasons.push('MACD bullish')
    score += modelWeights.macdTrend
  } else {
    reasons.push('MACD bearish')
    score -= modelWeights.macdTrend
  }
  if (last > a.e20) {
    reasons.push('Above EMA20')
    score += modelWeights.ema
  } else {
    reasons.push('Below EMA20')
    score -= modelWeights.ema
  }
  if (a.bb.pctB < 10) {
    reasons.push('Lower BB touch')
    score += modelWeights.bb
  } else if (a.bb.pctB > 90) {
    reasons.push('Upper BB stretch')
    score -= modelWeights.bb
  }
  if (a.vt === 'RISING') {
    reasons.push('Volume rising')
    score += modelWeights.vol
  } else if (a.vt === 'FALLING') {
    reasons.push('Volume falling')
    score -= modelWeights.vol
  }
  const prev10 = closes.slice(-20, -10)
  const last10 = closes.slice(-10)
  if (prev10.length >= 10 && last10.length >= 10) {
    const rsi1 = calcRSI(prev10)
    const rsi2 = calcRSI(last10)
    if (rsi1 > rsi2 && last > closes[closes.length - 11]) {
      reasons.push('Bearish RSI div')
      score -= modelWeights.diverge
    } else if (rsi1 < rsi2 && last < closes[closes.length - 11]) {
      reasons.push('Bullish RSI div')
      score += modelWeights.diverge
    }
  }
  const swingH = Math.max.apply(null, closes.slice(-20))
  const swingL = Math.min.apply(null, closes.slice(-20))
  if (last > swingH * 0.995) {
    reasons.push('Near resistance $' + pfmt(swingH))
    score -= 5
  }
  if (last < swingL * 1.005) {
    reasons.push('Near support $' + pfmt(swingL))
    score += 5
  }
  score = Math.max(-100, Math.min(100, score))
  return { score: score, reasons: reasons.slice(0, 4), ai: a, fc: fc, last: last }
}

function getWhaleFlow(sym: string): Promise<Any> {
  const cached = whaleFlowCache[sym]
  if (cached && Date.now() - cached.ts < 30000) return cached
  return jget('https://api.binance.com/api/v3/trades?symbol=' + sym + '&limit=500').then(function (trades: Any) {
    let buys = 0
    let sells = 0
    let buyUsd = 0
    let sellUsd = 0
    trades.forEach((t: Any) => {
      const usd = +t.price * +t.qty
      if (usd < 1000) return
      if (t.isBuyerMaker) {
        sells++
        sellUsd += usd
      } else {
        buys++
        buyUsd += usd
      }
    })
    const imbalance = (buyUsd - sellUsd) / (buyUsd + sellUsd + 1)
    const result = { buys: buys, sells: sells, buyUsd: buyUsd, sellUsd: sellUsd, imbalance: imbalance, ts: Date.now() }
    whaleFlowCache[sym] = result
    return result
  }).catch(function () {
    return { buys: 0, sells: 0, buyUsd: 0, sellUsd: 0, imbalance: 0, ts: Date.now() }
  })
}

function forecastScore(fc: Any): number {
  if (!fc || !fc.rows) return 0
  const pred24 = fc.rows[3]
  const pred1h = fc.rows[0]
  let bias = 0
  if (pred24.dp > 1) bias += 5
  else if (pred24.dp < -1) bias -= 5
  if (pred1h.dp > 0.5) bias += 3
  else if (pred1h.dp < -0.5) bias -= 3
  if (pred24.conf > 55) bias *= 1.2
  return Math.round(Math.max(-modelWeights.forecast, Math.min(modelWeights.forecast, bias)))
}

function masterSignal(tfScores: Any[]): { score: number; type: string; breakdown: Any[] } {
  let totalWeight = 0
  let weighted = 0
  const breakdown: Any[] = []
  tfScores.forEach((ts: Any) => {
    if (!ts) return
    const w = TF_LIST.find((f) => f.key === ts.tf)!.weight
    totalWeight += w
    weighted += ts.score * w
    breakdown.push({ tf: ts.tf, score: ts.score, type: ts.score > 15 ? 'BUY' : ts.score < -15 ? 'SELL' : 'WAIT' })
  })
  if (totalWeight === 0) return { score: 0, type: 'WAIT', breakdown: breakdown }
  const base = Math.round(weighted / totalWeight)
  return { score: base, type: base > 15 ? 'BUY' : base < -15 ? 'SELL' : 'WAIT', breakdown: breakdown }
}

// Cached kline fetch for the scanner: 1H/1D candles change slowly, so
// reuse the in-memory candle cache across the 2-minute scans instead of
// firing ~20 kline requests each cycle. TTL is generous but safe for these TF.
const scanCache: Record<string, { ts: number; candles: Any[] }> = {}
function scanKlineFetch(sym: string, tfKey: string): Promise<Any[]> {
  const key = sym + '|' + tfKey
  const hit = scanCache[key]
  if (hit && Date.now() - hit.ts < 60000) return Promise.resolve(hit.candles)
  // also prefer the main chart's current candles for the active symbol
  if (md.series.symbol === sym && mdTf(md.series.tf) === tfKey && state.candles && state.candles.length > 2) {
    scanCache[key] = { ts: Date.now(), candles: state.candles.slice() }
    return Promise.resolve(scanCache[key].candles)
  }
  return jget('https://api.binance.com/api/v3/klines?symbol=' + sym + '&interval=' + tfKey + '&limit=60').then(function (data: Any) {
    const candles = data.map((k: Any) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] })).filter(mdVal.candle)
    if (candles.length) scanCache[key] = { ts: Date.now(), candles: candles }
    return candles
  })
}

export function scanSignals(): void {
  const badge = $('sigCount')
  if (badge) badge.textContent = 'SCANNING...'
  if (badge) badge.style.background = 'rgba(41,98,255,.15)'
  const promises = SIGNAL_COINS.map(function (sym) {
    const tfPromises = TF_LIST.map(function (tf) {
      return scanKlineFetch(sym, tf.key).then(function (candles) {
        return scoreTimeframe(candles)
      }).catch(function () {
        return null
      })
    })
    const whalePromise = getWhaleFlow(sym)
    return Promise.all(tfPromises.concat([whalePromise])).then(function (results) {
      const tfScores = results.slice(0, TF_LIST.length)
      const whale = results[TF_LIST.length]
      const master = masterSignal(tfScores)
      let whaleText = ''
      let whaleAdj = 0
      if (whale && whale.imbalance) {
        whaleAdj = Math.round(whale.imbalance * modelWeights.whale)
        if (whale.imbalance > 0.15) whaleText = 'Whale accumulation (buy ' + cfmt(whale.buyUsd) + ' vs sell ' + cfmt(whale.sellUsd) + ')'
        else if (whale.imbalance < -0.15) whaleText = 'Whale distribution (sell ' + cfmt(whale.sellUsd) + ' vs buy ' + cfmt(whale.buyUsd) + ')'
        else whaleText = 'Whale flow balanced (buy ' + cfmt(whale.buyUsd) + ' / sell ' + cfmt(whale.sellUsd) + ')'
      }
      // blend master with whale flow and learning-adjusted master weight
      const blend = Math.max(-100, Math.min(100, Math.round(master.score * ((modelWeights.master || 30) / 30) + whaleAdj)))
      const allReasons: string[] = []
      tfScores.forEach((ts: Any) => { if (ts && ts.reasons.length) allReasons.push(ts.reasons[0]) })
      const t = state.tickers[sym]
      let fcObj: Any = null
      const s1 = tfScores[0] ? tfScores[0].fc : null
      if (s1 && s1.rows) {
        fcObj = { rows: s1.rows, pUp: 1 / (1 + Math.exp(-blend / 45)) }
      }
      return { sym: sym, score: blend, master: master, tfScores: tfScores, whale: whale, whaleText: whaleText, t: t, fc: fcObj, reasons: allReasons.slice(0, 4) }
    }).catch(function () {
      return null
    })
  })
  Promise.all(promises).then(function (results) {
    signalData = results.filter(Boolean)
    signalData.sort(function (a, b) { return Math.abs(b.score) - Math.abs(a.score) })
    renderSignals()
    recordSignalOutcomes()
  }).catch(function (e) {
    console.warn('Signal scan failed:', e)
    if (badge) badge.textContent = 'SCAN FAILED'
    if (badge) badge.style.background = 'rgba(255,23,68,.15)'
    $('signalGrid')!.innerHTML = '<div style="text-align:center;padding:40px;color:var(--dim)"><b style="color:var(--red);font-size:14px">Scanner Error</b><br><span style="font-size:12px;margin-top:6px;display:block">Could not reach Binance API. Retrying in 2 minutes.</span></div>'
  })
}

function recordSignalOutcomes(): void {
  if (!signalData.length) return
  const prevSignals = storageGet<Any>('lr-lastSignals', {})
  let touched = 0
  signalData.forEach((s: Any) => {
    const old = prevSignals[s.sym]
    const t = state.tickers[s.sym]
    if (!old || !t) return
    const px = t.last
    if (!(old.price > 0) || !(px > 0)) return
    const moved = ((px - old.price) / old.price) * 100
    // require a meaningful move over the scan window (1H/4H horizon)
    if (Math.abs(moved) < 0.3) return
    if (old.type === 'BUY' || old.type === 'SELL') {
      const correct = (old.type === 'BUY' && moved > 0) || (old.type === 'SELL' && moved < 0)
      recordPatternOutcome('master_' + old.type, correct ? 0 : 1)
      touched++
    }
  })
  if (touched) {
    adjustWeights()
    saveModelWeights()
  }
  const current: Record<string, Any> = {}
  signalData.forEach((s: Any) => {
    const px = (s.t && s.t.last) ? s.t.last : 0
    current[s.sym] = { type: s.master.type, score: s.score, ts: Date.now(), price: px }
  })
  storageSet('lr-lastSignals', current)
}

function renderSignals(): void {
  $('sigCount')!.textContent = signalData.length + ' COINS · ' + TF_LIST.length + ' TIMEFRAMES'
  let totalHits = 0
  let totalPreds = 0
  Object.keys(patternHistory).forEach((k) => { totalHits += patternHistory[k].correct; totalPreds += patternHistory[k].total })
  const hitRate = totalPreds > 10 ? Math.round((totalHits / totalPreds) * 100) : null
  $('signalGrid')!.innerHTML = signalData.map(function (s) {
    const ms = s.master
    const type = ms.type
    const typeCls = type === 'BUY' ? 'sig-buy' : type === 'SELL' ? 'sig-sell' : 'sig-wait'
    const badgeCls = type === 'BUY' ? 'buy' : type === 'SELL' ? 'sell' : 'wait'
    const conf = Math.abs(s.score)
    const confColor = type === 'BUY' ? 'var(--green)' : type === 'SELL' ? 'var(--red)' : 'var(--amber)'
    const t = s.t
    const price = t ? '$' + pfmt(t.last) : '--'
    const chg = t ? chgHtml(t.pct) : ''
    const tfBadges = ms.breakdown.map((b: Any) => {
      const cls = b.type === 'BUY' ? 'tf-buy' : b.type === 'SELL' ? 'tf-sell' : 'tf-wait'
      return '<span class="sc-tf-badge ' + cls + '">' + b.tf + ': ' + b.type + (b.score > 0 ? '+' : '') + b.score + '</span>'
    }).join('')
    const whaleClass = s.whaleText.indexOf('accumulation') !== -1 ? 'whale-buy' : s.whaleText.indexOf('distribution') !== -1 ? 'whale-sell' : ''
    let forecastHtml = ''
    if (s.fc && s.fc.rows) {
      const r1h = s.fc.rows[0]
      const r24 = s.fc.rows[3]
      const cGreen = 'var(--green)'
      const cRed = 'var(--red)'
      const pct = function (d: Any) { return (d > 0 ? '+' : '') + (d ? d.toFixed(2) : '0.00') + '%' }
      forecastHtml = '<div class="sc-forecast">'
        + '<div>1H <b style="color:' + (r1h.dp >= 0 ? cGreen : cRed) + '">$' + pfmt(r1h.pred) + '</b> (' + pct(r1h.dp) + ')</div>'
        + '<div>24H <b style="color:' + (r24.dp >= 0 ? cGreen : cRed) + '">$' + pfmt(r24.pred) + '</b> (' + pct(r24.dp) + ')' + (s.fc.pUp != null ? (' | P(up) ' + Math.round(s.fc.pUp * 100) + '%') : '') + '</div>'
        + '</div>'
    }
    const learnHtml = hitRate ? '<div class="sc-learning">Model accuracy: ' + hitRate + '% across ' + totalPreds + ' predictions</div>' : ''
    return '<div class="signal-card ' + typeCls + '">'
      + '<div class="sc-head"><span class="sc-coin">' + baseOf(s.sym) + '/USDT ' + price + ' ' + chg + '</span><span class="sc-type ' + badgeCls + '">' + type + '</span></div>'
      + '<div class="sc-tf-row">' + tfBadges + '</div>'
      + '<div class="sc-conf"><div class="sc-conf-bar"><div class="sc-conf-fill" style="width:' + Math.min(100, conf) + '%;background:' + confColor + '"></div></div></div>'
      + '<div class="sc-reasons">' + s.reasons.map((r: string) => '&bull; ' + esc(r)).join('<br>') + '</div>'
      + (s.whaleText ? '<div class="sc-whale ' + whaleClass + '">' + esc(s.whaleText) + '</div>' : '')
      + forecastHtml
      + learnHtml
      + '<div class="sc-master"><span class="sc-master-label">Master</span><span class="sc-master-signal" style="color:' + (type === 'BUY' ? 'var(--green)' : type === 'SELL' ? 'var(--red)' : 'var(--amber)') + '">' + type + ' (' + (s.score > 0 ? '+' : '') + s.score + ')</span></div>'
      + '<div class="sc-actions"><button class="sc-action-btn" onclick="setSymbol(\'' + s.sym + '\');switchTab(\'radar\')">View Chart</button></div>'
      + '</div>'
  }).join('')
}

// ===== SIGNAL COIN ANALYSIS =====
let sigSearchTimer: Any = null
let sigAnaChart: Any = null
let sigAnaCandleSeries: Any = null

export function switchSigMode(mode: string): void {
  document.querySelectorAll<HTMLElement>('.sig-mode-tab').forEach((t) => { t.classList.toggle('active', t.dataset.sigmode === mode) })
  $('sigAutoView')!.style.display = mode === 'auto' ? '' : 'none'
  $('sigSearchView')!.style.display = mode === 'search' ? '' : 'none'
  if (mode === 'search') $('sigSearchBox')!.focus()
}

export function onSigSearch(val: string): void {
  clearTimeout(sigSearchTimer)
  sigSearchTimer = setTimeout(() => analyzeSigCoin(val), 400)
}

function resolveSigSym(input: string): string | null {
  const s = input.trim().toUpperCase()
  if (!s) return null
  if (s.endsWith('USDT')) return s
  const aliases: Record<string, string> = {
    BTC: 'BTCUSDT', ETH: 'ETHUSDT', SOL: 'SOLUSDT', BNB: 'BNBUSDT', XRP: 'XRPUSDT', DOGE: 'DOGEUSDT', ADA: 'ADAUSDT',
    AVAX: 'AVAXUSDT', DOT: 'DOTUSDT', LINK: 'LINKUSDT', UNI: 'UNIUSDT', TRUMP: 'TRUMPUSDT', PEPE: 'PEPEUSDT', WIF: 'WIFUSDT',
    FLOKI: 'FLOKIUSDT', SHIB: 'SHIBUSDT', BONK: 'BONKUSDT', SUI: 'SUIUSDT', ARB: 'ARBUSDT', OP: 'OPUSDT', NEAR: 'NEARUSDT',
    MATIC: 'MATICUSDT', ATOM: 'ATOMUSDT', LTC: 'LTCUSDT', FIL: 'FILUSDT', APT: 'APTUSDT', NEIRO: 'NEIROUSDT', TREMP: 'TREMPUSDT',
  }
  if (aliases[s]) return aliases[s]
  if (typeof COINS !== 'undefined') { const found = Object.keys(COINS).find((k) => k === s); if (found) return COINS[found]!.sym }
  return s + 'USDT'
}

export function analyzeSigCoin(input: string): void {
  const sym = resolveSigSym(input)
  if (!sym || sym === 'USDT') return
  const el = $('sigAnalysisResult')!
  el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--dim)">Analyzing ' + baseOf(sym) + '...</div>'
  const tfs = ['1h', '4h', '1d']
  const tfLabels = ['1H', '4H', '1D']
  const tfPromises: Promise<Any>[] = tfs.map(function (tf) {
    return jget('https://api.binance.com/api/v3/klines?symbol=' + sym + '&interval=' + tf + '&limit=120').then(function (data: Any) {
      const candles = data.map((k: Any) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))
      const closes = candles.map((c: Any) => c.c)
      const vols = candles.map((c: Any) => c.v)
      const a = aiComposite(candles, closes, vols)
      const fc = forecastFrom(closes)
      const sc = scoreTimeframe(candles)
      return { tf: tf, label: tfLabels[tfs.indexOf(tf)], candles: candles, closes: closes, a: a, fc: fc, sc: sc }
    }).catch(function () {
      return { tf: tf, label: tfLabels[tfs.indexOf(tf)], candles: [], closes: [], a: null, fc: null, sc: null }
    })
  })
  const newsPromise: Promise<Any> = jget('https://cryptocurrency.cv/api/news?coin=' + baseOf(sym).toLowerCase()).catch(function () {
    return { articles: [] }
  })
  const whalePromise = getWhaleFlow(sym)
  Promise.all(tfPromises.concat([newsPromise, whalePromise])).then(function (results) {
    const tfData = results.slice(0, 3)
    const newsResult = results[3]
    const whale = results[4]
    const t = state.tickers[sym]
    const lastClose = tfData[0].closes.length ? tfData[0].closes[tfData[0].closes.length - 1] : (t ? t.last : 0)
    let masterScore = 0
    let tfHtml = ''
    const reasons: string[] = []
    tfData.forEach((d: Any, i: number) => {
      if (!d.sc) {
        tfHtml += '<div class="sig-tf-card"><div class="stc-tf">' + d.label + '</div><div class="stc-signal" style="color:var(--dim)">N/A</div></div>'
        return
      }
      const sc = d.sc
      const tp = sc.score > 15 ? 'BUY' : sc.score < -15 ? 'SELL' : 'WAIT'
      const tc = tp === 'BUY' ? 'color:var(--green)' : tp === 'SELL' ? 'color:var(--red)' : 'color:var(--amber)'
      const weight = i === 0 ? 0.4 : i === 1 ? 0.35 : 0.25
      masterScore += sc.score * weight
      if (sc.reasons.length) reasons.push(sc.reasons[0])
      tfHtml += '<div class="sig-tf-card">'
        + '<div class="stc-tf">' + d.label + '</div>'
        + '<div class="stc-signal" style="' + tc + '">' + tp + '</div>'
        + '<div class="stc-score">' + (sc.score > 0 ? '+' : '') + sc.score + '</div>'
        + '<div class="stc-reason">' + sc.reasons.slice(0, 2).join(' · ') + '</div>'
        + '</div>'
    })
    masterScore = Math.round(masterScore)
    if (whale && whale.imbalance) {
      const ws = Math.round(whale.imbalance * 15)
      masterScore += ws
      if (whale.imbalance > 0.15) reasons.push('Whale accumulation')
      else if (whale.imbalance < -0.15) reasons.push('Whale distribution')
    }
    masterScore = Math.max(-100, Math.min(100, masterScore))
    const masterType = masterScore > 15 ? 'LONG' : masterScore < -15 ? 'SHORT' : 'NO TRADE'
    const vc = masterType === 'LONG' ? 'sv-bull' : masterType === 'SHORT' ? 'sv-bear' : 'sv-none'
    const chg = t ? chgHtml(t.pct) : ''
    const newsItems = (newsResult && newsResult.articles) ? newsResult.articles.slice(0, 5) : []
    const newsHtml = newsItems.map((n: Any) => {
      return '<div class="sig-news-item"><a class="snb" href="' + esc(n.link || n.url || '#') + '" target="_blank" rel="noopener" style="cursor:pointer">' + esc(n.title || '') + '</a><br><span style="color:var(--dim);font-size:11px">' + esc(n.source || '') + ' · ' + esc(n.timeAgo || n.pubDate || '') + '</span></div>'
    }).join('')
    let whaleHtml = ''
    if (whale && whale.buyUsd) {
      whaleHtml = '<div style="margin-top:14px;padding:10px;background:var(--card2);border:1px solid var(--border);border-radius:9px">'
        + '<div style="font-size:11px;font-weight:700;margin-bottom:6px">Whale Flow (Last 500 Trades)</div>'
        + '<div style="display:flex;gap:14px;font-family:var(--mono);font-size:12px">'
        + '<span style="color:var(--green)">Buy: $' + cfmt(whale.buyUsd) + '</span>'
        + '<span style="color:var(--red)">Sell: $' + cfmt(whale.sellUsd) + '</span>'
        + '<span style="color:var(--dim)">Imbalance: ' + (whale.imbalance > 0 ? '+' : '') + (whale.imbalance * 100).toFixed(1) + '%</span>'
        + '</div></div>'
    }
    const html = '<div class="sig-analysis">'
      + '<div class="sig-ana-head"><span class="sig-ana-coin">' + baseOf(sym) + '/USDT</span><span class="sig-ana-price" style="color:' + (t && t.pct >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (t ? '$' + pfmt(t.last) : '--') + ' ' + chg + '</span></div>'
      + '<div class="sig-ana-chart" id="sigAnaChartWrap"></div>'
      + '<div class="sig-tf-grid">' + tfHtml + '</div>'
      + '<div class="sig-verdict ' + vc + '"><div class="sv-label">MASTER VERDICT</div><div class="sv-type">' + masterType + ' (' + (masterScore > 0 ? '+' : '') + masterScore + ')</div><div class="sv-reason">' + reasons.slice(0, 4).join(' · ') + '</div></div>'
      + whaleHtml
      + (newsHtml ? '<div style="margin-top:14px"><div style="font-size:11px;font-weight:700;margin-bottom:6px">Related News</div><div class="sig-news-list">' + newsHtml + '</div></div>' : '')
      + '<div class="disclaimer" style="margin-top:14px">Analysis from multi-indicator confluence across multiple timeframes. Not financial advice.</div>'
      + '</div>'
    el.innerHTML = html
    setTimeout(() => renderSigAnaChart(tfData[0].candles, sym), 100)
  }).catch(function (e) {
    console.warn('Analysis failed:', e)
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--dim)"><b style="color:var(--red)">Analysis Failed</b><br><span style="font-size:12px;margin-top:6px;display:block">Could not load data for ' + baseOf(sym) + '. Check the symbol and try again.</span></div>'
  })
}

function renderSigAnaChart(candles: Any[], sym: string): void {
  const el = $('sigAnaChartWrap')
  if (!el || !(window as Any).LightweightCharts || !candles.length) return
  try {
    const th = chartTheme()
    const c = LightweightCharts.createChart(el, {
      width: el.clientWidth,
      height: 300,
      layout: { background: { type: LightweightCharts.ColorType.Solid, color: th.bg }, textStyle: { color: th.txt } } as Any,
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: th.border },
      timeScale: { timeVisible: true, secondsVisible: false },
    })
    const cs = c.addCandlestickSeries({ upColor: th.up, downColor: th.dn, borderVisible: false, wickUpColor: th.up, wickDownColor: th.dn })
    cs.setData(candles.map(mapCandle))
    c.timeScale().fitContent()
    new ResizeObserver(() => { if (el.clientWidth) c.applyOptions({ width: el.clientWidth }) }).observe(el)
    sigAnaChart = c
    sigAnaCandleSeries = cs
  } catch (e) {
    console.warn('sigAnaChart', e)
  }
}

export function applySigAnaTheme(): void {
  if (sigAnaChart) {
    const th = chartTheme()
    sigAnaChart.applyOptions({
      layout: { background: { type: 'solid', color: th.bg }, textColor: th.txt },
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      rightPriceScale: { borderColor: th.border },
      timeScale: { borderColor: th.border },
    })
    if (sigAnaCandleSeries) sigAnaCandleSeries.applyOptions({ upColor: th.up, downColor: th.dn, wickUpColor: th.up, wickDownColor: th.dn })
  }
}

// ===== AUTO-SCAN TIMER =====
let autoScanInterval: Any = null
export function startAutoScan(): void {
  loadPatternHistory()
  loadModelWeights()
  scanSignals()
  autoScanInterval = setInterval(scanSignals, 120000)
}