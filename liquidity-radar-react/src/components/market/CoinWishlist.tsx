// The Market tab's coin wishlist: the user's favourite coins in their own
// priority order, the top three called out as cards, and one coin that can be
// pinned. The pinned coin is what the Radar opens on (instead of BTC) and it
// leads the Radar and Dashboard watchlists.
//
// The list is the same favourites store the chart's coin picker stars into,
// so starring there and adding here are one and the same.
import { useState } from 'react'
import { state } from '../../services/store'
import { COINS } from '../../constants/market'
import { cfmt, pfmt } from '../../utils/format'
import { useTick } from '../useTick'
import {
  getPinned,
  moveFavorite,
  setPinned,
  symOf,
  toggleFavorite,
  useFavorites,
} from '../../features/favorites/favorites'

const w = window as unknown as { setSymbol?: (s: string) => void }
const MARKET = ['market']

type Tick = { last?: number; pct?: number; qvol?: number } | undefined
const tick = (base: string) => state.tickers[symOf(base)] as Tick
const pct = (v?: number) =>
  v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + v.toFixed(2) + '%'

function Icon({ base, size = 26 }: { base: string; size?: number }) {
  const c = COINS[base]
  const color = c?.color ?? '#93A6C4'
  const img = (state.marketCaps as Record<string, { image?: string }>)[base]?.image
  return (
    <span
      className="coin-badge"
      style={{
        width: size,
        height: size,
        color,
        borderColor: color + '66',
        background: color + '1f',
        fontSize: size * 0.5,
      }}
    >
      {img ? (
        <img src={img} alt="" width={size} height={size} loading="lazy" />
      ) : (
        (c?.icon ?? base[0])
      )}
    </span>
  )
}

function PinButton({ base, pinned }: { base: string; pinned: boolean }) {
  return (
    <button
      type="button"
      className={'cwl-pin' + (pinned ? ' on' : '')}
      aria-pressed={pinned}
      title={pinned ? 'Unpin — Radar goes back to BTC' : 'Pin — Radar always opens on ' + base}
      onClick={() => setPinned(pinned ? null : base)}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M9 3h6l-1 6 4 4H6l4-4-1-6ZM12 13v8"
          fill={pinned ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      {pinned ? 'Pinned' : 'Pin'}
    </button>
  )
}

export function CoinWishlist() {
  useTick(1500, MARKET)
  const favs = useFavorites()
  const pinned = getPinned()
  const [add, setAdd] = useState('')
  const addable = Object.keys(COINS).filter((k) => !favs.includes(k))
  const top = favs.slice(0, 3)

  return (
    <div className="card cwl">
      <div className="sec-head">
        <div className="sec-title">Coin Wishlist</div>
        <span className="badge b-cyan">
          {favs.length} {favs.length === 1 ? 'COIN' : 'COINS'}
          {pinned ? ' · ' + pinned + ' PINNED' : ''}
        </span>
      </div>

      {favs.length === 0 ? (
        <p className="cwl-empty">
          Add coins below (or star them in the chart's coin picker). Order them by priority, and pin
          one to make it the coin the Radar always opens on.
        </p>
      ) : (
        <>
          <div className="cwl-top">
            {top.map((b, i) => {
              const t = tick(b)
              return (
                <div key={b} className={'cwl-card' + (pinned === b ? ' pinned' : '')}>
                  <div className="cwl-card-head">
                    <span className="cwl-rank">#{i + 1}</span>
                    <PinButton base={b} pinned={pinned === b} />
                  </div>
                  <button
                    type="button"
                    className="cwl-card-body"
                    onClick={() => w.setSymbol?.(symOf(b))}
                  >
                    <Icon base={b} size={34} />
                    <span className="cwl-card-nm">
                      <b>{b}</b>
                      <small>{COINS[b]?.name ?? b + '/USDT'}</small>
                    </span>
                  </button>
                  <div className="cwl-card-px mono">{t?.last ? '$' + pfmt(t.last) : '—'}</div>
                  <div className={'mono ' + ((t?.pct ?? 0) >= 0 ? 'up' : 'dn')}>{pct(t?.pct)}</div>
                </div>
              )
            })}
          </div>

          <div className="table-scroll">
            <table className="coins-table cwl-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Coin</th>
                  <th>Price</th>
                  <th>24h %</th>
                  <th>Volume (24h)</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {favs.map((b, i) => {
                  const t = tick(b)
                  return (
                    <tr key={b} className={pinned === b ? 'pinned' : ''}>
                      <td>
                        <span className="cwl-order">
                          <b>{i + 1}</b>
                          <button
                            type="button"
                            aria-label={'Move ' + b + ' up'}
                            disabled={i === 0}
                            onClick={() => moveFavorite(b, -1)}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            aria-label={'Move ' + b + ' down'}
                            disabled={i === favs.length - 1}
                            onClick={() => moveFavorite(b, 1)}
                          >
                            ▼
                          </button>
                        </span>
                      </td>
                      <td>
                        <span className="cwl-coin">
                          <Icon base={b} size={22} />
                          <b>{b}</b>
                          <small>{COINS[b]?.name}</small>
                        </span>
                      </td>
                      <td className="mono">{t?.last ? '$' + pfmt(t.last) : '—'}</td>
                      <td className={'mono ' + ((t?.pct ?? 0) >= 0 ? 'up' : 'dn')}>
                        {pct(t?.pct)}
                      </td>
                      <td className="mono vol-dim">{t?.qvol ? cfmt(t.qvol) : '—'}</td>
                      <td>
                        <span className="cwl-acts">
                          <PinButton base={b} pinned={pinned === b} />
                          <button
                            type="button"
                            className="cwl-btn"
                            onClick={() => w.setSymbol?.(symOf(b))}
                          >
                            Chart
                          </button>
                          <button
                            type="button"
                            className="cwl-btn cwl-rm"
                            aria-label={'Remove ' + b}
                            title="Remove from wishlist"
                            onClick={() => toggleFavorite(b)}
                          >
                            ✕
                          </button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <form
        className="cwl-add"
        onSubmit={(e) => {
          e.preventDefault()
          if (add && !favs.includes(add)) toggleFavorite(add)
          setAdd('')
        }}
      >
        <select value={add} onChange={(e) => setAdd(e.target.value)} aria-label="Coin to add">
          <option value="">Add a coin…</option>
          {addable.map((k) => (
            <option key={k} value={k}>
              {k} — {COINS[k].name}
            </option>
          ))}
        </select>
        <button type="submit" className="cwl-btn" disabled={!add}>
          Add to wishlist
        </button>
      </form>
    </div>
  )
}
