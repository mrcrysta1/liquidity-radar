// Polling that stands down when nobody is looking.
//
// Every REST loop in this app used to run on a plain setInterval, so a
// backgrounded tab kept spending Binance's weight budget on renders nobody
// could see. That is not merely wasteful: exhausting the budget is what earns a
// 418 and takes the chart down for everyone in the building on that IP.
//
// A registered poll runs on its interval while the page is visible, pauses when
// it is hidden, and fires once on return if it is overdue — so coming back to
// the tab shows fresh data rather than whatever was on screen when you left.
type Job = {
  fn: () => void
  everyMs: number
  /** Keep running while hidden — only for things that must not miss a beat. */
  always: boolean
  last: number
  timer: ReturnType<typeof setTimeout> | null
}

const jobs: Job[] = []
let started = false

const hidden = (): boolean => typeof document !== 'undefined' && document.hidden

function arm(job: Job): void {
  if (job.timer) clearTimeout(job.timer)
  job.timer = setTimeout(() => {
    job.timer = null
    if (hidden() && !job.always) return // resume() will pick it up
    try {
      job.fn()
    } catch (e) {
      console.warn('poll job failed', e)
    }
    job.last = Date.now()
    arm(job)
  }, job.everyMs)
}

function resume(): void {
  const now = Date.now()
  jobs.forEach((job) => {
    if (job.timer) return
    // Overdue while we were away: run straight off, so the first paint after
    // the tab regains focus is not stale.
    if (now - job.last >= job.everyMs) {
      try {
        job.fn()
      } catch (e) {
        console.warn('poll job failed', e)
      }
      job.last = now
    }
    arm(job)
  })
}

function pause(): void {
  jobs.forEach((job) => {
    if (job.always) return
    if (job.timer) clearTimeout(job.timer)
    job.timer = null
  })
}

/**
 * Run `fn` every `everyMs` while the page is visible.
 *
 * `always: true` opts a job out of pausing — use it only where a gap would
 * corrupt state rather than merely delay a number.
 */
export function poll(fn: () => void, everyMs: number, opts?: { always?: boolean }): void {
  const job: Job = { fn, everyMs, always: !!opts?.always, last: Date.now(), timer: null }
  jobs.push(job)
  arm(job)
  if (!started && typeof document !== 'undefined') {
    started = true
    document.addEventListener('visibilitychange', () => (hidden() ? pause() : resume()))
  }
}

/** How many polls are registered, and how many are currently armed. */
export function pollStats(): { total: number; armed: number } {
  return { total: jobs.length, armed: jobs.filter((j) => j.timer !== null).length }
}
