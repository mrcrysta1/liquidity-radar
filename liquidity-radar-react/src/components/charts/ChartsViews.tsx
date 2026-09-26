// The Charts tab, after the owner's reference: the main chart beside a Chart
// Intelligence panel, a multi-chart workspace with layout controls, and a
// Quick Tools bar. All figures come from live state; the workspace panels
// themselves are drawn by features/charts/multiCharts.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { state } from '../../services/store'
import { baseOf } from '../../utils/coins'
import { pfmt } from '../../utils/format'
import { useTick, CHART_TABS } from '../useTick'
import { HomeIcon } from '../home/icons'
import type { HomeIconId } from '../home/icons'
import { evidence, pivots } from '../../features/analysis/insights'
import {
  getConfluenceRows,
  confluenceSummary,
  onConfluenceChange,
} from '../../features/analysis/confluence'
import { getMLState, onMLChange } from '../../features/ml/store'
import { signalData } from '../../features/signals'
import { getIndicators, subscribeIndicators } from '../../features/charts/indicators/store'
import { indicatorDef, instanceLabel } from '../../features/charts/indicators/registry'
import {
  mcAdd,
  mcCanAdd,
  mcColumns,
  mcCount,
  mcSetColumns,
  onMcChange,
} from '../../features/charts/multiCharts'
import { toggleReplay } from '../../features/charts/replay'
import { chartScreenshot } from '../../features/charts/chartRender'
import { renderAlerts } from '../../features/alerts/alerts'
import { openModal, showToast } from '../../utils/dom'

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number }

function useBump(sub: (fn: () => void) => () => void) {
  const [, f] = useState(0)
  useEffect(() => sub(() => f((n) => n + 1)), [sub])
}

/** Higher highs and higher lows (or the reverse) across the last 40 bars, in two halves. */
function structure(cs: Candle[]): 'up' | 'down' | 'range' {
  const a = cs.slice(-40, -20)
  const b = cs.slice(-20)
  if (a.length < 10 || b.length < 10) return 'range'
  const hi = (x: Candle[]) => Math.max(...x.map((c) => c.h))
  const lo = (x: Candle[]) => Math.min(...x.map((c) => c.l))
  if (hi(b) > hi(a) && lo(b) > lo(a)) return 'up'
  if (hi(b) < hi(a) && lo(b) < lo(a)) return 'down'
  return 'range'
}

/** One labelled read in the Overview tab. */
const Row = ({
  icon,
  tone,
  title,
  children,
}: {
  icon: HomeIconId
  tone: string
  title: string
  children: ReactNode
}) => (
  <div className={'ci-row ' + tone}>
    <span className="ci-ico">
      <HomeIcon id={icon} size={22} />
    </span>
    <div className="ci-txt">
      <small>{title}</small>
      {children}
    </div>
  </div>
)

function Overview() {
  const cs = state.candles as Candle[]
  const st = structure(cs)
  const p = pivots()
  const closes = cs.map((c) => c.c)
  const rets = closes
    .slice(-97)
    .map((c, i, a) => (i ? Math.log(c / a[i - 1]) : 0))
    .slice(1)
  const vol =
    rets.length > 2
      ? Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / rets.length) * Math.sqrt(rets.length) * 100
      : null
  const v = cs.map((c) => c.v)
  const recent = v.slice(-10).reduce((a, b) => a + b, 0)
  const prior = v.slice(-20, -10).reduce((a, b) => a + b, 0)
  const volUp = prior > 0 ? recent / prior : 1
  const inds = getIndicators()
  return (
    <div className="ci-list">
      <Row
        icon="overview"
        tone={st === 'up' ? 'up' : st === 'down' ? 'dn' : ''}
        title="Current Trend"
      >
        <b className={st === 'up' ? 'up' : st === 'down' ? 'dn' : ''}>
          {st === 'up' ? '↗ Uptrend' : st === 'down' ? '↘ Downtrend' : '→ Ranging'}
        </b>
        <span>
          {st === 'up'
            ? 'Higher highs & higher lows'
            : st === 'down'
              ? 'Lower highs & lower lows'
              : 'No clear swing structure'}
        </span>
      </Row>
      <Row icon="radar" tone="" title="Key Levels">
        {p ? (
          <dl className="ci-kv">
            <dt className="dn">Resistance</dt>
            <dd>
              {pfmt(p.R[0])} – {pfmt(p.R[1])}
            </dd>
            <dt className="up">Support</dt>
            <dd>
              {pfmt(p.S[0])} – {pfmt(p.S[1])}
            </dd>
          </dl>
        ) : (
          <span>Waiting for the 24h range…</span>
        )}
      </Row>
      <Row icon="sentiment" tone="" title={'Volatility (' + rets.length + ' bars)'}>
        <b>{vol != null ? vol.toFixed(2) + '%' : '—'}</b>
        <span className="ci-tag">
          {vol == null ? '' : vol > 3 ? 'High' : vol > 1.2 ? 'Moderate' : 'Low'}
        </span>
      </Row>
      <Row icon="liqs" tone={volUp >= 1 ? 'up' : 'dn'} title="Volume State">
        <b className={volUp >= 1 ? 'up' : 'dn'}>{volUp >= 1 ? 'Increasing' : 'Decreasing'}</b>
        <span className="ci-tag">
          {volUp >= 1.15 ? 'Above average' : volUp <= 0.85 ? 'Below average' : 'Near average'}
        </span>
      </Row>
      <div className="ci-inds">
        <small>Active Indicators</small>
        {inds.length ? (
          <ul>
            {inds.map((ins) => {
              const def = indicatorDef(ins.type)
              if (!def) return null
              return (
                <li key={ins.uid}>
                  <i style={{ background: def.outputs[0]?.color || 'var(--green)' }} />
                  <span>{instanceLabel(def, ins.params)}</span>
                  <em>{def.group}</em>
                </li>
              )
            })}
          </ul>
        ) : (
          <span className="ci-none">None — add some from the chart’s indicator menu.</span>
        )}
      </div>
    </div>
  )
}

function Signals() {
  useBump(onConfluenceChange)
  const sig = (
    signalData as Array<{
      sym: string
      score: number
      master: { type: string }
      conv?: { agree: number; of: number }
    }>
  ).find((s) => s.sym === state.symbol)
  const rows = getConfluenceRows()
  return (
    <div className="ci-list">
      <div className="ci-row">
        <div className="ci-txt">
          <small>Scanner signal</small>
          {sig ? (
            <b
              className={sig.master.type === 'BUY' ? 'up' : sig.master.type === 'SELL' ? 'dn' : ''}
            >
              {sig.master.type} · score {sig.score > 0 ? '+' : ''}
              {sig.score}
              {sig.conv ? ' · ' + sig.conv.agree + '/' + sig.conv.of + ' TF' : ''}
            </b>
          ) : (
            <span>{baseOf(state.symbol)} is not in the scanner’s current sweep.</span>
          )}
        </div>
      </div>
      <table className="ci-mtf">
        <thead>
          <tr>
            <th>TF</th>
            <th>Trend</th>
            <th>RSI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.tf}>
              <td>{r.tf}</td>
              <td
                className={
                  r.loading
                    ? 'dim'
                    : r.verdict === 'bull'
                      ? 'up'
                      : r.verdict === 'bear'
                        ? 'dn'
                        : 'dim'
                }
              >
                {r.loading
                  ? '…'
                  : r.verdict === 'bull'
                    ? 'Bullish ↑'
                    : r.verdict === 'bear'
                      ? 'Bearish ↓'
                      : 'Neutral →'}
              </td>
              <td className="dim">{r.loading ? '' : r.rsi.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <small className="ci-foot">
        Overall:{' '}
        {confluenceSummary() === 'bull'
          ? 'Bullish'
          : confluenceSummary() === 'bear'
            ? 'Bearish'
            : 'Neutral'}
      </small>
    </div>
  )
}

function Insights() {
  useBump(onMLChange)
  const ml = getMLState()
  const pred = ml.prediction
  return (
    <div className="ci-list">
      <div className="ci-row">
        <div className="ci-txt">
          <small>Direction model</small>
          {pred ? (
            <b className={pred.direction === 'up' ? 'up' : 'dn'}>
              {pred.direction === 'up' ? 'Long' : 'Short'} · {Math.round(pred.confidence * 100)}%
              confidence
            </b>
          ) : (
            <span>
              {ml.status === 'training'
                ? 'Training on this market…'
                : 'Not trained yet — train it from the Radar tab.'}
            </span>
          )}
          {ml.trained?.backtestAccuracy != null && (
            <span>
              Backtest {(ml.trained.backtestAccuracy * 100).toFixed(1)}% on {ml.trained.backtestN}{' '}
              held-out bars
            </span>
          )}
        </div>
      </div>
      <ul className="ci-ev">
        {evidence().map((e) => (
          <li key={e.text} className={e.ok ? 'up' : 'dn'}>
            <span aria-hidden="true">{e.ok ? '✓' : '✗'}</span>
            {e.text}
          </li>
        ))}
      </ul>
      <small className="ci-foot">Statistical reads, not financial advice.</small>
    </div>
  )
}

const TABS = ['Overview', 'Signals', 'AI Insights'] as const

export function ChartIntel() {
  useTick(2000, CHART_TABS)
  useBump(subscribeIndicators)
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview')
  return (
    <aside className="card ci" aria-label="Chart intelligence">
      <header className="ci-head">
        <HomeIcon id="radar" size={22} />
        <h3>Chart Intelligence</h3>
        <span className="ci-sym">{baseOf(state.symbol)}/USDT</span>
      </header>
      <div className="ci-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === tab}
            className={t === tab ? 'on' : ''}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'Overview' ? <Overview /> : tab === 'Signals' ? <Signals /> : <Insights />}
    </aside>
  )
}

export function WorkspaceHead() {
  useBump(onMcChange)
  const cols = mcColumns()
  return (
    <div className="ws-head">
      <span className="ws-title">
        <HomeIcon id="radar" size={20} />
        Multi-Chart Workspace
      </span>
      <label className="ws-ctl">
        <HomeIcon id="overview" size={15} />
        <select
          value={cols}
          onChange={(e) => mcSetColumns(Number(e.target.value))}
          aria-label="Grid layout"
        >
          <option value={2}>Grid · 2 columns</option>
          <option value={3}>Grid · 3 columns</option>
          <option value={4}>Grid · 4 columns</option>
        </select>
      </label>
      <span className="ws-ctl ws-count">{mcCount()} Charts</span>
      <span className="ws-live">
        <i />
        Live
      </span>
    </div>
  )
}

function download(canvas: HTMLCanvasElement, name: string) {
  canvas.toBlob((b) => {
    if (!b) return
    const url = URL.createObjectURL(b)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }, 'image/png')
}

export function QuickTools() {
  const now = useTick(5000, ['multichart'])
  const tools: Array<{ title: string; sub: string; icon: HomeIconId; run: () => void }> = [
    {
      title: 'Compare',
      sub: 'Add this asset to the grid',
      icon: 'venues',
      run: () =>
        mcCanAdd()
          ? mcAdd(state.symbol, '1h')
          : showToast('The workspace is full — remove a chart first'),
    },
    { title: 'Replay', sub: 'Step through history', icon: 'calendar', run: () => toggleReplay() },
    {
      title: 'Alerts',
      sub: 'Price alerts',
      icon: 'star',
      run: () => {
        renderAlerts()
        openModal('alModal')
      },
    },
    {
      title: 'Layouts',
      sub: 'Cycle 2 · 3 · 4 columns',
      icon: 'overview',
      run: () => mcSetColumns(mcColumns() >= 4 ? 2 : mcColumns() + 1),
    },
    {
      title: 'Indicators',
      sub: 'Add indicators',
      icon: 'signals',
      run: () => {
        document
          .getElementById('radarChartCard')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        ;(document.querySelector('#radarChartCard .ind-open') as HTMLButtonElement | null)?.click()
      },
    },
    {
      title: 'Export',
      sub: 'Save the chart as PNG',
      icon: 'news',
      run: () => {
        const c = chartScreenshot()
        if (c)
          download(
            c,
            baseOf(state.symbol) +
              '-' +
              state.tf +
              '-' +
              new Date().toISOString().slice(0, 16).replace(':', '') +
              '.png',
          )
        else showToast('Chart is not ready yet')
      },
    },
  ]
  const live = document.getElementById('statusTxt')?.textContent === 'Live'
  return (
    <section className="card qt" aria-label="Quick tools">
      <header className="qt-head">
        <HomeIcon id="radar" size={18} />
        Quick Tools
      </header>
      <div className="qt-grid">
        {tools.map((t) => (
          <button key={t.title} type="button" onClick={t.run}>
            <span className="qt-ico">
              <HomeIcon id={t.icon} size={22} />
            </span>
            <span>
              <b>{t.title}</b>
              <small>{t.sub}</small>
            </span>
          </button>
        ))}
        <div className="qt-status">
          <span>
            <i className={live ? 'on' : ''} />
            Market Status <em className={live ? 'up' : 'dn'}>{live ? 'Live' : 'Try'}</em>
          </span>
          <small>
            Last update{' '}
            {new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </small>
        </div>
      </div>
    </section>
  )
}
