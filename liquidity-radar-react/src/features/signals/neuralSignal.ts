// A neural read for the signal scanner.
//
// The obvious implementation — train the direction model for each scanned
// market on every sweep — is precisely what pinned the app at 7fps before,
// and there are nineteen markets now rather than one. So this is deliberately
// rationed:
//
//   • at most ONE market is trained per call, never a batch;
//   • nothing trains unless the Signals tab is actually on screen;
//   • the model is disposed the moment its probability has been read. Only
//     the two numbers are kept, so nineteen markets cost one model's worth of
//     GPU memory rather than nineteen;
//   • a read is reused for TTL_MS before that market is retrained.
//
// The result is one short training run every couple of minutes while the user
// is looking at the scanner, which tf.fit yields out of per batch, instead of
// nineteen competing for the main thread.
//
// History is loaded per training run rather than reused from the scanner's
// cache: the scanner keeps 60 bars, which is enough to score an indicator but
// leaves far too few windowed samples to train on honestly. One extra request
// every couple of minutes is a fair price for a model that saw enough data.
import type { CandleFlat } from '../../services/market'

export interface NeuralRead {
  /** Model's probability that the next move is up, 0–1. */
  pUp: number
  /** Walk-forward accuracy on data the model never trained on. */
  accuracy: number
  /** How many out-of-sample bars that accuracy was measured over. */
  n: number
  at: number
}

const TTL_MS = 25 * 60 * 1000
/** Bars needed before training is worth attempting at all. */
const MIN_BARS = 220
/**
 * How long after load before the first training run is allowed.
 *
 * The first sweep lands while the streams are still connecting, the charts
 * are mounting and the first render is in flight. Adding a training run to
 * that pile was the one place the frame rate actually suffered; waiting until
 * the page has settled costs a minute of a read nobody is looking at yet.
 */
const WARMUP_MS = 45 * 1000
const bootAt = Date.now()
const reads = new Map<string, NeuralRead>()
let busy = false
/** Set by the scanner: training only happens while the tab is on screen. */
let allowed = false

export function setNeuralAllowed(v: boolean): void {
  allowed = v
}

export function getNeuralRead(sym: string): NeuralRead | null {
  const r = reads.get(sym)
  if (!r) return null
  return Date.now() - r.at > TTL_MS ? null : r
}

/**
 * Train one market that is due, if any. `load` fetches that market's history
 * — it is called for exactly one symbol per invocation, so this costs one
 * request every couple of minutes rather than one per market.
 *
 * Returns the symbol it trained, or null when it did nothing, which is the
 * common case and entirely fine.
 */
export async function trainOneNeural(
  symbols: string[],
  load: (sym: string) => Promise<CandleFlat[]>,
): Promise<string | null> {
  if (!allowed || busy) return null
  if (Date.now() - bootAt < WARMUP_MS) return null
  const now = Date.now()
  // Oldest read first, never-read markets before that, so every market comes
  // round rather than one hogging the budget.
  const due = symbols
    .map((sym) => ({ sym, at: reads.get(sym)?.at ?? 0 }))
    .filter((c) => now - c.at > TTL_MS)
    .sort((a, b) => a.at - b.at)
  const pick = due[0]
  if (!pick) return null

  busy = true
  try {
    const candles = await load(pick.sym)
    // buildDataset windows these down, so 60 bars would leave far fewer than
    // the 60 samples trainModel needs and it would simply return null.
    if (!candles || candles.length < MIN_BARS) return null
    // Imported here, not at module scope: this drags in TensorFlow.js, and a
    // static import would put it in the initial bundle for every visitor.
    const { trainModel, predict, disposeModel } = await import('../ml/model')
    // Half the ML panel's budget: this is a background read for one of
    // nineteen markets, not the thing the user is looking at.
    const trained = await trainModel(pick.sym, '1h', candles, 3, 18)
    if (!trained) return null
    try {
      const p = predict(trained, candles)
      if (p) {
        reads.set(pick.sym, {
          pUp: p.direction === 'up' ? p.confidence : 1 - p.confidence,
          accuracy: trained.backtestAccuracy,
          n: trained.backtestN,
          at: Date.now(),
        })
      }
    } finally {
      // The number is all that is wanted. Keeping the model would mean
      // nineteen live tf.LayersModels, which a garbage collector will not
      // reclaim on its own.
      disposeModel(trained)
    }
    return pick.sym
  } catch {
    return null
  } finally {
    busy = false
  }
}

/**
 * What the neural read is worth to the blended score.
 *
 * Weighted by measured edge, not by confidence. A model that is 51% accurate
 * on its own holdout has no business moving a signal however sure it sounds,
 * so below 52% it contributes exactly nothing; the contribution then ramps to
 * full weight by 65%. This is the part that keeps "advanced" from meaning
 * "louder" — the number only counts to the extent it has earned it.
 */
export function neuralAdjustment(read: NeuralRead | null, weight: number): number {
  if (!read || !isFinite(read.pUp) || !isFinite(read.accuracy)) return 0
  const edge = (read.accuracy - 0.52) / 0.13
  if (edge <= 0) return 0
  return Math.round((read.pUp - 0.5) * 2 * weight * Math.min(1, edge))
}

/** Clear everything — used when the scan universe or timeframe changes. */
export function resetNeuralReads(): void {
  reads.clear()
}
