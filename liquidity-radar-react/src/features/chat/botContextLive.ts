// The live half of botContext.ts: fills a BotSnapshot from the bot's Supabase
// records (serverBot.ts loaders, anonymous read-only), at most once a minute.
//
// Kept apart from botContext.ts because serverBot.ts reads import.meta.env,
// which only exists under Vite; the pure summarizer stays testable in Node.
import { SERVER_BOT, loadAccount, loadBot, loadJournal, loadPlans, loadReadiness, loadStrategies } from '../selflearn/serverBot'
import { createCache, summarizeBot } from './botContext'
import type { BotSnapshot } from './botContext'

export { SERVER_BOT }

/** Each loader on its own: one that fails leaves its part null, not the whole snapshot. */
async function loadSnapshot(): Promise<BotSnapshot> {
  const now = Date.now()
  const [account, strategies, plans, journal, bot, readiness] = await Promise.allSettled([
    loadAccount(),
    loadStrategies(),
    loadPlans(),
    loadJournal(150),
    loadBot(),
    loadReadiness(now),
  ])
  const v = <T>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null)
  return {
    now,
    account: v(account),
    strategies: v(strategies),
    plans: v(plans),
    journal: v(journal),
    events: v(bot)?.events ?? null,
    readiness: v(readiness),
  }
}

const cached = createCache(loadSnapshot, 60_000)

/** The bot's records, or null when this deployment has none or they cannot be read. */
export async function botSnapshot(): Promise<BotSnapshot | null> {
  if (!SERVER_BOT) return null
  try {
    return await cached()
  } catch {
    return null
  }
}

/** The BOT STATUS block for the model ('' when there is no bot data). */
export async function botContext(): Promise<string> {
  const x = await botSnapshot()
  return x ? summarizeBot(x) : ''
}
