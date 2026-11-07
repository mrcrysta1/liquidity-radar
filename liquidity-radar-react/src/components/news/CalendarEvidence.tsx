// Market evidence inside the economic calendar: a "BTC 1h" cell for past US
// releases and, for a clicked release, its last 12 occurrences with the
// surprise, BTC's and gold's 1 h move and the regime then. Data from the server
// bot (loaded on demand through a dynamic import, so the News tab's own code
// stays small). Describes what happened; it does not predict.
import { useEffect, useState } from 'react'
import { historySummary, reactionFor } from '../../features/news/calendarEvidence'
import type { HistoryRow, Move, ReactionMap } from '../../features/news/calendarEvidence'
import { CATEGORY_LABEL } from '../../features/selflearn/newsIntel'
import './CalendarEvidence.css'

const bot = () => import('../../features/selflearn/serverBot')
const pct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%'
const cls = (v: number) => (v > 0 ? 'up' : v < 0 ? 'dn' : '')

export function ReactionCell({ m, ts }: { m: ReactionMap | null; ts: number }) {
  const r = m ? reactionFor(m, ts) : null
  if (!r?.btc) return <td className="ff-num ce-cell empty">{''}</td>
  return (
    <td className={'ff-num ce-cell ' + cls(r.btc.ret)} title={`BTC ${pct(r.btc.ret)} in the hour after${r.btc.z != null ? `, ${r.btc.z.toFixed(1)}× its usual 1 h move` : ''}${r.gold ? ` · gold ${pct(r.gold.ret)}` : ''}`}>
      {pct(r.btc.ret)}
      {r.btc.z != null && Math.abs(r.btc.z) >= 2 && <i className="ce-big">{Math.abs(r.btc.z).toFixed(1)}σ</i>}
    </td>
  )
}

const M = ({ v }: { v: Move | null }) => (v ? <span className={cls(v.ret)}>{pct(v.ret)}{v.z != null && <small>{v.z.toFixed(1)}σ</small>}</span> : <span className="ce-dim">—</span>)

export function ReleaseHistory({ category, title, before, onClose }: { category: string; title: string; before: number; onClose: () => void }) {
  const [rows, setRows] = useState<HistoryRow[] | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    bot()
      .then((b) => b.loadReleaseHistory(category, before))
      .then((x) => alive && setRows(x))
      .catch(() => alive && setRows(null))
    return () => {
      alive = false
    }
  }, [category, before])
  const s = rows ? historySummary(rows) : null
  return (
    <div className="ce-hist" role="region" aria-label={`Past ${title} releases`}>
      <div className="ce-hist-top">
        <b>Last {CATEGORY_LABEL[category] ?? title} releases</b>
        <button type="button" onClick={onClose} aria-label="Close">×</button>
      </div>
      {rows === undefined && <p className="ce-dim">Loading past releases…</p>}
      {rows === null && <p className="ce-dim">Past releases could not be loaded.</p>}
      {rows && !rows.length && <p className="ce-dim">No earlier release recorded yet. The bot collects releases and their reactions from 2019 on.</p>}
      {rows && rows.length > 0 && (
        <>
          {s && s.n > 0 && (
            <p className="ce-sum">
              BTC rose after {s.up} of {s.n} · average move {s.avgAbs!.toFixed(2)}% in the hour · {s.big} big move{s.big === 1 ? '' : 's'} (≥ 2σ).
              {s.n < 10 && ' Too few releases to read a pattern.'}
            </p>
          )}
          <table className="ce-table">
            <thead><tr><th>Date</th><th>Surprise</th><th>BTC 1 h</th><th>Gold 1 h</th><th>Regime then</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.time}>
                  <td>{new Date(r.time).toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })}{r.decision && <small>{r.decision}</small>}</td>
                  <td>{r.surprise == null ? <span className="ce-dim">n/a</span> : (r.surprise > 0 ? '+' : '') + +r.surprise.toFixed(2)}</td>
                  <td><M v={r.btc} /></td>
                  <td><M v={r.gold} /></td>
                  <td>{r.regime ?? <span className="ce-dim">not recorded</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ce-dim">Same kind of release is not the same event: compare the surprise and the regime. Past moves describe what happened, not what will. Surprises exist only where a forecast was recorded.</p>
        </>
      )}
    </div>
  )
}
