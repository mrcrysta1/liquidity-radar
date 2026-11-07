// The bot status bar (components/neural/BotStatusBar.tsx): is the server bot
// running, which strategies trade for real, what is open, and how today went.
// Pure (tested in scripts/test-engines.mjs); serverBot.ts loadBotStatus reads
// bot_state (heartbeat, account, strategy:*) and today's closed real trades.

export interface StatusInput {
  now: number
  heartbeat: { t: number; mode?: string } | null
  positions: number
  strategies: Array<{ id: string; state: 'live' | 'probation' | 'shadow' }>
  /** R of real (demo) trades closed since 00:00 UTC. */
  todayR: number[]
}

export interface BotStatus {
  /** ok: ticked within 2 min; handover: 2–20 min (a run hands over to the next every 5½ h); down: longer or never. */
  health: 'ok' | 'handover' | 'down'
  ageS: number | null
  mode: string | null
  live: string[]
  probation: string[]
  shadow: number
  positions: number
  todayN: number
  todayR: number
}

export function botStatus(i: StatusInput): BotStatus {
  const age = i.heartbeat ? Math.max(0, Math.round((i.now - i.heartbeat.t) / 1000)) : null
  return {
    health: age == null ? 'down' : age <= 120 ? 'ok' : age <= 1200 ? 'handover' : 'down',
    ageS: age,
    mode: i.heartbeat?.mode ?? null,
    live: i.strategies.filter((s) => s.state === 'live').map((s) => s.id),
    probation: i.strategies.filter((s) => s.state === 'probation').map((s) => s.id),
    shadow: i.strategies.filter((s) => s.state === 'shadow').length,
    positions: i.positions,
    todayN: i.todayR.length,
    todayR: i.todayR.reduce((a, b) => a + b, 0),
  }
}

/** "12 s", "4 min", "3 h". */
export function ageText(s: number): string {
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`
}
