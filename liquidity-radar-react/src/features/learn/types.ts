// The Learning library (Settings → Learning, and its PDF) is plain data so it
// can grow with the app: when a feature or technique is added, add an entry to
// the matching file in this folder and bump LEARN_UPDATED in content.ts.
//
// Text supports **bold** and `code` only; everything else is escaped.

/** A drawn illustration (see diagrams.tsx). */
export type DiagramId =
  | 'double-top'
  | 'double-bottom'
  | 'head-shoulders'
  | 'inv-head-shoulders'
  | 'bull-flag'
  | 'bear-flag'
  | 'asc-triangle'
  | 'desc-triangle'
  | 'sym-triangle'
  | 'rising-wedge'
  | 'falling-wedge'
  | 'cup-handle'
  | 'bull-engulfing'
  | 'bear-engulfing'
  | 'hammer'
  | 'shooting-star'
  | 'doji'
  | 'morning-star'
  | 'evening-star'
  | 'rsi-divergence'
  | 'macd-cross'
  | 'bollinger-squeeze'
  | 'support-resistance'
  | 'fvg'
  | 'liquidity-sweep'
  | 'bos-choch'
  | 'volume-profile'
  | 'r-multiple'

export type Block =
  | { p: string }
  | { list: string[] }
  /** A formula or rule, shown in monospace. */
  | { formula: string }
  /** A practical hint, shown highlighted. */
  | { tip: string }
  /** A caution (limits, common mistakes). */
  | { warn: string }
  | { diagram: DiagramId; caption?: string }

export interface LearnEntry {
  /** Stable id, used for links and search (kebab-case). */
  id: string
  title: string
  /** One or two sentences: what it is, in plain words. */
  summary: string
  body: Block[]
  /** Where to find it in the app, e.g. "Charts → Indicators → RSI". */
  inApp?: string
  /** Extra words people might search for. */
  tags?: string[]
}

export interface LearnSection {
  id: string
  title: string
  intro: string
  entries: LearnEntry[]
}
