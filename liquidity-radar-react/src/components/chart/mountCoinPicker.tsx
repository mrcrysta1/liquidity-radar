// Mount the shared CoinPicker into a plain DOM element, for the chart panels
// that are still built as HTML strings (features/charts multiCharts and
// companionCharts). Their cells clip overflow, so the menu floats.
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { CoinPicker } from './CoinPicker'

const roots = new Map<HTMLElement, Root>()

export interface MountedPickerOptions {
  value?: string
  onPick: (sym: string) => void
  cryptoOnly?: boolean
  /** Button text instead of the selected market (an 'add' button). */
  triggerText?: string
  label?: string
}

export function mountCoinPicker(host: HTMLElement, opts: MountedPickerOptions): void {
  roots.get(host)?.unmount()
  const root = createRoot(host)
  roots.set(host, root)
  const render = (value?: string) =>
    root.render(
      <CoinPicker
        value={value}
        compact
        float
        cryptoOnly={opts.cryptoOnly}
        trigger={opts.triggerText ? <span className="cp-id"><b>{opts.triggerText}</b></span> : undefined}
        label={opts.label ?? 'Chart symbol'}
        onPick={(sym) => {
          if (!opts.triggerText) render(sym)
          // After this event: the callback may rebuild the panel and unmount this root.
          queueMicrotask(() => opts.onPick(sym))
        }}
      />,
    )
  render(opts.value)
}

/** Unmount every picker mounted inside `within` (before its HTML is replaced). */
export function unmountCoinPickers(within: Node): void {
  for (const [host, root] of roots)
    if (within.contains(host) || !host.isConnected) {
      root.unmount()
      roots.delete(host)
    }
}
