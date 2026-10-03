// Classic chart and candlestick patterns, each with a drawn diagram.
import type { LearnSection } from './types'

const WARN_PATTERN =
  'Patterns are common and often fail. Wait for the confirming break or close, use a stop beyond the pattern, and check volume and the higher timeframe.'

export const PATTERNS: LearnSection = {
  id: 'patterns',
  title: 'Chart & candlestick patterns',
  intro:
    'Shapes that price often makes before a reversal or a continuation. They describe how buyers and sellers have been behaving; they do not guarantee what happens next.',
  entries: [
    {
      id: 'double-top',
      title: 'Double top',
      summary: 'Price fails twice at the same high, then breaks the low between them: a bearish reversal.',
      tags: ['reversal', 'bearish', 'M pattern'],
      body: [
        { diagram: 'double-top', caption: 'Two equal highs; the break of the "neckline" confirms it.' },
        { list: ['Confirmation: a close below the neckline (the low between the two peaks).', 'Typical target: the height of the pattern, measured down from the neckline.'] },
        { warn: WARN_PATTERN },
      ],
    },
    {
      id: 'double-bottom',
      title: 'Double bottom',
      summary: 'Price holds twice at the same low, then breaks the high between them: a bullish reversal.',
      tags: ['reversal', 'bullish', 'W pattern'],
      body: [
        { diagram: 'double-bottom', caption: 'Two equal lows; a break above the neckline confirms it.' },
        { list: ['Confirmation: a close above the neckline.', 'Stronger when volume rises on the breakout.'] },
        { warn: WARN_PATTERN },
      ],
    },
    {
      id: 'head-shoulders',
      title: 'Head and shoulders',
      summary: 'A higher peak (head) between two lower ones (shoulders); breaking the neckline signals a top.',
      tags: ['reversal', 'bearish', 'H&S'],
      body: [
        { diagram: 'head-shoulders', caption: 'Left shoulder, head, right shoulder, neckline.' },
        { list: ['Confirmation: a close below the neckline.', 'Target: head-to-neckline height, projected down from the break.'] },
        { warn: WARN_PATTERN },
      ],
    },
    {
      id: 'inv-head-shoulders',
      title: 'Inverse head and shoulders',
      summary: 'The mirror image at a low: breaking the neckline upwards signals a bottom.',
      tags: ['reversal', 'bullish', 'inverse H&S'],
      body: [
        { diagram: 'inv-head-shoulders', caption: 'Three troughs, the middle one deepest.' },
        { warn: WARN_PATTERN },
      ],
    },
    {
      id: 'bull-flag',
      title: 'Bull flag',
      summary: 'A sharp rise (the pole) followed by a small downward-sloping pause; a break up continues the trend.',
      tags: ['continuation', 'bullish', 'flag'],
      body: [
        { diagram: 'bull-flag', caption: 'Pole, then a tight channel against the trend.' },
        { list: ['Entry: break of the flag\'s upper line.', 'Target: often the pole\'s length added to the breakout.'] },
        { warn: WARN_PATTERN },
      ],
    },
    {
      id: 'bear-flag',
      title: 'Bear flag',
      summary: 'A sharp drop followed by a small upward-sloping pause; a break down continues the trend.',
      tags: ['continuation', 'bearish', 'flag'],
      body: [{ diagram: 'bear-flag', caption: 'Pole down, then a rising channel.' }, { warn: WARN_PATTERN }],
    },
    {
      id: 'asc-triangle',
      title: 'Ascending triangle',
      summary: 'Flat resistance with rising lows: buyers keep pressing; usually breaks upward.',
      tags: ['triangle', 'bullish', 'continuation'],
      body: [{ diagram: 'asc-triangle', caption: 'Flat top, higher lows.' }, { warn: WARN_PATTERN }],
    },
    {
      id: 'desc-triangle',
      title: 'Descending triangle',
      summary: 'Flat support with falling highs: sellers keep pressing; usually breaks downward.',
      tags: ['triangle', 'bearish', 'continuation'],
      body: [{ diagram: 'desc-triangle', caption: 'Flat bottom, lower highs.' }, { warn: WARN_PATTERN }],
    },
    {
      id: 'sym-triangle',
      title: 'Symmetrical triangle',
      summary: 'Lower highs and higher lows squeeze together; the break direction decides it.',
      tags: ['triangle', 'neutral', 'squeeze'],
      body: [
        { diagram: 'sym-triangle', caption: 'Converging trendlines.' },
        { tip: 'It usually breaks in the direction of the trend that came before it, but wait for the break.' },
        { warn: WARN_PATTERN },
      ],
    },
    {
      id: 'rising-wedge',
      title: 'Rising wedge',
      summary: 'Price climbs in a narrowing channel with weakening momentum; often breaks down.',
      tags: ['wedge', 'bearish'],
      body: [{ diagram: 'rising-wedge', caption: 'Both lines rise, but they converge.' }, { warn: WARN_PATTERN }],
    },
    {
      id: 'falling-wedge',
      title: 'Falling wedge',
      summary: 'Price falls in a narrowing channel with fading selling; often breaks up.',
      tags: ['wedge', 'bullish'],
      body: [{ diagram: 'falling-wedge', caption: 'Both lines fall and converge.' }, { warn: WARN_PATTERN }],
    },
    {
      id: 'cup-handle',
      title: 'Cup and handle',
      summary: 'A rounded bottom (the cup) and a small pullback (the handle) before a breakout.',
      tags: ['continuation', 'bullish', 'rounding bottom'],
      body: [{ diagram: 'cup-handle', caption: 'Rounded base, short handle, breakout above the rim.' }, { warn: WARN_PATTERN }],
    },
    {
      id: 'engulfing',
      title: 'Engulfing candles',
      summary: 'A candle whose body fully covers the previous candle\'s body, in the opposite colour.',
      tags: ['candlestick', 'reversal', 'bullish engulfing', 'bearish engulfing'],
      body: [
        { diagram: 'bull-engulfing', caption: 'Bullish engulfing: a green body swallows the red one before it.' },
        { diagram: 'bear-engulfing', caption: 'Bearish engulfing: the opposite, after a rise.' },
        { p: 'Most meaningful at support or resistance after a move. The Neural Net tab\'s AI Insights spot engulfing candles live ("Bullish engulfing on 15m").' },
      ],
    },
    {
      id: 'hammer-star',
      title: 'Hammer and shooting star',
      summary: 'A small body with a long wick: price was pushed one way and rejected.',
      tags: ['candlestick', 'pin bar', 'rejection', 'wick'],
      body: [
        { diagram: 'hammer', caption: 'Hammer: long lower wick after a fall: buyers rejected lower prices.' },
        { diagram: 'shooting-star', caption: 'Shooting star: long upper wick after a rise: sellers rejected higher prices.' },
      ],
    },
    {
      id: 'doji',
      title: 'Doji',
      summary: 'Open and close almost equal: indecision. Meaningful mainly after a strong move.',
      tags: ['candlestick', 'indecision'],
      body: [{ diagram: 'doji', caption: 'A tiny body with wicks either side.' }],
    },
    {
      id: 'star-patterns',
      title: 'Morning star and evening star',
      summary: 'Three-candle reversals: a big candle, a small pause, then a big candle the other way.',
      tags: ['candlestick', 'reversal', 'three candle'],
      body: [
        { diagram: 'morning-star', caption: 'Morning star (bullish): down, pause, strong up.' },
        { diagram: 'evening-star', caption: 'Evening star (bearish): up, pause, strong down.' },
      ],
    },
  ],
}
