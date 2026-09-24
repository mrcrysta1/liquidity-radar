// Orchestrates the direction model: trains it for the active symbol +
// timeframe, holds the one live model, and disposes the previous one before
// replacing it — a tf.LayersModel is GPU/WASM-backed memory that a garbage
// collector won't reclaim on its own.
//
// model.ts (and the multi-hundred-KB TensorFlow.js it pulls in) is imported
// dynamically, not statically, even though this store itself is reached from
// the eager bundle (via userActions.ts, for the resetML() call on every
// symbol switch) — a static import here would drag tfjs into the initial
// page load for every visitor, whether or not they ever open the ML panel.
import type { CandleFlat } from '../../services/market'
import type { Prediction, TrainedModel } from './model'

export type MLStatus = 'idle' | 'training' | 'ready' | 'insufficient-data' | 'error'

interface MLState {
  status: MLStatus
  trained: TrainedModel | null
  prediction: Prediction | null
  symbol: string
  tf: string
  error?: string
}

let state: MLState = { status: 'idle', trained: null, prediction: null, symbol: '', tf: '' }

type Listener = () => void
const listeners: Listener[] = []
function emit(): void {
  listeners.slice().forEach((fn) => fn())
}
export function onMLChange(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}

export function getMLState(): MLState {
  return state
}

let trainToken = 0

export async function trainForSymbol(symbol: string, tf: string, candles: CandleFlat[]): Promise<void> {
  const token = ++trainToken
  const { disposeModel, predict, trainModel } = await import('./model')
  disposeModel(state.trained)
  state = { status: 'training', trained: null, prediction: null, symbol, tf }
  emit()
  try {
    const trained = await trainModel(symbol, tf, candles)
    if (token !== trainToken) {
      // A newer request superseded this one — don't leak the model, and
      // don't clobber whatever the newer request already set.
      disposeModel(trained)
      return
    }
    if (!trained) {
      state = { status: 'insufficient-data', trained: null, prediction: null, symbol, tf }
      emit()
      return
    }
    const prediction = predict(trained, candles)
    state = { status: 'ready', trained, prediction, symbol, tf }
    emit()
  } catch (e) {
    if (token !== trainToken) return
    state = {
      status: 'error',
      trained: null,
      prediction: null,
      symbol,
      tf,
      error: e instanceof Error ? e.message : String(e),
    }
    emit()
  }
}

/** Re-run the live prediction against fresh candles without retraining —
 * cheap, so it's fine to call on every new candle close. */
export async function refreshPrediction(candles: CandleFlat[]): Promise<void> {
  if (!state.trained) return
  const { predict } = await import('./model')
  const prediction = predict(state.trained, candles)
  state = { ...state, prediction }
  emit()
}

export async function resetML(): Promise<void> {
  trainToken++
  // Nothing to dispose (and no reason to pull in tfjs) if training never
  // actually ran for the symbol being left.
  if (state.trained) {
    const { disposeModel } = await import('./model')
    disposeModel(state.trained)
  }
  state = { status: 'idle', trained: null, prediction: null, symbol: '', tf: '' }
  emit()
}
