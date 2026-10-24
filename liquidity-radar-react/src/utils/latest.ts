// "Only the newest request may answer." Each start() supersedes every earlier
// one, so an async result that resolves late can check whether it is still
// wanted before it writes to the page.

export interface Latest {
  /** Begin a new request and get its token; every older token goes stale. */
  start(): number
  /** True while `token` belongs to the most recent start(). */
  isCurrent(token: number): boolean
}

export function createLatest(): Latest {
  let seq = 0
  return {
    start: () => ++seq,
    isCurrent: (token) => token === seq,
  }
}
