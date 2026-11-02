// "Model metrics": a data scientist's view of the server bot. Tab ML: how
// good the model's win probabilities are (classification at 0.5 and at the
// bot's own EV bar, ranking, calibration with a reliability chart) and the
// model registry. Tab Strategies: the rule strategies' R statistics.
// Logic in features/selflearn/modelMetrics.ts; rows from serverBot.ts loadModelMetrics.
import { useEffect, useMemo, useState } from 'react'
import { SERVER_BOT, loadModelMetrics } from '../../features/selflearn/serverBot'
import { DECISION_EV, RECENT_N, mlMetrics, modelRegistry, splitRows, strategyMetrics } from '../../features/selflearn/modelMetrics'
import type { CalibBin, Classification, MarketRegistry, MlReport, RuleReport, StrategyMetrics, Windowed } from '../../features/selflearn/modelMetrics'
import { marketLabel } from '../../features/selflearn/perp'
import { NnCard } from './parts'
import { NI } from './icons'
import './ModelMetricsCard.css'

type Tab = 'ml' | 'rules'
type Win = 'all' | 'recent'

const dash = '—'
const f = (v: number | null | undefined, d = 3) => (v == null || !isFinite(v) ? dash : v.toFixed(d))
const pct = (v: number | null | undefined, d = 1) => (v == null ? dash : (v * 100).toFixed(d) + '%')
const rr = (v: number | null | undefined, d = 2) => (v == null ? dash : (v >= 0 ? '+' : '') + v.toFixed(d) + 'R')
const cls = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '')
const when = (t: number | null) => (t == null ? dash : new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))

interface Data {
  ml: ReturnType<typeof mlMetrics>
  rules: StrategyMetrics[]
  registry: MarketRegistry[]
}

/** Reliability chart: predicted vs actual win rate per bin; the dashed diagonal is perfect calibration. Dot area ~ trades in the bin. */
function Reliability({ bins }: { bins: CalibBin[] }) {
  const S = 220
  const P = 28
  const x = (v: number) => P + v * (S - P - 8)
  const y = (v: number) => S - P - v * (S - P - 8)
  const used = bins.filter((b) => b.n > 0)
  const maxN = Math.max(1, ...used.map((b) => b.n))
  const pts = used.map((b) => `${x(b.predicted!)},${y(b.actual!)}`).join(' ')
  return (
    <svg className="mm-rel" viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Reliability chart: predicted win chance against the actual win rate, per bin">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={x(0)} x2={x(1)} y1={y(v)} y2={y(v)} className="mm-grid" />
          <text x={P - 4} y={y(v) + 3} className="mm-ax" textAnchor="end">{v * 100}</text>
          <text x={x(v)} y={S - P + 12} className="mm-ax" textAnchor="middle">{v * 100}</text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="mm-diag" />
      {used.length > 1 && <polyline points={pts} className="mm-line" />}
      {used.map((b) => (
        <circle key={b.lo} cx={x(b.predicted!)} cy={y(b.actual!)} r={4 + 6 * Math.sqrt(b.n / maxN)} className="mm-dot">
          <title>{`${pct(b.lo, 0)}–${pct(b.hi, 0)}: predicted ${pct(b.predicted)}, actual ${pct(b.actual)} over ${b.n} trades`}</title>
        </circle>
      ))}
      <text x={x(0.5)} y={S - 2} className="mm-ax" textAnchor="middle">predicted win chance %</text>
      <text x={8} y={y(0.5)} className="mm-ax" textAnchor="middle" transform={`rotate(-90 8 ${y(0.5)})`}>actual win rate %</text>
    </svg>
  )
}

function ConfusionGrid({ c, title }: { c: Classification; title: string }) {
  return (
    <div className="mm-cm">
      <small>{title}</small>
      <table>
        <thead>
          <tr><th /><th>Won</th><th>Lost</th></tr>
        </thead>
        <tbody>
          <tr><th>Predicted win</th><td className="mm-ok">{c.tp}<em>true pos.</em></td><td className="mm-bad">{c.fp}<em>false pos.</em></td></tr>
          <tr><th>Predicted loss</th><td className="mm-bad">{c.fn}<em>false neg.</em></td><td className="mm-ok">{c.tn}<em>true neg.</em></td></tr>
        </tbody>
      </table>
    </div>
  )
}

function ClsRows({ a, b }: { a: Classification; b: Classification }) {
  const row = (k: keyof Classification, label: string, fmt = (v: number | null) => pct(v)) => (
    <tr key={k}><td>{label}</td><td>{fmt(a[k] as number | null)}</td><td>{fmt(b[k] as number | null)}</td></tr>
  )
  return (
    <div className="nn-tbl">
      <table className="lab-table mm-table">
        <thead><tr><th>Metric</th><th>p ≥ 0.5</th><th>EV &gt; {DECISION_EV}R (taken)</th></tr></thead>
        <tbody>
          {row('accuracy', 'Accuracy')}
          {row('precision', 'Precision')}
          {row('recall', 'Recall')}
          {row('specificity', 'Specificity')}
          {row('f1', 'F1 score', (v) => f(v))}
          {row('takeRate', 'Predicted win / taken')}
        </tbody>
      </table>
    </div>
  )
}

function MlPanel({ d, win }: { d: Data; win: Win }) {
  const [sym, setSym] = useState<string>('all')
  const rep: MlReport | undefined = sym === 'all' ? d.ml.overall[win] : d.ml.perMarket.find((m) => m.symbol === sym)?.[win]
  if (!d.ml.overall.all.n) return <p className="nn-empty">No closed model trades yet. The model paper-trades every market; its first results arrive a few bars after it has trained there.</p>
  return (
    <div className="mm-panel">
      <div className="lab-filters mm-filters">
        <label>
          Market
          <select value={sym} onChange={(e) => setSym(e.target.value)}>
            <option value="all">All markets</option>
            {d.ml.perMarket.map((m) => <option key={m.symbol} value={m.symbol}>{marketLabel(m.symbol)} ({m.all.n})</option>)}
          </select>
        </label>
      </div>
      {!rep || !rep.n ? <p className="nn-empty">No trades here.</p> : (
        <>
          <div className="mm-tiles">
            <div><small>Trades</small><b>{rep.n}</b><em>{rep.real} real · {rep.shadow} paper</em></div>
            <div><small>Base rate</small><b>{pct(rep.baseRate)}</b><em>share that won · mean p {pct(rep.meanP)}</em></div>
            <div><small>ROC-AUC</small><b>{f(rep.auc)}</b><em>0.5 = coin flip · raw {f(rep.raw.auc)}</em></div>
            <div><small>PR-AUC</small><b>{f(rep.prAuc)}</b><em>no-skill = base rate</em></div>
            <div><small>Brier</small><b>{f(rep.brier)}</b><em>no-skill {f(rep.brierBase)} · raw {f(rep.raw.brier)}</em></div>
            <div><small>Log loss</small><b>{f(rep.logLoss)}</b><em>raw {f(rep.raw.logLoss)}</em></div>
            <div><small>ECE</small><b>{pct(rep.ece)}</b><em>calibration error · raw {pct(rep.raw.ece)}</em></div>
            <div><small>Avg R taken / skipped</small><b className={cls(rep.takenR)}>{rr(rep.takenR)}</b><em className={cls(rep.skippedR)}>skipped {rr(rep.skippedR)}</em></div>
          </div>
          <div className="mm-two">
            <div className="mm-col">
              <h4>Classification</h4>
              <ClsRows a={rep.at50} b={rep.atDecision} />
              <div className="mm-cms">
                <ConfusionGrid c={rep.at50} title="Confusion matrix · p ≥ 0.5" />
                <ConfusionGrid c={rep.atDecision} title={`Confusion matrix · EV > ${DECISION_EV}R`} />
              </div>
            </div>
            <div className="mm-col">
              <h4>Calibration</h4>
              <Reliability bins={rep.calib} />
              <div className="nn-tbl">
                <table className="lab-table mm-table">
                  <thead><tr><th>Bin</th><th>Predicted</th><th>Actual</th><th>Trades</th></tr></thead>
                  <tbody>
                    {rep.calib.map((b) => (
                      <tr key={b.lo} className={b.n ? '' : 'mm-empty'}>
                        <td>{pct(b.lo, 0)}–{pct(b.hi, 0)}</td><td>{pct(b.predicted)}</td><td>{pct(b.actual)}</td><td>{b.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
      <h4>Per market <i>{win === 'all' ? 'all time' : `last ${RECENT_N}`}</i></h4>
      <div className="nn-tbl">
        <table className="lab-table mm-table">
          <thead>
            <tr><th>Market</th><th>Trades</th><th>Base</th><th>AUC</th><th>Brier</th><th>Log loss</th><th>ECE</th><th>Prec. (taken)</th><th>Avg R taken</th></tr>
          </thead>
          <tbody>
            {d.ml.perMarket.map((m) => {
              const r = m[win]
              return (
                <tr key={m.symbol}>
                  <td><b>{marketLabel(m.symbol)}</b></td><td>{r.n}</td><td>{pct(r.baseRate)}</td><td>{f(r.auc)}</td><td>{f(r.brier)}</td>
                  <td>{f(r.logLoss)}</td><td>{pct(r.ece)}</td><td>{pct(r.atDecision.precision)}</td><td className={cls(r.takenR)}>{rr(r.takenR)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <h4>Model registry</h4>
      {!d.registry.length ? <p className="nn-empty">No model versions readable yet.</p> : (
        <div className="nn-tbl">
          <table className="lab-table mm-table">
            <thead>
              <tr><th>Market</th><th>Champion</th><th>Gate</th><th>Last promotion</th><th>Challengers</th><th>Latest challenger</th></tr>
            </thead>
            <tbody>
              {d.registry.map((m) => {
                const c = m.recent[0]
                return (
                  <tr key={m.symbol}>
                    <td><b>{marketLabel(m.symbol)}</b><small>{m.interval ?? ''}</small></td>
                    <td>{m.championVersion != null ? 'v' + m.championVersion : dash}<small>since {when(m.championSince)}</small></td>
                    <td className={m.gatePass ? 'up' : m.gatePass === false ? 'dn' : ''}>{m.gatePass == null ? dash : m.gatePass ? 'pass' : 'fail'}</td>
                    <td>{when(m.lastPromotion)}</td>
                    <td>{m.challengers}<small>{m.promotions} promoted</small></td>
                    <td className="mm-wrap">
                      {c ? (
                        <>
                          <span className={c.promoted ? 'up' : ''}>v{c.version ?? '?'} {c.promoted ? 'promoted' : 'kept as challenger'}</span>
                          <small>{when(c.t)} · log loss {f(c.challLogLoss, 4)} vs {f(c.champLogLoss, 4)} · {c.reason}</small>
                        </>
                      ) : dash}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <details className="mm-notes">
        <summary>What these numbers mean</summary>
        <ul>
          <li><b>Label</b>: a trade is a win when it hit its target, a loss when it hit its stop, and otherwise (time exit) a win when it closed above zero R before costs — the same label the bot learns from.</li>
          <li><b>p</b>: the calibrated win chance the bot uses for its EV. <b>Raw</b> columns score the network's output before calibration, so you can see whether calibration helps.</li>
          <li><b>Accuracy</b>: share of trades called right. With a base rate of 40% a model that always says “loss” is 60% accurate, so accuracy alone says little.</li>
          <li><b>Precision</b>: of the trades it called wins (or took), the share that won. <b>Recall</b>: of the trades that won, the share it called. <b>Specificity</b>: of the losers, the share it called losers. <b>F1</b>: the balance of precision and recall.</li>
          <li><b>EV &gt; {DECISION_EV}R</b> is the bot's real decision: it takes a signal when the expected value after costs clears that bar, not when p ≥ 0.5. A trade with a 1:1.5 reward:risk pays at about a 40% win chance.</li>
          <li><b>ROC-AUC</b>: the chance a random winner gets a higher p than a random loser (0.5 = no skill, 1 = perfect ranking). <b>PR-AUC</b>: average precision when ranking by p; no-skill equals the base rate.</li>
          <li><b>Brier score</b>: mean squared gap between p and the outcome (lower is better); it should beat the no-skill figure of always predicting the base rate. <b>Log loss</b> punishes confident mistakes hardest (0.693 = a constant 50%).</li>
          <li><b>Calibration</b>: in each 10% bin, does a predicted 60% win about 60% of the time? Dots on the dashed diagonal are well calibrated; <b>ECE</b> is the trade-weighted average gap.</li>
          <li><b>Win rate or accuracy ≠ profit</b>: profit is win rate × average win − loss rate × average loss, minus costs. A 35% win rate with 3R winners makes money; a 70% win rate with tiny wins and full-size losses does not. Judge by expectancy (avg R) and the Strategies tab.</li>
          <li>Most rows are paper trades on the model's own signals; overlapping trades on one market are correlated, so treat small samples (under ~100 per market) as noisy.</li>
        </ul>
      </details>
    </div>
  )
}

const RULE_COLS: Array<[keyof RuleReport, string, (v: number | null) => string, boolean?]> = [
  ['trades', 'Trades', (v) => String(v ?? 0)],
  ['winRate', 'Win rate', (v) => pct(v)],
  ['avgWinR', 'Avg win', (v) => rr(v), true],
  ['avgLossR', 'Avg loss', (v) => rr(v), true],
  ['payoff', 'Payoff (R:R)', (v) => f(v, 2)],
  ['expectancy', 'Expectancy', (v) => rr(v, 3), true],
  ['profitFactor', 'Profit factor', (v) => f(v, 2)],
  ['totalR', 'Total', (v) => rr(v, 1), true],
  ['maxDdR', 'Max DD', (v) => (v == null ? dash : v.toFixed(1) + 'R')],
  ['sharpe', 'Sharpe / trade', (v) => f(v, 2)],
  ['avgBars', 'Avg bars', (v) => f(v, 1)],
  ['medMaeR', 'MAE med.', (v) => f(v, 2)],
  ['medMfeR', 'MFE med.', (v) => f(v, 2)],
]

function RuleRow({ label, sub, r }: { label: string; sub?: string; r: RuleReport }) {
  return (
    <tr>
      <td><b>{label}</b>{sub && <small>{sub}</small>}</td>
      {RULE_COLS.map(([k, , fmt, signed]) => {
        const v = r[k] as number | null
        return <td key={k} className={signed ? cls(v) : ''}>{fmt(v)}</td>
      })}
    </tr>
  )
}

function RulesPanel({ d, win }: { d: Data; win: Win }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!d.rules.length) return <p className="nn-empty">No closed rule-strategy trades yet.</p>
  const pick = (w: Windowed<RuleReport>) => w[win]
  return (
    <div className="mm-panel">
      <div className="nn-tbl">
        <table className="lab-table mm-table">
          <thead>
            <tr><th>Strategy</th>{RULE_COLS.map(([k, label]) => <th key={k}>{label}</th>)}</tr>
          </thead>
          <tbody>
            {d.rules.map((s) => (
              <RuleRow key={s.id} label={s.id.toUpperCase()} sub={`${pick(s.overall).real} real · ${pick(s.overall).shadow} paper`} r={pick(s.overall)} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="nn-seg mm-pick" role="tablist" aria-label="Per-market breakdown">
        {d.rules.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={open === s.id} className={open === s.id ? 'on' : ''} onClick={() => setOpen(open === s.id ? null : s.id)}>
            {s.id.toUpperCase()} by market
          </button>
        ))}
      </div>
      {open && (
        <div className="nn-tbl">
          <table className="lab-table mm-table">
            <thead>
              <tr><th>Market</th>{RULE_COLS.map(([k, label]) => <th key={k}>{label}</th>)}</tr>
            </thead>
            <tbody>
              {d.rules.find((s) => s.id === open)?.perMarket.map((m) => <RuleRow key={m.symbol} label={marketLabel(m.symbol)} r={pick(m)} />)}
            </tbody>
          </table>
        </div>
      )}
      <details className="mm-notes">
        <summary>What these numbers mean</summary>
        <ul>
          <li><b>R</b>: profit or loss in units of the risk taken at the initial stop, after fees (real) or estimated costs (paper). 1R = the planned loss.</li>
          <li><b>Payoff</b>: average win ÷ average loss, the realised reward:risk. <b>Expectancy</b>: average R per trade = win rate × avg win + loss rate × avg loss. This, not win rate, decides whether a strategy makes money.</li>
          <li><b>Profit factor</b>: gross wins ÷ gross losses (above 1 = profitable). <b>Max DD</b>: the deepest fall of cumulative R from a peak, in close order.</li>
          <li><b>Sharpe / trade</b>: mean ÷ standard deviation of per-trade R (not annualised): how steady the edge is.</li>
          <li><b>MAE / MFE</b>: median worst and best open excursion in R: how far trades go against and for you before closing.</li>
          <li>Trend strategies like F1 win under half their trades and still profit from a few large winners: a low win rate is expected, not a fault.</li>
        </ul>
      </details>
    </div>
  )
}

export function ModelMetricsCard() {
  const [raw, setRaw] = useState<Awaited<ReturnType<typeof loadModelMetrics>>>(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState<Tab>('ml')
  const [win, setWin] = useState<Win>('all')
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    const load = () =>
      loadModelMetrics()
        .then((x) => {
          if (alive) {
            setRaw(x)
            setErr('')
          }
        })
        .catch((e) => alive && setErr(String(e)))
    load()
    const id = setInterval(load, 10 * 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])
  const d = useMemo<Data | null>(() => {
    if (!raw) return null
    const { ml, rule } = splitRows(raw.real, raw.shadow)
    return { ml: mlMetrics(ml), rules: strategyMetrics(rule), registry: modelRegistry(raw.models) }
  }, [raw])
  if (!SERVER_BOT) return null
  return (
    <NnCard
      title="Model metrics"
      icon={NI.chart}
      className="mm"
      right={
        <div className="mm-ctrl">
          <div className="nn-seg" role="tablist" aria-label="Metrics view">
            <button type="button" role="tab" aria-selected={tab === 'ml'} className={tab === 'ml' ? 'on' : ''} onClick={() => setTab('ml')}>ML</button>
            <button type="button" role="tab" aria-selected={tab === 'rules'} className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>Strategies</button>
          </div>
          <div className="nn-seg" role="tablist" aria-label="Window">
            <button type="button" role="tab" aria-selected={win === 'all'} className={win === 'all' ? 'on' : ''} onClick={() => setWin('all')}>All time</button>
            <button type="button" role="tab" aria-selected={win === 'recent'} className={win === 'recent' ? 'on' : ''} onClick={() => setWin('recent')}>Last {RECENT_N}</button>
          </div>
        </div>
      }
    >
      {err && <p className="nn-err">{err}</p>}
      {!d && !err && <p className="nn-empty">Loading metrics…</p>}
      {d && (tab === 'ml' ? <MlPanel d={d} win={win} /> : <RulesPanel d={d} win={win} />)}
    </NnCard>
  )
}
