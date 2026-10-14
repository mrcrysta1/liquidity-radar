// Reading the Binance aggTrade tape into whale orders, exactly.
//
// An order is a run of consecutive aggTrades sharing a transaction time and
// side (groupAggTrades in the app's whaleMath.ts). The tape arrives in pieces
// — REST pages of 1000 going backwards, and the live websocket going forward —
// and an order can straddle any piece boundary. So nothing is grouped until
// both of its edges have been seen:
//
//  - Backfill walks down from a starting id. The lowest group of each page
//    might continue into the next (older) page, so it is carried down and
//    prepended to that page before grouping.
//  - The live stream holds its newest group back until a different one
//    follows, so a group is never cut by a flush.
//  - The first group a websocket connection sees may have started before the
//    connection did: it becomes the carry for a backfill that starts right
//    below it. That same backfill also closes the hole a reconnect leaves.
//
// Invariant: every coverage range starts and ends on an order boundary. So
// stopping anywhere — budget, crash, restart — never leaves a half-order
// stored, and resuming picks up cleanly at the edge of what is covered.
import { groupAggTrades } from '../../liquidity-radar-react/src/features/whales/whaleMath.ts'
import type { Agg, WhaleOrder } from '../../liquidity-radar-react/src/features/whales/whaleMath.ts'

export type { Agg, WhaleOrder }

export interface Cov {
  a0: number
  a1: number
  t0: number
  t1: number
}

export interface TapeSink {
  /**
   * Orders (already over the floor) and the id range they were read from.
   * Must add `cov` to covered() synchronously, before its first await: that
   * is what stops two readers of the same stretch from both saving it.
   */
  save(orders: WhaleOrder[], cov: Cov): Promise<void>
  /** Current coverage, including everything saved so far this run. */
  covered(): Cov[]
  floor: number
}

const sameGroup = (x: Agg, y: Agg): boolean => x.T === y.T && x.m === y.m && y.a === x.a + 1

/** [leading group, rest] of an ascending run of aggTrades. */
export function splitLead(trades: Agg[]): [Agg[], Agg[]] {
  let i = 1
  while (i < trades.length && sameGroup(trades[i - 1], trades[i])) i++
  return [trades.slice(0, i), trades.slice(i)]
}

/** [rest, trailing group] of an ascending run of aggTrades. */
export function splitTail(trades: Agg[]): [Agg[], Agg[]] {
  let i = trades.length - 1
  while (i > 0 && sameGroup(trades[i - 1], trades[i])) i--
  return [trades.slice(0, i), trades.slice(i)]
}

/** Merge a range into a coverage list (sorted by id, touching ranges joined). */
export function mergeCoverage(list: Cov[], c: Cov): Cov[] {
  const all = [...list, c].sort((x, y) => x.a0 - y.a0)
  const out: Cov[] = []
  for (const s of all) {
    const last = out[out.length - 1]
    if (last && s.a0 <= last.a1 + 1) {
      if (s.a1 > last.a1) {
        last.a1 = s.a1
        last.t1 = s.t1
      }
      if (s.t0 < last.t0) last.t0 = s.t0
    } else out.push({ ...s })
  }
  return out
}

/** Synchronous up to sink.save, so coverage is claimed in the same tick. */
function emit(sink: TapeSink, trades: Agg[]): Promise<void> {
  if (!trades.length) return Promise.resolve()
  const orders = groupAggTrades(trades).filter((o) => o.usd >= sink.floor)
  const first = trades[0]
  const last = trades[trades.length - 1]
  return sink.save(orders, { a0: first.a, a1: last.a, t0: first.T, t1: last.T })
}

const coveredAt = (cov: Cov[], id: number) => cov.find((c) => id >= c.a0 && id <= c.a1)
const topBelow = (cov: Cov[], id: number) =>
  cov.filter((c) => c.a1 < id).reduce((m, c) => Math.max(m, c.a1), -1)

export interface BackfillOpts {
  /** Returns ascending aggTrades with ids fromId .. fromId+limit-1. */
  fetchPage(fromId: number, limit: number): Promise<Agg[]>
  pageSize: number
  paceMs: number
  /** Stop once trades older than this (ms) have been read. */
  stopT: number
  /** Checked between pages; true aborts (shutdown). */
  cancelled?: () => boolean
}

/**
 * Read the tape downwards from `cursor` (inclusive), with `carry` — an
 * ascending group whose lower edge is unknown — sitting directly above it.
 * Covered ranges are skipped; the walk ends at `stopT`, id 0 or cancellation.
 */
export async function backfillChain(
  sink: TapeSink,
  o: BackfillOpts,
  cursor: number,
  carry: Agg[],
): Promise<{ pages: number }> {
  let pages = 0
  while (!o.cancelled?.()) {
    if (cursor < 0) {
      await emit(sink, carry) // id 0 is a hard lower edge
      break
    }
    const inside = coveredAt(sink.covered(), cursor)
    if (inside) {
      // Covered ranges end on an order boundary, so the carry is complete.
      await emit(sink, carry)
      carry = []
      if (inside.t0 <= o.stopT) break
      cursor = inside.a0 - 1
      continue
    }
    let floorId = topBelow(sink.covered(), cursor) + 1
    let from = Math.max(floorId, cursor - o.pageSize + 1)
    const fetched = await o.fetchPage(from, cursor - from + 1)
    pages++
    // Another reader (the live tape, or a second backfill) may have covered
    // part of this stretch while the page was in flight: look again.
    if (coveredAt(sink.covered(), cursor)) continue
    floorId = Math.max(floorId, topBelow(sink.covered(), cursor) + 1)
    from = Math.max(from, floorId)
    const page = fetched.filter((t) => t.a >= from && t.a <= cursor)
    if (!page.length) break // the exchange has nothing older (or failed): stop, carry uncovered
    let trades = page.concat(carry)
    let lead: Agg[] = []
    // Directly above covered ground (or id 0) the lowest group is complete;
    // anywhere else it may continue into the next page down.
    if (from !== floorId) [lead, trades] = splitLead(trades)
    await emit(sink, trades)
    carry = lead
    cursor = from - 1
    if (trades.length && trades[0].T < o.stopT) break
    if (o.paceMs) await new Promise((r) => setTimeout(r, o.paceMs))
  }
  return { pages }
}

/**
 * The live websocket side. Push every aggTrade; completed groups are saved.
 * The first group of the connection is handed to `onHead` instead — start a
 * backfillChain(head[0].a - 1, head) with it.
 */
export class LiveTape {
  private pending: Agg[] = []
  private started = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()
  private sink: TapeSink
  private onHead: (head: Agg[]) => void
  private flushMs: number

  constructor(sink: TapeSink, onHead: (head: Agg[]) => void, flushMs = 250) {
    this.sink = sink
    this.onHead = onHead
    this.flushMs = flushMs
  }

  push(t: Agg): void {
    const last = this.pending[this.pending.length - 1]
    // An id gap inside one connection means frames were dropped. Close what is
    // held, and treat what follows as a fresh head so a backfill fills the hole.
    if (last && t.a !== last.a + 1 && t.a > last.a) {
      this.flush(true)
      this.started = false
    }
    this.pending.push(t)
    if (!this.timer) this.timer = setTimeout(() => this.flush(false), this.flushMs)
  }

  /**
   * Saves every group whose upper edge is proven — i.e. a different trade has
   * followed it. The newest group always waits for that, however long it
   * takes; on a close (`final`) it is dropped, and the next connection's
   * backfill reads it again from REST.
   */
  flush(final: boolean): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.pending.length) return
    const split = splitTail(this.pending)
    let page = split[0]
    const tail = split[1]
    this.pending = final ? [] : tail
    if (!page.length) return
    if (!this.started) {
      this.started = true
      const [head, rest] = splitLead(page)
      this.onHead(head)
      page = rest
      if (!page.length) return
    }
    // Saved now, not queued: coverage must be claimed before any backfill looks.
    const saving = emit(this.sink, page)
    this.chain = this.chain.then(() => saving).catch(() => {})
  }

  /** Resolves once every save queued so far has finished. */
  idle(): Promise<void> {
    return this.chain
  }
}
