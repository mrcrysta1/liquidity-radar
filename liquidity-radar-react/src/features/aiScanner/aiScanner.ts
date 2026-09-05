// AI chat pattern detection + signal summaries. Faithful extraction of the
// engine's ENHANCED AI CHAT PATTERNS block — pattern alerts feed the AI chat
// reply builder; summarizeSignalSummary is reused by analysis commentary.
// engine exclusively (chat reply generator, analysis section).
import { calcRSI, calcMACD, calcBB, emaArr } from '../../utils/indicators'
import { pfmt } from '../../utils/format'
import { state } from '../../services/store'

export interface ChatPattern {
  type: 'bullish' | 'bearish'
  text: string
  strength: number
}
export function detectPatterns(closes: number[], vols: number[]): ChatPattern[] {
  const patterns: ChatPattern[] = []
  if (closes.length < 20) return patterns
  const rsi = calcRSI(closes)
  const macd = calcMACD(closes)
  const bb = calcBB(closes)
  const e20 = emaArr(closes, 20)
  const last = closes[closes.length - 1]
  if (rsi < 30) patterns.push({ type: 'bullish', text: 'RSI oversold at ' + rsi.toFixed(1) + ', potential bounce zone', strength: 70 })
  else if (rsi > 70) patterns.push({ type: 'bearish', text: 'RSI overbought at ' + rsi.toFixed(1) + ', pullback risk', strength: 70 })
  if (macd.hist > 0 && closes[closes.length - 2] < closes[closes.length - 3]) patterns.push({ type: 'bullish', text: 'MACD bullish crossover detected', strength: 80 })
  if (macd.hist < 0 && closes[closes.length - 2] > closes[closes.length - 3]) patterns.push({ type: 'bearish', text: 'MACD bearish crossover detected', strength: 80 })
  if (bb.pctB < 5) patterns.push({ type: 'bullish', text: 'Price touching lower Bollinger band (%B=' + bb.pctB.toFixed(0) + '%), mean reversion setup', strength: 65 })
  if (bb.pctB > 95) patterns.push({ type: 'bearish', text: 'Price at upper Bollinger band (%B=' + bb.pctB.toFixed(0) + '%), stretched', strength: 65 })
  const recent5 = closes.slice(-5)
  const prior5 = closes.slice(-10, -5)
  if (recent5[4] > recent5[0] && prior5[4] < prior5[0]) patterns.push({ type: 'bullish', text: 'Higher high after lower low — trend reversal pattern', strength: 75 })
  if (recent5[4] < recent5[0] && prior5[4] > prior5[0]) patterns.push({ type: 'bearish', text: 'Lower low after higher high — trend reversal pattern', strength: 75 })
  const volAvg = vols.slice(-20).reduce((a, b) => a + b, 0) / 20
  const volNow = vols.slice(-3).reduce((a, b) => a + b, 0) / 3
  if (volNow > volAvg * 2 && last > closes[closes.length - 2]) patterns.push({ type: 'bullish', text: 'Volume spike (' + ((volNow / volAvg) * 100).toFixed(0) + '% avg) with price up — strong buying', strength: 85 })
  if (volNow > volAvg * 2 && last < closes[closes.length - 2]) patterns.push({ type: 'bearish', text: 'Volume spike (' + ((volNow / volAvg) * 100).toFixed(0) + '% avg) with price down — strong selling', strength: 85 })
  const swingHigh = Math.max.apply(null, closes.slice(-20))
  const swingLow = Math.min.apply(null, closes.slice(-20))
  if (last > swingHigh * 0.99 && last < swingHigh * 1.01) patterns.push({ type: 'bullish', text: 'Testing 20-bar resistance at $' + pfmt(swingHigh) + ', breakout watch', strength: 60 })
  if (last < swingLow * 1.01 && last > swingLow * 0.99) patterns.push({ type: 'bearish', text: 'Testing 20-bar support at $' + pfmt(swingLow) + ', breakdown risk', strength: 60 })
  return patterns
}

interface AiLike {
  fc?: { rows: Array<{ pred: number }> } | null
  last?: number
  score: number
}
export function generateSignalSummary(base: string, ai: AiLike, fc: unknown): string {
  let s = ''
  const closes = ai.fc ? ai.fc.rows.map((r) => r.pred) : [ai.last]
  const patterns = detectPatterns(closes as number[], state.candles.map((c) => c.v).filter((x): x is number => typeof x === 'number'))
  if (patterns.length) {
    s += '<b>PATTERN ALERTS:</b><br>'
    patterns.forEach(function (p) {
      const icon = p.type === 'bullish' ? '[BULL]' : '[BEAR]'
      const cls = p.type === 'bullish' ? 'hl-g' : 'hl-r'
      s += '<span class="' + cls + '">' + icon + ' ' + p.text + '</span> (strength: ' + p.strength + '%)<br>'
    })
    s += '<br>'
  }
  if (ai.score > 30) s += '<span class="hl-g"><b>STRONG BUY signal</b></span> — Multiple indicators aligned bullish. Consider entry with stop below EMA20.'
  else if (ai.score > 10) s += '<span class="hl-g">Mild bullish bias</span> — indicators lean positive but not strongly convictioned. Scale in, don\'t all-in.'
  else if (ai.score < -30) s += '<span class="hl-r"><b>STRONG SELL signal</b></span> — Multiple indicators aligned bearish. Consider reducing exposure or shorting with stop above EMA20.'
  else if (ai.score < -10) s += '<span class="hl-r">Mild bearish bias</span> — indicators lean negative. Reduce position size or wait for confirmation.'
  else s += '<span class="hl-a">NEUTRAL — No clear edge.</span> Wait for a setup rather than forcing a trade.'
  return s
}