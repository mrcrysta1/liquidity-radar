// "Is it on track?" — the server bot's learning, judged by its own record:
// do stops cost ~1R, are its win chances honest, is there a real edge, and how
// many more trades (and days, at the pace so far) each answer needs.
// Statistics in features/selflearn/onTrack.ts; data from the bot database.
import { useEffect, useState } from 'react'
import { SERVER_BOT, STRATEGY_SINCE, loadOutcomes } from '../../features/selflearn/serverBot'
import { onTrack } from '../../features/selflearn/onTrack'
import type { OnTrack as Report } from '../../features/selflearn/onTrack'
import { NnCard } from './parts'
import { NI } from './icons'
import './OnTrack.css'

const VERDICT: Record<Report['verdict'], [string, string]> = {
  early: ['Too early to tell', 'ot-early'],
  learning: ['Learning — not proven yet', 'ot-learning'],
  'on-track': ['On track', 'ot-good'],
  'off-track': ['Off track', 'ot-bad'],
}
const pct = (v: number) => (v * 100).toFixed(0) + '%'
const sgn = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2) + 'R'
const eta = (d: number | null) => (d == null ? 'pace not known yet' : d === 0 ? 'reached' : `~${d} day${d === 1 ? '' : 's'} at this pace`)

function Progress({ label, have, need, days }: { label: string; have: number; need: number; days: number | null }) {
  return (
    <div className="ot-prog">
      <div className="ot-prog-top">
        <span>{label}</span>
        <b>{Math.min(have, need)} / {need}</b>
      </div>
      <div className="ot-bar"><i style={{ width: Math.min(100, (have / need) * 100) + '%' }} /></div>
      <small>{eta(days)}</small>
    </div>
  )
}

export function OnTrackPanel() {
  const [rep, setRep] = useState<Report | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    const load = () => loadOutcomes().then((x) => { if (alive && x) { setRep(onTrack(x.real, x.shadow, STRATEGY_SINCE, Date.now())); setErr('') } }).catch((e) => alive && setErr(String(e)))
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  if (!SERVER_BOT) return null
  const since = new Date(STRATEGY_SINCE).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return (
    <NnCard title="Is it on track?" icon={NI.target} className="ot" right={<small className="ot-since">since {since} · 4h gated</small>}>
      {err && <p className="nn-err">{err}</p>}
      {!rep && !err && <p className="nn-empty">Loading the bot’s record…</p>}
      {rep && (
        <>
          <div className={'ot-verdict ' + VERDICT[rep.verdict][1]}>
            <b>{VERDICT[rep.verdict][0]}</b>
            <ul>{rep.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
          <div className="ot-tiles">
            <div>
              <small>Real trades</small>
              <b>{rep.real}</b>
              <em>{rep.shadow} shadow</em>
            </div>
            <div>
              <small>Avg per real trade</small>
              <b className={rep.edge.meanR == null ? '' : rep.edge.meanR >= 0 ? 'up' : 'dn'}>{rep.edge.meanR == null ? '—' : sgn(rep.edge.meanR)}</b>
              <em>{rep.edge.lo != null ? `95%: ${sgn(rep.edge.lo)} to ${sgn(rep.edge.hi!)}` : 'after fees'}</em>
            </div>
            <div>
              <small>Chance the edge is real</small>
              <b>{rep.edge.pEdge == null ? '—' : pct(rep.edge.pEdge)}</b>
              <em>needs 95%+ over many trades</em>
            </div>
            <div>
              <small>Avg stop-out</small>
              <b className={rep.stops.meanR != null && rep.stops.meanR < -1.3 ? 'dn' : ''}>{rep.stops.meanR == null ? '—' : sgn(rep.stops.meanR)}</b>
              <em>should be about −1R</em>
            </div>
          </div>
          <div className="ot-progs">
            <Progress label="Win chances checked (real + shadow)" have={rep.cal.n} need={rep.cal.need} days={rep.days.cal} />
            <Progress label="Edge proven (real trades)" have={rep.edge.n} need={rep.edge.need} days={rep.days.edge} />
          </div>
          {rep.cal.buckets.length > 0 && (
            <>
              <h4 className="ot-h">Said vs. happened <small>does a 55% call win 55% of the time?</small></h4>
              <div className="ot-cal">
                {rep.cal.buckets.map((b) => (
                  <div key={b.lo} className="ot-cal-row" title={`${b.n} outcomes`}>
                    <span>{pct(b.lo)}–{pct(b.hi)}</span>
                    <div className="ot-cal-bars">
                      <i className="ot-pred" style={{ width: b.pred * 100 + '%' }} />
                      <i className="ot-act" style={{ width: b.actual * 100 + '%' }} />
                    </div>
                    <b>{pct(b.pred)} → {pct(b.actual)}</b>
                    <small>{b.n}</small>
                  </div>
                ))}
              </div>
              <p className="ot-key"><i className="ot-pred" /> predicted <i className="ot-act" /> actual · bars are win rates</p>
            </>
          )}
        </>
      )}
    </NnCard>
  )
}
