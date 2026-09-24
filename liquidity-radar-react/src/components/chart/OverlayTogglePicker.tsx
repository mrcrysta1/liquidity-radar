// Two small toggle buttons for the chart overlays this session adds: the
// Delta (CVD) pane and the Whale-print bubble markers. Kept as plain toggle
// buttons rather than a dropdown — there is nothing to configure, just on/off.
import { useEffect, useState } from 'react'
import { CvdBadge } from './CvdBadge'
import {
  getShowConfluence,
  getShowDelta,
  getShowMLPrediction,
  getShowOBGauge,
  getShowRLPolicy,
  getShowVolumeProfile,
  getShowWhaleBubbles,
  onOverlayTogglesChange,
  setShowConfluence,
  setShowDelta,
  setShowMLPrediction,
  setShowOBGauge,
  setShowRLPolicy,
  setShowVolumeProfile,
  setShowWhaleBubbles,
} from '../../features/charts/overlayToggles'

export function OverlayTogglePicker() {
  const [delta, setDelta] = useState(getShowDelta())
  const [whales, setWhales] = useState(getShowWhaleBubbles())
  const [vp, setVp] = useState(getShowVolumeProfile())
  const [mtf, setMtf] = useState(getShowConfluence())
  const [ob, setOb] = useState(getShowOBGauge())
  const [ml, setMl] = useState(getShowMLPrediction())
  const [rl, setRl] = useState(getShowRLPolicy())

  useEffect(() => {
    return onOverlayTogglesChange(() => {
      setDelta(getShowDelta())
      setWhales(getShowWhaleBubbles())
      setVp(getShowVolumeProfile())
      setMtf(getShowConfluence())
      setOb(getShowOBGauge())
      setMl(getShowMLPrediction())
      setRl(getShowRLPolicy())
    })
  }, [])

  return (
    <>
      <button
        type="button"
        className="chart-tool-btn"
        aria-pressed={delta}
        title="Toggle taker buy/sell delta (CVD) pane"
        style={delta ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}
        onClick={() => setShowDelta(!delta)}
      >
        Δ
      </button>
      <CvdBadge />
      <button
        type="button"
        className="chart-tool-btn"
        aria-pressed={whales}
        title="Toggle large-order (whale) bubbles on the chart"
        style={whales ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}
        onClick={() => setShowWhaleBubbles(!whales)}
      >
        🐋
      </button>
      <button
        type="button"
        className="chart-tool-btn"
        aria-pressed={vp}
        title="Toggle Volume Profile (POC / VAH / VAL) on the chart"
        style={vp ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}
        onClick={() => setShowVolumeProfile(!vp)}
      >
        VP
      </button>
      <button
        type="button"
        className="chart-tool-btn"
        aria-pressed={mtf}
        title="Toggle multi-timeframe confluence panel"
        style={mtf ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}
        onClick={() => setShowConfluence(!mtf)}
      >
        MTF
      </button>
      <button
        type="button"
        className="chart-tool-btn"
        aria-pressed={ob}
        title="Toggle order-book imbalance gauge"
        style={ob ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}
        onClick={() => setShowOBGauge(!ob)}
      >
        OB
      </button>
      <button
        type="button"
        className="chart-tool-btn"
        aria-pressed={ml}
        title="Toggle ML direction prediction panel"
        style={ml ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}
        onClick={() => setShowMLPrediction(!ml)}
      >
        ML
      </button>
      <button
        type="button"
        className="chart-tool-btn"
        aria-pressed={rl}
        title="Toggle RL (Q-learning) trading policy panel"
        style={rl ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}
        onClick={() => setShowRLPolicy(!rl)}
      >
        RL
      </button>
    </>
  )
}
