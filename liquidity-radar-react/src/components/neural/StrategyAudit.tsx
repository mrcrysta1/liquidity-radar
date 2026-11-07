// "Strategy audit": the latest run of radar-worker/scripts/audit.ts — every
// strategy re-run on each market's whole history, its result under three cost
// profiles, the design period vs the holdout, by year and BTC regime, its
// weaknesses, and a keep / watch / retire verdict from fixed rules. A report
// only: the bot never acts on it. Data: bot_state 'audit:latest'.
import { useEffect, useState } from 'react'
import { SERVER_BOT, loadAudit } from '../../features/selflearn/serverBot'
import type { AuditReport, AuditStrategy, AuditSummary } from '../../features/selflearn/audit'
import { NnCard } from './parts'
import { NI } from './icons'
import './StrategyAudit.css'

const VERDICT: Record<AuditStrategy['verdict'], [string, string]> = {
  keep: ['Keep', 'sa-keep'],
  watch: ['Watch', 'sa-watch'],
  retire: ['Retire?', 'sa-retire'],
}
const dash = '—'
const rr = (v: number | null, d = 2) => (v == null ? dash : (v >= 0 ? '+' : '') + v.toFixed(d) + 'R')
const cls = (v: number | null) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '')
const day = (t: number | null) => (t == null ? dash : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))

function Cell({ s, label }: { s: AuditSummary; label: string }) {
  return (
    <div>
      <small>{label}</small>
      <b className={cls(s.mean)}>{rr(s.mean)}</b>
      <em>{s.lo != null && s.hi != null ? `${rr(s.lo)} to ${rr(s.hi)}` : `${s.n} trades`}</em>
    </div>
  )
}

function Strategy({ s }: { s: AuditStrategy }) {
  const [label, c] = VERDICT[s.verdict]
  return (
    <details className={'sa-card ' + c}>
      <summary>
        <b>{s.id.toUpperCase()}</b>
        <span className="sa-name">{s.name}</span>
        <span className="sa-badge">{label}</span>
      </summary>
      <div className="sa-nums">
        <Cell s={s.profiles.moderate} label="Moderate costs" />
        <Cell s={s.profiles.conservative} label="Conservative" />
        <Cell s={s.profiles.stress} label="Stress" />
        <Cell s={s.holdout} label={s.holdoutSeen ? 'Holdout ⚠ seen' : 'Holdout (sealed)'} />
      </div>
      <p className="sa-meta">
        {s.trades} trades on {s.markets} markets ({s.marketsPositive} positive) · ≈{s.profiles.conservative.eff} independent
        {s.costPerTrade != null && <> · costs + funding {s.costPerTrade.toFixed(2)}R/trade</>}
        {s.neighbours != null && <> · {Math.round(s.neighbours * 100)}% of nearby settings positive</>}
        {s.replication && <> · live check: {s.replication.matched} matched, {s.replication.backtestOnly + s.replication.liveOnly} differ</>}
      </p>
      <ul className="sa-why">{s.why.map((w) => <li key={w}>{w}</li>)}</ul>
      {s.flags.length > 0 && <ul className="sa-flags">{s.flags.map((w) => <li key={w}>{w}</li>)}</ul>}
      <div className="sa-split">
        <div>
          <h5>By year <small>conservative costs</small></h5>
          {s.years.map(([y, v]) => (
            <p key={y}><span>{y}</span><b className={cls(v.mean)}>{rr(v.mean)}</b><small>{v.n}</small></p>
          ))}
        </div>
        <div>
          <h5>By BTC regime</h5>
          {s.regimes.map(([k, v]) => (
            <p key={k}><span>{k.replace('-', ' · ')}</span><b className={cls(v.mean)}>{rr(v.mean)}</b><small>{v.n}</small></p>
          ))}
        </div>
      </div>
    </details>
  )
}

export function StrategyAuditCard() {
  const [rep, setRep] = useState<AuditReport | null | undefined>(undefined)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    loadAudit().then((x) => alive && setRep(x)).catch((e) => alive && setErr(String(e)))
    return () => {
      alive = false
    }
  }, [])
  if (!SERVER_BOT || rep === null) return null
  return (
    <NnCard title="Strategy audit" icon={NI.shield} className="sa" right={rep ? <small className="sa-sub">run {day(rep.generatedAt)} · {rep.markets} markets · {day(rep.from)} → {day(rep.to)}</small> : undefined}>
      {err && <p className="nn-err">{err}</p>}
      {rep === undefined && !err && <p className="nn-empty">Loading the audit…</p>}
      {rep && (
        <>
          <p className="sa-intro">
            Every strategy re-run with the bot’s own code over each market’s whole 4-hour history, priced with real funding and three cost levels. A report only: nothing is switched on or off automatically. Open a strategy for the detail.
          </p>
          <div className="sa-list">{rep.strategies.map((s) => <Strategy key={s.id} s={s} />)}</div>
          {rep.rules.length > 0 && (
            <details className="sa-rules">
              <summary>How the verdict is decided</summary>
              <ul>{rep.rules.map((r) => <li key={r}>{r}</li>)}</ul>
              <p>“Holdout ⚠ seen”: the strategy was designed after that period had been looked at, so it is not independent evidence; only trades since it went live are.</p>
            </details>
          )}
        </>
      )}
    </NnCard>
  )
}
