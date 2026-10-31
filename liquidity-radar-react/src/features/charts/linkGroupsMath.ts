// Pure parts of chart link groups (./linkGroups): the stored-state parser and
// the time <-> bar-index mapping that time-range sync runs on. No DOM, no
// chart, so the unit tests can import it directly.

export type LinkGroupId = 'A' | 'B' | 'C'
/** A chart's group; null is "not linked". */
export type LinkGroup = LinkGroupId | null

export const LINK_GROUP_IDS: readonly LinkGroupId[] = ['A', 'B', 'C']

export interface SyncOptions {
  symbol: boolean
  interval: boolean
  /** The visible time range (scroll and zoom). */
  time: boolean
}

/** Scopes are separate workspaces: the main-chart layout and the Charts-tab grid. */
export type LinkScope = 'layout' | 'mc'

export interface LinkState {
  /** Group per chart key ('c<pos>' layout cell, 'mc<index>' grid panel). */
  groups: Record<string, LinkGroup>
  opts: Record<LinkScope, SyncOptions>
}

/**
 * New charts start in group A with only the time range synced: cells in a
 * layout then share one time window out of the box (audit U16), while their
 * coins and intervals stay their own until the user links them.
 */
export const DEFAULT_GROUP: LinkGroup = 'A'
export const DEFAULT_OPTS: SyncOptions = { symbol: false, interval: false, time: true }

const KEY_RE = /^(c|mc)\d{1,2}$/

function cleanOpts(o: unknown): SyncOptions {
  const src = o && typeof o === 'object' ? (o as Record<string, unknown>) : {}
  const pick = (k: keyof SyncOptions) => (typeof src[k] === 'boolean' ? (src[k] as boolean) : DEFAULT_OPTS[k])
  return { symbol: pick('symbol'), interval: pick('interval'), time: pick('time') }
}

/** Stored state, whatever shape it is in, as a valid LinkState. */
export function parseLinkState(raw: unknown): LinkState {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const groups: Record<string, LinkGroup> = {}
  const g = src.groups
  if (g && typeof g === 'object') {
    for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
      if (!KEY_RE.test(k)) continue
      if (v === null) groups[k] = null
      else if (typeof v === 'string' && (LINK_GROUP_IDS as readonly string[]).includes(v)) groups[k] = v as LinkGroupId
    }
  }
  const o = src.opts && typeof src.opts === 'object' ? (src.opts as Record<string, unknown>) : {}
  return { groups, opts: { layout: cleanOpts(o.layout), mc: cleanOpts(o.mc) } }
}

/** A chart's group: its own choice, else the default. */
export function groupOf(groups: Record<string, LinkGroup>, key: string): LinkGroup {
  return key in groups ? groups[key] : DEFAULT_GROUP
}

/**
 * Panel `index` of `prefix` was removed: the groups of the panels after it
 * move up a place with them (as their indicator slots do).
 */
export function shiftGroups(
  groups: Record<string, LinkGroup>,
  prefix: string,
  index: number,
  count: number,
): Record<string, LinkGroup> {
  const out = { ...groups }
  for (let i = index; i < count - 1; i++) {
    const next = prefix + (i + 1)
    if (next in groups) out[prefix + i] = groups[next]
    else delete out[prefix + i]
  }
  delete out[prefix + Math.max(index, count - 1)]
  return out
}

/** Bar spacing (seconds) at either end, for extrapolating past the data. */
function edgeStep(times: readonly number[], right: boolean): number {
  const n = times.length
  if (n < 2) return 60
  const d = right ? times[n - 1] - times[n - 2] : times[1] - times[0]
  return d > 0 ? d : 60
}

/**
 * Fractional bar index of time `t` (seconds) on bars opening at `times`
 * (ascending seconds). Between bars it interpolates; past either end it
 * extrapolates at the edge bar's spacing, so the empty space right of the
 * live bar (and left of the first) carries over between charts. Null with no
 * bars.
 */
export function timeToLogical(times: readonly number[], t: number): number | null {
  const n = times.length
  if (!n || !isFinite(t)) return null
  if (n === 1) return (t - times[0]) / 60
  if (t <= times[0]) return (t - times[0]) / edgeStep(times, false)
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / edgeStep(times, true)
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid
  }
  return lo + (t - times[lo]) / (times[hi] - times[lo])
}

/** The inverse of timeToLogical: the time (seconds) at fractional index `x`. */
export function logicalToTime(times: readonly number[], x: number): number | null {
  const n = times.length
  if (!n || !isFinite(x)) return null
  if (n === 1) return times[0] + x * 60
  if (x <= 0) return times[0] + x * edgeStep(times, false)
  if (x >= n - 1) return times[n - 1] + (x - (n - 1)) * edgeStep(times, true)
  const i = Math.floor(x)
  return times[i] + (x - i) * (times[i + 1] - times[i])
}

/** A visible logical range on one chart as a time window (seconds). */
export function rangeToTimes(
  times: readonly number[],
  r: { from: number; to: number },
): { from: number; to: number } | null {
  const from = logicalToTime(times, r.from)
  const to = logicalToTime(times, r.to)
  return from == null || to == null || !(to > from) ? null : { from, to }
}

/**
 * A time window as a logical range on another chart. A window narrower than
 * two of its bars (a 1m window on a daily chart) is widened around its middle,
 * so the follower never zooms into a sliver of one bar.
 */
export function timesToRange(
  times: readonly number[],
  w: { from: number; to: number },
  minBars = 2,
): { from: number; to: number } | null {
  const from = timeToLogical(times, w.from)
  const to = timeToLogical(times, w.to)
  if (from == null || to == null) return null
  if (to - from >= minBars) return { from, to }
  const mid = (from + to) / 2
  return { from: mid - minBars / 2, to: mid + minBars / 2 }
}
