// Global keyboard shortcuts. Faithful extraction of the engine's keydown
// handler + SHORTCUT_TABS: Escape (exit fullscreen, close modals), / (focus
// search), ? (shortcut cheat-sheet), F (fullscreen) and one-key tab
// switching. Registered by the engine during init().
import { resizeChart } from '../charts/chartRender'
import { $, showToast } from '../../utils/dom'
import { switchTab } from '../actions/userActions'

export const SHORTCUT_TABS: Record<string, string> = {
  r: 'radar',
  c: 'multichart',
  s: 'signals',
  m: 'market',
  b: 'bubbles',
  a: 'analysis',
  n: 'news',
  p: 'portfolio',
  t: 'chat',
}

export function initKeyboard(): void {
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (document.documentElement.classList.contains('radar-fs')) {
        document.documentElement.classList.remove('radar-fs')
        const b = $('fsBtn')
        if (b) { b.textContent = '⛶'; b.title = 'Full screen [F]' }
        resizeChart()
      }
      const modals = document.querySelectorAll('.modal-overlay.open')
      modals.forEach((m) => m.classList.remove('open'))
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
    if (e.key === '/') {
      e.preventDefault()
      const cs = $('coinSearch') as HTMLInputElement | null
      if (cs) { cs.focus(); cs.select() }
      return
    }
    if (e.key === '?') {
      e.preventDefault()
      const hints = ['R Radar','C Charts','S Signals','M Market','B Bubbles','A Analysis','N News','P Portfolio','T Chat','F Fullscreen','/ Search','Esc Close']
      showToast('Shortcuts: ' + hints.join('   '))
      return
    }
    if (e.key === 'f' || e.key === 'F') {
      $('fsBtn')!.click()
      return
    }
    const k = e.key.toLowerCase()
    if (SHORTCUT_TABS[k]) switchTab(SHORTCUT_TABS[k])
  })
}