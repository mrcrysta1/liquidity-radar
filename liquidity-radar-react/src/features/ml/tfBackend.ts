// Which TensorFlow.js backend the in-browser models run on.
//
// tfjs picks WebGL by default. For networks this small (a single 8-unit
// hidden layer, a few hundred rows) the GPU buys nothing, and getting there
// costs a lot: every op's shader is compiled and linked synchronously on the
// main thread the first time it runs. Measured headless, that was one ~5–8s
// long task the moment the Radar tab opened with the ML overlay on — a frozen
// page. The CPU backend runs the same float32 maths with no shaders, so each
// training batch is a short task and the page stays interactive.
//
// Every tfjs user calls this before building a model, so all models live on
// one backend and no tensor ever has to be moved between two.
import * as tf from '@tensorflow/tfjs'

let pending: Promise<boolean> | null = null

export function ensureCpuBackend(): Promise<boolean> {
  if (!pending) pending = tf.setBackend('cpu')
  return pending
}
