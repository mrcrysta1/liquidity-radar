// Least-recently-used cap for the plain-object caches in services/market.ts —
// the same delete-and-reinsert pattern as providerChain's memoryStore, kept on
// a Record so existing `cache[key]` readers are unchanged. String keys that are
// not integers keep insertion order, so the first key is the least recent.

/** Mark `key` as just used, if it is present. */
export function lruTouch<V>(rec: Record<string, V>, key: string): void {
  if (!Object.prototype.hasOwnProperty.call(rec, key)) return
  const v = rec[key]
  delete rec[key]
  rec[key] = v
}

/**
 * Store `value` under `key` as the most recent entry, then evict the least
 * recent until at most `max` remain. `key` itself and any key `keep` protects
 * (the series on screen) are never evicted.
 */
export function lruSet<V>(
  rec: Record<string, V>,
  key: string,
  value: V,
  max: number,
  keep?: (k: string) => boolean,
): void {
  delete rec[key]
  rec[key] = value
  const keys = Object.keys(rec)
  let over = keys.length - max
  for (const k of keys) {
    if (over <= 0) break
    if (k === key || (keep && keep(k))) continue
    delete rec[k]
    over--
  }
}
