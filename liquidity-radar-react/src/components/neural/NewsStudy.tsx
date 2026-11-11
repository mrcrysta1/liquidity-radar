// "News reaction study": does the market's first hour after a US release say
// anything about the next day? The pre-registered N1 rule tested on 2019–2024
// and 2025 on (radar-worker/scripts/news-study.ts, bot_state 'news:study'),
// and N1's paper record since 2026-11-11 (news_signals), every evaluated
// release included, traded or not. N1 never places orders.
import { useEffect, useState } from 'react'
import { SERVER_BOT, loadNewsStudy } from '../../features/selflearn/serverBot'
import type { NewsSignal, NewsStudyView, StudySummary } from '../../features/selflearn/study'
import { NnCard } from './parts'
import { NI } from './icons'
import './StrategyStudy.css'

const dash = '—'
const pc = (v: number | null | undefined) => (v == null ? dash : (v >= 0 ? '+' : '') + v.toFixed(2) + '%')
const cls = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '')
const range = (s: StudySummary) => (s.lo != null && s.hi != null ? `${pc(s.lo)} to ${pc(s.hi)}` : 'too few for a range')
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function Cell({ s }: { s: StudySummary }) {
  return (
    <td>
      <b className={cls(s.mean)}>{pc(s.mean)}</b> <small>{s.n} trades · {range(s)}</small>
    </td>
  )
}

export function NewsStudyCard() {
  const [d, setD] = useState<{ study: NewsStudyView | null; signals: NewsSignal[] } | undefined>(undefined)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    loadNewsStudy().then((x) => alive && setD(x)).catch((e) => alive && setErr(String(e)))
    return () => {
      alive = false
    }
  }, [])
  if (!SERVER_BOT || (d && !d.study && !d.signals.length)) return null
  const s = d?.study
  const done = d?.signals.filter((x) => x.side !== 0 && x.netPct != null) ?? []
  const net = done.reduce((a, x) => a + x.netPct!, 0)
  return (
    <NnCard title="News reaction study (N1, paper only)" icon={NI.gauge} className="ss" right={s ? <small className="ss-sub">{s.releases} releases since 2019</small> : undefined}>
      {err && <p className="nn-err">{err}</p>}
      {d === undefined && !err && <p className="nn-empty">Loading the news study…</p>}
      {d && (
        <>
          <p className="ss-intro">
            A release on the calendar is never a signal by itself. N1 waits an hour after a US release (NFP, CPI, PPI, FOMC, GDP, unemployment, retail sales, PCE); if BTC, ETH or gold moved unusually for that hour (|z| ≥ {s?.minZ ?? 2} against its last 30 days) it takes a paper trade with the move (“continue”) or against it (“fade”) and closes it 24 hours after the release. Costs 0.10% per side. It never places orders.
          </p>
          {s && (
            <>
              <h4 className="ss-h">Tested on history <small>mode chosen on 2019–2024 only: <b>{s.chosen}</b> · 2025 on is the test</small></h4>
              <div className="nn-tbl">
                <table className="lab-table">
                  <thead><tr><th>Mode</th><th>min |z|</th><th>2019–2024 (design)</th><th>2025 on (test)</th></tr></thead>
                  <tbody>
                    {s.grid.map((g) => (
                      <tr key={g.mode + g.minZ}>
                        <td><b>{g.mode}</b></td>
                        <td>{g.minZ}</td>
                        <Cell s={g.design} />
                        <Cell s={g.test} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="ss-note">
                Without the reaction filter (every release, long for the same 24 hours): <b className={cls(s.base.mean)}>{pc(s.base.mean)}</b> per trade ({range(s.base)}). One release is one sample: BTC, ETH and gold reacting to it are not three. So far no mode clears zero in both periods — the first hour’s reaction has not shown measurable extra information. Consensus forecasts are not in the free history, so actual vs forecast cannot be tested yet.
              </p>
              <details className="ss-note">
                <summary>By release, asset and regime ({s.chosen}, |z| ≥ {s.minZ})</summary>
                <div className="nn-tbl">
                  <table className="lab-table">
                    <thead><tr><th>Group</th><th>Trades</th><th>Mean</th><th>95% range</th></tr></thead>
                    <tbody>
                      {s.groups.map((g) => (
                        <tr key={g.group + g.key}>
                          <td>{g.group}: <b>{g.key}</b></td>
                          <td>{g.s.n}</td>
                          <td className={cls(g.s.mean)}>{pc(g.s.mean)}</td>
                          <td><small>{range(g.s)}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
          <h4 className="ss-h">Paper record since 11 Nov 2026 <small>{d.signals.length} evaluated · {done.length} traded · total {pc(done.length ? net : null)}</small></h4>
          {d.signals.length === 0 ? (
            <p className="ss-note">No release evaluated yet: each one is decided a day after it, once its 24-hour result is known.</p>
          ) : (
            <div className="nn-tbl">
              <table className="lab-table">
                <thead><tr><th>Release</th><th>Asset</th><th>Decision</th><th>Result</th><th>Why</th></tr></thead>
                <tbody>
                  {d.signals.slice(0, 30).map((x) => (
                    <tr key={x.t + x.asset}>
                      <td>{when(x.t)} <small>{x.category.toUpperCase()}</small></td>
                      <td>{x.asset.replace(/USDT$/, '')}</td>
                      <td>{x.side > 0 ? <span className="ss-tag up">long</span> : x.side < 0 ? <span className="ss-tag dn">short</span> : <span className="ss-tag">no trade</span>}</td>
                      <td className={cls(x.netPct)}>{x.side ? pc(x.netPct) : dash}</td>
                      <td><small>{x.reason}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </NnCard>
  )
}
