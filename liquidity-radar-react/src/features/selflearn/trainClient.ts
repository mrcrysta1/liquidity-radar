// Runs model training in a Web Worker so it never freezes the page (it took up
// to a second per model on a mid-range phone, stalling scrolling). If a worker
// cannot be started, or dies, training falls back to the main thread with the
// same code (trainCore), so the engine behaves the same either way.
import type { CandleFlat } from '../../services/market'
import type { StratId } from './strategy'
import { trainCore } from './train'
import type { TrainResult } from './train'

type Pending = { resolve: (r: TrainResult) => void; reject: (e: Error) => void }

let worker: Worker | null = null
let broken = false
let seq = 0
const pending = new Map<number, Pending>()

function getWorker(): Worker | null {
  if (worker || broken || typeof Worker === 'undefined') return worker
  try {
    worker = new Worker(new URL('./train.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: TrainResult; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok && e.data.result) p.resolve(e.data.result)
      else p.reject(new Error(e.data.error || 'training failed'))
    }
    worker.onerror = () => {
      // The worker itself failed (not one training run): stop using it and let
      // whatever was waiting retry on the main thread.
      broken = true
      worker?.terminate()
      worker = null
      for (const p of pending.values()) p.reject(new Error('worker unavailable'))
      pending.clear()
    }
  } catch {
    broken = true
    worker = null
  }
  return worker
}

export async function trainInBackground(cs: CandleFlat[], strat: StratId): Promise<TrainResult> {
  const w = getWorker()
  if (!w) return trainCore(cs, strat)
  const id = ++seq
  try {
    return await new Promise<TrainResult>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      w.postMessage({ id, cs, strat })
    })
  } catch (e) {
    if (broken) return trainCore(cs, strat)
    throw e
  }
}
