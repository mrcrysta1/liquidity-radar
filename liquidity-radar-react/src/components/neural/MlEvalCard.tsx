// "Model calibration study": are the model's win chances honest, and would a
// different calibration be more honest? The live per-market calibration
// against pooled alternatives, replayed in time order (each outcome predicted
// before it is learned), scored on log loss, Brier, calibration error and
// ranking, long and short apart. A report only: nothing is switched.
// Data: bot_state 'ml:eval' (radar-worker/src/research/calib.ts), daily.
import { useEffect, useState } from 'react'
import { SERVER_BOT, loadMlEval } from '../../features/selflearn/serverBot'
import type { MlEval } from '../../features/selflearn/mlEval'
import { NnCard } from './parts'
import { NI } from './icons'
import './MlEvalCard.css'

const f = (v: number | null, d = 3) => (v == null ? '—' : v.toFixed(d))
const pct = (v: number | null) => (v == null ? '—' : Math.round(v * 100) + '%')
const rr = (v: number | null) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R')

export function MlEvalCard() {
  const [ev, setEv] = useState<MlEval | null | undefined>(undefined)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    loadMlEval().then((x) => alive && setEv(x)).catch((e) => alive && setErr(String(e)))
    return () => {
      alive = false
    }
  }, [])
  if (!SERVER_BOT || ev === null) return null
  return (
    <NnCard title="Model calibration study" icon={NI.cpu} className="me" right={ev ? <small className="me-sub">{ev.n} outcomes · {new Date(ev.t).toLocaleDateString()}</small> : undefined}>
      {err && <p className="nn-err">{err}</p>}
      {ev === undefined && !err && <p className="nn-empty">Loading the study…</p>}
      {ev && (
        <>
          <p className={'me-verdict' + (ev.better ? ' me-better' : '')}>{ev.verdict}</p>
          <div className="nn-tbl">
            <table className="lab-table me-table">
              <thead>
                <tr>
                  <th>Calibration</th>
                  <th title="Lower is better">Log loss</th>
                  <th title="Average gap between predicted and actual win rate (lower is better)">Calib. error</th>
                  <th title="0.5 = no ranking skill">AUC</th>
                  <th>Long: said / won</th>
                  <th>Short: said / won</th>
                  <th title="Log-loss gain over the live scheme; 95% range, grouped by candle">vs live</th>
                  <th title="Trades it would take at EV ≥ 0.1R, and their average result">Would take</th>
                </tr>
              </thead>
              <tbody>
                {ev.candidates.map((c) => (
                  <tr key={c.id} className={c.id === 'cell' ? 'me-live' : c.id === ev.better ? 'me-win' : ''}>
                    <td>{c.label}</td>
                    <td>{f(c.all.logLoss, 4)}</td>
                    <td>{f(c.all.ece)}</td>
                    <td>{f(c.all.auc)}</td>
                    <td>{pct(c.long.meanP)} / {pct(c.long.winRate)}</td>
                    <td>{pct(c.short.meanP)} / {pct(c.short.winRate)}</td>
                    <td>{c.id === 'cell' ? 'live' : <>{f(c.vsLive.mean, 4)}<small>{c.vsLive.lo != null ? `${f(c.vsLive.lo, 4)} to ${f(c.vsLive.hi, 4)}` : 'too few candles'}</small></>}</td>
                    <td>{c.taken.n}<small>{rr(c.taken.meanR)}</small></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="me-note">
            Each outcome is predicted with only what was known when the decision was made, and learned from once it closed; the first {ev.warmup} are replayed but not scored. An alternative is called better only when its gain’s 95% range is above zero. The bot refreshes this daily; switching would be a deliberate change, never automatic.
          </p>
        </>
      )}
    </NnCard>
  )
}
