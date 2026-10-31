// The pop-out chart window's URL and sync messages. Pure, no imports, so
// scripts/test-engines.mjs runs it; ./popout wires it to the app.

export interface PopoutParams {
  sym: string
  tf: string
  /** The BroadcastChannel the window and its opener talk on. */
  ch: string
}

/** A symbol as setSymbol takes it, ratio / spread expressions included. */
const SYM = /^[A-Z0-9.^=_/*+-]{2,48}$/
const TF = /^[0-9]{1,4}[A-Za-z]{1,3}$/
const CH = /^[a-z0-9]{4,32}$/

export function cleanSym(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toUpperCase()
  return SYM.test(s) ? s : null
}
export function cleanTf(v: unknown): string | null {
  return typeof v === 'string' && TF.test(v) ? v : null
}

/** The popout's parameters from `location.search`, or null for the normal app. */
export function parsePopout(search: string): PopoutParams | null {
  let q: URLSearchParams
  try {
    q = new URLSearchParams(search)
  } catch {
    return null
  }
  if (q.get('popout') !== '1') return null
  const ch = q.get('ch') || ''
  return { sym: cleanSym(q.get('sym')) || '', tf: cleanTf(q.get('tf')) || '', ch: CH.test(ch) ? ch : '' }
}

/** The query string that opens a popout on `sym` / `tf`. */
export function popoutSearch(p: PopoutParams): string {
  return (
    '?popout=1&sym=' + encodeURIComponent(p.sym) + '&tf=' + encodeURIComponent(p.tf) + '&ch=' + encodeURIComponent(p.ch)
  )
}

export type SyncMsg = { k: 'sym'; v: string } | { k: 'tf'; v: string }

/** A message off the channel, validated; null for anything else. */
export function readSyncMsg(d: unknown): SyncMsg | null {
  if (!d || typeof d !== 'object') return null
  const m = d as { k?: unknown; v?: unknown }
  if (m.k === 'sym') {
    const v = cleanSym(m.v)
    return v ? { k: 'sym', v } : null
  }
  if (m.k === 'tf') {
    const v = cleanTf(m.v)
    return v ? { k: 'tf', v } : null
  }
  return null
}
