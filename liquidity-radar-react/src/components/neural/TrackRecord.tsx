// "Track record": what the bot has actually done, in one shareable view
// (link: …/#track-record). The demo account over time, every strategy's live
// result next to its tested history and audit verdict, and the caveats —
// losses included, samples counted honestly. Practice money only.
import { useEffect, useState } from 'react'
import { SERVER_BOT, STRATEGY_SINCE, loadTrackRecord } from '../../features/selflearn/serverBot'
import { TRACK_HASH } from '../../features/selflearn/trackRecord'
import type { EquitySummary, StrategyLine } from '../../features/selflearn/trackRecord'
import { EquityCurve, NnCard } from './parts'
import { NI } from './icons'
import './TrackRecord.css'

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const rr = (v: number | null, d = 2) => (v == null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(d) + 'R')
const cls = (v: number | null) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '')
const VERDICT: Record<string, string> = { keep: 'keep', watch: 'watch', retire: 'retire?' }

export function TrackRecordCard() {
  const [d, setD] = useState<{ equity: EquitySummary | null; lines: StrategyLine[] } | null | undefined>(undefined)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    loadTrackRecord().then((x) => alive && setD(x)).catch((e) => alive && setErr(String(e)))
    return () => {
      alive = false
    }
  }, [])
  if (!SERVER_BOT || d === null) return null
  const copy = () => {
    const url = location.origin + location.pathname + TRACK_HASH
    navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false))
  }
  const e = d?.equity
  return (
    <NnCard title="Track record" icon={NI.trend} className="tr" right={<button type="button" className="tr-copy" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>}>
      {err && <p className="nn-err">{err}</p>}
      {d === undefined && !err && <p className="nn-empty">Loading the record…</p>}
      {d && (
        <>
          <p className="tr-lede">
            What the server bot has actually done on the <b>Binance Futures testnet — practice money, not real</b>. Nothing is left out: losing periods and strategies stay in.
          </p>
          {e ? (
            <div className="tr-eq">
              <div className="tr-tiles">
                <div><small>Demo account</small><b>${e.now.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b><em>started ${e.start.toLocaleString(undefined, { maximumFractionDigits: 0 })} · {day(e.from)}</em></div>
                <div><small>Change</small><b className={cls(e.changePct)}>{(e.changePct >= 0 ? '+' : '') + e.changePct.toFixed(1)}%</b><em>to {day(e.to)}</em></div>
                <div><small>Worst drawdown</small><b className="dn">−{e.maxDdPct.toFixed(1)}%</b><em>from a peak</em></div>
              </div>
              <EquityCurve equity={e.curve} height={110} />
              <p className="tr-note">Includes the early 5-minute testing setup (October 2026), which lost money, about half of it to fees; the current 4-hour setup started {day(STRATEGY_SINCE)}.</p>
            </div>
          ) : <p className="nn-empty">No account history yet.</p>}
          <div className="nn-tbl">
            <table className="lab-table tr-table">
              <thead><tr><th>Strategy</th><th>Since {day(STRATEGY_SINCE)}</th><th>Avg / trade</th><th>Total</th><th title="At conservative costs, re-run over 2017–2026 (strategy audit)">Tested history</th><th>Audit</th><th>What it can say</th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id}>
                    <td><b>{l.id.toUpperCase()}</b></td>
                    <td>{l.trades}<small>{l.real} demo · ≈{l.eff} indep.</small></td>
                    <td className={cls(l.avgR)}>{rr(l.avgR)}<small>{l.trades ? `${Math.round(l.win * 100)}% won` : ''}</small></td>
                    <td className={cls(l.totalR)}>{l.trades ? rr(l.totalR, 1) : '—'}</td>
                    <td className={cls(l.historyR)}>{rr(l.historyR, 3)}</td>
                    <td>{l.verdict ? VERDICT[l.verdict] ?? l.verdict : '—'}</td>
                    <td className="tr-say">{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="tr-caveats">
            <li>Results are in R (1R = the amount risked on a trade), after fees, slippage and funding; “demo” trades went to the testnet, the rest are paper trades the bot tracked.</li>
            <li>Trades decided on the same candle or day ride one market move, so they are counted as fewer independent decisions.</li>
            <li>The tested history uses 24 markets picked in 2026: coins that collapsed are missing, which flatters long-only strategies.</li>
            <li>Past results, tested or live, do not promise future ones. This is not financial advice.</li>
          </ul>
        </>
      )}
    </NnCard>
  )
}
