// Plain, explainable reads of the focused market, shared by the Radar and
// Charts tabs: floor pivots from the 24h range, and the indicator checks that
// sit behind the direction model's call. Each one is computed from live state
// and says exactly what it measured.
import { state } from '../../services/store'
import { calcRSI, emaArr } from '../../utils/indicators'
import { pfmt } from '../../utils/format'

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number }
const candles = () => state.candles as Candle[]

export /** Classic floor pivots from the 24h high / low / last. */
function pivots() {
  const t = state.tickers[state.symbol] as
    { last?: number; high?: number; low?: number } | undefined
  if (!t?.last || !t.high || !t.low) return null
  const { high: H, low: L, last: C } = t as { high: number; low: number; last: number }
  const P = (H + L + C) / 3
  return {
    P,
    R: [2 * P - L, P + (H - L), H + 2 * (P - L)],
    S: [2 * P - H, P - (H - L), L - 2 * (H - P)],
  }
}

export /** Plain-language checks behind the model's call, each from live indicators. */
function evidence() {
  const cs = candles()
  const closes = cs.map((c) => c.c)
  if (closes.length < 100) return []
  const last = closes[closes.length - 1]
  const rsi = calcRSI(closes)
  const ema99 = emaArr(closes, 99)[closes.length - 1]
  const v = cs.map((c) => c.v)
  const recent = v.slice(-10).reduce((a, b) => a + b, 0)
  const prior = v.slice(-20, -10).reduce((a, b) => a + b, 0)
  const p = pivots()
  const above = p ? [...p.R, p.P].filter((x) => x > last).sort((a, b) => a - b)[0] : undefined
  const room = above ? ((above - last) / last) * 100 : null
  return [
    {
      ok: rsi >= 50,
      text: `RSI is in the ${rsi >= 55 ? 'bullish' : rsi <= 45 ? 'bearish' : 'neutral'} zone (${rsi.toFixed(0)})`,
    },
    { ok: last >= ema99, text: `Price ${last >= ema99 ? 'above' : 'below'} the 99 EMA` },
    {
      ok: recent >= prior,
      text: `Volume ${recent >= prior ? 'increasing' : 'decreasing'} (last 10 bars vs prior 10)`,
    },
    room != null
      ? {
          ok: room > 1,
          text:
            room > 1
              ? `No resistance within 1% (next ${pfmt(above as number)})`
              : `Resistance ${room.toFixed(2)}% away at ${pfmt(above as number)}`,
        }
      : { ok: true, text: 'No pivot resistance above price' },
  ]
}
