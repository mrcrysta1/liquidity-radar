// Merging the news feeds and loading them progressively. Pure: no DOM, no
// fetch, no store — newsFeed.ts supplies the fetcher and the renderer, and the
// unit tests drive it under plain Node.
import type { NewsItem } from './newsItem.ts'

function norm(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Exact-or-near duplicate headlines: same text, or ≥60% shared long words. */
export function newsDedup(a: string, b: string): boolean {
  return sameStory(prep(a), prep(b))
}

export function newsNormKey(t: string): string {
  return t
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 60)
}

interface Prepped {
  n: string
  words: Set<string>
}

function prep(t: string): Prepped {
  const n = norm(t)
  return { n, words: new Set(n.split(' ').filter((w) => w.length > 3)) }
}

function sameStory(a: Prepped, b: Prepped): boolean {
  if (a.n === b.n) return true
  if (!a.words.size || !b.words.size) return false
  let inter = 0
  a.words.forEach((w) => {
    if (b.words.has(w)) inter++
  })
  const union = a.words.size + b.words.size - inter
  return union > 0 && inter / union >= 0.6
}

/**
 * One wire from the per-feed results, in feed order (so the outcome does not
 * depend on which feed answered first): drop near-duplicates, newest first.
 * Same rules the all-at-once merge used; headlines are normalised once each
 * rather than once per comparison, since this now runs on every feed arrival.
 */
export function mergeNewsFeeds(feeds: ReadonlyArray<readonly NewsItem[] | null | undefined>): NewsItem[] {
  const merged: Array<{ item: NewsItem; p: Prepped; k: string }> = []
  feeds.forEach((items) => {
    if (!items) return
    items.forEach((n) => {
      if (!n || typeof n.title !== 'string') return
      const k = newsNormKey(n.title)
      if (!k) return
      const p = prep(n.title)
      if (!merged.some((m) => m.k === k || sameStory(m.p, p))) merged.push({ item: n, p, k })
    })
  })
  merged.sort((a, b) => b.item.time - a.item.time)
  const unique: typeof merged = []
  merged.forEach((m) => {
    if (unique.some((u) => sameStory(u.p, m.p))) return
    unique.push(m)
  })
  return unique.map((u) => u.item)
}

/**
 * - loading: nothing to show yet (deadline not reached)
 * - ready:   items on screen (live, or the cached copy while live loads)
 * - empty:   the feeds answered but carried no stories
 * - error:   nothing arrived by the deadline, or every feed failed
 */
export type NewsPhase = 'loading' | 'ready' | 'empty' | 'error'

export interface NewsLoadUpdate {
  items: NewsItem[]
  phase: NewsPhase
  /** The items are the previous/cached wire, not this run's feeds. */
  cached: boolean
  /** Feeds settled so far, and how many of them answered. */
  done: number
  ok: number
  total: number
}

export interface NewsLoadOptions {
  total: number
  /** Resolves to the feed's items, or null/rejects when that feed failed. */
  fetchFeed: (i: number) => Promise<NewsItem[] | null>
  onUpdate: (u: NewsLoadUpdate) => void
  /** What is already on screen (the lr_news_cache copy or the last wire). */
  cached?: NewsItem[] | null
  /** After this, whatever arrived is shown and the loading state ends. */
  deadlineMs: number
  /** Gap between feed starts, to stay under rss2json's free-tier throttle. */
  staggerMs?: number
  /** Return false to drop updates from a superseded run. */
  isCurrent?: () => boolean
}

function sameUpdate(a: NewsLoadUpdate, b: NewsLoadUpdate): boolean {
  return (
    a.phase === b.phase &&
    a.cached === b.cached &&
    a.items.length === b.items.length &&
    a.items.every((n, i) => n === b.items[i])
  )
}

/**
 * Fetch every feed at once and publish the merged wire as feeds land.
 *
 * With nothing on screen the first feed to answer is shown straight away.
 * With a cached wire on screen it stays until every feed has settled or the
 * deadline passes — swapping a full cached list for one feed's dozen stories
 * would read as the news shrinking. Feeds that land after the deadline still
 * merge in. Resolves with the final update once every feed has settled.
 */
export function loadNewsProgressive(o: NewsLoadOptions): Promise<NewsLoadUpdate> {
  const results: Array<NewsItem[] | null> = new Array(o.total).fill(null)
  const cached = o.cached && o.cached.length ? o.cached : null
  let done = 0
  let okCount = 0
  let past = false
  let last: NewsLoadUpdate | null = null
  const current = () => (o.isCurrent ? o.isCurrent() : true)

  const emit = (final: boolean) => {
    if (!current()) return
    const live = mergeNewsFeeds(results)
    const allIn = done >= o.total
    let u: NewsLoadUpdate
    const base = { done, ok: okCount, total: o.total }
    if (live.length && (!cached || past || allIn)) {
      u = { ...base, items: live, phase: 'ready', cached: false }
    } else if (cached) {
      u = { ...base, items: cached, phase: 'ready', cached: true }
    } else if (allIn) {
      u = { ...base, items: [], phase: okCount ? 'empty' : 'error', cached: false }
    } else if (past) {
      u = { ...base, items: [], phase: 'error', cached: false }
    } else {
      u = { ...base, items: [], phase: 'loading', cached: false }
    }
    // Only publish changes: a feed that adds nothing new (or a cached screen
    // waiting out the deadline) would otherwise re-render the same list.
    if (!final && last && sameUpdate(last, u)) return
    last = u
    o.onUpdate(u)
  }

  emit(false)
  const timer = setTimeout(() => {
    past = true
    emit(false)
  }, o.deadlineMs)

  const jobs = Array.from({ length: o.total }, (_, i) =>
    new Promise<void>((res) => setTimeout(res, i * (o.staggerMs || 0)))
      .then(() => o.fetchFeed(i))
      .then(
        (items) => {
          results[i] = items && items.length ? items : null
          if (items) okCount++
        },
        () => {
          results[i] = null
        },
      )
      .then(() => {
        done++
        if (done < o.total) emit(false)
      }),
  )
  return Promise.all(jobs).then(() => {
    clearTimeout(timer)
    past = true
    emit(true)
    return last!
  })
}

/**
 * Ask `primary` first; if it fails, or has not answered within `headStartMs`,
 * ask `fallback` too and take whichever succeeds first. Rejects only when
 * both fail.
 */
export function hedge<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  headStartMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let fallbackStarted = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const win = (v: T) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(v)
    }
    const lose = (e: unknown) => {
      failures++
      if (settled) return
      if (failures >= 2) {
        settled = true
        reject(e)
      } else startFallback()
    }
    const startFallback = () => {
      if (fallbackStarted || settled) return
      fallbackStarted = true
      if (timer) clearTimeout(timer)
      let p: Promise<T>
      try {
        p = fallback()
      } catch (e) {
        p = Promise.reject(e)
      }
      p.then(win, lose)
    }
    let p: Promise<T>
    try {
      p = primary()
    } catch (e) {
      p = Promise.reject(e)
    }
    p.then(win, lose)
    timer = setTimeout(startFallback, headStartMs)
  })
}
