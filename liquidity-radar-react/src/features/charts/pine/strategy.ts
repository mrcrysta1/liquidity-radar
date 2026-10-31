// Pine strategy broker emulator — what runs strategy.entry / exit / close
// orders against the chart's bars and keeps the trade list and equity.
//
// Fill model (TradingView's defaults, so a script backtests the same way):
//  - Orders placed while the script runs on bar i are filled from bar i+1:
//    market orders at its open, limit/stop orders where the price path
//    through that bar first reaches them (they stay working until filled
//    or cancelled). `process_orders_on_close=true` fills market orders at
//    the close of the bar that placed them instead; `immediately=true` on
//    strategy.close / close_all does the same for that one order.
//  - Inside a bar the price is assumed to go open → nearer extreme →
//    farther extreme → close (TradingView's broker emulator rule), which
//    decides whether a stop or a take-profit was hit first.
//  - A limit that the open already gaps through fills at the open (the
//    better price); a stop gapped through also fills at the open.
//  - Slippage (ticks) worsens market and stop fills; limits fill at their
//    price. Commission is charged on every fill.
//  - Trailing stops ratchet with each bar's extreme once that bar is over,
//    so they act from the following bar (TradingView trails intrabar).
// Not modelled: stop-limit orders (the stop is used), OCA groups, margin
// calls, partial exits through strategy.exit qty/qty_percent (the whole
// trade exits).
//
// Kept free of app imports (Node runs it directly in the engine tests).

export type Side = 1 | -1
export interface StrategyConfig {
  initialCapital: number
  qtyType: 'fixed' | 'cash' | 'percent_of_equity'
  qtyValue: number
  commissionType: 'percent' | 'cash_per_contract' | 'cash_per_order'
  commissionValue: number
  /** Max entries in one direction (0 behaves as 1, as in Pine). */
  pyramiding: number
  /** Ticks against the trader on market and stop fills. */
  slippage: number
  mintick: number
  processOnClose: boolean
}
export const DEFAULT_STRATEGY: StrategyConfig = {
  initialCapital: 1000000,
  qtyType: 'fixed',
  qtyValue: 1,
  commissionType: 'percent',
  commissionValue: 0,
  pyramiding: 0,
  slippage: 0,
  mintick: 0.01,
  processOnClose: false,
}

export interface StrategyTrade {
  entryId: string
  dir: 'long' | 'short'
  qty: number
  entryBar: number
  entryTime: number
  entryPrice: number
  entryComment?: string
  /** Order id that closed it (exit id, close id, or the reversing entry). */
  exitId?: string
  exitBar?: number
  exitTime?: number
  exitPrice?: number
  exitComment?: string
  /** Net of commission. Open trades: marked at the last close. */
  profit: number
  profitPct: number
  commission: number
  open?: boolean
}
export interface StrategySummary {
  initialCapital: number
  netProfit: number
  netProfitPct: number
  grossProfit: number
  grossLoss: number
  /** Closed trades. */
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  /** Gross profit / gross loss; null with no losing trade. */
  profitFactor: number | null
  maxDrawdown: number
  maxDrawdownPct: number
  avgTrade: number
  avgTradePct: number
  openPL: number
  commission: number
  buyHoldPct: number
}
export interface StrategyReport {
  trades: StrategyTrade[]
  /** Equity at each bar's close (null before the strategy existed). */
  equity: Array<number | null>
  summary: StrategySummary
}

export interface BrokerBar {
  t: number
  o: number
  h: number
  l: number
  c: number
}
export interface ExitSpec {
  id: string
  /** Entry id it protects; '' = every open trade. */
  from: string
  profit?: number
  loss?: number
  limit?: number
  stop?: number
  trailPrice?: number
  trailPoints?: number
  trailOffset?: number
  comment?: string
}
interface Order {
  id: string
  kind: 'entry' | 'order' | 'close' | 'close_all'
  side: Side
  qty: number
  qtyPct?: number
  limit?: number
  stop?: number
  comment?: string
}
interface Trade {
  entryId: string
  side: Side
  qty: number
  price: number
  bar: number
  /** Where in its bar's path it opened (exits act only after that). */
  pos: number
  commission: number
  comment?: string
  /** Best price since entry, for the trailing stop. */
  best: number
  trailOn: boolean
}

const EPS = 1e-12

/** The assumed price path through a bar: open → nearer extreme → farther extreme → close. */
export function barPath(b: BrokerBar): number[] {
  return b.h - b.o <= b.o - b.l ? [b.o, b.h, b.l, b.c] : [b.o, b.l, b.h, b.c]
}
function priceAt(pts: number[], pos: number): number {
  const k = Math.floor(pos)
  if (k >= pts.length - 1) return pts[pts.length - 1]
  return pts[k] + (pts[k + 1] - pts[k]) * (pos - k)
}
/**
 * The first point at or after `from` where the price is ≥ x (`up`) or ≤ x:
 * [position along the path, fill price]. Already past it at `from` (a gap):
 * fills right there at the price of that moment.
 */
export function reach(pts: number[], x: number, up: boolean, from = 0): [number, number] | null {
  const p0 = priceAt(pts, from)
  if (up ? p0 >= x : p0 <= x) return [from, p0]
  for (let k = Math.floor(from); k < pts.length - 1; k++) {
    const s = Math.max(from, k)
    const a = s === from ? p0 : pts[k]
    const b = pts[k + 1]
    if (up ? b >= x : b <= x) return [s + (k + 1 - s) * ((x - a) / (b - a)), x]
  }
  return null
}

export interface Broker {
  /** Fill what was pending against bar i — call before the script runs on it. */
  beginBar(i: number): void
  /** After the script ran on bar i: on-close fills, trailing, equity. */
  endBar(i: number): void
  entry(id: string, side: Side, qty?: number, limit?: number, stop?: number, comment?: string): void
  order(id: string, side: Side, qty?: number, limit?: number, stop?: number, comment?: string): void
  exit(spec: ExitSpec): void
  close(id: string, comment?: string, qty?: number, qtyPct?: number, immediately?: boolean): void
  closeAll(comment?: string, immediately?: boolean): void
  cancel(id: string): void
  cancelAll(): void
  /** strategy.* variables as the script sees them now (`back` bars ago when > 0). */
  get(name: string, back?: number): number | string | undefined
  report(): StrategyReport
}

export const STRATEGY_VARS = [
  'strategy.position_size',
  'strategy.position_avg_price',
  'strategy.position_entry_name',
  'strategy.equity',
  'strategy.netprofit',
  'strategy.openprofit',
  'strategy.grossprofit',
  'strategy.grossloss',
  'strategy.closedtrades',
  'strategy.opentrades',
  'strategy.wintrades',
  'strategy.losstrades',
  'strategy.eventrades',
  'strategy.initial_capital',
  'strategy.max_drawdown',
]

export function createBroker(cfg: StrategyConfig, bars: BrokerBar[]): Broker {
  const tick = cfg.mintick > 0 ? cfg.mintick : 0.01
  const maxEntries = Math.max(1, Math.floor(cfg.pyramiding) || 0)
  let pending: Order[] = []
  const exits = new Map<string, ExitSpec>()
  let open: Trade[] = []
  const closed: StrategyTrade[] = []
  const equity: Array<number | null> = new Array(bars.length).fill(null)
  const snaps: Array<Record<string, number | string>> = []
  let realized = 0
  let commissionPaid = 0
  let cur = 0
  let peak = cfg.initialCapital
  let maxDd = 0
  let maxDdPct = 0

  const fee = (price: number, qty: number) =>
    cfg.commissionType === 'cash_per_contract'
      ? qty * cfg.commissionValue
      : cfg.commissionType === 'cash_per_order'
        ? cfg.commissionValue
        : (price * qty * cfg.commissionValue) / 100
  const netPos = () => open.reduce((s, t) => s + t.side * t.qty, 0)
  const openProfit = (price: number) =>
    open.reduce((s, t) => s + (price - t.price) * t.qty * t.side, 0)
  const equityAt = (price: number) => cfg.initialCapital + realized + openProfit(price)
  const slip = (price: number, buy: boolean) => price + (buy ? 1 : -1) * cfg.slippage * tick

  /** Contracts for an order placed now: explicit qty, else the strategy's default sizing. */
  function sizeOf(qty: number | undefined): number {
    if (qty != null && isFinite(qty) && qty > 0) return qty
    const price = bars[cur]?.c
    if (cfg.qtyType === 'fixed' || !price) return cfg.qtyValue
    if (cfg.qtyType === 'cash') return cfg.qtyValue / price
    return (Math.max(0, equityAt(price)) * cfg.qtyValue) / 100 / price
  }

  function closePart(t: Trade, qty: number, price: number, bar: number, exitId: string, comment?: string) {
    qty = Math.min(qty, t.qty)
    if (qty <= EPS) return
    const share = qty / t.qty
    const entryFee = t.commission * share
    const exitFee = fee(price, qty)
    commissionPaid += exitFee
    const profit = (price - t.price) * qty * t.side - entryFee - exitFee
    realized += profit
    closed.push({
      entryId: t.entryId,
      dir: t.side > 0 ? 'long' : 'short',
      qty,
      entryBar: t.bar,
      entryTime: bars[t.bar].t,
      entryPrice: t.price,
      entryComment: t.comment,
      exitId,
      exitBar: bar,
      exitTime: bars[bar].t,
      exitPrice: price,
      exitComment: comment,
      profit,
      profitPct: (profit / (t.price * qty)) * 100,
      commission: entryFee + exitFee,
    })
    t.qty -= qty
    t.commission -= entryFee
    if (t.qty <= EPS) open = open.filter((x) => x !== t)
  }
  function openTrade(o: Order, qty: number, price: number, bar: number, pos: number) {
    const f = fee(price, qty)
    commissionPaid += f
    open.push({
      entryId: o.id,
      side: o.side,
      qty,
      price,
      bar,
      pos,
      commission: f,
      comment: o.comment,
      best: price,
      trailOn: false,
    })
  }

  /** Execute one order at `price`. */
  function fill(o: Order, price: number, bar: number, pos: number) {
    if (o.kind === 'close' || o.kind === 'close_all') {
      const hit = o.kind === 'close_all' ? open.slice() : open.filter((t) => t.entryId === o.id)
      const total = hit.reduce((s, t) => s + t.qty, 0)
      let left =
        o.qtyPct != null ? (total * o.qtyPct) / 100 : isFinite(o.qty) && o.qty > 0 ? o.qty : total
      for (const t of hit) {
        if (left <= EPS) break
        const q = Math.min(left, t.qty)
        closePart(t, q, price, bar, o.kind === 'close_all' ? 'Close all' : o.id, o.comment)
        left -= q
      }
      return
    }
    const pos0 = netPos()
    if (o.kind === 'entry') {
      if (pos0 !== 0 && Math.sign(pos0) !== o.side) {
        // Reversal: the opposite position is closed by this entry, then it opens.
        for (const t of open.slice()) closePart(t, t.qty, price, bar, o.id, o.comment)
      } else if (open.filter((t) => t.side === o.side).length >= maxEntries) return
      openTrade(o, o.qty, price, bar, pos)
      return
    }
    // strategy.order: no reversal logic, no pyramiding limit — it nets
    // against the opposite trades first-in-first-out, the rest opens.
    let q = o.qty
    for (const t of open.slice()) {
      if (q <= EPS) break
      if (t.side === o.side) continue
      const take = Math.min(q, t.qty)
      closePart(t, take, price, bar, o.id, o.comment)
      q -= take
    }
    if (q > EPS) openTrade(o, q, price, bar, pos)
  }

  /**
   * After a fill: an exit whose trades are all closed (and whose entry is not
   * still working) is cancelled, as in Pine — so it cannot carry stale price
   * levels onto the next trade with the same entry id.
   */
  function dropIdleExits() {
    for (const [id, x] of exits) {
      const live = open.some((t) => x.from === '' || t.entryId === x.from)
      const waiting = pending.some(
        (o) => (o.kind === 'entry' || o.kind === 'order') && (x.from === '' || o.id === x.from),
      )
      if (!live && !waiting) exits.delete(id)
    }
  }

  /** Price levels an exit puts on a trade. */
  function exitLevels(x: ExitSpec, t: Trade): { limit?: number; stop?: number } {
    const limit = x.limit ?? (x.profit != null ? t.price + t.side * x.profit * tick : undefined)
    let stop = x.stop ?? (x.loss != null ? t.price - t.side * x.loss * tick : undefined)
    if (t.trailOn && x.trailOffset != null) {
      const ts = t.best - t.side * x.trailOffset * tick
      stop = stop == null ? ts : t.side > 0 ? Math.max(stop, ts) : Math.min(stop, ts)
    }
    return { limit, stop }
  }

  function runMarket(bar: number, price: number, pos: number) {
    const market = pending.filter((o) => o.limit == null && o.stop == null)
    pending = pending.filter((o) => o.limit != null || o.stop != null)
    for (const o of market) {
      const buy = o.kind === 'close' || o.kind === 'close_all' ? netPos() < 0 : o.side > 0
      fill(o, slip(price, buy), bar, pos)
      dropIdleExits()
    }
  }

  function beginBar(i: number) {
    cur = i
    const b = bars[i]
    if (!b) return
    const pts = barPath(b)
    if (pending.length) runMarket(i, b.o, 0)
    let from = 0
    // Fill the earliest-reached order, then look again from there: a fill
    // can open a trade whose stop or target is reached later in the bar.
    for (let guard = 0; guard < 500; guard++) {
      const pick: { pos: number; price: number; run: (price: number, pos: number) => void }[] = []
      const offer = (hit: [number, number] | null, run: (price: number, pos: number) => void) => {
        if (hit && (!pick.length || hit[0] < pick[0].pos - EPS)) pick[0] = { pos: hit[0], price: hit[1], run }
      }
      for (const o of pending) {
        const buy = o.side > 0
        const take = (price: number, pos: number) => {
          pending = pending.filter((x) => x !== o)
          fill(o, price, i, pos)
        }
        if (o.stop != null) offer(reach(pts, o.stop, buy, from), (p, pos) => take(slip(p, buy), pos))
        else if (o.limit != null) offer(reach(pts, o.limit, !buy, from), take)
      }
      for (const x of exits.values()) {
        for (const t of open) {
          if (x.from && t.entryId !== x.from) continue
          const lv = exitLevels(x, t)
          const start = Math.max(from, t.bar === i ? t.pos : 0)
          const long = t.side > 0
          // Stop first: when both are reached at once the worse fill is assumed.
          if (lv.stop != null)
            offer(reach(pts, lv.stop, !long, start), (p) =>
              closePart(t, t.qty, slip(p, !long), i, x.id, x.comment),
            )
          if (lv.limit != null)
            offer(reach(pts, lv.limit, long, start), (p) => closePart(t, t.qty, p, i, x.id, x.comment))
        }
      }
      const chosen = pick[0]
      if (!chosen) break
      from = chosen.pos
      chosen.run(chosen.price, chosen.pos)
      dropIdleExits()
    }
  }

  function snapshot(i: number) {
    const c = bars[i].c
    const pos = netPos()
    const qty = open.reduce((s, t) => s + t.qty, 0)
    snaps[i] = {
      'strategy.position_size': pos,
      'strategy.position_avg_price': qty ? open.reduce((s, t) => s + t.price * t.qty, 0) / qty : NaN,
      'strategy.position_entry_name': open[0]?.entryId ?? '',
      'strategy.equity': equityAt(c),
      'strategy.netprofit': realized,
      'strategy.openprofit': openProfit(c),
      'strategy.grossprofit': closed.reduce((s, t) => s + Math.max(0, t.profit), 0),
      'strategy.grossloss': closed.reduce((s, t) => s - Math.min(0, t.profit), 0),
      'strategy.closedtrades': closed.length,
      'strategy.opentrades': open.length,
      'strategy.wintrades': closed.filter((t) => t.profit > 0).length,
      'strategy.losstrades': closed.filter((t) => t.profit < 0).length,
      'strategy.eventrades': closed.filter((t) => t.profit === 0).length,
      'strategy.initial_capital': cfg.initialCapital,
      'strategy.max_drawdown': maxDd,
    }
  }

  function endBar(i: number) {
    const b = bars[i]
    if (!b) return
    snapshot(i)
    if (cfg.processOnClose && pending.length) runMarket(i, b.c, 3)
    for (const t of open) {
      t.best = t.side > 0 ? Math.max(t.best, b.h) : Math.min(t.best, b.l)
      for (const x of exits.values()) {
        if (x.from && t.entryId !== x.from) continue
        const act =
          x.trailPrice ?? (x.trailPoints != null ? t.price + t.side * x.trailPoints * tick : undefined)
        if (x.trailOffset != null && act != null && (t.side > 0 ? t.best >= act : t.best <= act))
          t.trailOn = true
      }
    }
    const eq = equityAt(b.c)
    equity[i] = eq
    peak = Math.max(peak, eq)
    if (peak - eq > maxDd) maxDd = peak - eq
    if (peak > 0) maxDdPct = Math.max(maxDdPct, ((peak - eq) / peak) * 100)
  }

  /** Orders with the same id replace each other (Pine modifies the working order). */
  function place(o: Order, immediately = false) {
    pending = pending.filter((x) => x.id !== o.id || x.kind !== o.kind)
    if (immediately && bars[cur]) {
      const buy = o.kind === 'close' || o.kind === 'close_all' ? netPos() < 0 : o.side > 0
      fill(o, slip(bars[cur].c, buy), cur, 3)
      dropIdleExits()
      return
    }
    pending.push(o)
  }
  const opt = (v: number | undefined) => (v != null && isFinite(v) ? v : undefined)

  return {
    beginBar,
    endBar,
    entry(id, side, qty, limit, stop, comment) {
      place({ id, kind: 'entry', side, qty: sizeOf(qty), limit: opt(limit), stop: opt(stop), comment })
    },
    order(id, side, qty, limit, stop, comment) {
      place({ id, kind: 'order', side, qty: sizeOf(qty), limit: opt(limit), stop: opt(stop), comment })
    },
    exit(spec) {
      const clean: ExitSpec = { id: spec.id, from: spec.from || '', comment: spec.comment }
      for (const k of ['profit', 'loss', 'limit', 'stop', 'trailPrice', 'trailPoints', 'trailOffset'] as const) {
        const v = opt(spec[k])
        if (v != null) clean[k] = v
      }
      exits.set(spec.id, clean)
    },
    close(id, comment, qty, qtyPct, immediately) {
      place({ id, kind: 'close', side: 1, qty: opt(qty) ?? NaN, qtyPct: opt(qtyPct), comment }, immediately)
    },
    closeAll(comment, immediately) {
      place({ id: '\u0000all', kind: 'close_all', side: 1, qty: NaN, comment }, immediately)
    },
    cancel(id) {
      pending = pending.filter((o) => o.id !== id)
      exits.delete(id)
    },
    cancelAll() {
      pending = []
      exits.clear()
    },
    get(name, back = 0) {
      if (back > 0) return snaps[cur - back]?.[name] ?? NaN
      snapshot(cur)
      return snaps[cur][name]
    },
    report() {
      const last = bars.length - 1
      const lc = bars[last]?.c ?? 0
      const trades: StrategyTrade[] = closed.slice()
      for (const t of open) {
        const profit = (lc - t.price) * t.qty * t.side - t.commission
        trades.push({
          entryId: t.entryId,
          dir: t.side > 0 ? 'long' : 'short',
          qty: t.qty,
          entryBar: t.bar,
          entryTime: bars[t.bar].t,
          entryPrice: t.price,
          entryComment: t.comment,
          profit,
          profitPct: (profit / (t.price * t.qty)) * 100,
          commission: t.commission,
          open: true,
        })
      }
      const grossProfit = closed.reduce((s, t) => s + Math.max(0, t.profit), 0)
      const grossLoss = closed.reduce((s, t) => s - Math.min(0, t.profit), 0)
      const wins = closed.filter((t) => t.profit > 0).length
      const losses = closed.filter((t) => t.profit < 0).length
      const n = closed.length
      const first = bars[0]?.c
      return {
        trades,
        equity,
        summary: {
          initialCapital: cfg.initialCapital,
          netProfit: realized,
          netProfitPct: cfg.initialCapital ? (realized / cfg.initialCapital) * 100 : 0,
          grossProfit,
          grossLoss,
          totalTrades: n,
          wins,
          losses,
          winRate: n ? (wins / n) * 100 : 0,
          profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
          maxDrawdown: maxDd,
          maxDrawdownPct: maxDdPct,
          avgTrade: n ? realized / n : 0,
          avgTradePct: n ? closed.reduce((s, t) => s + t.profitPct, 0) / n : 0,
          openPL: openProfit(lc),
          commission: commissionPaid,
          buyHoldPct: first ? ((lc - first) / first) * 100 : 0,
        },
      }
    },
  }
}
