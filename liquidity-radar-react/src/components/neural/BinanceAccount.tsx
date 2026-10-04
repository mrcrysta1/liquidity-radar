// The Binance Demo (testnet) futures account, mirrored: the same wallet,
// unrealized P&L, margin and available balance, positions, open orders and
// fills that the Binance panel shows. The bot (radar-worker) reads them with
// the exchange keys every 15 seconds and saves a snapshot; this only reads it.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { SERVER_BOT, loadAccount } from '../../features/selflearn/serverBot'
import type { BinanceAccount as Account } from '../../features/selflearn/serverBot'
import { pfmt } from '../../utils/format'

const usd = (v: number) => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const signed = (v: number) => (v > 0 ? '+' : '') + usd(v)
const ago = (t: number, now: number) => {
  const s = Math.max(0, Math.round((now - t) / 1000))
  return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago'
}
const panelUrl = (venue: string, sym = 'BTCUSDT') =>
  venue.includes('demo') || venue.includes('testnet') ? 'https://demo.binance.com/en/futures/' + sym : 'https://www.binance.com/en/futures/' + sym

/** `children`: extra sections (the bot's own trades and activity) shown under the fills. */
export function BinanceAccount({ children }: { children?: ReactNode }) {
  const [d, setD] = useState<{ account: Account | null; heartbeat: { t: number; mode: string; venue: string } | null } | null>(null)
  const [err, setErr] = useState('')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    const load = () =>
      loadAccount()
        .then((x) => {
          if (!alive) return
          setD(x)
          setErr('')
        })
        .catch((e) => alive && setErr(String(e)))
    void load()
    const id = setInterval(load, 15_000)
    const clock = setInterval(() => setNow(Date.now()), 5_000)
    return () => {
      alive = false
      clearInterval(id)
      clearInterval(clock)
    }
  }, [])

  if (!SERVER_BOT) return null
  const a = d?.account
  const hb = d?.heartbeat
  // The bot runs non-stop (GitHub Actions) and checks in every 15 s; a run
  // hand-over takes a minute or two, so allow plenty of slack.
  const live = !!hb && now - hb.t < 25 * 60_000
  const venue = a?.venue || hb?.venue || ''
  const demo = venue.includes('demo') || venue.includes('testnet')

  return (
    <section className="card nn-card bx" aria-label="Binance account">
      <header className="bx-head">
        <span className="bx-logo" aria-hidden="true">◆</span>
        <div>
          <h3>Binance {demo ? 'Demo' : ''} futures account</h3>
          <small>
            {live ? <b className="bx-live">● Bot connected</b> : <b className="bx-off">● Bot offline</b>}
            {a ? ' · updated ' + ago(a.t, now) : ''}
            {hb ? ' · mode ' + hb.mode : ''}
          </small>
        </div>
        {a && (
          <a className="bx-open" href={panelUrl(venue, a.positions[0]?.symbol)} target="_blank" rel="noopener noreferrer">
            Open in Binance ↗
          </a>
        )}
      </header>

      {err && <p className="nn-err">{err}</p>}
      {!a ? (
        <p className="nn-empty">
          {d ? 'No account snapshot yet. Start the bot (radar-worker: npm run bot); it reads the account every 15 seconds.' : 'Loading…'}
        </p>
      ) : (
        <>
          {!live && <p className="bx-warn">The bot has not checked in for {ago(hb ? hb.t : a.t, now).replace(' ago', '')}, so these figures may differ from Binance now. It normally runs non-stop and checks in every 15 seconds.</p>}
          <div className="bx-tiles">
            <div><small>Wallet balance</small><b>{usd(a.walletBalance)}</b></div>
            <div><small>Unrealized PNL</small><b className={a.unrealizedPnl > 0 ? 'up' : a.unrealizedPnl < 0 ? 'dn' : ''}>{signed(a.unrealizedPnl)}</b></div>
            <div><small>Margin balance</small><b>{usd(a.marginBalance)}</b></div>
            <div><small>Available</small><b>{usd(a.availableBalance)}</b></div>
          </div>

          <h4>Positions <i>{a.positions.length}</i></h4>
          {a.positions.length ? (
            <div className="nn-tbl">
              <table className="lab-table bx-table">
                <thead><tr><th>Market</th><th>Side</th><th>Size</th><th>Entry</th><th>Mark</th><th>Liq.</th><th>Margin</th><th>PNL</th></tr></thead>
                <tbody>
                  {a.positions.map((p) => (
                    <tr key={p.symbol}>
                      <td><b>{p.symbol}</b><small>{p.leverage}x</small></td>
                      <td className={p.side === 'LONG' ? 'up' : 'dn'}>{p.side === 'LONG' ? 'Long' : 'Short'}</td>
                      <td>{p.size}</td>
                      <td>{pfmt(p.entry)}</td>
                      <td>{pfmt(p.mark)}</td>
                      <td>{p.liquidation ? pfmt(p.liquidation) : '—'}</td>
                      <td>{usd(p.margin)}</td>
                      <td className={p.unrealized >= 0 ? 'up' : 'dn'}>{signed(p.unrealized)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="nn-empty">No open positions.</p>}

          <h4>Open orders <i>{a.orders.length}</i></h4>
          {a.orders.length ? (
            <div className="nn-tbl">
              <table className="lab-table bx-table">
                <thead><tr><th>Market</th><th>Type</th><th>Side</th><th>Price</th><th>Qty</th></tr></thead>
                <tbody>
                  {a.orders.map((o, i) => (
                    <tr key={i}>
                      <td><b>{o.symbol}</b></td>
                      <td>{o.type.replace(/_/g, ' ').toLowerCase()}{o.reduceOnly ? <small>reduce-only</small> : null}</td>
                      <td className={o.side === 'BUY' ? 'up' : 'dn'}>{o.side === 'BUY' ? 'Buy' : 'Sell'}</td>
                      <td>{pfmt(o.price)}</td>
                      <td>{o.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="nn-empty">No open orders.</p>}

          <h4>Recent fills <i>last 7 days</i></h4>
          {a.fills.length ? (
            <div className="nn-tbl">
              <table className="lab-table bx-table">
                <thead><tr><th>Time</th><th>Market</th><th>Side</th><th>Price</th><th>Qty</th><th>Realized</th><th>Fee</th></tr></thead>
                <tbody>
                  {a.fills.slice(0, 20).map((f, i) => (
                    <tr key={i}>
                      <td>{new Date(f.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td><b>{f.symbol}</b></td>
                      <td className={f.side === 'BUY' ? 'up' : 'dn'}>{f.side === 'BUY' ? 'Buy' : 'Sell'}</td>
                      <td>{pfmt(f.price)}</td>
                      <td>{f.qty}</td>
                      <td className={f.realizedPnl > 0 ? 'up' : f.realizedPnl < 0 ? 'dn' : ''}>{f.realizedPnl ? signed(f.realizedPnl) : '—'}</td>
                      <td>{usd(f.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="nn-empty">No fills in the last 7 days. The bot decides at each 4-hour candle close.</p>}
          {children}
          <p className="nn-note">Read from Binance by the bot with your API keys, which never reach this website. Practice money on the Demo account.</p>
        </>
      )}
    </section>
  )
}
