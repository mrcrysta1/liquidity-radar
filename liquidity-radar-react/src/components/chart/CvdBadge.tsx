// Small live readout next to the Δ toggle: running cumulative delta for the
// loaded window, plus a divergence flag when price makes a new high/low that
// CVD doesn't confirm (see detectCvdDivergence in deltaPane.ts).
import { useEffect, useState } from 'react'
import { state } from '../../services/store'
import { onDeltaChange } from '../../features/delta/delta'
import { cumulativeDelta, detectCvdDivergence } from '../../features/charts/deltaPane'
import type { CvdDivergence } from '../../features/charts/deltaPane'
import { getShowDelta, onOverlayTogglesChange } from '../../features/charts/overlayToggles'
import { nfmt } from '../../utils/format'

export function CvdBadge() {
  const [cvd, setCvd] = useState(0)
  const [div, setDiv] = useState<CvdDivergence>(null)
  const [show, setShow] = useState(getShowDelta())

  useEffect(() => onOverlayTogglesChange(() => setShow(getShowDelta())), [])

  useEffect(() => {
    if (!show) return
    const recompute = () => {
      setCvd(cumulativeDelta())
      setDiv(detectCvdDivergence(state.candles))
    }
    recompute()
    // aggTrade ticks can fire many times a second on an active market —
    // onDeltaChange fires on every one of them. Without coalescing to a
    // frame, this recomputed a 2000-bar sum and re-rendered on every single
    // tick, same class of jank the chart's own delta-pane redraw already
    // guards against (see chartRender.ts's onDeltaChange handler).
    let pending = false
    return onDeltaChange(() => {
      if (pending) return
      pending = true
      requestAnimationFrame(() => {
        pending = false
        recompute()
      })
    })
  }, [show])

  if (!show) return null
  const color = cvd > 0 ? 'var(--green)' : cvd < 0 ? 'var(--red)' : 'var(--muted)'

  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, marginLeft: 2 }}
      title="Cumulative taker buy/sell delta over the loaded window"
    >
      <span style={{ color, fontWeight: 700 }}>
        CVD {cvd >= 0 ? '+' : ''}
        {nfmt(cvd)}
      </span>
      {div && (
        <span
          style={{
            color: div === 'bullish' ? 'var(--green)' : 'var(--red)',
            border: '1px solid currentColor',
            borderRadius: 4,
            padding: '0 4px',
          }}
          title={
            div === 'bullish'
              ? 'Price made a new low without CVD confirming — selling pressure may be exhausting.'
              : 'Price made a new high without CVD confirming — buying pressure may be exhausting.'
          }
        >
          {div === 'bullish' ? '↗ div' : '↘ div'}
        </span>
      )}
    </span>
  )
}
