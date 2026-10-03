// The Self Learning tab: everything behind the Neural Net dashboard, in full.
// Engine controls and markets, every model with its unseen-data record and
// live read, performance across all trades, the complete trade records with
// export, the backtest lab, the full learning log, the 24/7 server bot's
// records (when Supabase is configured) and the deep network's internals.
import { lazy, Suspense, useEffect, useState } from 'react'
import { state } from '../../services/store'
import { baseOf } from '../../utils/coins'
import { pfmt } from '../../utils/format'
import { STRATS, stats } from '../../features/selflearn/strategy'
import type { StratId } from '../../features/selflearn/strategy'
import {
  clearRecords,
  closeTrade,
  DEFAULT_SYMBOLS,
  minEVFor,
  proven,
  retrainAll,
  runBt,
  setConfig,
  trainModel,
} from '../../features/selflearn/engine'
import type { SLEventKind, SLModel, SLTrade } from '../../features/selflearn/engine'
import { useSL } from '../../features/selflearn/useSL'
import { SERVER_BOT, loadBot } from '../../features/selflearn/serverBot'
import { BinanceAccount } from './BinanceAccount'
import type { BotEvent, BotTrade } from '../../features/selflearn/serverBot'
import { useTick } from '../useTick'
import { Guard } from '../ErrorBoundary'
import { CoinBadge, EquityCurve, Ico, NnCard } from './parts'
import { NI } from './icons'
import { Brain } from './Brain'

const NeuralNetPage = lazy(() => import('../chart/NeuralNetViz').then((m) => ({ default: m.NeuralNetPage })))
const LAB = ['selflearn']
const MARKETS = ['BTCUSDT', 'PAXGUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT']
const short = (s: string) => s.replace(/USDT$/, '')
const dt = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const ago = (t: number, now: number) => {
  const m = Math.max(0, Math.round((now - t) / 60_000))
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'
}
const sgn = (v: number, d = 2, u = '') => (v >= 0 ? '+' : '') + v.toFixed(d) + u

// ---- header & controls ----------------------------------------------------------

function LabHead() {
  const sl = useSL()
  const cur = String(state.symbol || '')
  const markets = Array.from(new Set([...MARKETS, ...sl.config.symbols, ...(cur.endsWith('USDT') ? [cur] : [])]))
  const toggleSym = (s: string) => {
    const on = sl.config.symbols.includes(s)
    const next = on ? sl.config.symbols.filter((x) => x !== s) : [...sl.config.symbols, s]
    if (next.length) setConfig({ symbols: next })
  }
  const toggleStrat = (s: StratId) => {
    const on = sl.config.strats.includes(s)
    const next = on ? sl.config.strats.filter((x) => x !== s) : [...sl.config.strats, s]
    if (next.length) setConfig({ strats: next })
  }
  return (
    <header className="card nn-card lab-head">
      <div className="lab-brand">
        <Brain busy={!!sl.busy} size={96} />
        <span>
          <h2>Self-Learning Lab</h2>
          <p>
            {sl.status === 'running' ? 'Engine running' : sl.status === 'warming' ? 'Engine warming up' : 'Engine idle'}
            {sl.busy ? ` · training ${sl.busy}` : ''} · paper trading on live Binance prices, no exchange orders
          </p>
        </span>
      </div>
      <div className="lab-ctl">
        <button type="button" className={'lab-tog' + (sl.config.auto ? ' on' : '')} onClick={() => setConfig({ auto: !sl.config.auto })}>
          <Ico d={sl.config.auto ? NI.pause : NI.play} size={14} /> {sl.config.auto ? 'Auto trading ON' : 'Auto trading paused'}
        </button>
        <button type="button" className={'lab-tog' + (sl.config.provenOnly ? ' on' : '')} onClick={() => setConfig({ provenOnly: !sl.config.provenOnly })}
          title="When on, only models that made money on history they never saw may open trades">
          <Ico d={NI.shield} size={14} /> {sl.config.provenOnly ? 'Proven models only' : 'All models trade'}
        </button>
        <label className="lab-sel">Leverage
          <select value={sl.config.leverage} onChange={(e) => setConfig({ leverage: Number(e.target.value) })}>
            {[1, 2, 3, 5, 10, 20, 25, 50].map((v) => <option key={v} value={v}>{v}x</option>)}
          </select>
        </label>
        <button type="button" className="lab-btn" onClick={retrainAll} disabled={!!sl.busy}><Ico d={NI.refresh} size={14} /> Retrain all</button>
      </div>
      <div className="lab-chips">
        <small>Markets</small>
        {markets.map((s) => (
          <button key={s} type="button" className={sl.config.symbols.includes(s) ? 'on' : ''} onClick={() => toggleSym(s)}>
            {short(s)}{DEFAULT_SYMBOLS.includes(s) && s === 'PAXGUSDT' ? ' · gold' : ''}
          </button>
        ))}
        <small>Styles</small>
        {(Object.keys(STRATS) as StratId[]).map((k) => (
          <button key={k} type="button" className={sl.config.strats.includes(k) ? 'on' : ''} onClick={() => toggleStrat(k)} title={STRATS[k].blurb}>
            {STRATS[k].label}
          </button>
        ))}
      </div>
    </header>
  )
}

// ---- models ---------------------------------------------------------------------

function ModelCard({ m, open, now }: { m: SLModel; open?: SLTrade; now: number }) {
  const st = STRATS[m.strat]
  const l = m.last
  const ok = proven(m)
  return (
    <div className={'lab-model' + (ok ? ' proven' : '')}>
      <div className="lab-mh">
        <CoinBadge sym={m.sym} size={26} />
        <b>{short(m.sym)} · {st.label}</b>
        <span className={'lab-badge ' + (ok ? 'g' : 'a')}>{ok ? 'Edge proven' : 'Learning'}</span>
      </div>
      <small className="lab-mm">v{m.version} · trained {ago(m.trainedAt, now)} on {m.rows.toLocaleString()} {st.tf} bars · {m.updates} live updates</small>
      <div className="lab-mk">
        <span><small>Unseen test</small><b>{m.holdout.n} trades</b></span>
        <span><small>Win rate</small><b>{Math.round(m.holdout.winRate * 100)}%</b></span>
        <span><small>Avg R</small><b className={m.holdout.avgR >= 0 ? 'up' : 'dn'}>{sgn(m.holdout.avgR)}</b></span>
      </div>
      {l ? (
        <div className="lab-read">
          <span className={l.evLong > l.evShort ? 'lead' : ''}><small>Long</small><b>{Math.round(l.pLong * 100)}%</b><i className={l.evLong >= 0 ? 'up' : 'dn'}>EV {sgn(l.evLong)}R</i></span>
          <span className={l.evShort > l.evLong ? 'lead' : ''}><small>Short</small><b>{Math.round(l.pShort * 100)}%</b><i className={l.evShort >= 0 ? 'up' : 'dn'}>EV {sgn(l.evShort)}R</i></span>
          <span><small>Bar to trade</small><b>{minEVFor(m.key).toFixed(2)}R</b><i>read {ago(l.at, now)}</i></span>
        </div>
      ) : <p className="nn-empty">First read on the next closed {st.tf} bar.</p>}
      {open && (
        <div className={'lab-open ' + (open.side === 1 ? 'g' : 'r')}>
          <b>{open.side === 1 ? 'LONG' : 'SHORT'} open</b>
          <span>entry {pfmt(open.entry)} · SL {pfmt(open.sl)} · TP {pfmt(open.tp)}</span>
          <button type="button" onClick={() => closeTrade(open.id)}>Close</button>
        </div>
      )}
      <button type="button" className="lab-mini" onClick={() => void trainModel(m.sym, m.strat, 'Manual retrain')}><Ico d={NI.refresh} size={12} /> Retrain</button>
    </div>
  )
}

function Models() {
  const now = useTick(10000, LAB)
  const sl = useSL()
  const keys = sl.config.symbols.flatMap((s) => sl.config.strats.map((k) => s + '|' + k))
  return (
    <NnCard title="Models" icon={NI.cpu} className="lab-models" right={<span className="nn-chip">{keys.length} market × style pairs · long + short each</span>}>
      <div className="lab-mgrid">
        {keys.map((k) => {
          const m = sl.models[k]
          if (!m) return <div key={k} className="lab-model pending"><b>{short(k.split('|')[0])} · {STRATS[k.split('|')[1] as StratId].label}</b><p className="nn-empty">{sl.busy ? 'Queued for training…' : 'Trains on the next scan.'}</p></div>
          return <ModelCard key={k} m={m} now={now} open={sl.trades.find((t) => t.closedAt == null && t.sym === m.sym && t.strat === m.strat)} />
        })}
      </div>
    </NnCard>
  )
}

// ---- performance ------------------------------------------------------------------

function Performance() {
  const sl = useSL()
  const closed = sl.trades.filter((t) => t.r != null).sort((a, b) => (a.closedAt as number) - (b.closedAt as number))
  const all = stats(closed.map((t) => ({ r: t.r as number, side: t.side })), sl.config.riskPct)
  const by = (f: (t: SLTrade) => boolean) => stats(closed.filter(f).map((t) => ({ r: t.r as number, side: t.side })))
  const groups: Array<[string, ReturnType<typeof stats>]> = [
    ['Scalp', by((t) => t.strat === 'scalp')],
    ['Swing', by((t) => t.strat === 'swing')],
    ['Long', by((t) => t.side === 1)],
    ['Short', by((t) => t.side === -1)],
  ]
  return (
    <NnCard title="Performance · every closed trade" icon={NI.trend} className="lab-perf">
      <div className="nn-kpis">
        <span><small>Trades</small><b>{all.n}</b></span>
        <span><small>Win rate</small><b>{all.n ? (all.winRate * 100).toFixed(1) + '%' : '—'}</b></span>
        <span><small>Avg R</small><b className={all.avgR >= 0 ? 'up' : 'dn'}>{all.n ? sgn(all.avgR) + 'R' : '—'}</b></span>
        <span><small>Total R</small><b className={all.totalR >= 0 ? 'up' : 'dn'}>{all.n ? sgn(all.totalR, 1) + 'R' : '—'}</b></span>
        <span><small>Profit factor</small><b>{all.n ? (isFinite(all.profitFactor) ? all.profitFactor.toFixed(2) : '∞') : '—'}</b></span>
        <span><small>Max drawdown</small><b className="dn">{all.n ? (all.maxDD * 100).toFixed(1) + '%' : '—'}</b></span>
      </div>
      <EquityCurve equity={all.equity} height={140} />
      <div className="lab-split">
        {groups.map(([l, s]) => (
          <span key={l}><small>{l}</small><b>{s.n} trades</b><i className={s.avgR >= 0 ? 'up' : 'dn'}>{s.n ? `${Math.round(s.winRate * 100)}% · ${sgn(s.avgR)}R` : '—'}</i></span>
        ))}
      </div>
      <p className="nn-note">Equity risks {sl.config.riskPct}% of the account per trade, compounded. R = result in multiples of the risk taken, after fees.</p>
    </NnCard>
  )
}

// ---- records ------------------------------------------------------------------------

function csv(rows: SLTrade[]): string {
  const head = ['opened', 'closed', 'market', 'style', 'side', 'setup', 'entry', 'sl', 'tp', 'exit', 'reason', 'r', 'pnl_pct', 'p_win', 'ev_r', 'model_v', 'note']
  const q = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v))
  return [head.join(',')]
    .concat(
      rows.map((t) =>
        [new Date(t.openedAt).toISOString(), t.closedAt ? new Date(t.closedAt).toISOString() : '', t.sym, t.strat, t.side === 1 ? 'long' : 'short',
          t.setup, t.entry, t.sl, t.tp, t.exit ?? '', t.reason ?? 'open', t.r?.toFixed(3) ?? '', t.pnlPct?.toFixed(3) ?? '', t.p.toFixed(3), t.ev.toFixed(3), t.model, t.note]
          .map(q)
          .join(','),
      ),
    )
    .join('\n')
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function Records() {
  useTick(3000, LAB)
  const sl = useSL()
  const [f, setF] = useState({ state: 'all', strat: 'all', side: 'all', sym: 'all' })
  const [page, setPage] = useState(0)
  const syms = Array.from(new Set(sl.trades.map((t) => t.sym)))
  const rows = sl.trades
    .filter((t) => f.state === 'all' || (f.state === 'open' ? t.closedAt == null : t.closedAt != null))
    .filter((t) => f.strat === 'all' || t.strat === f.strat)
    .filter((t) => f.side === 'all' || String(t.side) === f.side)
    .filter((t) => f.sym === 'all' || t.sym === f.sym)
    .sort((a, b) => b.openedAt - a.openedAt)
  const PER = 15
  const pages = Math.max(1, Math.ceil(rows.length / PER))
  const view = rows.slice(page * PER, page * PER + PER)
  const sel = (k: keyof typeof f, opts: Array<[string, string]>) => (
    <select value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setPage(0) }} aria-label={k}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
  return (
    <NnCard title="Trade Records" icon={NI.list} className="lab-rec" id="labRecords"
      right={
        <span className="lab-acts">
          <button type="button" onClick={() => download('self-learning-trades.csv', csv(rows), 'text/csv')}><Ico d={NI.download} size={13} /> CSV</button>
          <button type="button" onClick={() => download('self-learning.json', JSON.stringify({ trades: sl.trades, log: sl.events, config: sl.config }, null, 1), 'application/json')}><Ico d={NI.download} size={13} /> JSON</button>
          <button type="button" className="dn" onClick={() => { if (confirm('Clear all closed trades and the learning log? Models are kept.')) clearRecords() }}><Ico d={NI.trash} size={13} /> Clear</button>
        </span>
      }>
      <div className="lab-filters">
        {sel('state', [['all', 'All trades'], ['open', 'Open'], ['closed', 'Closed']])}
        {sel('strat', [['all', 'All styles'], ['scalp', 'Scalp'], ['swing', 'Swing']])}
        {sel('side', [['all', 'Long & short'], ['1', 'Long'], ['-1', 'Short']])}
        {sel('sym', [['all', 'All markets'], ...syms.map((s): [string, string] => [s, short(s)])])}
        <small>{rows.length} trades</small>
      </div>
      <div className="nn-tbl">
        <table className="lab-table">
          <thead>
            <tr><th>Opened</th><th>Market</th><th>Side</th><th>Setup</th><th>Entry</th><th>Stop</th><th>Target</th><th>Exit</th><th>Result</th><th>P/L ({sl.config.leverage}x)</th><th>Chance</th><th>Learned</th><th /></tr>
          </thead>
          <tbody>
            {view.map((t) => {
              const open = t.closedAt == null
              const px = state.tickers[t.sym]?.last
              const live = open && px ? t.side * (px / t.entry - 1) * 100 : null
              const p = open ? live : t.pnlPct
              return (
                <tr key={t.id}>
                  <td>{dt(t.openedAt)}</td>
                  <td><b>{short(t.sym)}</b><small>{STRATS[t.strat].label} · v{t.model}</small></td>
                  <td className={t.side === 1 ? 'up' : 'dn'}>{t.side === 1 ? 'Long' : 'Short'}</td>
                  <td title={t.note}>{t.setup}</td>
                  <td>{pfmt(t.entry)}</td>
                  <td className="dn">{pfmt(t.sl)}</td>
                  <td className="up">{pfmt(t.tp)}</td>
                  <td>{t.exit != null ? pfmt(t.exit) : open ? <i className="a">open</i> : '—'}<small>{t.reason && t.reason !== 'manual' ? { tp: 'target', sl: 'stop', time: 'time' }[t.reason] : t.reason ?? ''}</small></td>
                  <td className={open ? 'a' : (t.r ?? 0) > 0 ? 'up' : 'dn'}>{open ? '—' : sgn(t.r ?? 0) + 'R'}</td>
                  <td className={(p ?? 0) >= 0 ? 'up' : 'dn'}>{p == null ? '—' : sgn(p * sl.config.leverage, 1, '%')}</td>
                  <td>{Math.round(t.p * 100)}%<small>EV {sgn(t.ev)}R</small></td>
                  <td>{t.learned ? `${(t.learned.before * 100).toFixed(0)}→${(t.learned.after * 100).toFixed(0)}%` : open ? '' : '—'}</td>
                  <td>{open && <button type="button" className="lab-mini" onClick={() => closeTrade(t.id)}>Close</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!rows.length && <p className="nn-empty">No trades match. Records are kept in this browser, up to the last 600.</p>}
      </div>
      {pages > 1 && (
        <div className="lab-pager">
          <button type="button" disabled={!page} onClick={() => setPage(page - 1)}>‹</button>
          <span>{page + 1} / {pages}</span>
          <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>›</button>
        </div>
      )}
    </NnCard>
  )
}

// ---- backtest lab ---------------------------------------------------------------------

function BacktestLab() {
  const sl = useSL()
  const [o, setO] = useState({
    sym: String(state.symbol || 'BTCUSDT').endsWith('USDT') ? String(state.symbol) : 'BTCUSDT',
    strat: 'swing' as StratId,
    bars: 3000,
    minEV: STRATS.swing.minEV,
    online: true,
    trainFrac: 0.5,
    riskPct: 1,
    tpM: STRATS.swing.tpM,
    slM: STRATS.swing.slM,
    maxHold: STRATS.swing.maxHold,
    trend: true,
  })
  const setStrat = (k: StratId) => setO({ ...o, strat: k, minEV: STRATS[k].minEV, tpM: STRATS[k].tpM, slM: STRATS[k].slM, maxHold: STRATS[k].maxHold, trend: STRATS[k].trend })
  const r = sl.bt.result
  const s = r?.stats
  const [page, setPage] = useState(0)
  const PER = 12
  const trades = r ? r.trades.slice().reverse() : []
  const num = (k: 'bars' | 'minEV' | 'trainFrac' | 'riskPct' | 'tpM' | 'slM' | 'maxHold', label: string, step: number, min: number, max: number) => (
    <label>{label}<input type="number" value={o[k]} step={step} min={min} max={max} onChange={(e) => setO({ ...o, [k]: Number(e.target.value) })} /></label>
  )
  return (
    <NnCard title="Backtest Lab" icon={NI.flask} className="lab-bt" id="labBacktest">
      <div className="lab-btf">
        <label>Market<select value={o.sym} onChange={(e) => setO({ ...o, sym: e.target.value })}>{MARKETS.map((s) => <option key={s} value={s}>{short(s)}</option>)}</select></label>
        <label>Style<select value={o.strat} onChange={(e) => setStrat(e.target.value as StratId)}>{(Object.keys(STRATS) as StratId[]).map((k) => <option key={k} value={k}>{STRATS[k].label} · {STRATS[k].tf}</option>)}</select></label>
        {num('bars', 'Bars', 500, 600, 6000)}
        {num('trainFrac', 'Train share', 0.05, 0.3, 0.8)}
        {num('slM', 'Stop × ATR', 0.25, 0.5, 5)}
        {num('tpM', 'Target × ATR', 0.25, 0.5, 10)}
        {num('maxHold', 'Max bars held', 1, 4, 200)}
        {num('minEV', 'Min EV (R)', 0.05, -0.5, 1)}
        {num('riskPct', 'Risk % / trade', 0.25, 0.25, 5)}
        <label className="lab-chk"><input type="checkbox" checked={o.online} onChange={(e) => setO({ ...o, online: e.target.checked })} /> Learn from each trade</label>
        <label className="lab-chk"><input type="checkbox" checked={o.trend} onChange={(e) => setO({ ...o, trend: e.target.checked })} /> With the trend only</label>
        <button type="button" className="nn-btn" disabled={sl.bt.running} onClick={() => { setPage(0); void runBt(o) }}>
          <Ico d={NI.play} size={14} /> {sl.bt.running ? 'Running…' : 'Run backtest'}
        </button>
      </div>
      {sl.bt.error && <p className="nn-err">{sl.bt.error}</p>}
      {r && s ? (
        <>
          <p className="nn-btp-t">
            {short(r.opts.sym)} · {r.st.label} ({r.st.tf}) · {dt(r.from)} → {dt(r.to)} · trained on {r.trainBars.toLocaleString()} bars, traded {r.testBars.toLocaleString()} it never saw
          </p>
          <div className="nn-kpis">
            <span><small>Trades</small><b>{s.n}</b></span>
            <span><small>Win rate</small><b>{(s.winRate * 100).toFixed(1)}%</b></span>
            <span><small>Avg R</small><b className={s.avgR >= 0 ? 'up' : 'dn'}>{sgn(s.avgR)}R</b></span>
            <span><small>Total R</small><b className={s.totalR >= 0 ? 'up' : 'dn'}>{sgn(s.totalR, 1)}R</b></span>
            <span><small>Profit factor</small><b>{isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</b></span>
            <span><small>Max drawdown</small><b className="dn">{(s.maxDD * 100).toFixed(1)}%</b></span>
            <span><small>Return</small><b className={s.growth >= 0 ? 'up' : 'dn'}>{(s.growth * 100).toFixed(1)}%</b></span>
            <span><small>Buy &amp; hold</small><b className={r.hold >= 0 ? 'up' : 'dn'}>{(r.hold * 100).toFixed(1)}%</b></span>
            <span><small>Long · short</small><b>{s.long.n} · {s.short.n}</b></span>
            <span><small>Avg hold</small><b>{s.avgBars.toFixed(1)} bars</b></span>
          </div>
          <EquityCurve equity={s.equity} height={170} />
          <div className="nn-tbl">
            <table className="lab-table">
              <thead><tr><th>Entry</th><th>Side</th><th>Entry px</th><th>Exit px</th><th>Exit</th><th>Bars</th><th>Chance</th><th>Result</th></tr></thead>
              <tbody>
                {trades.slice(page * PER, page * PER + PER).map((t) => (
                  <tr key={t.i}>
                    <td>{dt(t.t)}</td>
                    <td className={t.side === 1 ? 'up' : 'dn'}>{t.side === 1 ? 'Long' : 'Short'}</td>
                    <td>{pfmt(t.entry)}</td>
                    <td>{pfmt(t.exit)}</td>
                    <td>{{ tp: 'Target', sl: 'Stop', time: 'Time' }[t.reason]}</td>
                    <td>{t.bars}</td>
                    <td>{Math.round(t.p * 100)}%</td>
                    <td className={t.r > 0 ? 'up' : 'dn'}>{sgn(t.r)}R</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {trades.length > PER && (
            <div className="lab-pager">
              <button type="button" disabled={!page} onClick={() => setPage(page - 1)}>‹</button>
              <span>{page + 1} / {Math.ceil(trades.length / PER)}</span>
              <button type="button" disabled={(page + 1) * PER >= trades.length} onClick={() => setPage(page + 1)}>›</button>
            </div>
          )}
        </>
      ) : !sl.bt.running && (
        <p className="nn-empty">Pick a market and style, then run. The replay uses the live engine’s exact code: train on the first part, trade the rest bar by bar, with fees.</p>
      )}
    </NnCard>
  )
}

// ---- log ---------------------------------------------------------------------------------

const KINDS: Array<[SLEventKind | 'all', string]> = [['all', 'All'], ['open', 'Opened'], ['close', 'Closed'], ['learn', 'Learned'], ['train', 'Training'], ['risk', 'Risk'], ['error', 'Errors']]

function FullLog() {
  const now = useTick(15000, LAB)
  const sl = useSL()
  const [k, setK] = useState<SLEventKind | 'all'>('all')
  const list = sl.events.filter((e) => k === 'all' || e.kind === k).slice().reverse().slice(0, 80)
  return (
    <NnCard title="Learning Log" icon={NI.brain} className="lab-log">
      <div className="nn-seg">
        {KINDS.map(([v, l]) => <button key={v} type="button" className={k === v ? 'on' : ''} onClick={() => setK(v)}>{l}</button>)}
      </div>
      <ul className="nn-logl lab-logl">
        {list.map((e) => (
          <li key={e.id} className={'k-' + e.kind}>
            <span className="nn-logi"><Ico d={{ train: NI.cpu, open: NI.play, close: NI.flag, learn: NI.brain, risk: NI.shield, info: NI.bolt, error: NI.close }[e.kind]} size={13} /></span>
            <span><b>{e.title}</b><small>{e.msg}</small></span>
            <em title={dt(e.t)}>{ago(e.t, now)}</em>
          </li>
        ))}
        {!list.length && <li className="nn-empty">Nothing logged yet.</li>}
      </ul>
    </NnCard>
  )
}

// ---- server bot -------------------------------------------------------------------------

function ServerBot() {
  const [d, setD] = useState<{ trades: BotTrade[]; events: BotEvent[] } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    const load = () => loadBot().then((x) => alive && setD(x)).catch((e) => alive && setErr(String(e)))
    load()
    const id = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  return (
    <NnCard title="Server bot · Binance testnet (24/7)" icon={NI.cpu} className="lab-bot">
      {!SERVER_BOT ? (
        <p className="nn-note">
          The browser engine only runs while this page is open. For round-the-clock trading, radar-worker runs the testnet bot on a server and records to Supabase.
          Add <code>VITE_WHALE_DB_URL</code> and <code>VITE_WHALE_DB_KEY</code> (Supabase URL and anon key) in Vercel to show its trades here.
        </p>
      ) : err ? <p className="nn-err">{err}</p> : !d ? <p className="nn-empty">Loading…</p> : (
        <div className="lab-botg">
          <div className="nn-tbl">
            <table className="lab-table">
              <thead><tr><th>Opened</th><th>Market</th><th>Side</th><th>Entry</th><th>Exit</th><th>R</th><th>P/L</th></tr></thead>
              <tbody>
                {d.trades.slice(0, 15).map((t) => (
                  <tr key={t.id}>
                    <td>{dt(Date.parse(t.opened_at))}</td>
                    <td><b>{short(t.symbol)}</b><small>{t.mode}</small></td>
                    <td className={t.side === 1 ? 'up' : 'dn'}>{t.side === 1 ? 'Long' : 'Short'}</td>
                    <td>{pfmt(t.entry)}</td>
                    <td>{t.exit != null ? pfmt(t.exit) : <i className="a">{t.status}</i>}</td>
                    <td>{t.r_multiple != null ? sgn(t.r_multiple) + 'R' : '—'}</td>
                    <td className={(t.pnl_usd ?? 0) >= 0 ? 'up' : 'dn'}>{t.pnl_usd != null ? '$' + t.pnl_usd.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!d.trades.length && <p className="nn-empty">No server trades yet.</p>}
          </div>
          <ul className="nn-logl">
            {d.events.slice(0, 8).map((e) => (
              <li key={e.id} className={'k-' + (e.level === 'error' ? 'error' : 'info')}>
                <span className="nn-logi"><Ico d={NI.bolt} size={12} /></span>
                <span><b>{e.symbol ? short(e.symbol) : 'bot'}</b><small>{e.msg}</small></span>
                <em>{dt(Date.parse(e.t))}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </NnCard>
  )
}

export function LearningLab() {
  return (
    <div className="nn-page lab-page">
      <Guard name="Lab header"><LabHead /></Guard>
      <Guard name="Binance account"><BinanceAccount /></Guard>
      <Guard name="Models"><Models /></Guard>
      <div className="lab-row">
        <Guard name="Performance"><Performance /></Guard>
        <Guard name="Learning log"><FullLog /></Guard>
      </div>
      <Guard name="Trade records"><Records /></Guard>
      <Guard name="Backtest lab"><BacktestLab /></Guard>
      <Guard name="Server bot"><ServerBot /></Guard>
      <section className="card nn-card lab-deep">
        <header className="nn-head"><span className="nn-ico"><Ico d={NI.layers} size={16} /></span><h3>Deep network internals · TensorFlow direction model &amp; RL policy</h3></header>
        <p className="nn-note">The app’s original neural networks for the focused chart ({baseOf(String(state.symbol))}): real layer weights and activations, the RL policy and its paper ledger.</p>
        <Suspense fallback={<p className="nn-empty">Loading…</p>}><NeuralNetPage /></Suspense>
      </section>
    </div>
  )
}
