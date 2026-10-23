// Market-wide sentiment from the signal scanner, as shown on the Neural Net
// page. The scanner scores each market from -100 to +100 and calls it BUY
// above +15 and SELL below -15 (signals.ts). The page shows the average score
// on a 0–100 scale, so the word for that average uses the same cut-offs
// mapped onto that scale; otherwise an average of 45 would read "Bearish"
// while not one market is a SELL.

/** The scanner's BUY / SELL cut-off on its -100..+100 score. */
export const SIGNAL_CUTOFF = 15

/** -100..+100 scanner score → 0..100. */
export const toScale100 = (score: number): number => (score + 100) / 2

/** Average of the scanner scores on a 0..100 scale, or null when there are none. */
export function avgScore100(scores: number[]): number | null {
  if (!scores.length) return null
  return scores.reduce((a, s) => a + toScale100(s), 0) / scores.length
}

export type SentimentWord = 'Bullish' | 'Neutral' | 'Bearish' | 'Scanning'

/** The word for an average score on the 0..100 scale. */
export function sentimentWord(avg: number | null): SentimentWord {
  if (avg == null || !isFinite(avg)) return 'Scanning'
  if (avg > toScale100(SIGNAL_CUTOFF)) return 'Bullish'
  if (avg < toScale100(-SIGNAL_CUTOFF)) return 'Bearish'
  return 'Neutral'
}
