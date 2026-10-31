// Mount the link-group chip (./LinkChip) into a plain DOM element, for the
// chart cells that are still built as HTML (features/charts/companionCharts)
// and the main chart.
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { LinkChip } from './LinkChip'

const roots = new Map<HTMLElement, Root>()

/** Mount (or re-point) a chip in a plain DOM element. */
export function mountLinkChip(host: HTMLElement, linkKey: string): void {
  let root = roots.get(host)
  if (!root) {
    root = createRoot(host)
    roots.set(host, root)
  }
  root.render(<LinkChip key={linkKey} linkKey={linkKey} />)
}

/** Unmount every chip mounted inside `within` (before it is removed). */
export function unmountLinkChips(within: Node): void {
  for (const [host, root] of roots)
    if (within.contains(host) || !host.isConnected) {
      root.unmount()
      roots.delete(host)
    }
}
