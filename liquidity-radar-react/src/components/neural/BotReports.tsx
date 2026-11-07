// "Daily & weekly report": the bot's own intelligence report for each day
// (releases and reactions, regime, BTC / gold, every strategy, the model,
// news-related trades, errors, anomalies, what to look at) and the week
// against the week before. Data: bot_state 'report:daily' / 'report:weekly'
// (radar-worker/src/research/report.ts), written once per UTC day.
import { useEffect, useState } from 'react'
import { SERVER_BOT, loadReports } from '../../features/selflearn/serverBot'
import type { DayReport, WeekReport } from '../../features/selflearn/reports'
import { NnCard } from './parts'
import { NI } from './icons'
import './BotReports.css'

const dash = '—'
const rr = (v: number | null | undefined, d = 2) => (v == null ? dash : (v >= 0 ? '+' : '') + v.toFixed(d) + 'R')
const cls = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '')
const pct = (v: number | null) => (v == null ? dash : Math.round(v * 100) + '%')
const sg = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%'

export function BotReportsCard() {
  const [data, setData] = useState<{ daily: DayReport[]; weekly: WeekReport | null } | null | undefined>(undefined)
  const [err, setErr] = useState('')
  const [pick, setPick] = useState('')
  const [tab, setTab] = useState<'day' | 'week'>('day')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    loadReports().then((x) => alive && setData(x)).catch((e) => alive && setErr(String(e)))
    return () => {
      alive = false
    }
  }, [])
  if (!SERVER_BOT || data === null || (data && !data.daily.length && !err)) return null
  const d = data?.daily.find((x) => x.day === pick) ?? data?.daily[0]
  const w = data?.weekly
  return (
    <NnCard title="Daily & weekly report" icon={NI.book} className="br" right={<div className="nn-seg"><button type="button" className={tab === 'day' ? 'on' : ''} onClick={() => setTab('day')}>Day</button><button type="button" className={tab === 'week' ? 'on' : ''} onClick={() => setTab('week')}>Week</button></div>}>
      {err && <p className="nn-err">{err}</p>}
      {data === undefined && !err && <p className="nn-empty">Loading reports…</p>}
      {tab === 'day' && d && data && (
        <>
          <div className="lab-filters">
            <select value={d.day} onChange={(e) => setPick(e.target.value)} aria-label="Day">
              {data.daily.map((x) => <option key={x.day} value={x.day}>{x.day}</option>)}
            </select>
            <small>{d.wins} won · {d.losses} lost · {d.errors.count} errors</small>
          </div>
          <div className="br-tiles">
            <div><small>Regime</small><b>{d.regime.end ?? dash}</b><em>{d.regime.start && d.regime.start !== d.regime.end ? `from ${d.regime.start}` : `${d.regime.snapshots} snapshots`}</em></div>
            <div><small>BTC · gold (4h)</small><b>{d.btc ?? dash} · {d.gold ?? dash}</b><em>{d.corrChanges} correlation changes</em></div>
            <div><small>Model</small><b>{d.model.n ? `${pct(d.model.meanP)} → ${pct(d.model.winRate)}` : dash}</b><em>{d.model.n ? `said → won, ${d.model.n} outcomes` : 'no outcomes'}</em></div>
            <div><small>Near releases</small><b className={cls(d.news.sumR)}>{d.news.trades ? rr(d.news.sumR, 1) : dash}</b><em>{d.news.trades} trades, {d.news.wins} won</em></div>
          </div>
          {d.events.length > 0 && (
            <ul className="br-list">
              {d.events.map((e) => (
                <li key={e.time + e.category}>
                  <b>{e.title}</b>{e.surprise != null && <> · surprise {e.surprise > 0 ? '+' : ''}{e.surprise}</>}
                  {e.btc1h && <> · BTC <span className={cls(e.btc1h.ret)}>{sg(e.btc1h.ret)}</span>{e.btc1h.z != null && ` (${e.btc1h.z.toFixed(1)}σ)`}</>}
                  {e.gold1h && <> · gold <span className={cls(e.gold1h.ret)}>{sg(e.gold1h.ret)}</span></>} in 1 h
                </li>
              ))}
            </ul>
          )}
          {d.strategies.length > 0 && (
            <div className="nn-tbl">
              <table className="lab-table br-table">
                <thead><tr><th>Strategy</th><th>Closed</th><th>Won</th><th>Total</th><th>Avg</th></tr></thead>
                <tbody>
                  {d.strategies.map((s) => (
                    <tr key={s.strategy}><td><b>{s.strategy.toUpperCase()}</b></td><td>{s.n}<small>{s.real} real</small></td><td>{s.wins}</td><td className={cls(s.sumR)}>{rr(s.sumR, 1)}</td><td className={cls(s.avgR)}>{rr(s.avgR)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.anomalies.length > 0 && <ul className="br-warn">{d.anomalies.map((a) => <li key={a}>{a}</li>)}</ul>}
          {d.investigate.length > 0 && <ul className="br-look">{d.investigate.map((a) => <li key={a}>{a}</li>)}</ul>}
          {d.errors.top.length > 0 && <p className="br-note">Errors: {d.errors.top.map((e) => `${e.msg} ×${e.n}`).join(' · ')}</p>}
        </>
      )}
      {tab === 'week' && (w ? (
        <>
          <p className="br-note">{w.from} → {w.to} ({w.days} days){w.previous ? ` vs ${w.previous.from} → ${w.previous.to}` : ' · no earlier week yet'} · {w.events} releases · {w.errors} errors · {w.anomalies} anomalies · regime: {w.regimes.map(([k, n]) => `${k} ${n}d`).join(', ') || dash}</p>
          <div className="nn-tbl">
            <table className="lab-table br-table">
              <thead><tr><th>Strategy</th><th>This week</th><th>Avg</th><th>Week before</th><th>Avg</th></tr></thead>
              <tbody>
                {w.strategies.map((s) => (
                  <tr key={s.strategy}>
                    <td><b>{s.strategy.toUpperCase()}</b></td>
                    <td className={cls(s.sumR)}>{rr(s.sumR, 1)}<small>{s.n} trades</small></td>
                    <td className={cls(s.avgR)}>{rr(s.avgR)}</td>
                    <td className={cls(s.prevSumR)}>{s.prevN ? rr(s.prevSumR, 1) : dash}<small>{s.prevN} trades</small></td>
                    <td className={cls(s.prevAvgR)}>{rr(s.prevAvgR)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="br-note">Model Brier score {w.model.brier == null ? dash : w.model.brier.toFixed(3)} ({w.model.n} outcomes) vs {w.model.prevBrier == null ? dash : w.model.prevBrier.toFixed(3)} the week before — lower is better. One week is a small sample: read the trend, not a single number.</p>
        </>
      ) : <p className="nn-empty">The weekly comparison appears after the first daily report.</p>)}
    </NnCard>
  )
}
