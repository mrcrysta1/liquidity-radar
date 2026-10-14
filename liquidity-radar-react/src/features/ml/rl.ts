// A genuine Q-learning agent (DQN: neural-network Q-function, replay of all
// historical transitions, a periodically-synced target network for stable
// bootstrapping) — not a relabeled classifier. It learns a flat/long policy
// for the charted symbol and is graded the only way that means anything for
// a trading policy: cumulative return on an untouched out-of-sample tail,
// against a buy-and-hold benchmark over the same stretch.
//
// Formulation: only two actions exist — flat (0) and long (1); this is a
// spot-trading context, no short leg modeled. Market features evolve
// exogenously (the agent's choices don't move the market), so the incoming
// position is made an explicit part of the state and every (position,
// action) combination is enumerated at every historical bar. That turns
// what would otherwise need real environment rollouts into a complete,
// non-circular offline transition set — still Q-learning with a Bellman
// backup, just built without the circularity of "the next state depends on
// which action a still-training policy would have taken."
import * as tf from '@tensorflow/tfjs'
import type { CandleFlat } from '../../services/market'
import { FEATURE_NAMES, allSteps } from './features'
import type { StepData } from './features'

/** Round-trip cost estimate (fee + slippage) charged whenever the agent
 * flips position — without this a policy learns to flip every bar for free. */
const COST_PER_FLIP = 0.0008
const GAMMA = 0.9
const STATE_DIM = FEATURE_NAMES.length + 1 // + incoming-position flag

export interface Standardizer {
  mean: number[]
  std: number[]
}

export interface RLPolicy {
  qNet: tf.LayersModel
  standardizer: Standardizer
  /** Compounded return the greedy policy made on the untouched holdout tail. */
  backtestReturn: number
  /** Buy-and-hold return over that same tail, for comparison. */
  benchmarkReturn: number
  backtestSteps: number
  flips: number
  trainedAt: number
  symbol: string
  tf: string
}

export interface Action {
  /** What the policy recommends right now, given it starts flat. */
  action: 'flat' | 'long'
  qFlat: number
  qLong: number
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
function standardizeOne(x: number[], s: Standardizer): number[] {
  return x.map((v, d) => (v - s.mean[d]) / s.std[d])
}

function buildQNet(): tf.LayersModel {
  const m = tf.sequential()
  m.add(
    tf.layers.dense({
      units: 16,
      activation: 'relu',
      inputShape: [STATE_DIM],
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
    }),
  )
  m.add(tf.layers.dense({ units: 8, activation: 'relu' }))
  // Linear output — Q-values are unbounded returns, not probabilities.
  m.add(tf.layers.dense({ units: 2 }))
  m.compile({ optimizer: tf.train.adam(0.005), loss: 'meanSquaredError' })
  return m
}

interface Transition {
  state: number[]
  action: 0 | 1
  reward: number
  nextState: number[]
  /** Real paper trades are terminal — the "episode" ends when TP/SL hits,
   * so their target is the realized reward alone, no bootstrap from a next
   * state that doesn't meaningfully exist. Historical transitions built from
   * `buildTransitions` bootstrap normally (not terminal). */
  terminal?: boolean
}

/** Every (incoming position, action) combination at every historical bar —
 * see the module comment for why this is a valid offline dataset here. */
function buildTransitions(steps: StepData[], std: Standardizer): Transition[] {
  const out: Transition[] = []
  for (let i = 0; i < steps.length - 1; i++) {
    const featNow = standardizeOne(steps[i].x, std)
    const featNext = standardizeOne(steps[i + 1].x, std)
    const r = steps[i].fwdReturn
    for (const pos of [0, 1] as const) {
      for (const action of [0, 1] as const) {
        const reward = action * r - COST_PER_FLIP * Math.abs(action - pos)
        out.push({
          state: [...featNow, pos],
          action,
          reward,
          nextState: [...featNext, action],
        })
      }
    }
  }
  return out
}

function qValues(net: tf.LayersModel, states: number[][]): number[][] {
  return tf.tidy(() => {
    const xs = tf.tensor2d(states)
    const out = net.predict(xs) as tf.Tensor
    return out.arraySync() as number[][]
  })
}

async function trainQNet(
  qNet: tf.LayersModel,
  transitions: Transition[],
  epochs: number,
  onProgress?: (epoch: number, of: number) => void,
): Promise<void> {
  const targetNet = buildQNet()
  // The state arrays never change between epochs — only the weights do — so
  // building them once instead of per epoch removes a full rebuild of two
  // arrays the size of the dataset on every pass.
  const nextStates = transitions.map((t) => t.nextState)
  const currentStates = transitions.map((t) => t.state)
  // A target network exists precisely so the bootstrap target holds still for
  // a while. Re-syncing it every epoch defeated that and forced a second full
  // forward pass every epoch to match. Syncing every few epochs is both the
  // standard formulation and a third less work.
  const SYNC_EVERY = 3
  let nextQ: number[][] = []
  try {
    for (let epoch = 0; epoch < epochs; epoch++) {
      onProgress?.(epoch, epochs)
      if (epoch % SYNC_EVERY === 0) {
        targetNet.setWeights(qNet.getWeights())
        nextQ = qValues(targetNet, nextStates)
      }
      const currentQ = qValues(qNet, currentStates)
      const targets = transitions.map((t, i) => {
        const maxNext = Math.max(nextQ[i][0], nextQ[i][1])
        const y = currentQ[i].slice()
        y[t.action] = t.terminal ? t.reward : t.reward + GAMMA * maxNext
        return y
      })
      const xs = tf.tensor2d(currentStates)
      const ys = tf.tensor2d(targets)
      try {
        // Same reason as model.ts's fit(): yield per batch so training the
        // policy does not freeze the page on a phone.
        await qNet.fit(xs, ys, {
          epochs: 1,
          batchSize: BATCH_SIZE,
          shuffle: true,
          verbose: 0,
          yieldEvery: 'batch',
        })
      } finally {
        xs.dispose()
        ys.dispose()
      }
    }
  } finally {
    targetNet.dispose()
  }
}

/** Runs the greedy policy forward through a slice of steps, starting flat,
 * and reports compounded return against simple buy-and-hold over the same
 * stretch — the only honest way to grade a trading policy. */
function backtest(qNet: tf.LayersModel, steps: StepData[], std: Standardizer): { ret: number; bench: number; flips: number } {
  // The walk is sequential — each action depends on the position the previous
  // bar left behind — so this used to call the network once per bar. Every one
  // of those is a separate round trip to the GPU, and on integrated graphics
  // the round trip, not the arithmetic, is the cost: it was taking longer than
  // the entire training loop that preceded it.
  //
  // The incoming position is only ever 0 or 1, so both cases can be evaluated
  // for every bar in two batched calls and the walk can then just read the row
  // it needs. Identical maths, ~60x fewer round trips.
  const feats = steps.map((s) => standardizeOne(s.x, std))
  const qIfFlat = feats.length ? qValues(qNet, feats.map((f) => [...f, 0])) : []
  const qIfLong = feats.length ? qValues(qNet, feats.map((f) => [...f, 1])) : []

  let position: 0 | 1 = 0
  let equity = 1
  let benchEquity = 1
  let flips = 0
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    const qRow: number[] = position === 0 ? qIfFlat[i] : qIfLong[i]
    const qFlat = qRow[0]
    const qLong = qRow[1]
    const action: 0 | 1 = qLong > qFlat ? 1 : 0
    if (action !== position) flips++
    const cost = action !== position ? COST_PER_FLIP : 0
    equity *= 1 + action * s.fwdReturn - cost
    benchEquity *= 1 + s.fwdReturn
    position = action
  }
  return { ret: equity - 1, bench: benchEquity - 1, flips }
}

const MIN_STEPS = 60

/**
 * Every bar yields four transitions, so a few hundred candles becomes a few
 * thousand — and each epoch runs two full forward passes over all of them
 * before it fits. Measured end to end, training took about four and a half
 * minutes, which is long enough that the button looked broken and the feature
 * never got used.
 *
 * Capped here, sampled evenly rather than truncated, so the set still spans
 * the whole period instead of only its oldest stretch.
 */
const MAX_TRANSITIONS = 800
const EPOCHS = 10
/**
 * Big batches on purpose.
 *
 * Every batch is a separate round trip to the GPU, and on the integrated
 * graphics this app actually runs on, that overhead — not the arithmetic —
 * is what dominated. Measured at batchSize 64 the policy took about six
 * minutes to train, with the per-epoch cost unmoved by cutting the forward
 * passes, which is the signature of op-count rather than op-size.
 *
 * Fewer, larger batches trade some gradient granularity for a button that
 * finishes. The epoch count stays where it was so the policy still sees the
 * data the same number of times.
 */
const BATCH_SIZE = 256

function subsample(rows: Transition[], cap: number): Transition[] {
  if (rows.length <= cap) return rows
  const stride = rows.length / cap
  const out: Transition[] = []
  for (let i = 0; i < cap; i++) out.push(rows[Math.floor(i * stride)])
  return out
}

export async function trainPolicy(
  symbol: string,
  tfId: string,
  candles: CandleFlat[],
  onProgress?: (epoch: number, of: number) => void,
): Promise<RLPolicy | null> {
  const steps = allSteps(candles)
  if (steps.length < MIN_STEPS) return null

  const splitAt = Math.floor(steps.length * 0.75)
  const trainSteps = steps.slice(0, splitAt)
  const testSteps = steps.slice(splitAt)

  const std = computeStandardizer(trainSteps.map((s) => s.x))
  const transitions = subsample(buildTransitions(trainSteps, std), MAX_TRANSITIONS)

  const qNet = buildQNet()
  await trainQNet(qNet, transitions, EPOCHS, onProgress)

  const { ret, bench, flips } = backtest(qNet, testSteps, std)

  return {
    qNet,
    standardizer: std,
    backtestReturn: ret,
    benchmarkReturn: bench,
    backtestSteps: testSteps.length,
    flips,
    trainedAt: Date.now(),
    symbol,
    tf: tfId,
  }
}

export function currentAction(policy: RLPolicy, candles: CandleFlat[]): Action | null {
  const steps = allSteps(candles)
  if (!steps.length) return null
  const last = steps[steps.length - 1]
  // Recommendation is framed from flat — "should I open a position right
  // now", which is the question someone reading this panel actually has.
  const state = [...standardizeOne(last.x, policy.standardizer), 0]
  const [qFlat, qLong] = qValues(policy.qNet, [state])[0]
  return { action: qLong > qFlat ? 'long' : 'flat', qFlat, qLong }
}

export function disposePolicy(p: RLPolicy | null): void {
  p?.qNet.dispose()
}

/**
 * A single terminal experience from a real paper trade that actually
 * closed (hit TP or SL) — the raw ingredient online learning updates the
 * policy from, as opposed to the synthetic historical transitions used for
 * the initial offline training pass.
 */
export interface TradeOutcome {
  /** Raw (unstandardized) features at the moment the trade was opened. */
  entryFeatures: number[]
  /** Realized return, TP/SL distance and costs already netted in. */
  realizedReturn: number
}

export function standardize(x: number[], std: Standardizer): number[] {
  return standardizeOne(x, std)
}

/**
 * Updates a live policy's weights from real trade outcomes — genuine online
 * learning, not a fresh offline train. Each outcome becomes one terminal
 * transition (state = features at entry + flat, action = long, reward =
 * what actually happened, no bootstrap since the trade fully closed). A
 * handful of epochs at a low rate, so a few new trades nudge the policy
 * without overwriting everything the offline backtest already learned.
 */
export async function fineTuneFromTrades(policy: RLPolicy, outcomes: TradeOutcome[]): Promise<void> {
  if (!outcomes.length) return
  const transitions: Transition[] = outcomes.map((o) => {
    const s = standardizeOne(o.entryFeatures, policy.standardizer)
    return { state: [...s, 0], action: 1, reward: o.realizedReturn, nextState: [...s, 1], terminal: true }
  })
  await trainQNet(policy.qNet, transitions, 5)
}

/** Real activations and real weights from the trained Q-network, for the
 * network visualization — same reasoning as model.ts's getDirectionActivations:
 * sub-models built from `qNet.inputs`/`layer.output` tap the same weights,
 * no new parameters. qNet.layers is [Dense(16,relu), Dense(8,relu), Dense(2,linear)]. */
export interface RLActivations {
  inputNames: readonly string[]
  input: number[]
  hidden1: number[]
  hidden2: number[]
  q: number[]
  inputToHidden1Weights: number[][]
  hidden1ToHidden2Weights: number[][]
  hidden2ToQWeights: number[][]
}

export function getRLActivations(policy: RLPolicy, candles: CandleFlat[]): RLActivations | null {
  const steps = allSteps(candles)
  if (!steps.length) return null
  const last = steps[steps.length - 1]
  const stateVec = [...standardizeOne(last.x, policy.standardizer), 0]
  const l1 = policy.qNet.layers[0]
  const l2 = policy.qNet.layers[1]
  const l3 = policy.qNet.layers[2]
  const inputToHidden1Weights = l1.getWeights()[0].arraySync() as number[][]
  const hidden1ToHidden2Weights = l2.getWeights()[0].arraySync() as number[][]
  const hidden2ToQWeights = l3.getWeights()[0].arraySync() as number[][]
  const { hidden1, hidden2, q } = tf.tidy(() => {
    const xs = tf.tensor2d([stateVec])
    const m1 = tf.model({ inputs: policy.qNet.inputs, outputs: l1.output as tf.SymbolicTensor })
    const m2 = tf.model({ inputs: policy.qNet.inputs, outputs: l2.output as tf.SymbolicTensor })
    const h1 = m1.predict(xs) as tf.Tensor
    const h2 = m2.predict(xs) as tf.Tensor
    const qOut = policy.qNet.predict(xs) as tf.Tensor
    return { hidden1: Array.from(h1.dataSync()), hidden2: Array.from(h2.dataSync()), q: Array.from(qOut.dataSync()) }
  })
  return {
    inputNames: [...FEATURE_NAMES, 'position'],
    input: stateVec,
    hidden1,
    hidden2,
    q,
    inputToHidden1Weights,
    hidden1ToHidden2Weights,
    hidden2ToQWeights,
  }
}
