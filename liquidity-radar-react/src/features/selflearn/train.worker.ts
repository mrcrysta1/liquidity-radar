// Web Worker: runs trainCore off the main thread (see train.ts and trainClient.ts).
import { trainCore } from './train'
import type { CandleFlat } from '../../services/market'
import type { StratId } from './strategy'

self.onmessage = (e: MessageEvent<{ id: number; cs: CandleFlat[]; strat: StratId }>) => {
  const { id, cs, strat } = e.data
  try {
    self.postMessage({ id, ok: true, result: trainCore(cs, strat) })
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
