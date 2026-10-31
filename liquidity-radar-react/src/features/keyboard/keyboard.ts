// Global keyboard shortcuts: Escape (exit fullscreen, close modals), / (focus
// search), ? (shortcut sheet), F (fullscreen), one-key tab switching, and the
// chart's TradingView keys (Alt+letter tools, Ctrl+Z/Y, Ctrl+S, Alt+R, replay
// stepping). Registered by the engine during init().
import { isFullScreen, setFullScreen } from '../charts/chartRender'
import { resetChartView } from '../charts/scaleNav'
import { $, showToast } from '../../utils/dom'
import { switchTab } from '../actions/userActions'
import { toggleDock } from '../chat/dock'
import { redoDrawing, setDrawTool, undoDrawing } from '../charts/drawTools'
import { isReplayOn, step as stepReplay } from '../charts/replay'
import { saveCurrentLayout } from '../charts/savedLayouts'
import { state } from '../../services/store'
import { baseOf } from '../../utils/coins'

/** TradingView's Alt+letter drawing shortcuts (e.code, so a Mac's Option works). */
const DRAW_KEYS: Record<string, string> = {
  KeyH: 'hline',
  KeyV: 'vline',
  KeyT: 'trend',
  KeyF: 'fibretr',
}

/** Every shortcut, for the "?" sheet. */
const SHORTCUTS: Array<[string, Array<[string, string]>]> = [
  [
    'Chart',
    [
      ['Ctrl+Z', 'Undo drawing change'],
      ['Ctrl+Y', 'Redo'],
      ['Alt+T', 'Trend line'],
      ['Alt+H', 'Horizontal line'],
      ['Alt+V', 'Vertical line'],
      ['Alt+F', 'Fib retracement'],
      ['Alt+R', 'Reset chart view'],
      ['Shift+→ / ←', 'Step bar replay'],
      ['Ctrl+S', 'Save layout'],
      ['F', 'Full screen'],
      ['Esc', 'Cancel / close'],
    ],
  ],
  [
    'App',
    [
      ['H', 'Dashboard'],
      ['R', 'Radar'],
      ['C', 'Charts'],
      ['S', 'Signals'],
      ['M', 'Market'],
      ['B', 'Bubbles'],
      ['A', 'Analysis'],
      ['N', 'News'],
      ['T', 'Radar AI'],
      ['/', 'Search'],
      ['?', 'This list'],
    ],
  ],
]

/** The shortcut sheet: a real dialog rather than a toast that ran off screen. */
function showShortcuts(): void {
  let dlg = document.getElementById('kbdDialog') as HTMLDialogElement | null
  if (!dlg) {
    dlg = document.createElement('dialog')
    dlg.id = 'kbdDialog'
    dlg.className = 'kbd-dialog'
    dlg.setAttribute('aria-label', 'Keyboard shortcuts')
    const mod = /Mac|iP(hone|ad)/.test(navigator.platform)
    const key = (k: string) => (mod ? k.replace('Ctrl+', '⌘').replace('Alt+', '⌥') : k)
    dlg.innerHTML =
      '<header><b>Keyboard shortcuts</b><button type="button" aria-label="Close">×</button></header>' +
      SHORTCUTS.map(
        ([group, rows]) =>
          '<section><h4>' +
          group +
          '</h4><dl>' +
          rows.map(([k, what]) => '<dt><kbd>' + key(k) + '</kbd></dt><dd>' + what + '</dd>').join('') +
          '</dl></section>',
      ).join('')
    dlg.querySelector('button')!.addEventListener('click', () => dlg!.close())
    // A click on the backdrop (outside the box) closes it too.
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg!.close()
    })
    document.body.appendChild(dlg)
  }
  if (!dlg.open) dlg.showModal()
}

/** The price-action chart is on screen (Radar or Charts tab). */
const chartShowing = (): boolean =>
  !!document.querySelector('.tab-section.active .chart-host #radarChartCard')

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
    // Drawing tools, Alt+letter as on TradingView.
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && DRAW_KEYS[e.code]) {
      if (typing || !chartShowing()) return
      e.preventDefault()
      setDrawTool(DRAW_KEYS[e.code])
      return
    }
    // Undo / redo drawing changes; Ctrl+S saves the layout.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing && chartShowing()) {
      const k = e.key.toLowerCase()
      if (k === 'z' || k === 'y') {
        e.preventDefault()
        if (k === 'y' || e.shiftKey) redoDrawing()
        else undoDrawing()
        return
      }
      if (k === 's' && !e.shiftKey) {
        e.preventDefault()
        const name = baseOf(state.symbol) + ' ' + state.tf
        const r = saveCurrentLayout(name)
        showToast(r.error ? r.error : 'Layout saved as "' + name + '"')
        return
      }
    }
    // Shift+arrows step bar replay one bar.
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !typing && isReplayOn()) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        stepReplay(e.key === 'ArrowRight' ? 1 : -1)
        return
      }
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
      showShortcuts()
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
    // A key pressed while working the chart (focus on one of its controls)
    // must not throw the user onto another page.
    if (document.activeElement?.closest('#radarChartCard')) return
    if (SHORTCUT_TABS[k]) switchTab(SHORTCUT_TABS[k])
  })
}
