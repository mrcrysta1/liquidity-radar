// The policy's trading record: what it is holding, everything it has closed,
// and what it learned from each one.
//
// All of this machinery already existed — paper trades opened from the DQN's
// long signal, TP and SL checked on every price tick, and a fine-tune pass
// fired on each close. None of it was visible anywhere. A model that trades
// and learns without showing its ledger is indistinguishable from one that
// does nothing, which is exactly how it felt.
//
// Every fill here is simulated against real prices. Nothing on this page has
// ever placed an order.
import { useEffect, useState } from 'react'
import {
  getHistory,
  getOpenTrades,
  getOverallStats,
  onPaperTradingChange,
} from '../../features/ml/paperTrading'
import type { PaperTrade } from '../../features/ml/paperTrading'
import {
  getAutoTrade,
  getRLState,
  onRLChange,
  setAutoTrade,
  trainRLPolicy,
} from '../../features/ml/rlStore'
import { state } from '../../services/store'
import { pfmt } from '../../utils/format'
import { coinMeta } from '../../utils/coins'

const pct = (v: number): string => (v > 0 ? '+' : '') + (v * 100).toFixed(2) + '%'

function ago(ts: number, now: number): string {
  const m = Math.max(0, Math.round((now - ts) / 60000))
  if (m < 60) return m + 'm'
  const h = Math.round(m / 60)
  return h < 48 ? h + 'h' : Math.round(h / 24) + 'd'
}

/** Distance from live price to a level, as a percentage of the live price. */
function away(price: number, level: number): string {
  if (!(price > 0)) return '—'
  return ((level - price) / price * 100).toFixed(2) + '%'
}

function OpenRow({ t, now }: { t: PaperTrade; now: number }) {
  const live = (state.tickers[t.symbol] as { last?: number } | undefined)?.last ?? 0
  const unreal = live > 0 ? (live - t.entry) / t.entry : 0
  const meta = coinMeta(t.symbol)
  return (
    <div className="tl-open">
      <div className="tl-open-head">
        <span className="tl-open-sym">
          {meta.icon} {meta.name}
        </span>
        <span className="badge b-green">LONG · OPEN</span>
        <span className="tl-open-age">held {ago(t.openedAt, now)}</span>
      </div>
      <div className="tl-open-grid">
        <div>
          <small>Entry</small>
          <b>{pfmt(t.entry)}</b>
        </div>
        <div>
          <small>Live</small>
          <b className={unreal >= 0 ? 'up' : 'dn'}>{live > 0 ? pfmt(live) : '—'}</b>
          <i className={unreal >= 0 ? 'up' : 'dn'}>{live > 0 ? pct(unreal) : ''}</i>
        </div>
        <div>
          <small>Take profit</small>
          <b className="up">{pfmt(t.tp)}</b>
          <i>{away(live, t.tp)} away</i>
        </div>
        <div>
          <small>Stop loss</small>
          <b className="dn">{pfmt(t.sl)}</b>
          <i>{away(live, t.sl)} away</i>
        </div>
      </div>
    </div>
  )
}

export function TradeLedger() {
  const [, bump] = useState(0)
  const [auto, setAuto] = useState(getAutoTrade())
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const off1 = onPaperTradingChange(() => bump((n) => n + 1))
    const off2 = onRLChange(() => {
      setAuto(getAutoTrade())
      bump((n) => n + 1)
    })
    // Open positions show distance-to-level against a live price, so this
    // has to re-render on its own even when nothing in the store changes.
    const id = setInterval(() => setNow(Date.now()), 2000)
    return () => {
      off1()
      off2()
      clearInterval(id)
    }
  }, [])

  const rl = getRLState()
  const open = getOpenTrades()
  const closed = getHistory().filter((t) => t.outcome)
  const stats = getOverallStats()
  const learned = closed.filter((t) => t.learnedFrom).length

  const train = async () => {
    setBusy(true)
    try {
      await trainRLPolicy(state.symbol, state.tf, state.candles)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tl">
      <div className="tl-head">
        <span className="tl-title">Autonomous paper trading</span>
        <label className="tl-auto" title="Open a simulated long whenever the policy says long">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto0(e.target.checked, setAuto)}
          />
          Auto-trade
        </label>
        <button
          type="button"
          className="chart-tool-btn"
          disabled={busy || rl.status === 'training'}
          onClick={() => void train()}
        >
          {rl.status === 'training' || busy
            ? rl.progress && rl.progress.of > 1
              ? 'Training ' + (rl.progress.epoch + 1) + '/' + rl.progress.of
              : 'Training…'
            : 'Train policy'}
        </button>
      </div>

      <div className="tl-note">
        The policy opens a simulated long when it reads long, sets take-profit and stop-loss from
        the volatility at entry, and watches every price tick for one of them to hit. Each close is
        fed straight back in as a fine-tune, so the next decision is made by weights that have seen
        that outcome. Fills are simulated against real prices — nothing here places an order.
      </div>

      <div className="tl-stats">
        <div>
          <small>Closed trades</small>
          <b>{stats.count}</b>
        </div>
        <div>
          <small>Win rate</small>
          <b className={stats.winRate >= 0.5 ? 'up' : 'dn'}>
            {stats.count ? (stats.winRate * 100).toFixed(0) + '%' : '—'}
          </b>
          <i>{stats.count ? stats.wins + ' TP / ' + (stats.count - stats.wins) + ' SL' : ''}</i>
        </div>
        <div>
          <small>Compound return</small>
          <b className={stats.totalReturn >= 0 ? 'up' : 'dn'}>
            {stats.count ? pct(stats.totalReturn) : '—'}
          </b>
        </div>
        <div>
          <small>Average trade</small>
          <b className={stats.avgReturn >= 0 ? 'up' : 'dn'}>
            {stats.count ? pct(stats.avgReturn) : '—'}
          </b>
        </div>
        <div>
          <small>Learned from</small>
          <b>{learned}</b>
          <i>{rl.learnEvents} fine-tunes</i>
        </div>
      </div>

      {open.length > 0 && open.map((t) => <OpenRow key={t.id} t={t} now={now} />)}

      {closed.length === 0 ? (
        <div className="tl-empty">
          {open.length
            ? 'First position is open — it will appear here once TP or SL is hit.'
            : auto
              ? 'No trades yet. The policy opens one when it reads long on the charted market; train it above if it has not been trained for this symbol.'
              : 'Auto-trade is off, so the policy is only advising, not taking positions. Turn it on above to let it trade and learn from the results.'}
        </div>
      ) : (
        <div className="tl-scroll">
          <table className="tl-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Opened</th>
                <th className="tl-num">Entry</th>
                <th className="tl-num">TP</th>
                <th className="tl-num">SL</th>
                <th className="tl-num">Exit</th>
                <th>Result</th>
                <th className="tl-num">P&amp;L</th>
                <th>Learned</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((t) => {
                const win = t.outcome === 'tp'
                const meta = coinMeta(t.symbol)
                return (
                  <tr key={t.id}>
                    <td>
                      {meta.icon} {meta.sym || t.symbol}
                      <span className="tl-tf">{t.tf}</span>
                    </td>
                    <td className="tl-dim">{ago(t.openedAt, now)} ago</td>
                    <td className="tl-num">{pfmt(t.entry)}</td>
                    <td className="tl-num up">{pfmt(t.tp)}</td>
                    <td className="tl-num dn">{pfmt(t.sl)}</td>
                    <td className="tl-num">{t.exitPrice != null ? pfmt(t.exitPrice) : '—'}</td>
                    <td>
                      <span className={'tl-tag ' + (win ? 'win' : 'loss')}>
                        {win ? 'TP hit' : 'SL hit'}
                      </span>
                    </td>
                    <td className={'tl-num ' + (win ? 'up' : 'dn')}>{pct(t.pnlPct ?? 0)}</td>
                    <td className="tl-dim">{t.learnedFrom ? '✓' : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Keeps the checkbox and the store in step without a stale closure. */
function setAuto0(v: boolean, setLocal: (b: boolean) => void): void {
  setAutoTrade(v)
  setLocal(v)
}
