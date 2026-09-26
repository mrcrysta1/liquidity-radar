// Market snapshot widgets — Fear & Greed gauge, top-coin table + movers, and
// whale-watch feed. Faithful extraction of the engine's fngColor/drawGauge/
// renderFG/renderTopCoins/renderWhales blocks; the engine repaints these from
// the fetchTickers/fetchFG/fetchWhales loops.
import { COINS, HOT_LIST, CELEBS } from '../../constants/market'
import { esc, pfmt, cfmt, nfmt, timeAgo, chgHtml, sigOf } from '../../utils/format'
import { baseOf } from '../../utils/coins'
import { $ } from '../../utils/dom'
import { state } from '../../services/store'

interface FngData { value: string; classification: string }

export function fngColor(v: number | null | undefined): string {
  if (v == null) return '#8FA3BF'
  if (v < 25) return '#FF1744'
  if (v < 45) return '#FFB300'
  if (v <= 55) return '#78909C'
  return '#00E676'
}
function drawGauge(v: number): void {
  const cv = $('gauge') as HTMLCanvasElement | null
  if (!cv) return
  const dpr = window.devicePixelRatio || 1
  cv.width = 130 * dpr
  cv.height = 130 * dpr
  const x = cv.getContext('2d')!
  x.scale(dpr, dpr)
  const cx = 65
  const cy = 70
  const r = 48
  const segs: Array<[number, number, string]> = [[0, 25, '#FF1744'], [25, 45, '#FFB300'], [45, 55, '#78909C'], [55, 75, '#8BC34A'], [75, 100, '#00E676']]
  segs.forEach(function (seg) {
    const a0 = Math.PI + (seg[0] / 100) * Math.PI
    const a1 = Math.PI + (seg[1] / 100) * Math.PI
    x.beginPath()
    x.arc(cx, cy, r, a0 + 0.015, a1 - 0.015)
    x.strokeStyle = seg[2]
    x.lineWidth = 13
    x.lineCap = 'butt'
    x.shadowColor = seg[2]
    x.shadowBlur = (v >= seg[0] && v <= seg[1]) ? 10 : 0
    x.stroke()
  })
  x.shadowBlur = 0
  for (let i = 0; i <= 10; i++) {
    const ang = Math.PI + (i / 10) * Math.PI
    x.beginPath()
    x.moveTo(cx + Math.cos(ang) * (r - 11), cy + Math.sin(ang) * (r - 11))
    x.lineTo(cx + Math.cos(ang) * (r - 16), cy + Math.sin(ang) * (r - 16))
    x.strokeStyle = '#33486F'
    x.lineWidth = i % 5 === 0 ? 2 : 1
    x.stroke()
  }
  const na = Math.PI + (v / 100) * Math.PI
  x.beginPath()
  x.moveTo(cx - Math.cos(na) * 8, cy - Math.sin(na) * 8)
  x.lineTo(cx + Math.cos(na) * (r - 19), cy + Math.sin(na) * (r - 19))
  x.strokeStyle = '#FFFFFF'
  x.lineWidth = 2.5
  x.lineCap = 'round'
  x.shadowColor = '#FFFFFF'
  x.shadowBlur = 6
  x.stroke()
  x.shadowBlur = 0
  x.beginPath()
  x.arc(cx, cy, 4.5, 0, Math.PI * 2)
  x.fillStyle = '#0D1628'
  x.fill()
  x.strokeStyle = '#FFFFFF'
  x.lineWidth = 2
  x.stroke()
  x.font = '700 17px JetBrains Mono, monospace'
  x.textAlign = 'center'
  x.fillStyle = fngColor(v)
  x.fillText(String(v), cx, cy + 34)
  x.font = '600 8px Inter, sans-serif'
  x.fillStyle = '#5A6E8F'
  x.fillText('FEAR / GREED', cx, cy + 46)
}
export function renderFG(): void {
  if (!state.fg) return
  const fg = state.fg as FngData
  const v = parseInt(fg.value, 10)
  drawGauge(v)
  $('fngVal')!.textContent = String(v)
  $('fngVal')!.style.color = fngColor(v)
  $('fngClass')!.textContent = fg.classification.toUpperCase()
  $('fngClass')!.style.color = fngColor(v)
  const map: Record<string, string> = {
    'Extreme Fear': 'Capitulation zone — historically where contrarian entries print.',
    'Fear': 'Anxious tape — sellers still in control but exhaustion nears.',
    'Neutral': 'Balanced sentiment — trend and structure lead from here.',
    'Greed': 'Risk appetite building — momentum tends to extend.',
    'Extreme Greed': 'Euphoria — statistically a poor zone to chase breakouts.',
  }
  $('fngNote')!.textContent = map[fg.classification] || ''
}

/** Colored pill for 24h change, CoinMarketCap-style (filled background,
 * not just colored text) — visually distinct from the plain chgHtml() used
 * elsewhere in the app, which stays as-is since this is the one table meant
 * to read like a market-cap-site listing. */
function chgPill(p: number): string {
  const cls = p > 0.005 ? 'up' : p < -0.005 ? 'down' : 'flat'
  return '<span class="cmc-pill ' + cls + '">' + (p > 0 ? '+' : '') + p.toFixed(2) + '%</span>'
}

export function renderTopCoins(): void {
  $('coinsBody')!.innerHTML = HOT_LIST.map((k, i) => {
    const c = COINS[k]
    const t = state.tickers[c.sym]
    if (!t) return ''
    const mc = state.marketCaps[k]
    return '<tr data-sym="' + c.sym + '">'
      + '<td class="cmc-rank">' + (i + 1) + '</td>'
      + '<td><div class="coin-cell"><div class="coin-ci cmc-ci" style="color:' + c.color + ';border-color:' + c.color + '44;background:' + c.color + '14">' + c.icon + '</div><div class="coin-nm"><div class="cn">' + esc(c.name) + '</div><div class="cs">' + k + '</div></div></div></td>'
      + '<td class="cmc-price">$' + pfmt(t.last) + '</td>'
      + '<td>' + (mc && mc.chg1h != null ? chgPill(mc.chg1h) : '<span class="cmc-pill flat">—</span>') + '</td>'
      + '<td>' + chgPill(t.pct) + '</td>'
      + '<td class="vol-dim">' + (mc ? cfmt(mc.marketCap) : '—') + '</td>'
      + '<td class="vol-dim">' + (mc ? nfmt(mc.circulatingSupply) + ' ' + k : '—') + '</td>'
      + '<td class="vol-dim">' + cfmt(t.qvol) + '</td>'
      + '</tr>'
  }).join('')

  $('celebGrid')!.innerHTML = CELEBS.map((k) => {
    const c = COINS[k]
    const t = state.tickers[c.sym]
    if (!t) return ''
    const sg = sigOf(t.pct)
    return '<div class="celeb-card" data-sym="' + c.sym + '">'
      + '<div class="celeb-top"><span class="celeb-em">' + c.icon + '</span><span class="badge ' + sg[1] + '">' + sg[0] + '</span></div>'
      + '<div class="celeb-nm">' + esc(c.name) + '</div>'
      + '<div class="celeb-pr">$' + pfmt(t.last) + '</div>'
      + '<div class="celeb-mt"><span>' + chgHtml(t.pct) + '</span><span>' + cfmt(t.qvol) + '</span></div>'
      + '</div>'
  }).join('')

  const ts = HOT_LIST.map((k) => state.tickers[COINS[k].sym]).filter((t) => !!t)
  if (ts.length) {
    const vol = ts.reduce((a, t) => a + t.qvol, 0)
    const adv = ts.filter((t) => t.pct > 0).length
    const dec = ts.filter((t) => t.pct < 0).length
    $('moVol')!.textContent = cfmt(vol)
    $('moAdv')!.textContent = String(adv)
    $('moDec')!.textContent = String(dec)
    const sorted = [...ts].sort((a, b) => b.pct - a.pct)
    const top = sorted[0]
    const bot = sorted[sorted.length - 1]
    const topKey = Object.keys(COINS).find((k) => state.tickers[COINS[k].sym] === top)
    const botKey = Object.keys(COINS).find((k) => state.tickers[COINS[k].sym] === bot)
    $('moFGc')!.innerHTML = topKey ? 'leader <span style="color:var(--green)">' + topKey + ' ' + (top.pct > 0 ? '+' : '') + top.pct.toFixed(1) + '%</span> · laggard <span style="color:var(--red)">' + botKey + ' ' + bot.pct.toFixed(1) + '%</span>' : ''
  }
  if (state.fg) {
    $('moFG')!.textContent = (state.fg as FngData).value
    $('moFG')!.style.color = fngColor(parseInt((state.fg as FngData).value, 10))
  }
}

interface WhalePrint { maker?: boolean; usd: number; price: number; qty: number; time: number }
/** Filled bg pill for funding rate — same visual language as chgPill, but
 * funding's "normal" range is much tighter (±0.01%/8h), so the sign
 * thresholds are near zero rather than the 0.5% used for price moves. */
function fundingPill(rate: number): string {
  const cls = rate > 0.00005 ? 'up' : rate < -0.00005 ? 'down' : 'flat'
  return '<span class="cmc-pill ' + cls + '">' + (rate * 100).toFixed(4) + '%</span>'
}

/** Perpetual futures table — mark price, funding rate, 24h change, open
 * interest, for the same HOT_LIST set the spot table already tracks. */
export function renderFutures(): void {
  $('futuresBody')!.innerHTML = HOT_LIST.map((k, i) => {
    const c = COINS[k]
    const f = state.futures[k]
    if (!f) return ''
    return '<tr data-sym="' + c.sym + '">'
      + '<td class="cmc-rank">' + (i + 1) + '</td>'
      + '<td><div class="coin-cell"><div class="coin-ci cmc-ci" style="color:' + c.color + ';border-color:' + c.color + '44;background:' + c.color + '14">' + c.icon + '</div><div class="coin-nm"><div class="cn">' + esc(c.name) + '</div><div class="cs">' + k + '-PERP</div></div></div></td>'
      + '<td class="cmc-price">$' + pfmt(f.markPrice) + '</td>'
      + '<td>' + chgPill(f.pct) + '</td>'
      + '<td>' + fundingPill(f.fundingRate) + '</td>'
      + '<td class="vol-dim">' + (f.openInterest != null ? cfmt(f.openInterest * f.markPrice) : '—') + '</td>'
      + '<td class="vol-dim">' + cfmt(f.qvol) + '</td>'
      + '</tr>'
  }).join('')
}

export function renderWhales(): void {
  const list = state.whales as WhalePrint[]
  $('whaleCount')!.textContent = list.length + ' BLOCK TRADES · ≥ $50,000'
  if (!list.length) { $('whaleList')!.innerHTML = '<div class="fc-note">No block trades ≥ $50k in the recent tape. Quiet book.</div>'; return }
  $('whaleList')!.innerHTML = list.slice(0, 24).map((w) => {
    const buy = !w.maker
    return '<div class="whale-item">'
      + '<div class="whale-ic ' + (buy ? 'wi-buy' : 'wi-sell') + '">' + (buy ? 'B' : 'S') + '</div>'
      + '<div class="whale-info">'
      + '<div class="whale-line1">'
      + '<span class="side-tag ' + (buy ? 'side-buy' : 'side-sell') + '">' + (buy ? 'BUY' : 'SELL') + '</span>'
      + '<span class="whale-amt" style="color:' + (buy ? 'var(--green)' : 'var(--red)') + '">' + cfmt(w.usd) + '</span>'
      + '<span class="whale-sub">@ ' + pfmt(w.price) + '</span>'
      + '</div>'
      + '<div class="whale-sub">' + nfmt(w.qty) + ' ' + baseOf(state.symbol) + ' · tape print</div>'
      + '</div>'
      + '<div class="whale-time">' + timeAgo(w.time) + '</div>'
      + '</div>'
  }).join('')
}