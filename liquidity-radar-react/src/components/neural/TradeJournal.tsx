// "Trade journal": every real and shadow (paper) trade the server bot made,
// newest first — planned levels, exit and why, result in R and USDT, the
// model's win chance and EV, regime, how far it went against / for the trade
// while open (MAE / MFE) and the model version. Filters by market, real or
// shadow, and win or loss; summary figures follow the filters. A row expands to
// the decision summary, the reason and the exact inputs the model saw.
// Logic in features/selflearn/journal.ts; data from the bot database.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { pfmt } from '../../utils/format'
import { SERVER_BOT, loadJournal } from '../../features/selflearn/serverBot'
import { ALL, filterJournal, journalStats } from '../../features/selflearn/journal'
import type { JournalFilter, JournalRow } from '../../features/selflearn/journal'
import { marketLabel } from '../../features/selflearn/perp'
import { NnCard } from './parts'
import { NI } from './icons'
import './TradeJournal.css'

const PER = 40
const EXIT: Record<string, string> = { tp: 'target', sl: 'stop', trail: 'trailing stop', signal: 'exit rule', time: 'time exit', manual: 'manual', error: 'error' }
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const dash = '—'
const px = (v: number | null) => (v == null || !isFinite(v) ? dash : pfmt(v))
const rr = (v: number | null, d = 2) => (v == null ? dash : (v >= 0 ? '+' : '') + v.toFixed(d) + 'R')
const pct = (v: number | null) => (v == null ? dash : Math.round(v * 100) + '%')
const usd = (v: number | null) => (v == null ? dash : (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2))
const cls = (v: number | null) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '')

function Detail({ r }: { r: JournalRow }) {
  // The first group repeats the columns hidden on narrow screens.
  const narrow: Array<[string, string]> = [
    ['Entry', px(r.entry)],
    ['Stop / target', px(r.sl) + ' / ' + px(r.tp)],
    ['P/L', r.kind === 'shadow' ? 'paper' : usd(r.pnlUsd)],
    ['Regime', r.regime ?? dash],
    ['MAE / MFE', (r.maeR == null ? dash : r.maeR.toFixed(2)) + ' / ' + (r.mfeR == null ? dash : '+' + r.mfeR.toFixed(2)) + 'R'],
    ['Bars held', r.barsHeld == null ? dash : String(r.barsHeld)],
  ]
  const items: Array<[string, string]> = [
    ['Planned entry', px(r.plannedEntry)],
    ['Slippage', r.slippageBps == null ? dash : r.slippageBps.toFixed(1) + ' bps'],
    ['Raw win chance', pct(r.pRaw)],
    ['R:R after costs', r.rr == null ? dash : r.rr.toFixed(2)],
    ['Cost', r.costR == null ? dash : r.costR.toFixed(3) + 'R'],
    ['Fees', r.feesUsd == null ? dash : '$' + r.feesUsd.toFixed(2)],
    ['Closed', r.closedAt == null ? dash : when(r.closedAt)],
    ['Model', r.modelId == null ? dash : `#${r.modelId}${r.modelVersion != null ? ' · v' + r.modelVersion : ''}`],
    ['Mode', r.mode ?? dash],
    ['Candle', r.interval ?? dash],
  ]
  return (
    <div className="tj-detail">
      <dl className="tj-kv">
        {narrow.map(([k, v]) => (
          <div key={k} className="tj-narrow"><dt>{k}</dt><dd>{v}</dd></div>
        ))}
        {items.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <p><b>Decision</b> {r.decision ?? 'not recorded (trade from before the journal)'}</p>
      {r.reason && <p><b>{r.kind === 'shadow' ? 'Why not real' : 'Notes'}</b> {r.reason}</p>}
      {r.features ? (
        <div className="tj-feats">
          <b>Inputs the model saw</b>
          <div>
            {Object.entries(r.features).map(([k, v]) => (
              <span key={k}><small>{k}</small>{Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)}</span>
            ))}
          </div>
        </div>
      ) : (
        <p className="tj-dim">No inputs stored.</p>
      )}
    </div>
  )
}

export function TradeJournal() {
  const [rows, setRows] = useState<JournalRow[] | null>(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState<JournalFilter>(ALL)
  const [open, setOpen] = useState<string | null>(null)
  const [shown, setShown] = useState(PER)
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    const load = () => loadJournal().then((x) => { if (alive) { setRows(x); setErr('') } }).catch((e) => alive && setErr(String(e)))
    load()
    const id = setInterval(load, 2 * 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  const view = useMemo(() => (rows ? filterJournal(rows, f) : []), [rows, f])
  const st = useMemo(() => journalStats(view), [view])
  if (!SERVER_BOT) return null
  const syms = rows ? Array.from(new Set(rows.map((r) => r.symbol))).sort() : []
  const set = (k: keyof JournalFilter, v: string) => {
    setF({ ...f, [k]: v } as JournalFilter)
    setShown(PER)
  }
  const sel = (k: keyof JournalFilter, label: string, opts: Array<[string, string]>) => (
    <select value={f[k]} onChange={(e) => set(k, e.target.value)} aria-label={label}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
  return (
    <NnCard title="Trade journal" icon={NI.book} className="tj" id="tradeJournal" right={<small className="tj-sub">every real and paper trade</small>}>
      {err && <p className="nn-err">{err}</p>}
      {!rows && !err && <p className="nn-empty">Loading the journal…</p>}
      {rows && !rows.length && <p className="nn-empty">No trades yet: real and paper trades appear here as the bot takes them.</p>}
      {rows && rows.length > 0 && (
        <>
          <div className="lab-filters">
            {sel('symbol', 'Market', [['all', 'All markets'], ...syms.map((s): [string, string] => [s, marketLabel(s)])])}
            {sel('kind', 'Real or paper', [['all', 'Real & paper'], ['real', 'Real only'], ['shadow', 'Paper only']])}
            {sel('outcome', 'Result', [['all', 'Any result'], ['win', 'Wins'], ['loss', 'Losses'], ['open', 'Still open']])}
            <small>{view.length} trades</small>
          </div>
          <div className="tj-tiles">
            <div><small>Closed</small><b>{st.n}</b><em>{st.open} open</em></div>
            <div><small>Win rate</small><b>{st.n ? pct(st.winRate) : dash}</b><em>{st.wins} wins</em></div>
            <div><small>Avg R</small><b className={cls(st.avgR)}>{st.n ? rr(st.avgR) : dash}</b><em>per trade</em></div>
            <div><small>Total R</small><b className={cls(st.totalR)}>{st.n ? rr(st.totalR, 1) : dash}</b><em>after costs</em></div>
          </div>
          {st.bySymbol.length > 1 && (
            <div className="tj-syms">
              {st.bySymbol.map((g) => (
                <button type="button" key={g.symbol} className={f.symbol === g.symbol ? 'on' : ''} onClick={() => set('symbol', f.symbol === g.symbol ? 'all' : g.symbol)}>
                  <b>{marketLabel(g.symbol)}</b>
                  <span>{g.n} · {g.n ? pct(g.winRate) : dash} · <i className={cls(g.totalR)}>{rr(g.totalR, 1)}</i></span>
                </button>
              ))}
            </div>
          )}
          <div className="nn-tbl">
            <table className="lab-table tj-table">
              <thead>
                <tr>
                  <th>Opened</th><th>Market</th><th>Side</th><th className="tj-opt">Entry</th><th className="tj-opt">Stop / Target</th><th>Exit</th>
                  <th>Result</th><th className="tj-opt">P/L</th><th>Chance</th><th className="tj-opt">Regime</th><th className="tj-opt">MAE / MFE</th>
                  <th className="tj-opt">Bars</th><th className="tj-opt">Model</th><th />
                </tr>
              </thead>
              <tbody>
                {view.slice(0, shown).map((r) => {
                  const isOpen = open === r.key
                  const live = r.status === 'open'
                  return (
                    <Fragment key={r.key}>
                      <tr className={'tj-row' + (isOpen ? ' on' : '')} onClick={() => setOpen(isOpen ? null : r.key)}>
                        <td>{when(r.openedAt)}</td>
                        <td>
                          <b>{marketLabel(r.symbol)}</b>
                          <small className={r.kind === 'real' ? 'tj-real' : 'tj-paper'}>{r.kind === 'real' ? 'Real' : 'Paper'} #{r.id}</small>
                        </td>
                        <td className={r.side === 1 ? 'up' : 'dn'}>{r.side === 1 ? 'Long' : 'Short'}</td>
                        <td className="tj-opt">{px(r.entry)}</td>
                        <td className="tj-opt"><span className="dn">{px(r.sl)}</span><small className="up">{px(r.tp)}</small></td>
                        <td>
                          {live ? <i className="a">open</i> : px(r.exit)}
                          <small>{r.exitReason ? (EXIT[r.exitReason] ?? r.exitReason) : r.status === 'expired' ? 'expired' : ''}</small>
                        </td>
                        <td className={cls(r.r)}>{live ? dash : rr(r.r)}</td>
                        <td className={'tj-opt ' + cls(r.pnlUsd)}>{r.kind === 'shadow' ? <small>paper</small> : usd(r.pnlUsd)}</td>
                        <td>{pct(r.pWin)}<small>EV {rr(r.evR)}</small></td>
                        <td className="tj-opt">{r.regime ?? dash}</td>
                        <td className="tj-opt">
                          <span className="dn">{r.maeR == null ? dash : r.maeR.toFixed(2)}</span>
                          <small className="up">{r.mfeR == null ? dash : '+' + r.mfeR.toFixed(2)}</small>
                        </td>
                        <td className="tj-opt">{r.barsHeld ?? dash}</td>
                        <td className="tj-opt">{r.modelVersion != null ? 'v' + r.modelVersion : r.modelId != null ? '#' + r.modelId : dash}</td>
                        <td>
                          <button type="button" className="tj-x" aria-expanded={isOpen} aria-label={isOpen ? 'Hide details' : 'Show details'}
                            onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : r.key) }}>{isOpen ? '−' : '+'}</button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="tj-more">
                          <td colSpan={14}><Detail r={r} /></td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {!view.length && (
                  <tr><td colSpan={14} className="nn-empty">No trades match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {view.length > shown && (
            <button type="button" className="tj-more-btn" onClick={() => setShown(shown + PER)}>Show {Math.min(PER, view.length - shown)} more</button>
          )}
        </>
      )}
    </NnCard>
  )
}
