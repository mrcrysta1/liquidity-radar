// A small, honestly-evaluated direction classifier — not a black box. Trains
// in-browser (TensorFlow.js) on technical features from features.ts, reports
// its own out-of-sample accuracy via a walk-forward split, and only then is
// used for the live prediction. Every tf.Tensor here is disposed explicitly
// (tf.tidy where possible) — leaving GPU-backed tensors uncollected is a
// real, fast memory leak in a long-running session, exactly the class of bug
// this session's audit has been finding and fixing elsewhere in this app.
import * as tf from '@tensorflow/tfjs'
import type { CandleFlat } from '../../services/market'
import { FEATURE_NAMES, buildDataset, latestFeatures } from './features'
import type { Sample } from './features'

export interface Standardizer {
  mean: number[]
  std: number[]
}

export interface TrainedModel {
  model: tf.LayersModel
  standardizer: Standardizer
  /** Out-of-sample accuracy from the walk-forward holdout — the number to
   * actually trust, since it's never seen the data it's scored on. */
  backtestAccuracy: number
  backtestN: number
  trainedAt: number
  symbol: string
  tf: string
  horizon: number
}

function computeStandardizer(rows: number[][]): Standardizer {
  const n = rows.length
  const dims = rows[0].length
  const mean = new Array(dims).fill(0)
  for (const r of rows) for (let d = 0; d < dims; d++) mean[d] += r[d] / n
  const std = new Array(dims).fill(0)
  for (const r of rows) for (let d = 0; d < dims; d++) std[d] += (r[d] - mean[d]) ** 2 / n
  for (let d = 0; d < dims; d++) std[d] = Math.sqrt(std[d]) || 1
  return { mean, std }
}

function standardize(rows: number[][], s: Standardizer): number[][] {
  return rows.map((r) => r.map((v, d) => (v - s.mean[d]) / s.std[d]))
}

function buildModel(inputDim: number): tf.LayersModel {
  const model = tf.sequential()
  // Deliberately shallow: a few hundred candles is a small dataset for a
  // noisy, near-random-walk target, and a deeper net would just memorize
  // it. L2 regularization + a single small hidden layer is closer to what
  // this much data can actually support without overfitting.
  model.add(
    tf.layers.dense({
      units: 8,
      activation: 'relu',
      inputShape: [inputDim],
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    }),
  )
  model.add(tf.layers.dropout({ rate: 0.2 }))
  model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }))
  model.compile({ optimizer: tf.train.adam(0.01), loss: 'binaryCrossentropy', metrics: ['accuracy'] })
  return model
}

async function fit(model: tf.LayersModel, train: Sample[], epochs: number): Promise<void> {
  const xs = tf.tensor2d(train.map((s) => s.x))
  const ys = tf.tensor2d(train.map((s) => [s.y]))
  try {
    // yieldEvery defaults to 'auto', which hands the main thread back only
    // about every 125ms — long enough that every frame during training misses
    // its deadline and the page stops scrolling on a phone. Yielding per
    // batch costs wall-clock time but changes nothing about the maths or the
    // resulting model, and the page stays interactive while it runs.
    await model.fit(xs, ys, {
      epochs,
      batchSize: 32,
      shuffle: true,
      verbose: 0,
      yieldEvery: 'batch',
    })
  } finally {
    xs.dispose()
    ys.dispose()
  }
}

function evalAccuracy(model: tf.LayersModel, test: Sample[]): number {
  if (!test.length) return 0.5
  return tf.tidy(() => {
    const xs = tf.tensor2d(test.map((s) => s.x))
    const preds = model.predict(xs) as tf.Tensor
    const arr = preds.dataSync()
    let correct = 0
    test.forEach((s, i) => {
      if ((arr[i] >= 0.5 ? 1 : 0) === s.y) correct++
    })
    return correct / test.length
  })
}

const MIN_SAMPLES = 60

/**
 * Trains a fresh model for one symbol/timeframe: standardizes features on
 * the training split only (no lookahead into the holdout), reports walk-
 * forward accuracy on the untouched tail, then retrains on the full dataset
 * for the model actually used to predict live — standard practice: report
 * the honest holdout number, predict from the best-data model.
 */
export async function trainModel(
  symbol: string,
  tfId: string,
  candles: CandleFlat[],
  horizon = 3,
  /**
   * Training budget. The ML panel is the headline feature and gets the full
   * 40; the signal scanner runs this in the background for one market every
   * couple of minutes and takes fewer, because a background read is not worth
   * the frames a full run costs on a phone.
   */
  epochs = 40,
): Promise<TrainedModel | null> {
  const dataset = buildDataset(candles, horizon)
  if (dataset.length < MIN_SAMPLES) return null

  const splitAt = Math.floor(dataset.length * 0.75)
  const trainSet = dataset.slice(0, splitAt)
  const testSet = dataset.slice(splitAt)

  const trainStd = computeStandardizer(trainSet.map((s) => s.x))
  const trainScaled: Sample[] = trainSet.map((s) => ({ x: standardize([s.x], trainStd)[0], y: s.y }))
  const testScaled: Sample[] = testSet.map((s) => ({ x: standardize([s.x], trainStd)[0], y: s.y }))

  const evalModel = buildModel(FEATURE_NAMES.length)
  await fit(evalModel, trainScaled, epochs)
  const backtestAccuracy = evalAccuracy(evalModel, testScaled)
  evalModel.dispose()

  // Now the model that actually predicts: full dataset, its own standardizer.
  const fullStd = computeStandardizer(dataset.map((s) => s.x))
  const fullScaled: Sample[] = dataset.map((s) => ({ x: standardize([s.x], fullStd)[0], y: s.y }))
  const liveModel = buildModel(FEATURE_NAMES.length)
  await fit(liveModel, fullScaled, epochs)

  return {
    model: liveModel,
    standardizer: fullStd,
    backtestAccuracy,
    backtestN: testSet.length,
    trainedAt: Date.now(),
    symbol,
    tf: tfId,
    horizon,
  }
}

export interface Prediction {
  direction: 'up' | 'down'
  /** Model's own probability for its stated direction, 0.5–1. */
  confidence: number
}

export function predict(trained: TrainedModel, candles: CandleFlat[]): Prediction | null {
  const f = latestFeatures(candles)
  if (!f) return null
  return tf.tidy(() => {
    const scaled = standardize([f], trained.standardizer)
    const xs = tf.tensor2d(scaled)
    const out = trained.model.predict(xs) as tf.Tensor
    const p = out.dataSync()[0]
    return p >= 0.5 ? { direction: 'up' as const, confidence: p } : { direction: 'down' as const, confidence: 1 - p }
  })
}

export function disposeModel(t: TrainedModel | null): void {
  t?.model.dispose()
}

/**
 * Real activations and real weights from the trained model, for the network
 * visualization — not a mockup with made-up numbers. Reads the model's own
 * layers directly: `layers[0]` is the 8-unit dense+ReLU hidden layer,
 * `layers[2]` is the sigmoid output (layers[1] is dropout, an identity at
 * inference time). Sub-models built from `model.inputs`/`layer.output`
 * share weights with the original — no extra parameters are created, just a
 * different tap point on the same graph.
 */
export interface DirectionActivations {
  inputNames: readonly string[]
  input: number[]
  hidden: number[]
  output: number
  /** [inputIndex][hiddenIndex] kernel weights, input → hidden. */
  inputToHiddenWeights: number[][]
  /** [hiddenIndex] kernel weights, hidden → output. */
  hiddenToOutputWeights: number[]
}

export function getDirectionActivations(
  trained: TrainedModel,
  candles: CandleFlat[],
): DirectionActivations | null {
  const f = latestFeatures(candles)
  if (!f) return null
  const hiddenLayer = trained.model.layers[0]
  const outputLayer = trained.model.layers[2]
  const inputToHiddenWeights = hiddenLayer.getWeights()[0].arraySync() as number[][]
  const hiddenToOutputWeights = (outputLayer.getWeights()[0].arraySync() as number[][]).map((r) => r[0])
  const { hidden, output } = tf.tidy(() => {
    const scaled = standardize([f], trained.standardizer)
    const xs = tf.tensor2d(scaled)
    const hiddenModel = tf.model({ inputs: trained.model.inputs, outputs: hiddenLayer.output as tf.SymbolicTensor })
    const hiddenOut = hiddenModel.predict(xs) as tf.Tensor
    const finalOut = trained.model.predict(xs) as tf.Tensor
    return { hidden: Array.from(hiddenOut.dataSync()), output: finalOut.dataSync()[0] }
  })
  return { inputNames: FEATURE_NAMES, input: f, hidden, output, inputToHiddenWeights, hiddenToOutputWeights }
}
