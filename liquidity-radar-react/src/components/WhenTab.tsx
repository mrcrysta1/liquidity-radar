// Mounts its children the first time their tab is opened, and keeps them
// mounted after that.
//
// Every tab section is in the DOM from the start (the engine writes into
// them), so each lazy panel inside used to begin downloading at first render,
// whether or not anyone would open it. On a slow link those ten downloads
// queued ahead of the engine itself, and the live data waited behind code for
// screens nobody was looking at. Now a hidden panel costs nothing at startup;
// its code is fetched quietly once the page is idle (`preload`), so opening
// the tab later is still instant.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getActiveTab, subscribeActiveTab } from '../features/actions/userActions'

/** Prefetch after the first screen has settled — seconds, not minutes. */
const IDLE_PRELOAD_MS = 6000

export function WhenTab({
  tab,
  preload,
  children,
}: {
  tab: string
  preload?: () => Promise<unknown>
  children: ReactNode
}) {
  const [shown, setShown] = useState(() => getActiveTab() === tab)

  useEffect(() => {
    if (shown) return
    return subscribeActiveTab((t) => {
      if (t === tab) setShown(true)
    })
  }, [shown, tab])

  useEffect(() => {
    if (shown || !preload) return
    const run = () => void preload().catch(() => {})
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    }
    const t = setTimeout(
      () => (w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 4000 }) : run()),
      IDLE_PRELOAD_MS,
    )
    return () => clearTimeout(t)
  }, [shown, preload])

  return shown ? <>{children}</> : null
}
