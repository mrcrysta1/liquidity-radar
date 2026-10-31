// Bar-replay transport for the price-action chart. The toolbar button arms
// replay; the bar below the chart scrubs it and holds the paper-trading
// panel (features/charts/paperSession), as TradingView's replay does.
import { useEffect, useState } from 'react'
import { chartZone, fmtChartDate, tzOffsetMinutes } from '../../features/charts/timezone'
import { fmt, pfmt } from '../../utils/format'
import { showToast } from '../../utils/dom'
import {
  SPEEDS,
  STEP_SIZES,
  exitReplay,
  playPause,
  randomBar,
  replayInfo,
  restart,
  seek,
  selectDateLoading,
  setSpeed,
  setStepBars,
  setUpdateInterval,
  startSelect,
  stepBy,
  subscribeReplay,
  toggleReplay,
  updateIntervals,
} from '../../features/charts/replay'
import {
  cancelAllOrders,
  cancelOrder,
  canTrade,
  orderTicket,
  paperBook,
  paperBuy,
  paperFlatten,
  paperQty,
  paperSell,
  paperSummary,
  resetPaper,
  setPaperQty,
  setPickingPrice,
  setTicketPrice,
  setTicketType,
  subscribePaper,
  workingOrders,
} from '../../features/charts/paperSession'
import type { OrderType } from '../../features/charts/paperTrading'

function useReplay() {
  const [, force] = useState(0)
  useEffect(() => subscribeReplay(() => force((n) => n + 1)), [])
  return replayInfo()
}

function usePaper() {
  const [, force] = useState(0)
  useEffect(() => subscribePaper(() => force((n) => n + 1)), [])
  return {
    book: paperBook(),
    sum: paperSummary(),
    can: canTrade(),
    qty: paperQty(),
    ticket: orderTicket(),
    orders: workingOrders(),
  }
}

/** A date-input value (YYYY-MM-DD) as midnight in the chart's time zone. */
function dateInZone(v: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return NaN
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return wall - tzOffsetMinutes(chartZone(), wall) * 60000
}

const signed = (n: number): string => (n > 0 ? '+' : n < 0 ? '−' : '') + pfmt(Math.abs(n))
const pnlClass = (n: number): string => (n > 0 ? 'up' : n < 0 ? 'dn' : '')
const size = (n: number): number => Number(Math.abs(n).toPrecision(6))
const stampOf = (t: number): string =>
  fmtChartDate(t, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Toolbar button — sits at the right of the chart's top toolbar. */
export function ReplayButton() {
  const r = useReplay()
  return (
    <button
      type="button"
      className={'chart-tool-btn tvb-icon replay-btn' + (r.on ? ' on' : '')}
      aria-pressed={r.on}
      aria-label={r.on ? 'Exit bar replay' : 'Bar replay'}
      onClick={toggleReplay}
    >
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
        <path
          d="M11 5 4 12l7 7M20 5l-7 7 7 7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="tvb-tip">{r.on ? 'Exit bar replay' : 'Bar replay'}</span>
    </button>
  )
}

function Icon({ d, filled }: { d: string; filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d={d}
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={filled ? 0.6 : 2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const PLAY = 'M8 5.5 18.5 12 8 18.5Z'
const PAUSE = 'M9 5.5h2.6v13H9zM12.9 5.5h2.6v13h-2.6z'

/** Where replay starts: pick a bar on the chart, a date, or a random bar. */
function ReplayStart({ selecting }: { selecting: boolean }) {
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const go = (v: string) => {
    setDate(v)
    const t = dateInZone(v)
    if (!Number.isFinite(t)) return
    // A date before the loaded bars pages older history in to reach it;
    // past what can be loaded, say so rather than silently clamp.
    selectDateLoading(t, () => {
      setBusy(true)
      showToast('Loading older history…')
    })
      .then((ok) => {
        if (!ok) showToast('That date is outside the available history — replay starts at the nearest bar')
      })
      .finally(() => setBusy(false))
  }
  return (
    <div className="replay-start">
      <button
        type="button"
        className={'replay-pick' + (selecting ? ' on' : '')}
        onClick={startSelect}
        aria-pressed={selecting}
        title="Select bar: click the chart where replay should start"
      >
        <Icon d="M12 3v18M5 8h4M5 12h4M5 16h4" />
        <span>Select bar</span>
      </button>
      <input
        type="date"
        className="replay-date"
        value={date}
        disabled={busy}
        onChange={(e) => go(e.target.value)}
        aria-label="Start replay from date"
        title="Select date"
      />
      <button type="button" className="replay-pick" onClick={randomBar} title="Start from a random bar">
        <Icon d="M4 7h3l10 10h3M4 17h3l3-3M14 10l3-3h3M18 4l2 3-2 3M18 14l2 3-2 3" />
        <span>Random</span>
      </button>
    </div>
  )
}

/** Paper trading at the replay bar's close: orders, position, P&L, trade list. */
function ReplayTrade() {
  const { book, sum, can, qty, ticket, orders } = usePaper()
  const [qtyText, setQtyText] = useState(String(qty))
  const [pxText, setPxText] = useState('')
  const pos = book.pos
  const pending = ticket.type !== 'market'
  // The price box follows the ticket (a chart pick) unless it is being typed in.
  const pxShown = pxText !== '' && Number(pxText) === ticket.price ? pxText : ticket.price ? String(ticket.price) : ''
  return (
    <div className="replay-trade" role="group" aria-label="Paper trading">
      <div className="replay-orders">
        <input
          className="replay-qty"
          type="number"
          min={0}
          step="any"
          value={qtyText}
          onChange={(e) => {
            setQtyText(e.target.value)
            setPaperQty(Number(e.target.value))
          }}
          aria-label="Order quantity"
          title="Quantity"
        />
        <select
          className="replay-otype"
          value={ticket.type}
          onChange={(e) => setTicketType(e.target.value as 'market' | OrderType)}
          aria-label="Order type"
          title="Order type"
        >
          <option value="market">Market</option>
          <option value="limit">Limit</option>
          <option value="stop">Stop</option>
        </select>
        {pending && (
          <>
            <input
              className="replay-qty replay-px"
              type="number"
              min={0}
              step="any"
              value={pxShown}
              onChange={(e) => {
                setPxText(e.target.value)
                setTicketPrice(Number(e.target.value))
              }}
              aria-label="Order price"
              title="Order price"
            />
            <button
              type="button"
              className={'replay-pickpx' + (ticket.picking ? ' on' : '')}
              disabled={!can}
              aria-pressed={ticket.picking}
              onClick={() => setPickingPrice(!ticket.picking)}
              title="Trade from chart: click the chart to set the order price"
            >
              <Icon d="M12 3v4M12 17v4M3 12h4M17 12h4M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />
            </button>
          </>
        )}
        <button type="button" className="replay-buy" disabled={!can} onClick={paperBuy}>
          Buy
        </button>
        <button type="button" className="replay-sell" disabled={!can} onClick={paperSell}>
          Sell
        </button>
        <button
          type="button"
          className="replay-flat"
          disabled={!can || pos === 0}
          onClick={paperFlatten}
        >
          Flatten
        </button>
      </div>
      {orders.length > 0 && (
        <div className="replay-working" aria-label="Working orders">
          {orders.map((o) => (
            <span key={o.id} className={'replay-order ' + (o.side === 'buy' ? 'up' : 'dn')}>
              {(o.side === 'buy' ? 'Buy ' : 'Sell ') + o.type + ' ' + size(o.qty) + ' @ ' + pfmt(o.price)}
              <button type="button" onClick={() => cancelOrder(o.id)} aria-label="Cancel order" title="Cancel">
                ×
              </button>
            </span>
          ))}
          {orders.length > 1 && (
            <button type="button" className="replay-reset" onClick={cancelAllOrders}>
              Cancel all
            </button>
          )}
        </div>
      )}
      <div className="replay-pnl">
        <span>
          Pos{' '}
          <b className={pnlClass(pos)}>
            {pos === 0 ? 'Flat' : (pos > 0 ? 'Long ' : 'Short ') + size(pos)}
          </b>
          {pos !== 0 && <small> @ {pfmt(book.avg)}</small>}
        </span>
        <span>
          Open <b className={pnlClass(sum.unrealized)}>{signed(sum.unrealized)}</b>
        </span>
        <span>
          Realised <b className={pnlClass(sum.realized)}>{signed(sum.realized)}</b>
        </span>
        <span>
          Net <b className={pnlClass(sum.net)}>{signed(sum.net)}</b>
        </span>
      </div>
      <details className="replay-trades">
        <summary>
          {sum.trades} trade{sum.trades === 1 ? '' : 's'} · win {fmt(sum.winRate * 100, 0)}%
        </summary>
        <div className="replay-sum">
          <span>
            Won <b className="up">{sum.wins}</b>
          </span>
          <span>
            Lost <b className="dn">{sum.losses}</b>
          </span>
          <span>
            Best <b className={pnlClass(sum.best)}>{signed(sum.best)}</b>
          </span>
          <span>
            Worst <b className={pnlClass(sum.worst)}>{signed(sum.worst)}</b>
          </span>
          <button type="button" className="replay-reset" onClick={resetPaper}>
            Reset
          </button>
        </div>
        {book.trades.length > 0 && (
          <table className="replay-list">
            <thead>
              <tr>
                <th>Side</th>
                <th>Qty</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Closed</th>
                <th>P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {/* Newest first, like the order history it mirrors. */}
              {book.trades
                .map((tr, i) => (
                  <tr key={i}>
                    <td className={tr.side === 'long' ? 'up' : 'dn'}>
                      {tr.side === 'long' ? 'Long' : 'Short'}
                    </td>
                    <td>{size(tr.qty)}</td>
                    <td>{pfmt(tr.entry)}</td>
                    <td>{pfmt(tr.exit)}</td>
                    <td>{stampOf(tr.exitT)}</td>
                    <td className={pnlClass(tr.pnl)}>{signed(tr.pnl)}</td>
                  </tr>
                ))
                .reverse()}
            </tbody>
          </table>
        )}
      </details>
    </div>
  )
}

/** The transport itself — rendered under the chart, only while replay is on. */
export function ReplayBar() {
  const r = useReplay()
  if (!r.on) return null

  // Picking the start bar: the chart shows every bar with a cut line under
  // the cursor (features/charts/replayOverlay); the transport waits.
  if (r.selecting) {
    return (
      <div className="replay-bar selecting" role="group" aria-label="Bar replay">
        <span className="replay-hint">Click a bar on the chart to start replay, or</span>
        <ReplayStart selecting />
        <button type="button" className="replay-exit" onClick={exitReplay}>
          Exit
        </button>
      </div>
    )
  }

  const stamp = r.at ? stampOf(r.at.t) : '—'
  const done = r.idx >= r.total
  const n = r.stepBars
  const ups = updateIntervals()
  const unit = r.sub ? r.sub + ' step' : 'bar'

  return (
    <div className="replay-bar" role="group" aria-label="Bar replay">
      <div className="replay-transport">
        <button type="button" title="Back to start" onClick={restart} aria-label="Back to start">
          <Icon d="M7 5.5v13M18.5 5.5 9.5 12l9 6.5Z" />
        </button>
        <button
          type="button"
          title={n === 1 ? 'Step back' : 'Step back ' + n + ' ' + unit + 's'}
          onClick={() => stepBy(-1)}
          aria-label="Step back"
        >
          <Icon d="M15.5 5.5 6.5 12l9 6.5Z" />
        </button>
        <button
          type="button"
          className={'replay-play' + (r.playing ? ' on' : '')}
          onClick={playPause}
          title={r.playing ? 'Pause' : done ? 'Replay from the middle' : 'Play'}
          aria-label={r.playing ? 'Pause' : 'Play'}
        >
          <Icon d={r.playing ? PAUSE : PLAY} filled />
        </button>
        <button
          type="button"
          title={n === 1 ? 'Step forward' : 'Step forward ' + n + ' ' + unit + 's'}
          onClick={() => stepBy(1)}
          aria-label="Step forward"
        >
          <Icon d="M8.5 5.5 17.5 12l-9 6.5Z" />
        </button>
      </div>

      <input
        className="replay-scrub"
        type="range"
        min={1}
        max={Math.max(1, r.total)}
        value={r.idx}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Replay position"
      />

      <div className="replay-meta">
        <span className="replay-at">{stamp}</span>
        <span className="replay-count">
          {r.idx}/{r.total}
        </span>
      </div>

      <select
        className="replay-speed"
        value={r.speed}
        onChange={(e) => setSpeed(Number(e.target.value))}
        aria-label="Replay speed"
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>

      <select
        className="replay-speed"
        value={n}
        onChange={(e) => setStepBars(Number(e.target.value))}
        aria-label="Bars per step"
        title={r.sub ? 'Update-interval steps per press' : 'Bars per step'}
      >
        {STEP_SIZES.map((k) => (
          <option key={k} value={k}>
            {k} {r.sub ? '×' + r.sub : 'bar' + (k === 1 ? '' : 's')}
          </option>
        ))}
      </select>

      {ups.length > 0 && (
        <select
          className="replay-speed replay-upd"
          value={r.sub}
          onChange={(e) => setUpdateInterval(e.target.value)}
          aria-label="Update interval"
          title="Update interval: how much of the bar in progress each step reveals"
        >
          <option value="">Per bar</option>
          {ups.map((id) => (
            <option key={id} value={id}>
              Update {id}
            </option>
          ))}
        </select>
      )}
      {r.loading && <span className="replay-loading">Loading…</span>}

      <ReplayStart selecting={false} />

      <button type="button" className="replay-exit" onClick={exitReplay}>
        Exit
      </button>

      <ReplayTrade />
    </div>
  )
}
