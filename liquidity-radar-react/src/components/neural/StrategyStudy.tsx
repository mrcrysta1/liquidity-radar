// "Strategy study": the latest run of radar-worker/scripts/study.ts — F1 with
// and without confirmation filters (C6, BTC above its EMA 300, both), the
// exit experiments (profit protection) with how much profit trades gave back,
// every strategy by market regime, each coin's BTC correlation over its whole
// history, and the live paper results counted per decision candle. A report
// only: the bot never acts on it. Data: bot_state 'study:latest'.
import { useEffect, useState } from 'react'
import { SERVER_BOT, loadStudy } from '../../features/selflearn/serverBot'
import { givenBack } from '../../features/selflearn/study'
import type { Paired, StudySummary, StudyView } from '../../features/selflearn/study'
import { NnCard } from './parts'
import { NI } from './icons'
import './StrategyStudy.css'

const dash = '—'
const rr = (v: number | null | undefined, d = 2) => (v == null ? dash : (v >= 0 ? '+' : '') + v.toFixed(d) + 'R')
const cls = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '')
const pct = (v: number) => `${Math.round(v * 100)}%`
const day = (t: number | null) => (t == null ? dash : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))
const range = (s: { lo: number | null; hi: number | null }) => (s.lo != null && s.hi != null ? `${rr(s.lo)} to ${rr(s.hi)}` : 'too few days for a range')

const EXIT_LABEL: Record<string, string> = {
  A: 'Current (F1)',
  'B-trail3': 'Trail 3 ATR',
  'B-trail2': 'Trail 2 ATR',
  'C-be1': 'Break-even at +1R',
  'C-be1.5': 'Break-even at +1.5R',
  'C-be2': 'Break-even at +2R',
  'D-part1.5': 'Half off at +1.5R',
  'D-part2': 'Half off at +2R',
  'E-ema50': 'Exit under EMA 50',
  'E-ema20': 'Exit under EMA 20',
}

function Mean({ s }: { s: StudySummary }) {
  return (
    <td>
      <b className={cls(s.mean)}>{rr(s.mean)}</b>
      <small>{range(s)}</small>
    </td>
  )
}

function Vs({ p }: { p: Paired | null }) {
  if (!p) return <td>{dash}</td>
  return (
    <td>
      <span className={cls(p.mean)}>{rr(p.mean)}</span> {p.better ? <span className="ss-tag up">better</span> : p.worse ? <span className="ss-tag dn">worse</span> : null}
      <small>{range(p)}</small>
    </td>
  )
}

function Filters({ s }: { s: StudyView }) {
  return (
    <>
      <h4 className="ss-h">F1 vs F1 + C6 <small>{s.filters.covered} F1 entries since {day(s.filters.from)} · conservative costs</small></h4>
      <div className="nn-tbl">
        <table className="lab-table">
          <thead><tr><th>Variant</th><th>Taken</th><th>Mean (taken)</th><th>Turned down</th><th>Mean if taken anyway</th><th title="Taken, and lost">False positives</th><th title="Turned down, would have won">Missed winners</th><th>Since Feb 2026</th><th>Proven?</th></tr></thead>
          <tbody>
            {s.filters.variants.map((v) => (
              <tr key={v.id}>
                <td><b>{v.label}</b></td>
                <td>{v.taken.n}</td>
                <Mean s={v.taken} />
                <td>{v.id === 'f1' ? dash : v.rejected.n}</td>
                {v.id === 'f1' ? <td>{dash}</td> : <Mean s={v.rejected} />}
                <td>{v.falsePositives} <small>{v.taken.n ? pct(v.falsePositives / v.taken.n) : ''}</small></td>
                <td>{v.id === 'f1' ? dash : v.missed}</td>
                <td><span className={cls(v.holdout.mean)}>{rr(v.holdout.mean)}</span><small>{v.holdout.n} trades</small></td>
                <td>{v.id === 'f1' ? dash : v.helps ? <span className="ss-tag up">yes</span> : <span className="ss-tag">not proven</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ss-note">
        A filter is proven only if the trades it turns down are clearly worse than F1’s average (their 95% range entirely below it). Each filter raises the average of what it keeps, but what it turns down was still profitable on average — so it mostly trades less, not better. C6 and the BTC rule were designed after Feb 2026 had been seen: that column is not independent evidence; only their paper trades since go-live are.
      </p>
    </>
  )
}

function Exits({ s }: { s: StudyView }) {
  return (
    <>
      <h4 className="ss-h">Profit protection: other exits on the same F1 entries <small>{s.exits[0]?.n ?? 0} trades · per-trade difference from the current exit</small></h4>
      <div className="nn-tbl">
        <table className="lab-table">
          <thead><tr><th>Exit</th><th>Mean per trade</th><th>vs current, whole history</th><th>before Feb 2026</th><th>since Feb 2026</th><th title="Average best unrealized profit reached">Avg best</th><th title="Average profit given back from the best point to the exit">Avg given back</th><th title="Trades that were +1R up at some point and still closed at a loss">+1R then lost</th><th>Exit reasons</th></tr></thead>
          <tbody>
            {s.exits.map((x) => (
              <tr key={x.id}>
                <td><b>{EXIT_LABEL[x.id] ?? x.id}</b></td>
                <Mean s={x.all} />
                <Vs p={x.vsA} />
                <Vs p={x.vsADesign} />
                <Vs p={x.vsAHoldout} />
                <td>{rr(x.giveback.avgMfeR)}</td>
                <td>{rr(x.giveback.avgGivebackR)}</td>
                <td>{x.giveback.reached1RLost} <small>of {x.giveback.reached1R}</small></td>
                <td><small>{x.exits.map(([k, n]) => `${k} ${n}`).join(' · ')}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ss-note">
        Every exit was replayed bar by bar from the same entries (a candle that touches both the stop and a profit level counts as the stop). “Better / worse” only when the 95% range of the difference clears zero. Tighter trails, early break-even and taking half off all gave back less but earned less: a trend strategy is paid by its rare long runs, and protecting profit early cuts those short. No exit can promise a trade will not close at a loss.
      </p>
    </>
  )
}

function Regimes({ s }: { s: StudyView }) {
  const cols = s.regimes.share.map(([k]) => k)
  return (
    <>
      <h4 className="ss-h">Strategies by market regime <small>2019 on · regime at the signal candle · share of time: {s.regimes.share.map(([k, v]) => `${k} ${pct(v)}`).join(', ')}</small></h4>
      <div className="nn-tbl">
        <table className="lab-table">
          <thead><tr><th>Strategy</th>{cols.map((k) => <th key={k}>{k.replace('-', ' ')}</th>)}</tr></thead>
          <tbody>
            {s.regimes.strategies.map((x) => {
              const m = new Map(x.cells)
              return (
                <tr key={x.id}>
                  <td><b>{x.id.toUpperCase()}</b></td>
                  {cols.map((k) => {
                    const c = m.get(k)
                    if (!c) return <td key={k}>{dash}</td>
                    const sure = c.lo != null && c.lo > 0 ? ' ✓' : c.hi != null && c.hi < 0 ? ' ✗' : ''
                    return (
                      <td key={k} className={c.n < 30 ? 'ss-few' : ''} title={range(c)}>
                        <span className={cls(c.mean)}>{rr(c.mean)}{sure}</span>
                        <small>{c.n} trades</small>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="ss-note">✓ / ✗: the 95% range is above / below zero. Faded cells have under 30 trades. With 7 regimes and 6 strategies some cells look good by chance; nothing is switched off by this table.</p>
    </>
  )
}

function Correlation({ s }: { s: StudyView }) {
  if (!s.correlation.length) return null
  return (
    <>
      <h4 className="ss-h">BTC correlation over each coin’s whole history <small>30-day windows of 4h returns · no assumed numbers</small></h4>
      <div className="nn-tbl">
        <table className="lab-table">
          <thead><tr><th>Coin</th><th>Windows</th><th>Median r</th><th>Usual range</th><th title="Share of windows with r ≥ 0.7">Strong</th><th title="Share of windows that changed significantly from the one before">Changed</th><th title="Share of windows ending in a move of its own">Own move</th><th>Beta</th><th title="Beta on BTC's falling bars only">Downside beta</th></tr></thead>
          <tbody>
            {s.correlation.map((c) => (
              <tr key={c.symbol}>
                <td><b>{c.symbol.replace(/USDT$/, '')}</b></td>
                <td>{c.windows}</td>
                <td>{c.median?.toFixed(2) ?? dash}</td>
                <td>{c.p10 != null && c.p90 != null ? `${c.p10.toFixed(2)}–${c.p90.toFixed(2)}` : dash}</td>
                <td>{pct(c.strongShare)}</td>
                <td>{pct(c.changedShare)}</td>
                <td>{pct(c.decoupledShare)}</td>
                <td>{c.beta?.toFixed(2) ?? dash}</td>
                <td className={c.downBeta != null && c.beta != null && c.downBeta > c.beta ? 'dn' : ''}>{c.downBeta?.toFixed(2) ?? dash}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="ss-note">Red downside beta: the coin falls harder with BTC than it rises with it. The live values are in Market context.</p>
    </>
  )
}

function Live({ s }: { s: StudyView }) {
  if (!s.live) return null
  return (
    <>
      <h4 className="ss-h">Since go-live (Nov 2026) <small>paper and demo trades · one mean per decision candle, so one market-wide move counts once</small></h4>
      <div className="nn-tbl">
        <table className="lab-table">
          <thead><tr><th>Strategy</th><th>Trades</th><th>Candles</th><th>Days</th><th>Mean per trade</th><th>Mean per candle</th></tr></thead>
          <tbody>
            {s.live.strategies.map((x) => (
              <tr key={x.strategy}>
                <td><b>{x.strategy.toUpperCase()}</b></td>
                <td>{x.n}</td>
                <td>{x.candles}</td>
                <td>{x.days}</td>
                <td className={cls(x.byTrade.mean)}>{rr(x.byTrade.mean)}</td>
                <Mean s={x.byCandle} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {s.live.real.length > 0 && (
        <>
          <h4 className="ss-h">Demo trades: best point vs result <small>in R of the first stop</small></h4>
          <div className="nn-tbl">
            <table className="lab-table">
              <thead><tr><th>#</th><th>Market</th><th>Strategy</th><th>Exit</th><th>Best (max unrealized)</th><th>Worst</th><th>Result</th><th>Given back</th></tr></thead>
              <tbody>
                {s.live.real.map((t) => (
                  <tr key={t.id}>
                    <td>{t.id}</td>
                    <td><b>{t.symbol.replace(/USDT$/, '')}</b></td>
                    <td>{t.strategy}</td>
                    <td>{t.exit}</td>
                    <td className="up">{rr(t.mfeR)}</td>
                    <td className="dn">{rr(t.maeR)}</td>
                    <td className={cls(t.r)}>{rr(t.r)}</td>
                    <td>{rr(givenBack(t))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  )
}

export function StrategyStudyCard() {
  const [s, setS] = useState<StudyView | null | undefined>(undefined)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    loadStudy().then((x) => alive && setS(x)).catch((e) => alive && setErr(String(e)))
    return () => {
      alive = false
    }
  }, [])
  if (!SERVER_BOT || s === null) return null
  return (
    <NnCard title="Strategy study" icon={NI.shield} className="ss" right={s ? <small className="ss-sub">run {day(s.generatedAt)} · {s.markets} markets · {day(s.from)} → {day(s.to)}</small> : undefined}>
      {err && <p className="nn-err">{err}</p>}
      {s === undefined && !err && <p className="nn-empty">Loading the study…</p>}
      {s && (
        <>
          <p className="ss-intro">
            F1’s whole history re-run with confirmation filters and with other exits, every strategy split by market regime, and the paper results so far. Conservative costs (0.10% per order side) plus real funding; ranges count trades on the same day as one. A report only: nothing in the bot changes from it.
          </p>
          <Filters s={s} />
          <Exits s={s} />
          <Regimes s={s} />
          <Correlation s={s} />
          <Live s={s} />
        </>
      )}
    </NnCard>
  )
}
