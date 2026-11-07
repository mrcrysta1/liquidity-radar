// "Market context": what the server bot sees of the market right now — BTC on
// 15m / 1h / 4h, the market regime and why, every coin's measured correlation
// with BTC (and where it just changed), and gold with the dollar index and
// Treasury yields. Description, not advice. Data: bot_state 'context:latest'
// (radar-worker/src/context/), refreshed every 15 minutes by the bot.
import { useEffect, useState } from 'react'
import { SERVER_BOT, loadContext } from '../../features/selflearn/serverBot'
import { TFS, corrGroups } from '../../features/selflearn/marketContext'
import type { ContextView, DailyView, Dir, TfView } from '../../features/selflearn/marketContext'
import { NnCard } from './parts'
import { NI } from './icons'
import './MarketContext.css'

const REGIME: Record<string, [string, string]> = {
  'strong-bull': ['Strong bullish', 'mc-up'],
  'weak-bull': ['Weak bullish', 'mc-up'],
  sideways: ['Sideways', 'mc-flat'],
  'weak-bear': ['Weak bearish', 'mc-dn'],
  'strong-bear': ['Strong bearish', 'mc-dn'],
  'high-volatility': ['High volatility', 'mc-warn'],
  uncertain: ['Uncertain', 'mc-flat'],
}
const ARROW: Record<Dir, string> = { up: '▲ up', down: '▼ down', flat: '◆ flat' }
const dcls = (d: Dir | undefined) => (d === 'up' ? 'up' : d === 'down' ? 'dn' : '')
const n2 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2))
const price = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: v >= 100 ? 0 : 2 })
const sgn = (v: number, d = 2) => (v >= 0 ? '+' : '') + v.toFixed(d)
const corrCls = (r: number | null | undefined) => (r == null ? '' : r >= 0.7 ? 'mc-c3' : r >= 0.4 ? 'mc-c2' : 'mc-c1')

function TfRow({ k, s }: { k: string; s: TfView | undefined }) {
  if (!s) return <tr><td>{k}</td><td colSpan={5} className="mc-dim">no data</td></tr>
  return (
    <tr>
      <td>{k}</td>
      <td className={dcls(s.dir)}>{ARROW[s.dir]}</td>
      <td className={s.roc20 >= 0 ? 'up' : 'dn'}>{sgn(s.roc20)}%</td>
      <td>{s.rsi14.toFixed(0)}</td>
      <td>{s.er30.toFixed(2)}</td>
      <td>{s.atrPct.toFixed(2)}% <small>({Math.round(s.atrRank * 100)}th pct)</small></td>
    </tr>
  )
}

function Daily({ label, d, unit = '' }: { label: string; d: DailyView | null; unit?: string }) {
  return (
    <div>
      <small>{label}</small>
      {d ? (
        <>
          <b className={dcls(d.dir)}>{d.last.toFixed(2)}{unit} {ARROW[d.dir].split(' ')[0]}</b>
          <em>5 days {sgn(d.change5)}{unit}</em>
        </>
      ) : <b className="mc-dim">—</b>}
    </div>
  )
}

export function MarketContextCard() {
  const [c, setC] = useState<ContextView | null | undefined>(undefined)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    const load = () => loadContext().then((x) => { if (alive) { setC(x); setErr('') } }).catch((e) => alive && setErr(String(e)))
    load()
    const id = setInterval(load, 5 * 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  if (!SERVER_BOT || c === null) return null
  const when = c ? new Date(c.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''
  const [rl, rc] = c ? (REGIME[c.regime] ?? [c.regime, 'mc-flat']) : ['', '']
  const g4 = c ? corrGroups(c.coins, '4h') : null
  return (
    <NnCard title="Market context" icon={NI.gauge} className="mc" right={c ? <small className="mc-sub">as of {when} · every 15 min</small> : undefined}>
      {err && <p className="nn-err">{err}</p>}
      {c === undefined && !err && <p className="nn-empty">Loading the market context…</p>}
      {c && (
        <>
          <div className={'mc-regime ' + rc}>
            <small>Market regime (BTC)</small>
            <b>{rl}</b>
            <span>{c.why}</span>
          </div>
          <div className="mc-cols">
            <section>
              <h4>BTC</h4>
              <div className="nn-tbl">
                <table className="lab-table mc-table">
                  <thead><tr><th>TF</th><th>Direction</th><th>20 bars</th><th>RSI</th><th title="Efficiency: 1 = straight line, 0 = chop">Trend eff.</th><th>Volatility</th></tr></thead>
                  <tbody>{TFS.map((k) => <TfRow key={k} k={k} s={c.btc[k]} />)}</tbody>
                </table>
              </div>
            </section>
            <section>
              <h4>Gold (XAU/USD) and the dollar</h4>
              <div className="mc-gold">
                <div>
                  <small>Gold 4h</small>
                  <b className={dcls(c.gold.h4?.dir)}>{c.gold.h4 ? `${price(c.gold.h4.close)} ${ARROW[c.gold.h4.dir].split(' ')[0]}` : '—'}</b>
                  <em>1h {c.gold.h1 ? ARROW[c.gold.h1.dir] : '—'}</em>
                </div>
                <Daily label="Dollar index (DXY)" d={c.gold.dxy} />
                <Daily label="10-year yield" d={c.gold.yield10y} unit="%" />
                <Daily label="13-week T-bill" d={c.gold.bill13w} unit="%" />
              </div>
              {c.gold.levels && (
                <p className="mc-note">
                  Levels: yesterday {price(c.gold.levels.prevDayLow)}–{price(c.gold.levels.prevDayHigh)}, 20 days {price(c.gold.levels.low20d)}–{price(c.gold.levels.high20d)}.
                </p>
              )}
              <p className="mc-note">
                60-day correlation: gold vs dollar {n2(c.gold.goldDxyCorr)}, BTC vs gold {n2(c.gold.btcGoldCorr)}. BTC and gold on 4h:{' '}
                <b>{c.btcVsGold === 'same' ? 'same direction' : c.btcVsGold === 'opposite' ? 'opposite directions' : c.btcVsGold === 'mixed' ? 'one of them flat' : '—'}</b>
                {c.btcVsGold === 'opposite' && ' — information, not a signal: they are read separately.'}
                {' '}Yields stand in for interest-rate expectations.
              </p>
            </section>
          </div>
          <h4 className="mc-h">
            Correlation with BTC <small>measured on returns: 15m ≈ 2 days, 1h ≈ 7 days, 4h ≈ 30 days{g4 && ` · 4h: ${g4.strong} strong, ${g4.moderate} moderate, ${g4.independent} independent`}</small>
          </h4>
          <div className="nn-tbl">
            <table className="lab-table mc-table mc-corr">
              <thead><tr><th>Market</th>{TFS.map((k) => <th key={k}>{k}</th>)}<th title="A 1% BTC move goes with this % move (4h)">Beta</th></tr></thead>
              <tbody>
                {c.coins.map((x) => (
                  <tr key={x.symbol}>
                    <td><b>{x.symbol.replace(/USDT$/, '')}</b></td>
                    {TFS.map((k) => {
                      const v = x.corr[k]
                      return (
                        <td key={k} className={corrCls(v?.r)} title={v?.prev != null ? `window before: ${v.prev.toFixed(2)}` : undefined}>
                          {n2(v?.r)}{v?.changed && <i className="mc-chg" title={`changed from ${n2(v.prev)} (99% test)`}>{(v.r ?? 0) > (v.prev ?? 0) ? '↑' : '↓'}</i>}
                        </td>
                      )
                    })}
                    <td>{n2(x.corr['4h']?.beta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mc-note">
            ≥ 0.7 moves with BTC, 0.4–0.7 partly, below 0.4 on its own. ↑↓ marks a correlation that changed against the window before it (99% test). {c.changes.length} change{c.changes.length === 1 ? '' : 's'} right now.
            {c.errors.length > 0 && ` Missing sources: ${c.errors.length}.`}
          </p>
        </>
      )}
    </NnCard>
  )
}
