// The server bot's trades and latest plans for the chart overlays, from the
// read-only loaders in serverBot.ts. One shared, time-boxed cache so the
// Neural Net chart and the main chart polling at once cost one round of
// requests, not two.
import { loadBot, loadPlans, SERVER_BOT } from './serverBot'
import type { BotPlan, BotTrade } from './serverBot'
import { sameMarket } from './botChart'

export { SERVER_BOT }

/** How often the chart overlays re-read the bot (it trades 4-hour bars). */
export const BOT_POLL_MS = 60_000
const TTL = 30_000

export interface BotChartData {
  trades: BotTrade[]
  plans: BotPlan[]
}

let cache: { at: number; p: Promise<BotChartData | null> } | null = null

export function loadBotChart(): Promise<BotChartData | null> {
  if (!SERVER_BOT) return Promise.resolve(null)
  if (cache && Date.now() - cache.at < TTL) return cache.p
  const p = Promise.all([loadBot(), loadPlans()]).then(([b, plans]) =>
    b ? { trades: b.trades, plans: plans ?? [] } : null,
  )
  // A failed read is not cached: the next poll tries again.
  p.catch(() => {
    if (cache?.p === p) cache = null
  })
  cache = { at: Date.now(), p }
  return p
}

export const planFor = (d: BotChartData | null, sym: string): BotPlan | null =>
  d?.plans.find((p) => sameMarket(p.symbol, sym)) ?? null
