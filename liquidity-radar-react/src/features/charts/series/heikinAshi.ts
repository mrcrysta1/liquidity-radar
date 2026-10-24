// Heikin Ashi — the averaged candles TradingView draws for its "Heikin Ashi"
// style.
//
//   HA close = (O + H + L + C) / 4
//   HA open  = (previous HA open + previous HA close) / 2   (first bar: (O + C) / 2)
//   HA high  = max(H, HA open, HA close)
//   HA low   = min(L, HA open, HA close)
//
// Each HA open depends on the HA bar before it, so a live tick on the last
// candle must be transformed against the previous *HA* bar, not the raw one.
// heikinAshiOf keeps the transformed series per source array and, while only
// the last candle moves (or one is appended), recomputes just the tail.
//
// Pure apart from that memo: no DOM, no store — scripts/test-engines.mjs runs it.
import type { CandleFlat } from '../../../services/market'

/** The HA bar for candle `c`, given the HA bar before it (null for the first). */
export function heikinAshiNext(prev: CandleFlat | null, c: CandleFlat): CandleFlat {
  const close = (c.o + c.h + c.l + c.c) / 4
  const open = prev ? (prev.o + prev.c) / 2 : (c.o + c.c) / 2
  return {
    t: c.t,
    o: open,
    h: Math.max(c.h, open, close),
    l: Math.min(c.l, open, close),
    c: close,
    v: c.v,
  }
}

/** Heikin Ashi bars for a run of candles (same times and volumes). */
export function heikinAshi(candles: CandleFlat[]): CandleFlat[] {
  const out: CandleFlat[] = []
  let prev: CandleFlat | null = null
  for (const c of candles) {
    prev = heikinAshiNext(prev, c)
    out.push(prev)
  }
  return out
}

// One memo per source array. The chart's candle arrays are long-lived and
// mutated in place (the last bar replaced, a new one pushed, the oldest
// shifted off), which is exactly what the cheap path below recognises.
const memo = new WeakMap<CandleFlat[], CandleFlat[]>()

/**
 * The HA bars for `src`, memoised. When only the last candle changed or one
 * was appended, only the tail is recomputed; anything else (history paged in,
 * the oldest bar dropped, a different array) recomputes the lot. `fresh`
 * forces a full rebuild — used where the whole series is handed to the chart.
 */
export function heikinAshiOf(src: CandleFlat[], fresh = false): CandleFlat[] {
  const n = src.length
  const ha = fresh ? undefined : memo.get(src)
  if (
    ha &&
    n > 0 &&
    ha.length > 0 &&
    ha[0].t === src[0].t &&
    (n === ha.length || n === ha.length + 1)
  ) {
    // Everything before the candle that was live last time must be unchanged.
    const from = ha.length - 1
    if (from === 0 || ha[from - 1].t === src[from - 1].t) {
      ha.length = from
      for (let i = from; i < n; i++) ha.push(heikinAshiNext(i ? ha[i - 1] : null, src[i]))
      return ha
    }
  }
  const all = heikinAshi(src)
  memo.set(src, all)
  return all
}

/**
 * The HA bar for candle `c` within `src` — what a live update hands the
 * series. `c` is normally src's last candle; if it is not in `src` at all it
 * is transformed against the last HA bar before it.
 */
export function heikinAshiBar(src: CandleFlat[], c: CandleFlat): CandleFlat {
  const ha = heikinAshiOf(src)
  for (let i = ha.length - 1; i >= 0; i--) {
    if (ha[i].t === c.t && src[i] === c) return ha[i]
    if (ha[i].t === c.t) return heikinAshiNext(i ? ha[i - 1] : null, c)
    if (ha[i].t < c.t) return heikinAshiNext(ha[i], c)
  }
  return heikinAshiNext(null, c)
}
