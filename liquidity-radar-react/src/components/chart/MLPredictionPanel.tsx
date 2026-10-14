// Shows the in-browser-trained direction model's live read, with its own
// walk-forward backtest accuracy front and center — the number that says
// whether this particular symbol/timeframe is one the model actually reads
// better than a coin flip, not a borrowed "AI" confidence score.
import { useEffect, useState } from 'react'
import { getMLState, onMLChange } from '../../features/ml/store'
import { state } from '../../services/store'
import { trainForSymbol } from '../../features/ml/store'
import {
  getShowMLPrediction,
  onOverlayTogglesChange,
  setShowMLPrediction,
} from '../../features/charts/overlayToggles'
import { provenEdge } from '../../features/ml/edge'

export function MLPredictionPanel() {
  const [ml, setMl] = useState(getMLState())
  const [show, setShow] = useState(getShowMLPrediction())

  useEffect(() => {
    const off1 = onMLChange(() => setMl(getMLState()))
    const off2 = onOverlayTogglesChange(() => setShow(getShowMLPrediction()))
    return () => {
      off1()
      off2()
    }
  }, [])

  if (!show) return null

  const acc = ml.trained ? ml.trained.backtestAccuracy : null
  // Judged against always guessing the holdout's common direction, and only
  // the lead chance would not explain counts (ml/edge.ts).
  const base = ml.trained ? ml.trained.baselineAccuracy : 0.5
  const edge = acc == null || !ml.trained ? null : provenEdge(acc, base, ml.trained.backtestN)
  const accColor = edge == null ? 'var(--muted)' : edge > 0.05 ? 'var(--green)' : edge > 0 ? 'var(--amber,#ffc107)' : 'var(--red)'
  const basePct = (base * 100).toFixed(0) + '%'
  const trustNote =
    edge == null
      ? ''
      : edge > 0.05
        ? 'Beats always guessing (' + basePct + ') by more than chance on its own recent history.'
        : edge > 0
          ? 'Only a slight edge over always guessing (' + basePct + ') — a weak lean, not a signal.'
          : 'No real edge: always guessing the common direction scores ' + basePct + ' here.'

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="sec-title" style={{ fontSize: 12 }}>
          ML Direction Model
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
          {ml.status === 'training'
            ? 'training…'
            : ml.status === 'insufficient-data'
              ? 'not enough history to train'
              : ml.status === 'error'
                ? 'training failed'
                : ''}
        </span>
        <button
          type="button"
          className="chart-tool-btn"
          style={{ marginLeft: 'auto' }}
          disabled={ml.status === 'training'}
          onClick={() => trainForSymbol(state.symbol, state.tf, state.candles)}
          title="Retrain on the latest candles"
        >
          Retrain
        </button>
        <button type="button" className="chart-tool-btn" title="Hide" onClick={() => setShowMLPrediction(false)}>
          ✕
        </button>
      </div>

      {ml.status === 'ready' && ml.prediction && ml.trained && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
              Next {ml.trained.horizon} candles ({ml.trained.tf})
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: ml.prediction.direction === 'up' ? 'var(--green)' : 'var(--red)',
              }}
            >
              {ml.prediction.direction === 'up' ? '▲ UP' : '▼ DOWN'} · {(ml.prediction.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)' }}>
              Backtest accuracy ({ml.trained.backtestN} holdout samples)
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: accColor }}>
              {acc != null ? (acc * 100).toFixed(1) + '%' : '—'}
            </span>
          </div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted)', maxWidth: 260 }}>{trustNote}</span>
        </div>
      )}

      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--dim,var(--muted))' }}>
        Trained live in your browser on this symbol's own recent candles — not financial advice, and not a
        guarantee it beats a coin flip. Check the backtest number before trusting the direction above.
      </span>
    </div>
  )
}
