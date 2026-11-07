// A small request cache for the bot tables (serverBot.ts rest): identical GETs
// in flight or answered within `ttl` share one response, failures are never
// kept, arrays are handed out as copies (a caller sorting its rows cannot
// reorder another's), and a request gets one retry after a network failure, a
// 5xx or a rate limit. Pure apart from the fetcher it is given (tested in
// scripts/test-engines.mjs).

export interface GetResult {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export interface CachedGetOptions {
  ttl: number
  retryMs?: number
  max?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export function cachedGet(fetcher: (path: string) => Promise<GetResult>, o: CachedGetOptions): <T>(path: string) => Promise<T> {
  const now = o.now ?? Date.now
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const retryMs = o.retryMs ?? 800
  const max = o.max ?? 200
  const cache = new Map<string, { at: number; p: Promise<unknown> }>()

  async function once(path: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      let r: GetResult
      try {
        r = await fetcher(path)
      } catch (e) {
        if (attempt > 0) throw e
        await sleep(retryMs)
        continue
      }
      if (r.ok) return r.json()
      if (attempt === 0 && (r.status >= 500 || r.status === 429)) {
        await sleep(retryMs)
        continue
      }
      throw new Error('bot records: HTTP ' + r.status)
    }
  }

  return async <T>(path: string): Promise<T> => {
    const t = now()
    let hit = cache.get(path)
    if (!hit || t - hit.at > o.ttl) {
      const entry = { at: t, p: once(path) }
      cache.set(path, entry)
      // A failure is forgotten — unless a newer request for the path has replaced it.
      entry.p.catch(() => {
        if (cache.get(path) === entry) cache.delete(path)
      })
      if (cache.size > max) for (const [k, v] of cache) if (t - v.at > o.ttl) cache.delete(k)
      hit = entry
    }
    const v = await hit.p
    return (Array.isArray(v) ? [...v] : v) as T
  }
}
