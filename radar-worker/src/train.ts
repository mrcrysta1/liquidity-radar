// Walk-forward report, no keys or database needed:
//
//   npm run train                 # BTCUSDT and XAUUSDT (gold)
//   npm run train -- ETHUSDT      # any Binance spot symbols
//
// Downloads ~2 years of 4h bars, trains a fresh model per test block on the
// past only, trades each block as the bot would, and says whether the result
// clears the gate the live bot requires before it will trade.
import { closedBars } from './bot/data.ts'
import { DEFAULT_GATE, DEFAULT_WF, gate, walkForward } from './bot/walkforward.ts'
import { DEFAULT_TRADER, INTERVAL_DEFAULTS } from './bot/trader.ts'

// Same knobs as the bot: BOT_INTERVAL=5m BOT_MIN_EV=any npm run train
const INTERVAL = process.env.BOT_INTERVAL || DEFAULT_TRADER.interval
const HISTORY = INTERVAL_DEFAULTS[INTERVAL]?.historyBars ?? DEFAULT_TRADER.historyBars
const MIN_EV = process.env.BOT_MIN_EV === 'any' ? -1e9 : Number(process.env.BOT_MIN_EV || DEFAULT_WF.minEvR)

const symbols = process.argv.slice(2).length ? process.argv.slice(2) : ['BTCUSDT', 'XAUUSDT']
const pct = (v: number) => (v * 100).toFixed(1) + '%'

for (const sym of symbols.map((s) => s.toUpperCase())) {
  const t0 = Date.now()
  const b = await closedBars(sym, INTERVAL, HISTORY)
  // Same rule as the live bot: young markets get a shorter training window.
  const { metrics: m, foldR } = walkForward(b, { ...DEFAULT_WF, minEvR: MIN_EV, trainBars: Math.min(DEFAULT_WF.trainBars, Math.floor(b.length * 0.6)) })
  const g = gate(m, DEFAULT_GATE)
  const d = (t: number) => new Date(t).toISOString().slice(0, 10)
  console.log(`\n${sym} · ${b.length} × ${INTERVAL} bars, ${d(b[0].t)} → ${d(b[b.length - 1].t)} · ${Math.round((Date.now() - t0) / 1000)}s`)
  console.log(`  out-of-sample trades  ${m.trades}  (long ${m.longTrades} / short ${m.shortTrades})`)
  console.log(`  win rate              ${pct(m.winRate)}`)
  console.log(`  expectancy            ${m.expectancyR.toFixed(3)} R per trade, after fees + slippage`)
  console.log(`  profit factor         ${m.profitFactor.toFixed(2)}`)
  console.log(`  total / max drawdown  ${m.totalR.toFixed(1)} R / ${m.maxDrawdownR.toFixed(1)} R`)
  console.log(`  test blocks positive  ${m.positiveFolds} of ${m.folds}   [${foldR.map((v) => v.toFixed(1)).join(' ')}]`)
  console.log(`  gate                  ${g.pass ? 'PASS — the bot may trade this model' : 'FAIL — the bot stays flat:\n    - ' + g.reasons.join('\n    - ')}`)
}
