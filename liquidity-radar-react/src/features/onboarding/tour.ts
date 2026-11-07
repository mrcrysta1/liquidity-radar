// The first-visit tour (components/onboarding/OnboardingTour.tsx): five short
// steps, shown once, re-opened from Settings → Learning (the 'lr:tour' event).
// Pure apart from the storage it is given (tested in scripts/test-engines.mjs).

export interface TourStep {
  title: string
  body: string
  /** The tab a "Show me" button opens (ids of features/actions/userActions switchTab). */
  tab?: string
  tabLabel?: string
}

export const TOUR_KEY = 'tour:v1'
export const TOUR_EVENT = 'lr:tour'

export const TOUR: TourStep[] = [
  {
    title: 'Welcome to Liquidity Radar',
    body: 'Live crypto and market data read straight from the exchanges, measured with indicators and order-flow tools, and models that are tested before they are trusted. It analyses; it does not advise, and no model here can promise profit.',
  },
  {
    title: 'See the market',
    body: 'Radar shows one market in depth: price, funding, open interest and key levels. Charts is the full workspace with 40+ indicators, drawing tools and multi-chart layouts.',
    tab: 'radar',
    tabLabel: 'Open Radar',
  },
  {
    title: 'Signals, with their evidence',
    body: 'The scanner scores 19 markets on three timeframes. Every card shows how its past calls on that market actually did — and says “too few to judge” when there is not enough history.',
    tab: 'signals',
    tabLabel: 'Open Signals',
  },
  {
    title: 'The bot learns on demo money',
    body: 'Self Learning is the server bot: it trades the Binance testnet (practice money) around the clock, keeps every idea as a paper trade, and judges each strategy honestly — samples, ranges and what is not proven yet.',
    tab: 'selflearn',
    tabLabel: 'Open Self Learning',
  },
  {
    title: 'Help is one key away',
    body: 'Press / to search for a coin. The AI assistant (bottom right, or press T) can open coins and tabs and explain any concept. Settings → Learning explains every tool, with a PDF to download.',
    tab: 'settings',
    tabLabel: 'Open Learning',
  },
]

export interface KV {
  get(k: string): string | null
  set(k: string, v: string): void
}

/** Show the tour on a first visit; a storage that cannot be read counts as "seen", so nobody gets it on every load. */
export function shouldShowTour(kv: KV): boolean {
  try {
    return kv.get(TOUR_KEY) == null
  } catch {
    return false
  }
}

export function markTourSeen(kv: KV): void {
  try {
    kv.set(TOUR_KEY, String(Date.now()))
  } catch {
    // Private mode: it may show again next time, which is harmless.
  }
}
