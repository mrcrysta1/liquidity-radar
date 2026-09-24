// Meme coin universe table (a separate feature from the physics-based
// Bubbles tab, which now lives in components/BubblesCanvas.tsx).
import { esc, pfmt, cfmt, chgHtml, sigOf } from '../../utils/format'
import { $ } from '../../utils/dom'
import { state } from '../../services/store'

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