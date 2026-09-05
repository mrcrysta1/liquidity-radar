// Portfolio tracker. Faithful extraction of the engine's portfolio block
// (PF_KEY/loadPortfolio/savePortfolio/renderPortfolio/removePosition/
// addPosition) plus the "+ Add Position" modal opener. Reads local state at
// import time like the former inline script did.
import { COINS } from '../../constants/market'
import { esc, pfmt, cfmt, nfmt } from '../../utils/format'
import { $, showToast, openModal, closeModal } from '../../utils/dom'
import { storageGet, storageSet } from '../../services/storage'
import { state } from '../../services/store'

export interface PortfolioPosition { sym: string; qty: number; cost: number; added?: number }

const PF_KEY = 'lr_portfolio_v1'
function loadPortfolio(): PortfolioPosition[] { return storageGet<PortfolioPosition[]>(PF_KEY, []) }
function savePortfolio(p: PortfolioPosition[]): void { storageSet(PF_KEY, p) }
export function renderPortfolio(): void {
  const p = loadPortfolio()
  const rows = $('pfRows')
  if (!rows) return
  const tks = state.tickers || {}
  let total = 0
  let dayTot = 0
  let lastChg = 0
  const rowHtml = p.map((pos, i) => {
    const tk = tks[COINS[pos.sym] ? COINS[pos.sym].sym : pos.sym]
    const price = tk ? +tk.last : null
    const day = tk ? +tk.pct : 0
    const val = price != null ? price * pos.qty : null
    const cost = pos.qty * pos.cost
    const pnl = val != null ? val - cost : null
    if (val != null) total += val
    if (day && val != null) dayTot += val * day / 100
    if (pnl != null) lastChg += pnl
    return '<tr>'
      + '<td><b>' + esc(pos.sym) + '</b></td>'
      + '<td>' + nfmt(pos.qty) + '</td>'
      + '<td>$' + pfmt(pos.cost) + '</td>'
      + '<td>' + (price != null ? '$' + pfmt(price) : '—') + '</td>'
      + '<td>' + (price != null ? '<span class="' + (day >= 0 ? 'hl-g' : 'hl-r') + '">' + (day >= 0 ? '+' : '') + day.toFixed(2) + '%</span>' : '—') + '</td>'
      + '<td>' + (val != null ? '$' + cfmt(val) : '—') + '</td>'
      + '<td>' + (pnl != null ? '<span class="' + (pnl >= 0 ? 'hl-g' : 'hl-r') + '">' + (pnl >= 0 ? '+' : '') + '$' + cfmt(pnl) + '</span>' : '—') + '</td>'
      + '<td><button class="sc-action-btn" style="font-size:10px;padding:2px 7px;background:var(--red);color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="removePosition(' + i + ')">X</button></td>'
      + '</tr>'
  }).join('')
  rows.innerHTML = rowHtml || '<tr><td colspan="8" class="fc-note">No positions — click + Add Position</td></tr>'
  $('pfTotal')!.textContent = total ? '$' + cfmt(total) : '—'
  $('pfPnl')!.textContent = lastChg ? (lastChg >= 0 ? '+' : '') + '$' + cfmt(lastChg) : '—'
  $('pfPnl')!.style.color = lastChg >= 0 ? 'var(--green)' : 'var(--red)'
  $('pfDay')!.textContent = (dayTot >= 0 ? '+' : '') + '$' + cfmt(dayTot)
  $('pfDay')!.style.color = dayTot >= 0 ? 'var(--green)' : 'var(--red)'
  $('pfCount')!.textContent = String(p.length)
  $('pfEmpty')!.style.display = p.length ? 'none' : 'block'
}
export function removePosition(i: number): void {
  const p = loadPortfolio()
  p.splice(i, 1)
  savePortfolio(p)
  renderPortfolio()
  showToast('Position removed')
}
export function addPosition(sym: string, qty: string, cost: string): void {
  const s = (sym || '').trim().toUpperCase()
  const q = parseFloat(qty)
  const c = parseFloat(cost)
  if (!s || !(q > 0) || !(c > 0)) { showToast('Enter symbol, quantity and avg cost'); return }
  const p = loadPortfolio()
  const ex = p.find((x) => x.sym === s)
  if (ex) {
    const totQ = ex.qty + q
    ex.cost = ((ex.qty * ex.cost) + (q * c)) / totQ
    ex.qty = totQ
  } else { p.push({ sym: s, qty: q, cost: c, added: Date.now() }) }
  savePortfolio(p)
  renderPortfolio()
  showToast(s + ' added to portfolio')
  closeModal('pfModal')
}
$('pfAddBtn')!.addEventListener('click', () => openModal('pfModal'))