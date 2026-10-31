// What linked charts share (features/charts/linkGroups), per workspace: the
// layout picker's menu lists them as checkboxes beside crosshair sync; the
// comparison grid's header shows them as compact toggles.
import { useSyncExternalStore } from 'react'
import { getSyncOptions, setSyncOption, subscribeLinks } from '../../features/charts/linkGroups'
import type { LinkScope, SyncOptions } from '../../features/charts/linkGroups'

const ITEMS: Array<{ k: keyof SyncOptions; label: string; short: string; tip: string }> = [
  { k: 'symbol', label: 'Sync symbol', short: 'Symbol', tip: 'Charts in the same link group show the same symbol' },
  { k: 'interval', label: 'Sync interval', short: 'Interval', tip: 'Charts in the same link group share the interval' },
  {
    k: 'time',
    label: 'Sync date range',
    short: 'Time',
    tip: 'Scrolling or zooming one chart moves the others in its link group',
  },
]

export function LinkSyncOptions({ scope, compact }: { scope: LinkScope; compact?: boolean }) {
  const opts = useSyncExternalStore(subscribeLinks, () => getSyncOptions(scope))
  if (compact)
    return (
      <span className="lk-opts" role="group" aria-label="Link group sync">
        <span className="lk-opts-k">Sync</span>
        {ITEMS.map((it) => (
          <button
            key={it.k}
            type="button"
            className={'lk-opt' + (opts[it.k] ? ' on' : '')}
            aria-pressed={opts[it.k]}
            title={it.tip}
            onClick={() => setSyncOption(scope, it.k, !opts[it.k])}
          >
            {it.short}
          </button>
        ))}
      </span>
    )
  return (
    <>
      {ITEMS.map((it) => (
        <label key={it.k} className="layout-sync lk-sync" title={it.tip}>
          <input
            type="checkbox"
            checked={opts[it.k]}
            onChange={(e) => setSyncOption(scope, it.k, e.target.checked)}
          />
          <span>{it.label}</span>
        </label>
      ))}
    </>
  )
}
