// A re-render clock for panels that poll the engine's mutable state.
//
// Most panels read `state` directly (the engine mutates it imperatively) and
// re-render on a timer. Those timers used to fire every 0.7–2s for the life
// of the page, on hidden tabs and in background browser tabs alike — a dozen
// panels re-rendering for nobody. This one only ticks while the page is
// visible and, when `tabs` is given, while one of those tabs is open; opening
// the tab ticks once straight away so it never shows stale numbers.
import { useEffect, useState } from 'react'
import { getActiveTab, subscribeActiveTab } from '../features/actions/userActions'

export function useTick(ms: number, tabs?: readonly string[] | null, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  const key = tabs ? tabs.join(',') : ''

  useEffect(() => {
    if (!enabled) return
    const list = key ? key.split(',') : null
    const seen = () => !document.hidden && (!list || list.includes(getActiveTab()))
    const id = setInterval(() => {
      if (seen()) setNow(Date.now())
    }, ms)
    const offTab = list
      ? subscribeActiveTab((t) => {
          if (list.includes(t)) setNow(Date.now())
        })
      : null
    const onVis = () => {
      if (seen()) setNow(Date.now())
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      offTab?.()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [ms, key, enabled])

  return now
}

/** Tabs the price-action chart card can be shown on. */
export const CHART_TABS = ['radar', 'multichart'] as const
