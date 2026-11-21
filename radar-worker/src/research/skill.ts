// Does the model choose sides better than a simple trend rule? (plan step 2;
// scripts/ml-skill.ts.) Pure functions, tested in test/research-skill.test.ts.
//
// Every rule here trades the model's own bracket (stop 1.5 ATR, target
// 2.25 ATR, time exit 12 bars), from the close of the signal bar, with the same
// costs (costR) and the funding paid or received while open — so the only
// difference between the model and a baseline is which side it takes and when.
//
//   trendSides     long when the reference close is above its EMA, else short.
//                  With BTC as the reference every coin follows BTC's trend.
//   bracketTrade   one trade of the bracket at bar i, net of costs and funding.
//   standalone     a rule traded on its own, one trade at a time per market
//                  (as the walk-forward trades the model).
import type { Bar, Bracket, Costs, Ind } from '../bot/features.ts'
import { costR, outcomeAt } from '../bot/features.ts'
import { fundingR } from '../bot/c6.ts'
import type { Funding } from '../bot/data.ts'

export interface SkillTrade {
  /** Entry time (close of the signal bar). */
  t: number
  i: number
  side: 1 | -1
  /** Net R: bracket result − costs + funding. */
  r: number
  exit: 'tp' | 'sl' | 'time'
  /** Bar index of the exit. */
  end: number
}

export function emaOf(c: number[], n: number): number[] {
  const k = 2 / (n + 1)
  const out: number[] = []
  c.forEach((v, i) => out.push(i ? v * k + out[i - 1] * (1 - k) : v))
  return out
}

/**
 * The trend side at each of `b`'s bars from a reference market (BTC, or the
 * coin itself): +1 above its EMA(n) at that bar's close, −1 below, 0 when the
 * reference has no bar at that time or not `n` bars of history yet.
 */
export function trendSides(b: Bar[], ref: Bar[], n: number): Array<1 | -1 | 0> {
  const e = emaOf(ref.map((x) => x.c), n)
  const at = new Map(ref.map((x, k) => [x.t, k]))
  return b.map((x) => {
    const k = at.get(x.t)
    if (k == null || k < n) return 0
    return ref[k].c > e[k] ? 1 : ref[k].c < e[k] ? -1 : 0
  })
}

/** The bracket from the close of bar i on `side`, net of costs and funding; null if it has not ended yet. */
export function bracketTrade(b: Bar[], ind: Ind, i: number, side: 1 | -1, k: Bracket, costs: Costs, fund: Funding[], stepMs: number): SkillTrade | null {
  const o = outcomeAt(b, ind, i, side, k)
  if (!o) return null
  const entry = b[i].c
  const dist = k.slAtr * ind.atr[i]
  const t = b[i].t + stepMs
  const tExit = b[o.end].t + stepMs
  const r = o.r - costR(entry, dist, costs, o.exit) + side * fundingR(fund, t, tExit, entry, dist)
  return { t, i, side, r, exit: o.exit, end: o.end }
}

/** A rule on one market from bar `from` on: a trade whenever it has a side and no trade is open. */
export function standalone(
  b: Bar[],
  ind: Ind,
  side: (i: number) => 1 | -1 | 0,
  from: number,
  to: number,
  k: Bracket,
  costs: Costs,
  fund: Funding[],
  stepMs: number,
): SkillTrade[] {
  const out: SkillTrade[] = []
  let freeAt = from
  for (let i = from; i < to; i++) {
    if (i < freeAt) continue
    const s = side(i)
    if (!s) continue
    const tr = bracketTrade(b, ind, i, s, k, costs, fund, stepMs)
    if (!tr) continue
    out.push(tr)
    freeAt = tr.end + 1
  }
  return out
}
