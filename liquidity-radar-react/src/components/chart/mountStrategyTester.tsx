// Mount the Strategy Tester on demand, in a React root of its own on the
// page body: the Pine editor that opens it sits in a menu that unmounts when
// it closes, and the tester should outlive it. One tester at a time.
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { StrategyTester } from './StrategyTester'
import type { IndicatorStore } from '../../features/charts/indicators/store'

let host: HTMLElement | null = null
let root: Root | null = null

export function closeStrategyTester(): void {
  root?.unmount()
  host?.remove()
  root = null
  host = null
}

/** Show the tester for the Pine strategy `uid` on the chart of `store`. */
export function openStrategyTester(store: IndicatorStore, uid: string): void {
  if (!host || !root) {
    host = document.createElement('div')
    host.className = 'st-host'
    document.body.appendChild(host)
    root = createRoot(host)
  }
  root.render(<StrategyTester key={uid} store={store} uid={uid} onClose={closeStrategyTester} />)
}
