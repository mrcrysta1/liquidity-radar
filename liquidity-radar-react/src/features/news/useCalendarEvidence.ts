// Hooks and flags for the calendar's market evidence (components/news/CalendarEvidence.tsx),
// kept out of the component file so fast refresh keeps working.
import { useEffect, useState } from 'react'
import type { ReactionMap } from './calendarEvidence'

/** The same check as serverBot.ts SERVER_BOT, without importing it. */
export const HAS_BOT = !!(import.meta.env.VITE_WHALE_DB_URL && import.meta.env.VITE_WHALE_DB_KEY)

/** 1 h reactions for releases between `from` and `to`; reloads when the range changes. Loads the bot module on demand. */
export function useReactions(from: number, to: number): ReactionMap | null {
  const [m, setM] = useState<ReactionMap | null>(null)
  useEffect(() => {
    if (!HAS_BOT || !Number.isFinite(from)) return
    let alive = true
    import('../selflearn/serverBot')
      .then((b) => b.loadCalendarReactions(from, Number.isFinite(to) ? to : Date.now()))
      .then((x) => alive && setM(x))
      .catch(() => alive && setM(null))
    return () => {
      alive = false
    }
  }, [from, to])
  return m
}
