// The server bot at a glance, above the Self Learning sub-tabs: running or not
// (from its heartbeat), the strategies placing demo orders, open positions and
// today's closed demo trades. Refreshes every 30 s; one small request.
import { useEffect, useState } from 'react'
import { SERVER_BOT, loadBotStatus } from '../../features/selflearn/serverBot'
import { ageText } from '../../features/selflearn/botStatus'
import type { BotStatus } from '../../features/selflearn/botStatus'
import './BotStatusBar.css'

const HEALTH: Record<BotStatus['health'], [string, string]> = {
  ok: ['Bot running', 'bs-ok'],
  handover: ['Bot handing over', 'bs-wait'],
  down: ['Bot not running', 'bs-down'],
}

export function BotStatusBar() {
  const [s, setS] = useState<BotStatus | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    const load = () => loadBotStatus().then((x) => { if (alive) { setS(x); setErr(false) } }).catch(() => alive && setErr(true))
    load()
    const id = setInterval(load, 30_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  if (!SERVER_BOT || (!s && !err)) return null
  if (!s) return <div className="bs-bar bs-down" role="status"><b>Bot status unavailable</b><span>the database could not be read</span></div>
  const [label, cls] = HEALTH[s.health]
  return (
    <div className={'bs-bar ' + cls} role="status" aria-live="polite">
      <b><i className="bs-dot" />{label}</b>
      <span>{s.ageS == null ? 'no heartbeat yet' : `last tick ${ageText(s.ageS)} ago`}{s.health === 'handover' && ' (runs restart every 5½ h)'}</span>
      <span>{s.live.length ? <>live: <b>{s.live.map((x) => x.toUpperCase()).join(', ')}</b></> : 'no live strategy'}{s.probation.length > 0 && <> · probation: {s.probation.map((x) => x.toUpperCase()).join(', ')}</>} · {s.shadow} on paper</span>
      <span>{s.positions} open position{s.positions === 1 ? '' : 's'}</span>
      <span>today: {s.todayN ? <b className={s.todayR >= 0 ? 'up' : 'dn'}>{(s.todayR >= 0 ? '+' : '') + s.todayR.toFixed(2)}R</b> : 'no closed trades'}{s.todayN > 0 && ` (${s.todayN})`}</span>
      <span className="bs-demo">testnet · demo money</span>
    </div>
  )
}
