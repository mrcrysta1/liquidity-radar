// Link groups: TradingView-style symbol, interval and time-range sync between
// charts of one workspace.
//
// Every chart has a colour group (A red, B blue, C green, or none). What the
// charts of a group share is set per workspace (scope): the main-chart layout
// ('layout': the main chart and its companion cells) and the Charts-tab
// comparison grid ('mc') each have their own sync options. Crosshair sync
// stays in ./crosshairSync and covers the whole layout, as before.
//
// This module keeps the store (persisted) and runs the time-range sync,
// which works the same for every chart. Symbol and interval sync differ per
// workspace (the main chart's coin goes through setSymbol, a grid panel's
// through its own loader), so companionCharts and multiCharts follow the store
// themselves through subscribeLinks.
//
// Time-range sync maps the moving chart's visible bars to a time window and
// that window back to each follower's own bars (./linkGroupsMath), so charts
// on different intervals line up and the blank space past the live bar
// carries over. Only a chart the user is handling (pointer or wheel on it in
// the last moments) broadcasts: followers being moved, data loads and fits
// never echo back, which is what keeps the group out of a feedback loop.
import { storageGet, storageSet } from '../../services/storage'
import {
  groupOf,
  parseLinkState,
  rangeToTimes,
  shiftGroups,
  timesToRange,
} from './linkGroupsMath.ts'
import type { LinkGroup, LinkGroupId, LinkScope, LinkState, SyncOptions } from './linkGroupsMath.ts'

export type { LinkGroup, LinkGroupId, LinkScope, SyncOptions }
export { LINK_GROUP_IDS } from './linkGroupsMath.ts'

type Any = any

export const LINK_COLORS: Record<LinkGroupId, string> = {
  A: '#f23645',
  B: '#2962ff',
  C: '#089981',
}
export const LINK_NAMES: Record<LinkGroupId, string> = { A: 'Red', B: 'Blue', C: 'Green' }

const STORE_KEY = 'lr-linkGroups-v1'

let store: LinkState = parseLinkState(storageGet<unknown>(STORE_KEY, null))

type Listener = () => void
const listeners: Listener[] = []
/** Group membership or a sync option changed. */
export function subscribeLinks(fn: Listener): () => void {
  listeners.push(fn)
  return () => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
}
function commit(next: LinkState): void {
  store = next
  storageSet(STORE_KEY, store)
  listeners.slice().forEach((fn) => fn())
  realignAll()
}

export function getLinkGroup(key: string): LinkGroup {
  return groupOf(store.groups, key)
}

export function setLinkGroup(key: string, g: LinkGroup): void {
  if (getLinkGroup(key) === g) return
  commit({ ...store, groups: { ...store.groups, [key]: g } })
}

export function getSyncOptions(scope: LinkScope): SyncOptions {
  return store.opts[scope]
}

export function setSyncOption(scope: LinkScope, k: keyof SyncOptions, on: boolean): void {
  if (store.opts[scope][k] === on) return
  commit({ ...store, opts: { ...store.opts, [scope]: { ...store.opts[scope], [k]: on } } })
}

/** Grid panel `index` of `prefix` was removed: later panels keep their groups. */
export function shiftLinkGroups(prefix: string, index: number, count: number): void {
  store = { ...store, groups: shiftGroups(store.groups, prefix, index, count) }
  storageSet(STORE_KEY, store)
  listeners.slice().forEach((fn) => fn())
}

/**
 * The layout cell the main chart sits in ('c<pos>'), kept current by
 * companionCharts, so chartRender need not import it (it imports chartRender).
 */
let mainKey = 'c0'
export function setMainLinkKey(key: string): void {
  mainKey = key
}
export function mainLinkKey(): string {
  return mainKey
}

// ---- time-range sync ----

export interface TimeSyncMember {
  scope: LinkScope
  /** The chart's link key now ('c<pos>' / 'mc<index>'); cells move. */
  key: () => string
  chart: Any
  /** Whether input on `target` is the user handling this chart (makes it the driver). */
  owns: (target: Element) => boolean
  /** Open times (seconds) of the bars on the chart, oldest first. */
  times: () => number[]
  /** False while the chart's bars are not on a real time axis (range bars). */
  syncable?: () => boolean
  /** Leads its group when the group is lined up (the main chart). */
  primary?: boolean
}

export interface TimeSyncHandle {
  /** Take the group's time window (after loading new bars). */
  adopt: () => void
  /** Move the group to this chart's window (after this chart refits). */
  publish: () => void
  /** Leave the hub, before chart.remove(). */
  off: () => void
}

const members: TimeSyncMember[] = []
/** Last shared window per scope + group, in seconds. */
const windows = new Map<string, { from: number; to: number }>()
let driver: TimeSyncMember | null = null
let driverUntil = 0
/** Input on a chart makes it the one that moves its group for this long. */
const DRIVE_MS = 1500

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function groupKey(m: TimeSyncMember): string | null {
  if (!store.opts[m.scope].time) return null
  const g = getLinkGroup(m.key())
  return g ? m.scope + ':' + g : null
}

const usable = (m: TimeSyncMember): boolean =>
  (m.syncable ? m.syncable() : true) && m.times().length > 0

function windowOf(m: TimeSyncMember): { from: number; to: number } | null {
  if (!usable(m)) return null
  let r: Any
  try {
    r = m.chart.timeScale().getVisibleLogicalRange()
  } catch (e) {
    return null
  }
  return r ? rangeToTimes(m.times(), r) : null
}

function apply(m: TimeSyncMember, w: { from: number; to: number }): void {
  if (!usable(m)) return
  const r = timesToRange(m.times(), w)
  if (!r) return
  try {
    m.chart.timeScale().setVisibleLogicalRange(r)
  } catch (e) {
    /* chart already removed */
  }
}

function publishFrom(m: TimeSyncMember): void {
  const gk = groupKey(m)
  if (!gk) return
  const w = windowOf(m)
  if (!w) return
  windows.set(gk, w)
  members.forEach((o) => {
    if (o !== m && groupKey(o) === gk) apply(o, w)
  })
}

function adoptInto(m: TimeSyncMember): void {
  const gk = groupKey(m)
  if (!gk) return
  let w = windows.get(gk) || null
  if (!w) {
    // Nobody has moved this group yet: line up with its leader.
    const peers = members.filter((o) => o !== m && groupKey(o) === gk && usable(o))
    const lead = peers.find((o) => o.primary) || peers[0]
    w = lead ? windowOf(lead) : null
  }
  if (w) apply(m, w)
}

/** Options or groups changed: every group lines up behind its leader. */
function realignAll(): void {
  const seen = new Set<string>()
  const ordered = members.filter((m) => m.primary).concat(members.filter((m) => !m.primary))
  ordered.forEach((m) => {
    const gk = groupKey(m)
    if (!gk || seen.has(gk) || !usable(m)) return
    seen.add(gk)
    // A leader with no window of its own yet takes the group's last one.
    const w = windows.get(gk)
    if (w && !m.primary) apply(m, w)
    publishFrom(m)
  })
}

/** One set of document listeners finds the chart under the user's input. */
let watching = false
function watchInput(): void {
  if (watching || typeof document === 'undefined') return
  watching = true
  const take = (e: Event) => {
    const t = e.target
    if (!(t instanceof Element)) return
    const m = members.find((x) => x.owns(t))
    if (!m) return
    driver = m
    driverUntil = now() + DRIVE_MS
  }
  const opts: AddEventListenerOptions = { capture: true, passive: true }
  document.addEventListener('pointerdown', take, opts)
  // A drag keeps its chart driving, however long it lasts.
  document.addEventListener('pointermove', (e) => (e.buttons ? take(e) : undefined), opts)
  document.addEventListener('wheel', take, opts)
  document.addEventListener('touchstart', take, opts)
  document.addEventListener('keydown', take, opts)
}

export function registerTimeSync(m: TimeSyncMember): TimeSyncHandle {
  members.push(m)
  watchInput()
  // One broadcast per frame however fast the range moves.
  let frame = 0
  const onRange = () => {
    if (driver !== m || now() > driverUntil || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      publishFrom(m)
    })
  }
  m.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange)
  return {
    adopt: () => adoptInto(m),
    publish: () => publishFrom(m),
    off: () => {
      const i = members.indexOf(m)
      if (i === -1) return
      members.splice(i, 1)
      if (driver === m) driver = null
      if (frame) cancelAnimationFrame(frame)
      try {
        m.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange)
      } catch (e) {
        /* chart already removed */
      }
    },
  }
}
