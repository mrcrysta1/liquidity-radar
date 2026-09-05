// Price-alert engine. Faithful extraction of the engine's alerts block
// (AL_KEY/loadAlerts/saveAlerts/notifState/renderAlerts/notify/enableAlerts/
// addAlert/removeAlert/checkAlerts) plus the alert button opener. The engine
// polls checkAlerts() from the ticker loop and renders inline delete rows.
import { esc, pfmt } from '../../utils/format'
import { $, showToast, openModal, closeModal } from '../../utils/dom'
import { storageGet, storageSet } from '../../services/storage'
import { state } from '../../services/store'

export interface AlertItem {
  sym: string
  dir: 'above' | 'below' | string
  price: number
  fired?: boolean
  created?: number
}

const AL_KEY = 'lr_alerts_v1'
let notifOk = false
function loadAlerts(): AlertItem[] { return storageGet<AlertItem[]>(AL_KEY, []) }
function saveAlerts(a: AlertItem[]): void { storageSet(AL_KEY, a) }
function notifState(): HTMLElement | null { return $('alPermState') }
export function renderAlerts(): void {
  const list = $('alList')
  if (!list) return
  const a = loadAlerts()
  list.innerHTML = a.length ? a.map((al, i) => {
    const dirTxt = al.dir === 'above' ? 'ABOVE' : 'BELOW'
    const p = state.tickers && state.tickers[al.sym] ? +state.tickers[al.sym].last : null
    return '<div class="al-item"><div style="flex:1"><b>' + esc(al.sym) + '</b> ' + dirTxt + ' <span class="al-tgt">$' + pfmt(al.price) + '</span>' + (p != null ? ' <span class="al-cur">· now $' + pfmt(p) + '</span>' : '') + '</div><button class="sc-action-btn" style="font-size:10px;padding:2px 7px;background:var(--red);color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="removeAlert(' + i + ')">X</button></div>'
  }).join('') : '<div class="fc-note">No alerts set.</div>'
  const ok = 'Notification' in window && Notification.permission === 'granted'
  notifOk = ok
  const st = notifOk ? 'on' : 'off'
  notifState()!.textContent = st
  notifState()!.style.color = notifOk ? 'var(--green)' : 'var(--dim)'
}
function notify(title: string, body: string): void {
  try {
    if (notifOk && window.Notification && Notification.permission === 'granted') {
      new Notification(title, { body: body, tag: 'lr-alert' })
    }
    showToast(title + ' — ' + body)
  } catch (e) {
    /* ignore */
  }
}
export function enableAlerts(): void {
  if (!('Notification' in window)) { showToast('Desktop notifications not supported in this browser'); return }
  Notification.requestPermission().then(function (p) {
    if (p === 'granted') { notifOk = true; renderAlerts(); showToast('Desktop notifications enabled') }
    else { showToast('Notifications blocked by browser') }
  })
}
export function addAlert(sym: string, dir: string, price: string): void {
  const s = (sym || '').trim().toUpperCase()
  const pr = parseFloat(price)
  if (!s || !(pr > 0)) { showToast('Enter symbol and alert price'); return }
  const a = loadAlerts()
  a.push({ sym: s, dir: dir || 'above', price: pr, fired: false, created: Date.now() })
  saveAlerts(a)
  renderAlerts()
  showToast('Alert set for ' + s + ' ' + dir + ' $' + pfmt(pr))
  closeModal('alModal')
}
export function removeAlert(i: number): void {
  const a = loadAlerts()
  a.splice(i, 1)
  saveAlerts(a)
  renderAlerts()
  showToast('Alert removed')
}
export function checkAlerts(): void {
  const a = loadAlerts()
  if (!a.length) return
  const tks = state.tickers || {}
  let changed = false
  a.forEach((al) => {
    const tk = tks[al.sym]
    if (!tk) return
    const p = +tk.last
    const hit = al.dir === 'above' ? (p >= al.price) : (p <= al.price)
    if (hit && !al.fired) {
      al.fired = true
      notify(al.sym + ' Alert', (al.dir === 'above' ? 'Price crossed ABOVE' : 'Price crossed BELOW') + ' $' + pfmt(al.price) + ' — now $' + pfmt(p))
      changed = true
    }
  })
  if (changed) { saveAlerts(a); renderAlerts() }
}
$('alertBtn')!.addEventListener('click', () => { renderAlerts(); openModal('alModal') })