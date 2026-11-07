// "Strategy ledger": every strategy's closed real and paper trades as its own
// virtual portfolio — results long and short, the cost of a trade taken apart
// (fees, slippage, funding) and the whole record re-scored under moderate,
// conservative and stress costs. Calculations in features/selflearn/ledger.ts.
import { useEffect, useState } from 'react'
import { SERVER_BOT, STRATEGY_SINCE, loadLedger } from '../../features/selflearn/serverBot'
import { LEDGER_EQUITY, LEDGER_RISK, PROFILES } from '../../features/selflearn/ledger'
import type { Perf, StrategyLedger as Ledger } from '../../features/selflearn/ledger'
import { NnCard } from './parts'
import { NI } from './icons'
import './StrategyLedger.css'

const dash = '—'
const rr = (v: number | null | undefined, d = 2) => (v == null ? dash : (v >= 0 ? '+' : '') + v.toFixed(d) + 'R')
const cls = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '')
const usd = (v: number) => (v >= 0 ? '+$' : '−$') + Math.abs(v).toFixed(0)
const pct = (v: number) => (v * 100).toFixed(0) + '%'

function Side({ p }: { p: Perf }) {
  if (!p.n) return <span className="sl-dim">{dash}</span>
  return (
    <>
      <b className={cls(p.avgR)}>{rr(p.avgR)}</b>
      <small>{p.n} · {pct(p.win)} won</small>
    </>
  )
}

export function StrategyLedgerCard() {
  const [rows, setRows] = useState<Ledger[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    const load = () => loadLedger().then((x) => { if (alive && x) { setRows(x); setErr('') } }).catch((e) => alive && setErr(String(e)))
    load()
    const id = setInterval(load, 10 * 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  if (!SERVER_BOT) return null
  const since = new Date(STRATEGY_SINCE).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const total = rows?.reduce((a, r) => a + r.real + r.shadow, 0) ?? 0
  const known = rows?.reduce((a, r) => a + r.fundingKnown, 0) ?? 0
  return (
    <NnCard title="Strategy ledger" icon={NI.book} className="sl" right={<small className="sl-sub">since {since} · real + paper · after costs</small>}>
      {err && <p className="nn-err">{err}</p>}
      {!rows && !err && <p className="nn-empty">Loading every strategy’s trades…</p>}
      {rows && !rows.length && <p className="nn-empty">No closed trades yet.</p>}
      {rows && rows.length > 0 && (
        <>
          <div className="nn-tbl">
            <table className="lab-table sl-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Trades</th>
                  <th>As recorded</th>
                  <th>Long</th>
                  <th>Short</th>
                  <th title="Average cost of one trade under the moderate profile">Cost / trade</th>
                  {PROFILES.map((p) => <th key={p.id}>{p.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td><b>{s.id.toUpperCase()}</b></td>
                    <td>
                      <b>{s.real + s.shadow}</b>
                      <small>{s.real} real · {s.shadow} paper · ≈{s.eff} indep.</small>
                    </td>
                    <td>
                      <b className={cls(s.recorded.avgR)}>{rr(s.recorded.avgR)}</b>
                      <small>{pct(s.recorded.win)} won · PF {s.recorded.pf == null ? dash : s.recorded.pf.toFixed(2)} · DD {s.recorded.maxDdR.toFixed(1)}R</small>
                    </td>
                    <td><Side p={s.long} /></td>
                    <td><Side p={s.short} /></td>
                    <td>
                      <b className="dn">{rr(-(s.costs.feeR + s.costs.slipR + s.costs.fundingR))}</b>
                      <small>
                        fees {s.costs.feeR.toFixed(2)} · slip {s.costs.slipR.toFixed(2)} · funding {Math.abs(s.costs.fundingR).toFixed(2)}{s.costs.fundingR < 0 ? ' received' : ''}
                        {s.actual.feeR != null && <> · real fees {s.actual.feeR.toFixed(2)}</>}
                      </small>
                    </td>
                    {PROFILES.map((p) => {
                      const v = s.profiles[p.id]
                      return (
                        <td key={p.id}>
                          <b className={cls(v.avgR)}>{rr(v.avgR)}</b>
                          <small className={cls(v.usd)}>{usd(v.usd)} · DD {v.maxDdR.toFixed(1)}R</small>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sl-note">
            Each strategy is its own ${LEDGER_EQUITY.toLocaleString()} paper portfolio risking {(LEDGER_RISK * 100).toFixed(2)}% (${(LEDGER_EQUITY * LEDGER_RISK).toFixed(0)}) per trade.
            Costs are charged on both legs: <b>moderate</b> = the bot’s own assumption (0.05% fee + 0.02% slippage, maker take-profit),
            <b> conservative</b> = 0.05% + 0.05% with no maker fills, <b>stress</b> = 0.05% + 0.15% and double funding.
            Funding uses each market’s real 8-hourly rate ({known} of {total} trades; the rest assume 0.01% per 8 h).
            A strategy that only wins under moderate costs has no margin for worse fills. Few independent decisions mean none of this is proof yet.
          </p>
        </>
      )}
    </NnCard>
  )
}
