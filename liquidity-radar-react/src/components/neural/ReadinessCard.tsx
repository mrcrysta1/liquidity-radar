// "Go-live readiness": the checklist the testnet bot must pass before real
// money is even considered (features/selflearn/readiness.ts). READY only when
// every row passes; win rate is shown but is not a criterion.
import { useEffect, useState } from 'react'
import { SERVER_BOT, loadReadiness } from '../../features/selflearn/serverBot'
import { BENIGN_ERRORS, computeReadiness } from '../../features/selflearn/readiness'
import type { CheckStatus, Readiness } from '../../features/selflearn/readiness'
import { NnCard } from './parts'
import { NI } from './icons'
import './ReadinessCard.css'

const MARK: Record<CheckStatus, [string, string]> = {
  pass: ['Pass', 'rd-pass'],
  fail: ['Fail', 'rd-fail'],
  insufficient: ['Not yet', 'rd-wait'],
}
const daysTxt = (d: number | null | undefined) => (d == null ? 'unknown' : d <= 0 ? 'done' : d < 1 ? 'under a day' : `~${Math.ceil(d)} days`)

export function ReadinessCard() {
  const [r, setR] = useState<Readiness | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    const load = () =>
      loadReadiness()
        .then((x) => {
          if (alive && x) {
            setR(computeReadiness(x))
            setErr('')
          }
        })
        .catch((e) => alive && setErr(String(e)))
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  if (!SERVER_BOT) return null
  return (
    <NnCard
      title="Go-live readiness"
      icon={NI.shield}
      className="rd"
      right={r && <span className={'rd-verdict ' + (r.ready ? 'rd-pass' : 'rd-fail')}>{r.ready ? 'READY' : 'NOT READY'}</span>}
    >
      {err && <p className="nn-err">{err}</p>}
      {!r && !err && <p className="nn-empty">Checking the record…</p>}
      {r && (
        <>
          <p className="rd-sub">
            Real money only when every row passes. Live set: {r.liveIds.length ? r.liveIds.map((x) => x.toUpperCase()).join(', ') : 'none'}
            {r.since != null && ` · first real trade ${new Date(r.since).toLocaleDateString()}`}
            {!r.ready && ` · time and trade count done in ${daysTxt(r.daysLeft)}`}
          </p>
          <ul className="rd-list">
            {r.checks.map((c) => {
              const [label, cls] = MARK[c.status]
              return (
                <li key={c.id} className={'rd-row ' + cls}>
                  <span className="rd-mark">{label}</span>
                  <div className="rd-main">
                    <b>{c.label}</b>
                    <span className="rd-val">{c.value}</span>
                    {c.note && <small>{c.note}</small>}
                  </div>
                  <div className="rd-target">
                    <small>Target</small>
                    <span>{c.target}</span>
                    {c.daysLeft !== undefined && c.status !== 'pass' && <em>{daysTxt(c.daysLeft)} to go</em>}
                  </div>
                </li>
              )
            })}
          </ul>
          <p className="rd-foot">
            Win rate {r.winRate == null ? '—' : (r.winRate * 100).toFixed(0) + '%'} of {r.closed} closed —{' '}
            <b>not</b> a go-live criterion: a trend strategy loses most trades and earns on the few large ones.
          </p>
          <small className="rd-note">
            Benign errors not counted: {BENIGN_ERRORS.map((b) => `“${b.re.source.replace(/^\^/, '')}” (${b.why})`).join('; ')}.
          </small>
        </>
      )}
    </NnCard>
  )
}
