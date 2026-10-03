// Things the assistant can do in the app, not just say: open a tab, open a
// market, open a Learning topic.
//
// The model asks for an action by writing a tag on its own line, e.g.
// [[open:SOL]] or [[tab:signals]] or [[learn:rsi]]. Tags are stripped from the
// text and shown as buttons under the answer; when the user's own message was a
// command ("open SOL", "take me to signals") the first one runs straight away.
// Plain commands are also understood locally, so they work instantly and even
// when no language model is configured. Parsing is pure (tested).

export type ActionKind = 'tab' | 'open' | 'learn'
export interface ChatAction {
  kind: ActionKind
  /** Tab id, market text (resolved later), or Learning topic id. */
  arg: string
}

/** The app's tabs: id, label, what it is for. Shared with the model's guide. */
export const TABS: Array<{ id: string; label: string; what: string; words: string[] }> = [
  { id: 'home', label: 'Dashboard', what: 'snapshot of everything: price, top signals, liquidity, movers, liquidations, sentiment, headlines', words: ['dashboard', 'home'] },
  { id: 'radar', label: 'Radar', what: 'one market in depth: price, funding, open interest, long/short, live chart, key levels, quick stats', words: ['radar', 'overview'] },
  { id: 'multichart', label: 'Charts', what: 'charting workspace: 40+ indicators, drawings, footprint/TPO/range bars, multi-chart layouts, replay', words: ['charts', 'chart', 'multichart', 'multi chart'] },
  { id: 'signals', label: 'Signals', what: 'signal scanner across 19 markets on 1H/4H/1D with trade plans and a graded win rate', words: ['signals', 'signal', 'scanner'] },
  { id: 'analysis', label: 'Analysis', what: 'liquidation heatmap, volume profile, order flow, liquidation levels, Fibonacci zones', words: ['analysis', 'heatmap', 'liquidation heatmap'] },
  { id: 'neuralnet', label: 'Neural Net', what: 'model predictions, AI insights, market sentiment, top movers', words: ['neural net', 'neural', 'ai prediction', 'predictions'] },
  { id: 'selflearn', label: 'Self Learning', what: 'paper-trading engine, its models, trades, learning log, server bot', words: ['self learning', 'self-learning', 'paper trading', 'learning lab', 'bot'] },
  { id: 'market', label: 'Market', what: 'top coins, futures, meme coins, gainers and losers', words: ['market', 'markets', 'gainers', 'losers', 'top coins'] },
  { id: 'bubbles', label: 'Bubbles', what: 'visual bubble map of movers', words: ['bubbles', 'bubble'] },
  { id: 'news', label: 'News', what: 'crypto news with sentiment, trending coins, economic calendar', words: ['news', 'headlines', 'calendar', 'economic calendar'] },
  { id: 'settings', label: 'Settings', what: 'Learning library (guides, glossary, PDF), data sources, appearance', words: ['settings', 'learning', 'learning guide', 'guide', 'glossary', 'docs'] },
]

const TAB_IDS = new Set(TABS.map((t) => t.id))

const TAG = /\[\[\s*(tab|open|learn)\s*:\s*([^\]\n]{1,40}?)\s*\]\]/gi

/** Pull action tags out of a model answer. */
export function parseActions(text: string): { text: string; actions: ChatAction[] } {
  const actions: ChatAction[] = []
  const seen = new Set<string>()
  const clean = text.replace(TAG, (_m, kind: string, arg: string) => {
    const a: ChatAction = { kind: kind.toLowerCase() as ActionKind, arg: arg.trim() }
    if (a.kind === 'tab' && !TAB_IDS.has(a.arg.toLowerCase())) return ''
    if (a.kind === 'tab') a.arg = a.arg.toLowerCase()
    const k = a.kind + ':' + a.arg.toLowerCase()
    if (!seen.has(k)) {
      seen.add(k)
      actions.push(a)
    }
    return ''
  })
  // Tags usually sit on their own line: drop the empty lines they leave.
  return { text: clean.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), actions: actions.slice(0, 4) }
}

/** Strip complete and half-written tags while an answer is still streaming. */
export function hideTagsWhileStreaming(text: string): string {
  return text.replace(TAG, '').replace(/\[\[[^\]\n]*$/, '')
}

const NAV_VERB = /^\s*(?:please\s+|can you\s+|pls\s+|plz\s+)?(open|go to|goto|take me to|show me|show|switch to|navigate to|bring up|load)\s+(.+?)[\s.!?]*$/i

/**
 * A plain navigation command, understood without the model.
 * `isMarket` decides whether a phrase names a market (symbolIndex.resolveMarket in the app).
 * Returns null for anything that is not clearly a command, so questions still
 * go to the model ("show me why BTC dropped" is not a navigation).
 */
export function localCommand(msg: string, isMarket: (s: string) => boolean): ChatAction | null {
  const m = NAV_VERB.exec(msg)
  if (!m) return null
  const target = m[2].toLowerCase().replace(/^(the|my)\s+/, '').replace(/\s+(tab|page|section|screen)$/, '').trim()
  if (!target || target.split(/\s+/).length > 4) return null
  if (/\b(why|how|what|when|if|whether)\b/.test(target)) return null
  // "the learning guide for rsi", "guide on fvg"
  const learn = /^(?:learning\s+guide|learning|guide|lesson|docs?)(?:\s+(?:for|on|about))?\s+(.+)$/.exec(target)
  if (learn) return { kind: 'learn', arg: learn[1] }
  const tab = TABS.find((t) => t.id === target || t.words.includes(target))
  if (tab) return { kind: 'tab', arg: tab.id }
  const chart = /^(.+?)\s+(?:chart|price|coin)$/.exec(target)
  const coin = chart ? chart[1] : target
  if (isMarket(coin)) return { kind: 'open', arg: coin }
  return null
}

/** Did the user ask to go somewhere (so the first action can run on its own)? */
export function isCommand(msg: string): boolean {
  return NAV_VERB.test(msg)
}

/** Button label for an action. */
export function actionLabel(a: ChatAction, learnTitle?: (id: string) => string | undefined): string {
  if (a.kind === 'tab') return 'Open ' + (TABS.find((t) => t.id === a.arg)?.label ?? a.arg)
  if (a.kind === 'open') return 'Open ' + a.arg.toUpperCase() + ' chart'
  return 'Learn: ' + (learnTitle?.(a.arg) ?? a.arg)
}

/** The app guide sent to the model with every question. */
export function appGuide(learnIds: string[]): string {
  return [
    'APP GUIDE (Liquidity Radar). Tabs:',
    ...TABS.map((t) => '- ' + t.id + ' (' + t.label + '): ' + t.what),
    '',
    'ACTIONS: you can operate the app for the user. To offer one, put a tag on its own line at the very end of your answer:',
    '[[tab:<tab id>]] opens a tab. [[open:<ticker>]] opens that market on Radar (e.g. [[open:SOL]], [[open:XAUUSD]]). [[learn:<topic id>]] opens that Learning guide entry.',
    'Use at most 3 tags, only when they help (the user asked to go somewhere, wants to see a coin, or is learning a concept). Never invent tab or topic ids.',
    '',
    'LEARNING TOPIC IDS (Settings → Learning, each a full guide with formula and diagram): ' + learnIds.join(', '),
    'When someone is learning: explain simply first, then offer the matching [[learn:id]].',
  ].join('\n')
}
