// Experimental strategies (research plan, "new strategies"): kept apart from
// the established ones and run in SHADOW only — paper trades, never orders.
// They have no health bands, so health.ts never promotes them: a candidate
// becomes a replacement only by a deliberate decision after independent
// validation, never automatically. Each is F1 with one extra entry condition,
// decided before testing (pre-registered) to keep the number of tries small:
//
//   x1  F1 entries only while BTCUSDT closes above its own EMA(300) at the
//       signal bar (the market-wide trend agrees). Idea from the strategy
//       audit (F1 earned most in bull regimes), so the audit's history is not
//       independent evidence for it: only its paper trades from go-live are.
//   x2  F1 entries only when the breakout bar's volume is at least 1.5 × the
//       average of the 20 bars before it (participation confirms the break).
//
// Exits, stops and trailing are F1's. Built from the strategy passed in
// (strategies.ts calls experimental(F1_STRATEGY)), so this file imports no
// values from strategies.ts and there is no import cycle.
import type { Bar } from './features.ts'
import { F1, trendIndicators } from './strategy.ts'
import type { RefBars, RuleStrategy } from './strategies.ts'

export const X2_VOLUME_X = 1.5
const X2_LOOKBACK = 20

const btcEma = new WeakMap<Bar[], { ema: number[]; at: Map<number, number> }>()
/** BTC's close vs its EMA(300) at the bar opening at t: true above, false not above, null unknown. */
export function btcAbove(btc: Bar[] | undefined, t: number): boolean | null {
  if (!btc) return null
  let x = btcEma.get(btc)
  if (!x) btcEma.set(btc, (x = { ema: trendIndicators(btc).ema, at: new Map(btc.map((b, k) => [b.t, k])) }))
  const k = x.at.get(t)
  if (k === undefined || k < F1.warm) return null
  return btc[k].c > x.ema[k]
}

/** The breakout bar's volume over the average of the 20 bars before it (null without enough history). */
export function volumeRatio(b: Bar[], i: number): number | null {
  if (i < X2_LOOKBACK) return null
  let s = 0
  for (let k = i - X2_LOOKBACK; k < i; k++) s += b[k].v
  const avg = s / X2_LOOKBACK
  return avg > 0 ? b[i].v / avg : null
}

/** A base strategy with one more entry condition; everything else is the base's. */
function filtered(
  base: RuleStrategy,
  o: { id: string; name: string; refs?: string[]; ok: (b: Bar[], i: number, ref?: RefBars) => { pass: boolean; why: string; feature: Record<string, number> } },
): RuleStrategy {
  return {
    ...base,
    id: o.id,
    name: o.name,
    refs: o.refs ?? base.refs,
    health: undefined,
    describe: (b, i, ref) => base.describe(b, i, ref).replace(/^F1:/, `${o.id.toUpperCase()} (F1 entry):`) + ' · ' + o.ok(b, i, ref).why,
    noEntry(b, i, ref) {
      const r = base.noEntry(b, i, ref)
      if (r) return r.replace(/F1/g, o.id.toUpperCase())
      const f = o.ok(b, i, ref)
      return f.pass ? '' : `no ${o.id.toUpperCase()} entry: ${f.why}`
    },
    signal(b, i, ref) {
      const s = base.signal(b, i, ref)
      if (!s) return null
      const f = o.ok(b, i, ref)
      return f.pass ? { ...s, features: { ...s.features, ...f.feature } } : null
    },
  }
}

export function experimental(f1: RuleStrategy): Record<string, RuleStrategy> {
  const x1 = filtered(f1, {
    id: 'x1',
    name: 'X1 F1 + BTC above EMA(300) (4h, long, experimental)',
    refs: ['BTCUSDT'],
    ok(b, i, ref) {
      const up = btcAbove(ref?.BTCUSDT, b[i].t)
      return { pass: up === true, why: up == null ? 'BTC trend unknown' : up ? 'BTC above its EMA(300)' : 'BTC not above its EMA(300)', feature: { btcAbove: up ? 1 : 0 } }
    },
  })
  const x2 = filtered(f1, {
    id: 'x2',
    name: `X2 F1 + breakout volume ≥ ${X2_VOLUME_X}× (4h, long, experimental)`,
    ok(b, i) {
      const v = volumeRatio(b, i)
      return { pass: v != null && v >= X2_VOLUME_X, why: v == null ? 'volume history too short' : `volume ${v.toFixed(2)}× its 20-bar average`, feature: { volRatio: v ?? 0 } }
    },
  })
  return { x1, x2 }
}
