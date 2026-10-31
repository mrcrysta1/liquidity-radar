// "Visible on intervals", as on TradingView: a drawing can be hidden on whole
// groups of timeframes (seconds, minutes, hours, days and up). Pure — no
// chart, no DOM — so the main chart, the layout cells and the tests agree.

export type TfGroup = 'sec' | 'min' | 'hour' | 'day'

export const TF_GROUPS: Array<{ id: TfGroup; label: string }> = [
  { id: 'sec', label: 'Seconds' },
  { id: 'min', label: 'Minutes' },
  { id: 'hour', label: 'Hours' },
  { id: 'day', label: 'Days and up' },
]

/**
 * The group a timeframe id belongs to: '15s' seconds, '5m' minutes, '4h'
 * hours, and everything else ('1d', '1w', '1M' — a capital M is a month)
 * days and up. Unknown ids count as days and up.
 */
export function tfGroup(tf: unknown): TfGroup {
  const m = /^\d+([smhdwM])$/.exec(String(tf ?? ''))
  const u = m ? m[1] : ''
  if (u === 's') return 'sec'
  if (u === 'm') return 'min'
  if (u === 'h') return 'hour'
  return 'day'
}

/** The groups a drawing is hidden on, cleaned up (unknown entries dropped). */
export function hiddenGroups(d: { hideOn?: unknown }): TfGroup[] {
  const v = d && Array.isArray(d.hideOn) ? d.hideOn : []
  const ids = TF_GROUPS.map((g) => g.id)
  return ids.filter((id) => v.includes(id))
}

/** Whether a drawing shows on timeframe `tf`. */
export function visibleOnTf(d: { hideOn?: unknown }, tf: unknown): boolean {
  return !hiddenGroups(d).includes(tfGroup(tf))
}

/** Flip one group; returns the new hideOn list (undefined when nothing is hidden). */
export function toggleHidden(d: { hideOn?: unknown }, g: TfGroup): TfGroup[] | undefined {
  const cur = hiddenGroups(d)
  const next = cur.includes(g) ? cur.filter((x) => x !== g) : cur.concat(g)
  return next.length ? next : undefined
}
