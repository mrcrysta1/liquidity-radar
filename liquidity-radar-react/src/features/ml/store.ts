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

// --- when training is allowed to run ---------------------------------
//
// trainModel fits two 40-epoch networks, which is tens of seconds of WebGL
// work on a phone. This used to be kicked off from the first kline load
// regardless of what the user was looking at, so a page opened on the
// Dashboard sat at ~7fps for its first minute and barely scrolled. Nothing
// trains now until something that actually displays a prediction is on
// screen; engine/app.ts owns that call because it can see both the active
// tab and the overlay toggles without this module importing either.

let wanted = false
let latest: { symbol: string; tf: string; candles: CandleFlat[] } | null = null

/** Called on every kline load. Trains at most once per symbol+timeframe, and
 * only while a prediction is actually being shown. */
export function mlOnCandles(symbol: string, tf: string, candles: CandleFlat[]): void {
  latest = { symbol, tf, candles }
  if (wanted) runForLatest()
}

/** Told by app.ts when the ML panel or the neural-net page comes into or goes
 * out of view. Turning it on trains against whatever candles are already in
 * hand, so opening the panel doesn't wait for the next kline load. */
export function setMLWanted(v: boolean): void {
  if (v === wanted) return
  wanted = v
  if (v) runForLatest()
}

function runForLatest(): void {
  if (!latest) return
  const { symbol, tf, candles } = latest
  const same = state.symbol === symbol && state.tf === tf
  // Already training this pair, or already gave a verdict on it — either way
  // retraining from scratch would just burn the main thread again.
  if (same && (state.status === 'training' || state.status === 'insufficient-data' || state.status === 'error')) return
  if (same && state.status === 'ready') {
    void refreshPrediction(candles)
    return
  }
  void trainForSymbol(symbol, tf, candles)
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
