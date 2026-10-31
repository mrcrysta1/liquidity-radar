// Runs Pine scripts off the main thread (./indicator posts a run per changed
// candle set). A slow or runaway script used to block the page for up to its
// 2.5s budget on every new bar; here it only delays its own lines.
import { PineError, runPine } from './runtime.ts'
import type { InputValue, PineBar, RunOptions } from './runtime.ts'

interface Job {
  id: number
  script: string
  candles: PineBar[]
  inputs: Record<string, InputValue>
  opts?: RunOptions
}

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, script, candles, inputs, opts } = e.data
  const t0 = performance.now()
  try {
    const result = runPine(script, candles, inputs, opts || {})
    self.postMessage({ id, result, ms: performance.now() - t0 })
  } catch (err) {
    // Line/column travel as fields too, so the editor can jump to them.
    const at = err instanceof PineError ? { line: err.line, col: err.col } : {}
    self.postMessage({
      id,
      error: err instanceof Error ? err.message : String(err),
      ...at,
      ms: performance.now() - t0,
    })
  }
}
