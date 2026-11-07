// The evidence line under a Signals card: the scanner's graded record on this
// market and for this conviction tier, and — when the server bot has its own
// signal on the same market — what it did and its strategy's audit verdict.
// The bot's plans and the audit are fetched once for all cards (2 min cache);
// the bot module is loaded on demand so it stays out of the first-page bundle.
import { useEffect, useState } from 'react'
import { callRecord } from '../../features/signals/signals'
import { botViewFor, recordText } from '../../features/signals/trust'
import type { PlanLike } from '../../features/signals/trust'
import './SignalTrust.css'

type BotData = { plans: PlanLike[]; verdicts: Record<string, string>; at: number }
let cache: Promise<BotData> | null = null
let cacheAt = 0
function botData(now: number): Promise<BotData> {
  if (!cache || now - cacheAt > 120_000) {
    cacheAt = now
    cache = import('../../features/selflearn/serverBot').then((m) => Promise.all([m.loadPlans().catch(() => null), m.loadAudit().catch(() => null)])).then(([plans, audit]) => ({
      plans: plans ?? [],
      verdicts: Object.fromEntries((audit?.strategies ?? []).map((s) => [s.id, s.verdict])),
      at: Date.now(),
    }))
  }
  return cache
}

/** The same check as serverBot.ts SERVER_BOT, without importing it. */
const SERVER_BOT = !!(import.meta.env.VITE_WHALE_DB_URL && import.meta.env.VITE_WHALE_DB_KEY)
const VERDICT: Record<string, string> = { keep: 'audit: keep', watch: 'audit: watch', retire: 'audit: retire?' }

export function SignalTrust({ sym, tier }: { sym: string; tier?: string }) {
  const [bot, setBot] = useState<BotData | null>(null)
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    botData(Date.now()).then((d) => alive && setBot(d))
    return () => {
      alive = false
    }
  }, [])
  const rec = callRecord(sym, tier)
  const view = bot ? botViewFor(sym, bot.plans, bot.verdicts, bot.at) : null
  return (
    <div className="sg-trust" title="How much history stands behind this signal">
      <span>{recordText(rec.market, 'Scanner on this market')}</span>
      {tier && <span>{recordText(rec.tier, `${tier[0]}${tier.slice(1).toLowerCase()} calls`)}</span>}
      {view && (
        <span className="sg-trust-bot">
          Bot: {view.strategy.toUpperCase()} {view.side.toLowerCase()} ({view.status === 'opened' ? 'demo trade' : 'paper'})
          {view.verdict && <> · {VERDICT[view.verdict] ?? view.verdict}</>}
        </span>
      )}
    </div>
  )
}
