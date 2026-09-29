// Which settings belong to a user, and how they move between this browser
// and the user's row in Supabase.
//
// While signed out the app keeps using localStorage exactly as before (the
// "guest" profile). Signing in saves the guest profile aside, loads the
// user's own settings in its place, and reloads so every module starts from
// them; every later change is saved back to the account a moment after it
// is made. Signing out saves once more, then puts the guest profile back.
import { setStorageWriteHook } from '../../services/storage'

/** Everything a user would call "my settings". Caches and market data stay local. */
export const SYNC_KEYS = [
  // look
  'lr-theme', 'lr-palette-v3', 'lr-navCollapsed',
  // chart
  'lr-chartIndicators', 'lr-chartPrefs', 'lr-chartLayout', 'lr-chartMagnet', 'lr-tf', 'lr-tfFavs', 'lr-tfGroups',
  'lr-chartSide', 'lr-chartSideTab', 'lr-showDelta', 'lr-showMLPrediction', 'lr-showConfluence', 'lr-showObGauge',
  'lr-showRLPolicy', 'lr-showVolumeProfile', 'lr-vpSettings', 'lr-showWhaleBubbles', 'lr-whaleMult', 'lr-mc-cols',
  'lr-drawings-v1', 'lr-pineScripts', 'lr-panelIndicators-v1',
  // lists and alerts
  'lr-favCoins', 'lr-pinCoin', 'lr_alerts_v1',
  // paper trading and the self-learning engine
  'lr-paperTrades', 'lr-rlAutoTrade', 'lr-sl-config-v1', 'lr-sl-trades-v1', 'lr-sl-log-v1', 'lr-sl-models-v1',
] as const
const SYNC = new Set<string>(SYNC_KEYS)

export const K = {
  uid: 'lr-auth-uid',
  synced: 'lr-auth-synced',
  guest: 'lr-guest-profile',
} as const

export type Profile = Record<string, string>

export function collect(): Profile {
  const out: Profile = {}
  SYNC_KEYS.forEach((k) => {
    const v = localStorage.getItem(k)
    if (v != null) out[k] = v
  })
  return out
}

/** Replace every synced key with the profile's value (absent = back to default). */
export function apply(p: Profile): void {
  SYNC_KEYS.forEach((k) => {
    if (p[k] != null) localStorage.setItem(k, p[k])
    else localStorage.removeItem(k)
  })
}

export function same(a: Profile, b: Profile): boolean {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

/** Records the engine rewrites often: saved at most once a minute. */
const HEAVY = new Set<string>(['lr-paperTrades', 'lr-sl-trades-v1', 'lr-sl-log-v1', 'lr-sl-models-v1', 'lr-sl-config-v1'])

let timer: ReturnType<typeof setTimeout> | null = null
let due = 0
let pushFn: (() => Promise<void>) | null = null

function schedule(ms: number): void {
  const at = Date.now() + ms
  // A sooner save wins; a later one never pushes an earlier one back.
  if (timer && at >= due) return
  if (timer) clearTimeout(timer)
  due = at
  timer = setTimeout(() => {
    timer = null
    void pushFn?.()
  }, ms)
}

/** Save to the account shortly after any synced setting changes. */
export function startSyncing(push: () => Promise<void>): void {
  pushFn = push
  setStorageWriteHook((key) => {
    if (!SYNC.has(key)) return
    schedule(HEAVY.has(key) ? 60_000 : 1500)
  })
  // A tab being closed gets one last chance to save.
  window.addEventListener('pagehide', flushSoon)
}

function flushSoon(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
    void pushFn?.()
  }
}

export function stopSyncing(): void {
  setStorageWriteHook(null)
  window.removeEventListener('pagehide', flushSoon)
  if (timer) clearTimeout(timer)
  timer = null
  pushFn = null
}
