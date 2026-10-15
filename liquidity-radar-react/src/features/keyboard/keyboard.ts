// Global keyboard shortcuts. Faithful extraction of the engine's keydown
// handler + SHORTCUT_TABS: Escape (exit fullscreen, close modals), / (focus
// search), ? (shortcut cheat-sheet), F (fullscreen) and one-key tab
// switching. Registered by the engine during init().
import { isFullScreen, setFullScreen } from '../charts/chartRender'
import { resetChartView } from '../charts/scaleNav'
import { $, showToast } from '../../utils/dom'
import { switchTab } from '../actions/userActions'
import { toggleDock } from '../chat/dock'

export const SHORTCUT_TABS: Record<string, string> = {
  h: 'home',
  r: 'radar',
  c: 'multichart',
  s: 'signals',
  m: 'market',
  b: 'bubbles',
  a: 'analysis',
  n: 'news',
}

export function initKeyboard(): void {
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (isFullScreen()) setFullScreen(false)
      const modals = document.querySelectorAll('.modal-overlay.open')
      modals.forEach((m) => m.classList.remove('open'))
      return
    }
    const t = e.target as HTMLElement | null
    const typing =
      !!t &&
      (t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable)
    // Alt+R resets the chart view, as on TradingView. e.code, not e.key: on a
    // Mac Option+R types "®". Only where the price-action chart is showing.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyR') {
      if (typing || !document.querySelector('.tab-section.active .chart-host #radarChartCard'))
        return
      e.preventDefault()
      resetChartView()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (typing) return
    if (e.key === '/') {
      e.preventDefault()
      const cs = $('coinSearch') as HTMLInputElement | null
      if (cs) {
        cs.focus()
        cs.select()
      } else {
        // The search lives behind the header button (components/search/HeaderSearch).
        window.dispatchEvent(new Event('lr:open-search'))
      }
      return
    }
    if (e.key === '?') {
      e.preventDefault()
      const hints = [
        'H Dashboard',
        'R Radar',
        'C Charts',
        'S Signals',
        'M Market',
        'B Bubbles',
        'A Analysis',
        'N News',
        'T Radar AI',
        'F Fullscreen',
        'Alt+R Reset chart',
        '/ Search',
        'Esc Close',
      ]
      showToast('Shortcuts: ' + hints.join('   '))
      return
    }
    if (e.key === 'f' || e.key === 'F') {
      // Full screen only makes sense where the price-action chart is showing —
      // the Radar and Charts tabs both host it.
      const host = document.querySelector('.tab-section.active .chart-host #radarChartCard')
      if (host) $('fsBtn')?.click()
      return
    }
    const k = e.key.toLowerCase()
    // The assistant is a dock now, not a tab — same key, different verb.
    if (k === 't') {
      toggleDock()
      return
    }
    if (SHORTCUT_TABS[k]) switchTab(SHORTCUT_TABS[k])
  })
}
