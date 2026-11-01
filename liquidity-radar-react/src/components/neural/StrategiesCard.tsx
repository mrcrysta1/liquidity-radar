// "Strategies": every strategy the server bot runs, in priority order, with its
// health — live (real orders), probation (still real, a warning) or shadow
// (paper only) — its real and paper trade counts, the rolling 30-trade
// expectancy, the drawdown in R and its last state change. Data from bot_state
// 'strategy:*' (radar-worker/src/bot/health.ts).
import { useEffect, useState } from 'react'
import { SERVER_BOT, loadStrategies } from '../../features/selflearn/serverBot'
import type { BotStrategy, BotStrategyState } from '../../features/selflearn/botStrategies'
import { NnCard } from './parts'
import { NI } from './icons'
import './StrategiesCard.css'

const BADGE: Record<BotStrategyState, [string, string]> = {
  live: ['Live', 'sc-live'],
  probation: ['Probation', 'sc-prob'],
  shadow: ['Shadow', 'sc-shadow'],
}
const dash = '—'
const rr = (v: number | null, d = 2) => (v == null ? dash : (v >= 0 ? '+' : '') + v.toFixed(d) + 'R')
const cls = (v: number | null) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '')
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function Strategy({ s }: { s: BotStrategy }) {
  const [label, c] = BADGE[s.state]
  return (
    <div className={'sc-card ' + c}>
      <div className="sc-top">
        <b>{s.id.toUpperCase()}</b>
        <span className="sc-name">{s.name}</span>
        <span className="sc-badge">{label}</span>
      </div>
      <div className="sc-nums">
        <div><small>Real</small><b>{s.real}</b></div>
        <div><small>Paper</small><b>{s.shadow}</b></div>
        <div><small>Last 30</small><b className={cls(s.roll30)}>{rr(s.roll30)}</b><em>per trade</em></div>
        <div><small>Drawdown</small><b className={s.ddR ? 'dn' : ''}>{s.ddR == null ? dash : s.ddR.toFixed(1) + 'R'}</b><em>worst {s.maxDdR == null ? dash : s.maxDdR.toFixed(1) + 'R'}</em></div>
      </div>
      {s.last ? (
        <p className="sc-why">
          {BADGE[s.last.from]?.[0] ?? s.last.from} → {BADGE[s.last.to][0]} {when(s.last.t)}: {s.last.reason}
        </p>
      ) : (
        <p className="sc-why">No state change yet (started {s.configured}).</p>
      )}
      {!s.hasBands && <small className="sc-note">No health bands: it never moves between live and shadow on its own.</small>}
      {s.hasBands && s.state === 'shadow' && s.segN != null && (
        <small className="sc-note">{s.segN} paper trades since {s.last?.to === 'shadow' ? 'the demotion' : 'it started'} · needs 30 with a positive result to go live</small>
      )}
    </div>
  )
}

export function StrategiesCard() {
  const [rows, setRows] = useState<BotStrategy[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    const load = () => loadStrategies().then((x) => { if (alive) { setRows(x); setErr('') } }).catch((e) => alive && setErr(String(e)))
    load()
    const id = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  // Nothing to show until the bot runs several strategies (BOT_STRATEGIES).
  if (!SERVER_BOT || (rows && !rows.length && !err)) return null
  return (
    <NnCard title="Strategies" icon={NI.layers} className="sc" right={<small className="sc-sub">real orders only while live</small>}>
      {err && <p className="nn-err">{err}</p>}
      {!rows && !err && <p className="nn-empty">Loading strategies…</p>}
      {rows && rows.length > 0 && <div className="sc-grid">{rows.map((s) => <Strategy key={s.id} s={s} />)}</div>}
    </NnCard>
  )
}
