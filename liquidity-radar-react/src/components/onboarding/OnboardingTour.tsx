// The first-visit tour: five short steps over the app, shown once and
// re-opened from Settings → Learning. Keyboard: ← → to move, Esc to close.
import { useEffect, useState } from 'react'
import { TOUR, TOUR_EVENT, markTourSeen, shouldShowTour } from '../../features/onboarding/tour'
import type { KV } from '../../features/onboarding/tour'
import { switchTab } from '../../features/actions/userActions'
import './OnboardingTour.css'

const kv: KV = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) }

export function OnboardingTour() {
  const [open, setOpen] = useState(() => shouldShowTour(kv))
  const [i, setI] = useState(0)
  useEffect(() => {
    const show = () => {
      setI(0)
      setOpen(true)
    }
    window.addEventListener(TOUR_EVENT, show)
    return () => window.removeEventListener(TOUR_EVENT, show)
  }, [])
  const close = () => {
    markTourSeen(kv)
    setOpen(false)
  }
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight') setI((x) => Math.min(TOUR.length - 1, x + 1))
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!open) return null
  const s = TOUR[i]
  const last = i === TOUR.length - 1
  return (
    <div className="ob-back" role="presentation" onClick={close}>
      <div className="ob-card" role="dialog" aria-modal="true" aria-labelledby="ob-title" onClick={(e) => e.stopPropagation()}>
        <div className="ob-top">
          <span className="ob-step">{i + 1} / {TOUR.length}</span>
          <button type="button" className="ob-x" onClick={close} aria-label="Close the tour">×</button>
        </div>
        <h3 id="ob-title">{s.title}</h3>
        <p>{s.body}</p>
        {s.tab && (
          <button type="button" className="ob-show" onClick={() => switchTab(s.tab!)}>
            {s.tabLabel ?? 'Show me'} →
          </button>
        )}
        <div className="ob-dots" aria-hidden="true">{TOUR.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}</div>
        <div className="ob-nav">
          <button type="button" className="ob-skip" onClick={close}>{last ? 'Close' : 'Skip'}</button>
          <span>
            {i > 0 && <button type="button" onClick={() => setI(i - 1)}>Back</button>}
            <button type="button" className="ob-next" onClick={() => (last ? close() : setI(i + 1))}>{last ? 'Done' : 'Next'}</button>
          </span>
        </div>
      </div>
    </div>
  )
}
