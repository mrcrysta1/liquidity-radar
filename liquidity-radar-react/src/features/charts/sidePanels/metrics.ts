// Maths behind the chart's side panels — order-book quality, a liquidity
// score, the price/open-interest regime and market structure.
//
// Modelled on the Pro terminal's core/scores and core/analysis, but reading
// this app's own state shapes. Every number here comes from public data; the
// interpretations are heuristics, and the UI says so.
import type { CandleFlat } from '../../../services/market'

export interface Level {
  price: number
  size: number
}
export interface Wall {
  side: 'bid' | 'ask'
  price: number
  size: number
  multiple: number
}
export interface Slip {
  notional: number
  side: 'buy' | 'sell'
  bps: number
  filled: boolean
}
export interface BookMetrics {
  best: { bid: number; ask: number }
  mid: number
  spreadBps: number
  /** Quote-currency depth within 1% of mid. */
  bidDepth1: number
  askDepth1: number
  /** −1 (all asks) … +1 (all bids) within 1%. */
  imbalance1: number
  walls: Wall[]
  slippage: Slip[]
}

const NOTIONALS = [10_000, 100_000, 1_000_000]

export function bookMetrics(bids: Level[], asks: Level[]): BookMetrics | null {
  if (!bids.length || !asks.length) return null
  const bestBid = bids[0].price
  const bestAsk = asks[0].price
  const mid = (bestBid + bestAsk) / 2
  if (!(mid > 0)) return null
  const spreadBps = ((bestAsk - bestBid) / mid) * 1e4
  const lo = mid * 0.99
  const hi = mid * 1.01
  let bidDepth1 = 0
  let askDepth1 = 0
  for (const l of bids) if (l.price >= lo) bidDepth1 += l.price * l.size
  for (const l of asks) if (l.price <= hi) askDepth1 += l.price * l.size
  const tot = bidDepth1 + askDepth1
  const imbalance1 = tot ? (bidDepth1 - askDepth1) / tot : 0

  // A wall is a level that stands out **against its own side**: the two halves
  // of a book routinely carry different level granularity, so one combined
  // average flags ordinary levels on the denser side and hides real walls on
  // the thinner one.
  const walls: Wall[] = []
  const collect = (ls: Level[], side: 'bid' | 'ask') => {
    if (ls.length < 5) return
    const avg = ls.reduce((s, l) => s + l.size, 0) / ls.length
    if (!(avg > 0)) return
    ls.forEach((l) => {
      if (l.size >= avg * 5) walls.push({ side, price: l.price, size: l.size, multiple: l.size / avg })
    })
  }
  collect(bids, 'bid')
  collect(asks, 'ask')
  walls.sort((a, b) => b.multiple - a.multiple)

  // Walk the book to see what a market order of each size would pay.
  const slippage: Slip[] = []
  for (const notional of NOTIONALS) {
    for (const side of ['buy', 'sell'] as const) {
      const book = side === 'buy' ? asks : bids
      let left = notional
      let cost = 0
      let qty = 0
      for (const l of book) {
        const take = Math.min(left, l.price * l.size)
        if (take <= 0) continue
        qty += take / l.price
        cost += take
        left -= take
        if (left <= 0) break
      }
      const filled = left <= 0 && qty > 0
      const avgPx = qty ? cost / qty : 0
      const bps = filled ? (Math.abs(avgPx - mid) / mid) * 1e4 : 0
      slippage.push({ notional, side, bps, filled })
    }
  }
  return {
    best: { bid: bestBid, ask: bestAsk },
    mid,
    spreadBps,
    bidDepth1,
    askDepth1,
    imbalance1,
    walls,
    slippage,
  }
}

export interface ScoreComponent {
  key: string
  label: string
  weight: number
  score: number
  reason: string
}
export interface LiquidityScore {
  value: number
  components: ScoreComponent[]
}

const clamp = (v: number) => Math.max(0, Math.min(100, v))

/**
 * LIQUIDITY SCORE v1 — 0–100 from five visible, fixed-weight components.
 *
 * The fifth is what a $100k market buy actually costs to fill. Spread and
 * resting depth describe a book at rest; slippage is the number a trader pays,
 * and a score without it flatters a book that looks deep but walks badly. Each
 * component states its own scale in `reason`, so the number can be argued with
 * rather than taken on faith.
 */
export function liquidityScore(m: BookMetrics, quoteVol24h?: number): LiquidityScore {
  const d1 = m.bidDepth1 + m.askDepth1
  const s100k = m.slippage.find((x) => x.notional === 100_000 && x.side === 'buy')
  const slipBps = s100k && s100k.filled ? s100k.bps : Infinity
  const vol = quoteVol24h ?? 0
  const components: ScoreComponent[] = [
    {
      key: 'spread',
      label: 'Spread',
      weight: 0.25,
      score: clamp(100 - m.spreadBps * 20),
      reason: m.spreadBps.toFixed(2) + ' bps best bid to ask (0 bps = 100, 5 bps = 0)',
    },
    {
      key: 'depth1',
      label: 'Depth ±1%',
      weight: 0.3,
      score: clamp((Math.log10(Math.max(d1, 1)) * 100) / 8),
      reason: '$' + fmtUsd(d1) + ' resting within 1% of mid (log scale, $100M = 100)',
    },
    {
      key: 'slippage',
      label: 'Slippage $100k',
      weight: 0.2,
      score: isFinite(slipBps) ? clamp(100 - slipBps * 10) : 0,
      reason: isFinite(slipBps)
        ? slipBps.toFixed(2) + ' bps to buy $100k at market (0 = 100, 10 bps = 0)'
        : 'book too thin to fill $100k',
    },
    {
      key: 'balance',
      label: 'Bid/ask balance',
      weight: 0.1,
      score: clamp(100 - Math.abs(m.imbalance1) * 100),
      reason:
        Math.abs(m.imbalance1 * 100).toFixed(0) +
        '% imbalance within ±1% (' +
        (m.imbalance1 > 0 ? 'bid' : 'ask') +
        '-heavy)',
    },
    {
      key: 'volume',
      label: '24h volume',
      weight: 0.15,
      score: vol ? clamp((Math.log10(Math.max(vol, 1)) * 100) / 10) : 0,
      reason: vol ? '$' + fmtUsd(vol) + ' traded in 24h (log scale, $10B = 100)' : 'unavailable',
    },
  ]
  const value = Math.round(components.reduce((sum, c) => sum + c.score * c.weight, 0))
  return { value, components }
}

export const fmtUsd = (v: number): string =>
  v >= 1e9
    ? (v / 1e9).toFixed(2) + 'B'
    : v >= 1e6
      ? (v / 1e6).toFixed(2) + 'M'
      : v >= 1e3
        ? (v / 1e3).toFixed(1) + 'K'
        : v.toFixed(0)

export interface Regime {
  regime: 'LONGS_BUILDING' | 'SHORTS_BUILDING' | 'LONGS_CLOSING' | 'SHORTS_CLOSING' | 'FLAT'
  title: string
  /** The quadrant in the matrix's own shorthand, e.g. "Price up · OI up". */
  matrix: string
  meaning: string
  priceChg: number
  oiChg: number
}

/**
 * The classic price x open-interest quadrants.
 *
 * `eps` is the dead band in percent: below it a leg counts as flat, because a
 * 0.05% drift in open interest is noise and reading a regime into it would be
 * invention rather than analysis.
 */
export function classifyPriceOI(priceChg: number, oiChg: number, eps = 0.15): Regime {
  const up = priceChg > eps
  const dn = priceChg < -eps
  const oiUp = oiChg > eps
  const oiDn = oiChg < -eps
  const base = { priceChg, oiChg }
  if (up && oiUp)
    return {
      ...base,
      regime: 'LONGS_BUILDING',
      title: 'New longs',
      matrix: 'Price ↑ · OI ↑',
      meaning:
        'Fresh long positions are funding the move, so the trend has support — and a crowd to liquidate below it if funding climbs alongside.',
    }
  if (dn && oiUp)
    return {
      ...base,
      regime: 'SHORTS_BUILDING',
      title: 'New shorts',
      matrix: 'Price ↓ · OI ↑',
      meaning:
        'Fresh shorts are pressing the move. Squeeze risk grows if price reclaims, and faster still if funding turns sharply negative.',
    }
  if (dn && oiDn)
    return {
      ...base,
      regime: 'LONGS_CLOSING',
      title: 'Long liquidation',
      matrix: 'Price ↓ · OI ↓',
      meaning:
        'Longs are closing or being forced out rather than new shorts arriving — selling can exhaust once the leverage has flushed.',
    }
  if (up && oiDn)
    return {
      ...base,
      regime: 'SHORTS_CLOSING',
      title: 'Short covering',
      matrix: 'Price ↑ · OI ↓',
      meaning:
        'Shorts buying back rather than new demand arriving, which tends to fade once the covering is done.',
    }
  return {
    ...base,
    regime: 'FLAT',
    title: 'No clear regime',
    matrix: 'Price → · OI →',
    meaning: 'Neither price nor positioning has moved enough to read.',
  }
}

export interface Swing {
  index: number
  price: number
  type: 'high' | 'low'
  /** Where this swing sits against the previous one of its kind. */
  label?: 'HH' | 'HL' | 'LH' | 'LL'
}

/**
 * Fractal swings with `bars` of confirmation either side, then the
 * HH/HL/LH/LL label that gives market structure its language.
 *
 * Three bars rather than one: a single-bar fractal fires on every minor wiggle,
 * and a structure read built on noise is worse than no read at all.
 */
export function swings(c: CandleFlat[], bars = 3): Swing[] {
  const out: Swing[] = []
  for (let i = bars; i < c.length - bars; i++) {
    let hi = true
    let lo = true
    for (let j = 1; j <= bars; j++) {
      // Ties count against the earlier side only, so a flat top resolves once
      // rather than marking every bar of it as a swing.
      if (c[i - j].h >= c[i].h) hi = false
      if (c[i - j].l <= c[i].l) lo = false
      if (c[i + j].h > c[i].h) hi = false
      if (c[i + j].l < c[i].l) lo = false
    }
    if (hi) out.push({ index: i, price: c[i].h, type: 'high' })
    if (lo) out.push({ index: i, price: c[i].l, type: 'low' })
  }
  let lastH: Swing | undefined
  let lastL: Swing | undefined
  for (const s of out) {
    if (s.type === 'high') {
      if (lastH) s.label = s.price > lastH.price ? 'HH' : 'LH'
      lastH = s
    } else {
      if (lastL) s.label = s.price > lastL.price ? 'HL' : 'LL'
      lastL = s
    }
  }
  return out
}

export interface StructureEvent {
  index: number
  price: number
  type: 'BOS' | 'CHoCH'
  direction: 'bull' | 'bear'
}
/**
 * Break of structure / change of character: a close through the last confirmed
 * swing. It is a CHoCH when it flips the prevailing direction, a BOS when it
 * continues it.
 *
 * A swing is only *knowable* `bars` candles after it prints — that is what the
 * confirmation window means — so no event is dated earlier than that, and each
 * swing fires once and is then spent. Swings arrive in index order, so one
 * pointer walks them alongside the candles instead of rescanning per bar.
 */
export function structureEvents(c: CandleFlat[], sw: Swing[], bars = 3): StructureEvent[] {
  const out: StructureEvent[] = []
  let dir: 'bull' | 'bear' | null = null
  let ptr = 0
  let lastHigh: Swing | undefined
  let lastLow: Swing | undefined
  for (let i = 0; i < c.length; i++) {
    while (ptr < sw.length && sw[ptr].index + bars <= i) {
      const s = sw[ptr++]
      if (s.type === 'high') lastHigh = s
      else lastLow = s
    }
    const close = c[i].c
    if (lastHigh && close > lastHigh.price) {
      out.push({
        index: i,
        price: lastHigh.price,
        type: dir === 'bear' ? 'CHoCH' : 'BOS',
        direction: 'bull',
      })
      dir = 'bull'
      lastHigh = undefined
    }
    if (lastLow && close < lastLow.price) {
      out.push({
        index: i,
        price: lastLow.price,
        type: dir === 'bull' ? 'CHoCH' : 'BOS',
        direction: 'bear',
      })
      dir = 'bear'
      lastLow = undefined
    }
  }
  return out
}
