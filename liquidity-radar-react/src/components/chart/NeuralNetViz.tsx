// A live diagram of whichever model actually exists right now - real
// layer sizes, real trained weights (line opacity), real activation values
// (neuron glow), pulled straight from the tfjs model via
// getDirectionActivations()/getRLActivations() (see model.ts / rl.ts).
// Nothing here is illustrative or hardcoded; if no model is trained yet, the
// page says so instead of drawing a placeholder network.
//
// Lives on its own tab (see Sidebar.tsx's 'neuralnet' entry and Shell.tsx's
// #tab-neuralnet section) rather than as a small panel above the chart -
// it was easy to miss up there and easy to confuse for a status banner.
import { useEffect, useState } from 'react'
import { TradeLedger } from './TradeLedger'
import type React from 'react'
import { state } from '../../services/store'
import { getMLState, onMLChange, trainForSymbol } from '../../features/ml/store'
import { getRLState, onRLChange } from '../../features/ml/rlStore'
import type { DirectionActivations } from '../../features/ml/model'
import type { RLActivations } from '../../features/ml/rl'

type Mode = 'direction' | 'rl'

interface Layer {
  label: string
  values: number[]
  normalized: number[]
}

function normalizeRelu(values: number[]): number[] {
  const max = Math.max(...values.map(Math.abs), 1e-6)
  return values.map((v) => Math.min(1, Math.abs(v) / max))
}

const VIEW_W = 680

function layout(layers: Layer[], top: number, bottom: number): { x: number; ys: number[] }[] {
  const margin = 150
  const usable = VIEW_W - margin * 2
  const gap = layers.length > 1 ? usable / (layers.length - 1) : 0
  return layers.map((l, li) => {
    const x = margin + gap * li
    const n = l.values.length
    const ys =
      n === 1
        ? [(top + bottom) / 2]
        : l.values.map((_, i) => top + ((bottom - top) * i) / (n - 1))
    return { x, ys }
  })
}

function NetSvg({ layers, weights, colors }: { layers: Layer[]; weights: number[][][]; colors: string[] }) {
  const top = 70
  const bottom = 620
  const pos = layout(layers, top, bottom)
  const r = layers.some((l) => l.values.length > 12) ? 6 : 9
  return (
    <svg width="100%" viewBox={'0 0 ' + VIEW_W + ' 660'} role="img" aria-label="Neural network activations">
      <g>
        {weights.map((wMatrix, gi) => {
          const a = pos[gi]
          const b = pos[gi + 1]
          const lines: React.JSX.Element[] = []
          for (let i = 0; i < a.ys.length; i++) {
            for (let j = 0; j < b.ys.length; j++) {
              const w = wMatrix[i]?.[j] ?? 0
              lines.push(
                <line
                  key={gi + '-' + i + '-' + j}
                  x1={a.x + r}
                  y1={a.ys[i]}
                  x2={b.x - r}
                  y2={b.ys[j]}
                  stroke={w >= 0 ? 'var(--green)' : 'var(--red)'}
                  strokeWidth={0.6}
                  opacity={Math.min(0.85, Math.abs(w) * 0.6 + 0.03)}
                  style={{ transition: 'opacity .6s ease' }}
                />,
              )
            }
          }
          return <g key={gi}>{lines}</g>
        })}
      </g>
      {layers.map((l, li) => (
        <g key={li}>
          <text className="th" x={pos[li].x} y={30} textAnchor="middle" fill="var(--txt)">
            {l.label}
          </text>
          <text className="ts" x={pos[li].x} y={48} textAnchor="middle" fill="var(--muted)">
            {l.values.length} neuron{l.values.length === 1 ? '' : 's'}
          </text>
          {l.values.map((v, i) => (
            <g key={i}>
              <circle
                cx={pos[li].x}
                cy={pos[li].ys[i]}
                r={r + l.normalized[i] * 5}
                fill={colors[li]}
                fillOpacity={0.15 + l.normalized[i] * 0.7}
                stroke={colors[li]}
                strokeWidth={0.8}
                style={{ transition: 'r .6s ease, fill-opacity .6s ease' }}
              />
              {l.values.length <= 10 && (
                <text
                  className="ts"
                  x={li === 0 ? pos[li].x - r - 10 : pos[li].x + r + 10}
                  y={pos[li].ys[i]}
                  textAnchor={li === 0 ? 'end' : 'start'}
                  dominantBaseline="central"
                  fill="var(--muted)"
                >
                  {v.toFixed(2)}
                </text>
              )}
            </g>
          ))}
        </g>
      ))}
    </svg>
  )
}

export function NeuralNetPage() {
  const [mode, setMode] = useState<Mode>('direction')
  const [dirAct, setDirAct] = useState<DirectionActivations | null>(null)
  const [rlAct, setRlAct] = useState<RLActivations | null>(null)
  const ml = getMLState()
  const rl = getRLState()
  const [busy, setBusy] = useState(false)
  const trainDirection = async () => {
    setBusy(true)
    try {
      await trainForSymbol(state.symbol, state.tf, state.candles)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const recompute = async () => {
      const m = getMLState()
      if (m.trained && m.status === 'ready') {
        const { getDirectionActivations } = await import('../../features/ml/model')
        setDirAct(getDirectionActivations(m.trained, state.candles))
      } else {
        setDirAct(null)
      }
      const r = getRLState()
      if (r.policy && r.status === 'ready') {
        const { getRLActivations } = await import('../../features/ml/rl')
        setRlAct(getRLActivations(r.policy, state.candles))
      } else {
        setRlAct(null)
      }
    }
    recompute()
    const off1 = onMLChange(recompute)
    const off2 = onRLChange(recompute)
    return () => {
      off1()
      off2()
    }
  }, [])

  const hasDirection = ml.status === 'ready' && dirAct
  const hasRL = rl.status === 'ready' && rlAct

  let layers: Layer[] = []
  let weights: number[][][] = []
  let colors: string[] = []

  if (mode === 'direction' && dirAct) {
    const hiddenNorm = normalizeRelu(dirAct.hidden)
    layers = [
      { label: 'Input', values: dirAct.input, normalized: dirAct.input.map(() => 0.5) },
      { label: 'Hidden (relu)', values: dirAct.hidden, normalized: hiddenNorm },
      { label: 'Output (sigmoid)', values: [dirAct.output], normalized: [dirAct.output] },
    ]
    weights = [dirAct.inputToHiddenWeights, dirAct.hiddenToOutputWeights.map((w) => [w])]
    colors = ['var(--cyan)', 'var(--purple)', 'var(--primary)']
  } else if (mode === 'rl' && rlAct) {
    const h1n = normalizeRelu(rlAct.hidden1)
    const h2n = normalizeRelu(rlAct.hidden2)
    const qn = normalizeRelu(rlAct.q)
    layers = [
      { label: 'Input', values: rlAct.input, normalized: rlAct.input.map(() => 0.5) },
      { label: 'Hidden 1 (relu)', values: rlAct.hidden1, normalized: h1n },
      { label: 'Hidden 2 (relu)', values: rlAct.hidden2, normalized: h2n },
      { label: 'Q-values', values: rlAct.q, normalized: qn },
    ]
    weights = [rlAct.inputToHidden1Weights, rlAct.hidden1ToHidden2Weights, rlAct.hidden2ToQWeights]
    colors = ['var(--cyan)', 'var(--purple)', 'var(--purple)', 'var(--primary)']
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="chart-tool-btn"
          aria-pressed={mode === 'direction'}
          style={mode === 'direction' ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}
          onClick={() => setMode('direction')}
        >
          Direction model
        </button>
        <button
          type="button"
          className="chart-tool-btn"
          aria-pressed={mode === 'rl'}
          style={mode === 'rl' ? { color: 'var(--primary)', borderColor: 'var(--primary)' } : undefined}
          onClick={() => setMode('rl')}
        >
          RL policy
        </button>
      </div>

      {/* Sending someone to another tab to press a button is the kind of
          friction that makes a feature feel broken. Train it from here. */}
      {mode === 'direction' && !hasDirection && (
        <div className="nn-empty">
          <span>
            {ml.status === 'training'
              ? 'Training the direction model on this market…'
              : ml.status === 'insufficient-data'
                ? 'Not enough history on this market to train a direction model.'
                : 'No direction model for this market yet.'}
          </span>
          <button
            type="button"
            className="chart-tool-btn"
            disabled={ml.status === 'training' || busy}
            onClick={() => void trainDirection()}
          >
            {ml.status === 'training' || busy ? 'Training…' : 'Train direction model'}
          </button>
        </div>
      )}
      {mode === 'rl' && !hasRL && (
        <div className="nn-empty">
          <span>
            {rl.status === 'training'
              ? 'Training the policy on this market…'
              : rl.status === 'insufficient-data'
                ? 'Not enough history on this market to train a policy.'
                : 'No RL policy for this market yet.'}
          </span>
          <span className="nn-empty-hint">Use the Train policy button in the ledger below.</span>
        </div>
      )}
      {mode === 'direction' && hasDirection && <NetSvg layers={layers} weights={weights} colors={colors} />}
      {mode === 'rl' && hasRL && <NetSvg layers={layers} weights={weights} colors={colors} />}

      <span style={{ fontSize: 11, color: 'var(--dim,var(--muted))' }}>
        Neuron glow = actual activation magnitude for the current bar. Line color = sign of the trained weight
        (green positive, red negative); line opacity = its magnitude. Recomputes whenever the model retrains,
        fine-tunes from a closed paper trade, or you switch symbol.
      </span>

      {/* The ledger belongs next to the network that produced it: the weights
          above are what these trades were taken with, and every closed trade
          below is what changed them. */}
      <TradeLedger />
    </div>
  )
}
