// Meme coin universe + crypto bubble visualization. Faithful extraction of the
// engine's MEME COIN UNIVERSE / CRYPTO BUBBLES blocks; setSymbol/switchTab come
// from the actions hub, and the engine's init() drives the 20s/30s repaints.
import { COINS } from '../../constants/market'
import { esc, pfmt, cfmt, chgHtml, sigOf } from '../../utils/format'
import { $ } from '../../utils/dom'
import { state } from '../../services/store'
import { setSymbol, switchTab } from '../actions/userActions'

const MEME_UNIVERSE = ['PEPEUSDT', 'WIFUSDT', 'FLOKIUSDT', 'SHIBUSDT', 'BONKUSDT', 'DOGEUSDT', 'TRUMPUSDT', 'NEIROUSDT', 'BOMEUSDT', 'MEMEUSDT', 'ORDIUSDT', 'DOGSUSDT', 'HMSTRUSDT', 'ACTUSDT', 'TURBOUSDT', 'GALAUSDT', 'SANDUSDT', 'NOTUSDT', 'TONUSDT', '1000SATSUSDT']

export function renderMemeUniverse(): void {
  const rows = MEME_UNIVERSE.map(function (sym) {
    const t = state.tickers[sym]
    const base = sym.replace('USDT', '')
    if (!t) return ''
    const sg = sigOf(t.pct)
    return '<tr data-sym="' + sym + '">'
      + '<td><div class="coin-cell"><div class="coin-ci" style="color:var(--pink);border-color:rgba(255,64,129,.3)">' + base.charAt(0) + '</div><div class="coin-nm"><div class="cn">' + esc(base) + '</div><div class="cs">' + base + '/USDT</div></div></div></td>'
      + '<td>$' + pfmt(t.last) + '</td>'
      + '<td>' + chgHtml(t.pct) + '</td>'
      + '<td class="vol-dim">' + cfmt(t.qvol) + '</td>'
      + '<td><span class="badge ' + sg[1] + '">' + sg[0] + '</span></td>'
      + '<td><button class="sc-action-btn" onclick="setSymbol(\'' + sym + '\');switchTab(\'radar\')" style="font-size:10px;padding:3px 8px">Chart</button></td>'
      + '</tr>'
  }).filter(Boolean).join('')
  $('memeBody')!.innerHTML = rows
  $('memeCount')!.textContent = MEME_UNIVERSE.filter((s) => state.tickers[s]).length + ' MEME COINS'
}

const BUB_MAJORS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'UNI', 'SUI']
const BUB_MEMES = ['DOGE', 'PEPE', 'WIF', 'FLOKI', 'SHIB', 'BONK', 'TRUMP']
function bubFilterSet(): string[] | null {
  const f = state.bubFilter || 'all'
  if (f === 'major') return BUB_MAJORS
  if (f === 'meme') return BUB_MEMES
  return null
}
export function renderBubbles(): void {
  const wrap = $('bubWrap')
  if (!wrap) return
  const keys = bubFilterSet()
  const items: { k: string; sym: string; name: string; icon: string; last: number; pct: number; qvol: number }[] = []
  Object.keys(COINS).forEach(function (k) {
    if (keys && keys.indexOf(k) === -1) return
    const t = state.tickers[COINS[k].sym]
    if (!t || !isFinite(t.last) || !(t.qvol > 0)) return
    items.push({ k: k, sym: COINS[k].sym, name: COINS[k].name, icon: COINS[k].icon, last: t.last, pct: t.pct, qvol: t.qvol })
  })
  items.sort((a, b) => b.qvol - a.qvol)
  const cnt = $('bubCount')
  if (!items.length) {
    wrap.innerHTML = '<div class="bub-empty">Loading live prices…</div>'
    if (cnt) cnt.textContent = '—'
    return
  }
  const maxQ = items[0].qvol
  const minS = 46
  const maxS = 118
  const up = items.filter((i) => i.pct >= 0).length
  if (cnt) cnt.textContent = items.length + ' COINS · ' + up + ' ▲'
  wrap.innerHTML = items.map(function (it, i) {
    const size = Math.round(minS + (maxS - minS) * Math.sqrt(Math.max(0, it.qvol) / maxQ))
    const gain = it.pct >= 0
    const my = ((i * 37) % 16) - 8
    const fdur = (4.5 + ((i * 13) % 28) / 10).toFixed(1)
    const fdel = ((i * 97) % 40) / 10
    const pctTxt = (it.pct > 0 ? '+' : '') + it.pct.toFixed(2) + '%'
    const fs = Math.max(9, Math.round(size * 0.135))
    return '<div class="bub ' + (gain ? 'b-g' : 'b-r') + '" data-sym="' + it.sym + '" title="' + esc(it.name) + ' · 24h ' + pctTxt + ' · vol ' + cfmt(it.qvol) + '" style="width:' + size + 'px;height:' + size + 'px;--my:' + my + 'px;--fdur:' + fdur + 's;--fdel:' + fdel + 's">'
      + '<div class="bub-sym" style="font-size:' + fs + 'px">' + it.icon + ' ' + esc(it.k) + '</div>'
      + '<div class="bub-pct">' + pctTxt + '</div>'
      + '</div>'
  }).join('')
}
export function initBubbles(): void {
  renderBubbles()
  document.querySelectorAll<HTMLElement>('.bub-f').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.bubFilter = btn.dataset.f
      document.querySelectorAll<HTMLElement>('.bub-f').forEach((b) => b.classList.toggle('on', b === btn))
      renderBubbles()
    })
  })
  document.addEventListener('click', function (e) {
    const b = (e.target as HTMLElement).closest('.bub')
    if (!b) return
    const sym = (b as HTMLElement).dataset.sym
    if (!sym) return
    setSymbol(sym)
    switchTab('radar')
  })
}