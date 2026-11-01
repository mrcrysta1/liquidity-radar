// "Planned trades": what the server bot wanted to do on its latest bar for each
// market — side, entry, stop, target, win chance, expected value — whether it
// became a real trade, a paper (shadow) trade or was skipped, and why. Each card
// also shows how the same plan would be sized on a small real-money account,
// with the bot's own sizing code (radar-worker/src/bot/plan.ts).
import { useEffect, useState } from 'react'
import { pfmt } from '../../utils/format'
import { SERVER_BOT, loadPlans } from '../../features/selflearn/serverBot'
import type { BotPlan, PlanSize } from '../../features/selflearn/serverBot'
import { badgeSym, marketLabel } from '../../features/selflearn/perp'
import { CoinBadge, NnCard } from './parts'
import { NI } from './icons'
import './PlannedTrades.css'

const STATUS: Record<BotPlan['status'], [string, string]> = {
  opened: ['Real trade', 'pt-real'],
  paper: ['Paper trade', 'pt-paper'],
  skipped: ['Skipped', 'pt-skip'],
}
const pct = (v: number, d = 0) => (v * 100).toFixed(d) + '%'
const usd = (v: number) => '$' + (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(0))
const move = (from: number, to: number) => ((to - from) / from) * 100
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function Sizing({ label, s }: { label: string; s?: PlanSize }) {
  if (!s) return null
  return (
    <div className="pt-size">
      <small>{label} · {usd(s.equity)}</small>
      {s.qty > 0 ? (
        <span>
          {usd(s.notional)} position · margin {usd(s.margin)} · risk <b>{usd(s.riskUsd)}</b> ({pct(s.riskPct, 1)}) · fees ~{usd(s.feesUsd)}
        </span>
      ) : (
        <span className="pt-no">Binance would refuse: {s.reason}</span>
      )}
    </div>
  )
}

function Plan({ p }: { p: BotPlan }) {
  const long = p.side === 'LONG'
  return (
    <div className={'pt-card ' + STATUS[p.status][1]}>
      <div className="pt-top">
        <CoinBadge sym={badgeSym(p.symbol)} size={22} />
        <b>{marketLabel(p.symbol)}</b>
        <span className={'pt-side ' + (long ? 'up' : 'dn')}>{p.side}</span>
        <span className="pt-status">{STATUS[p.status][0]}{p.tradeId ? ` #${p.tradeId}` : p.shadowId ? ` #${p.shadowId}` : ''}</span>
      </div>
      <div className="pt-levels">
        <div><small>Entry</small><b>{pfmt(p.entry)}</b></div>
        <div><small>Stop-loss</small><b className="dn">{pfmt(p.sl)}</b><em>{move(p.entry, p.sl).toFixed(2)}%</em></div>
        {p.tp != null ? (
          <div><small>Take-profit</small><b className="up">{pfmt(p.tp)}</b><em>{move(p.entry, p.tp) >= 0 ? '+' : ''}{move(p.entry, p.tp).toFixed(2)}%</em></div>
        ) : (
          <div><small>Take-profit</small><b>—</b><em>{p.strategy === 'trend' ? 'trailing stop' : ''}</em></div>
        )}
      </div>
      <div className="pt-nums">
        {p.strategy === 'trend' && <span>Strategy <b>{(p.strategyId ?? 'f1').toUpperCase()} trend</b></span>}
        {p.pWin != null && <span>Win chance <b>{pct(p.pWin)}</b></span>}
        {p.evR != null && <span>Expected <b className={p.evR >= 0 ? 'up' : 'dn'}>{p.evR >= 0 ? '+' : ''}{p.evR.toFixed(2)}R</b></span>}
        {p.rr != null && <span>R:R <b>{p.rr.toFixed(2)}</b></span>}
        {Number.isFinite(p.costR) && <span>Fees <b>{p.costR.toFixed(2)}R</b></span>}
      </div>
      {p.reasons.length > 0 && <p className="pt-why">Why not real: {p.reasons.join('; ')}</p>}
      <Sizing label="Demo account" s={p.live} />
      <Sizing label="Small real account" s={p.small} />
      <small className="pt-when">{p.interval} bar closed {when(p.barClose)}</small>
    </div>
  )
}

export function PlannedTrades() {
  const [plans, setPlans] = useState<BotPlan[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    const load = () => loadPlans().then((x) => { if (alive) { setPlans(x); setErr('') } }).catch((e) => alive && setErr(String(e)))
    load()
    const id = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  if (!SERVER_BOT) return null
  return (
    <NnCard title="Planned trades" icon={NI.target} className="pt" right={<small className="pt-sub">latest bar, every market</small>}>
      {err && <p className="nn-err">{err}</p>}
      {!plans && !err && <p className="nn-empty">Loading plans…</p>}
      {plans && !plans.length && <p className="nn-empty">No plan yet: the bot writes one when the next candle closes.</p>}
      {plans && plans.length > 0 && <div className="pt-grid">{plans.map((p) => <Plan key={p.symbol} p={p} />)}</div>}
    </NnCard>
  )
}
