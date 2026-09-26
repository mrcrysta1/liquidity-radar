// Shows the DQN's recommendation, its offline backtest, and — when paper
// trading is on — the live simulated position (if any), trade history
// stats, and how many real outcomes it has learned from. Every number here
// is either backtest-derived or from a simulated fill against real prices;
// nothing on this panel ever touches a real order.
import { useEffect, useState } from 'react'
import { state } from '../../services/store'
import {
  getAutoTrade,
  getRLState,
  onRLChange,
  setAutoTrade,
  trainRLPolicy,
} from '../../features/ml/rlStore'
import { pfmt } from '../../utils/format'
import {
  getShowRLPolicy,
  onOverlayTogglesChange,
  setShowRLPolicy,
} from '../../features/charts/overlayToggles'
import { useTick } from '../useTick'

export function RLPolicyPanel() {
  const [rl, setRl] = useState(getRLState())
  const [show, setShow] = useState(getShowRLPolicy())
  const [auto, setAuto] = useState(getAutoTrade())
  const now = useTick(2000, ['radar', 'neuralnet'])

  useEffect(() => {
    const off1 = onRLChange(() => setRl(getRLState()))
    const off2 = onOverlayTogglesChange(() => setShow(getShowRLPolicy()))
    return () => {
      off1()
      off2()
    }
  }, [])
  void now // re-render tick for the live unrealized P&L below

  if (!show) return null

  const p = rl.policy
  const edge = p ? p.backtestReturn - p.benchmarkReturn : null
  const edgeColor = edge == null ? 'var(--muted)' : edge > 0 ? 'var(--green)' : 'var(--red)'
  const livePrice = state.tickers[rl.symbol]?.last
  const uPnl =
    rl.openTrade && livePrice ? (livePrice - rl.openTrade.entry) / rl.openTrade.entry : null

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '10px 12px',
        marginBottom: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="sec-title" style={{ fontSize: 12 }}>
          RL Trading Policy (DQN)
        </span>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>
          {rl.status === 'training'
            ? 'training…'
            : rl.status === 'insufficient-data'
              ? 'not enough history to train'
              : rl.status === 'error'
                ? 'training failed'
                : rl.status === 'idle'
                  ? 'not trained yet'
                  : ''}
        </span>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            color: 'var(--muted)',
            marginLeft: 'auto',
          }}
        >
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked)
              setAutoTrade(e.target.checked)
            }}
          />
          Auto paper-trade
        </label>
        <button
          type="button"
          className="chart-tool-btn"
          disabled={rl.status === 'training'}
          onClick={() => trainRLPolicy(state.symbol, state.tf, state.candles)}
          title="Train a flat/long Q-learning policy on this symbol's recent history"
        >
          {rl.status === 'idle' ? 'Train' : 'Retrain'}
        </button>
        <button
          type="button"
          className="chart-tool-btn"
          title="Hide"
          onClick={() => setShowRLPolicy(false)}
        >
          ✕
        </button>
      </div>

      {rl.status === 'ready' && rl.action && p && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>Recommendation (from flat)</span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: rl.action.action === 'long' ? 'var(--green)' : 'var(--muted)',
              }}
            >
              {rl.action.action === 'long' ? '▲ GO LONG' : '● STAY FLAT'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              Backtest vs buy-and-hold ({p.backtestSteps} bars)
            </span>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              <span style={{ color: p.backtestReturn >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {(p.backtestReturn * 100).toFixed(1)}%
              </span>
              {' vs '}
              <span style={{ color: 'var(--muted)' }}>{(p.benchmarkReturn * 100).toFixed(1)}%</span>
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>Edge over buy-and-hold</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: edgeColor }}>
              {edge != null ? (edge >= 0 ? '+' : '') + (edge * 100).toFixed(1) + '%' : '—'}
            </span>
          </div>
        </div>
      )}

      {rl.openTrade && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '6px 8px',
            borderRadius: 6,
            background: 'rgba(0,230,118,.08)',
            border: '1px solid rgba(0,230,118,.25)',
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)' }}>
            PAPER POSITION OPEN
          </span>
          <span style={{ fontSize: 11 }}>Entry {pfmt(rl.openTrade.entry)}</span>
          <span style={{ fontSize: 11, color: 'var(--red)' }}>SL {pfmt(rl.openTrade.sl)}</span>
          <span style={{ fontSize: 11, color: 'var(--green)' }}>TP {pfmt(rl.openTrade.tp)}</span>
          {uPnl != null && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: uPnl >= 0 ? 'var(--green)' : 'var(--red)',
              }}
            >
              {uPnl >= 0 ? '+' : ''}
              {(uPnl * 100).toFixed(2)}% unrealized
            </span>
          )}
        </div>
      )}

      {rl.stats.count > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 14,
            flexWrap: 'wrap',
            fontSize: 10,
            color: 'var(--muted)',
          }}
        >
          <span>
            {rl.stats.wins}/{rl.stats.count} paper trades hit TP (
            {(rl.stats.winRate * 100).toFixed(0)}%)
          </span>
          <span>
            Compounded paper return:{' '}
            <b style={{ color: rl.stats.totalReturn >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {(rl.stats.totalReturn * 100).toFixed(1)}%
            </b>
          </span>
          {rl.learnEvents > 0 && <span>Learned from real outcomes {rl.learnEvents}×</span>}
        </div>
      )}

      <span style={{ fontSize: 10, color: 'var(--dim,var(--muted))' }}>
        Auto paper-trade simulates a position against live prices with real TP/SL — no exchange
        order is ever placed. Each simulated trade that closes (hit TP or SL) fine-tunes this policy
        on the real outcome. Not financial advice, and a policy that traded well on its own recent
        paper history is not guaranteed to keep doing so.
      </span>
    </div>
  )
}
