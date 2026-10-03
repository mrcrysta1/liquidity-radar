// The Market tab's coin wishlist: the user's favourite coins in their own
// priority order, and one coin that can be
// pinned. The pinned coin is what the Radar opens on (instead of BTC) and it
// leads the Radar and Dashboard watchlists.
//
// Built from the pieces the Market tab already uses: the chart's coin picker
// to add coins (a star anywhere is the same list) and the Top Coins table.
// Rows carry `data-sym`, so the engine's
// click handler opens their chart just like the other Market tables.
import { MkIco } from './MarketHead'
import { MK_ICONS } from './mkIcons'
import type { MouseEvent, ReactNode } from 'react'
import { state } from '../../services/store'
import { COINS } from '../../constants/market'
import { cfmt, pfmt } from '../../utils/format'
import { useTick } from '../useTick'
import { CoinBadge } from '../common/CoinBadge'
import { CoinPicker } from '../chart/CoinPicker'
import {
  getPinned,
  moveFavorite,
  setPinned,
  symOf,
  toggleFavorite,
  useFavorites,
} from '../../features/favorites/favorites'

const MARKET = ['market']

type Tick = { last?: number; pct?: number; qvol?: number } | undefined
const tick = (base: string) => state.tickers[symOf(base)] as Tick

function ChgPill({ pct }: { pct?: number }) {
  if (pct == null || !isFinite(pct)) return <span className="cmc-pill flat">—</span>
  const cls = pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : 'flat'
  return <span className={'cmc-pill ' + cls}>{(pct > 0 ? '+' : '') + pct.toFixed(2)}%</span>
}

/** A button inside a clickable row: must not also open the chart. */
function Btn({
  label,
  on,
  disabled,
  onClick,
  children,
}: {
  label: string
  on?: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={'chart-tool-btn' + (on ? ' on' : '')}
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={disabled}
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
        onClick()
      }}
    >
      {children}
    </button>
  )
}

function PinBtn({ base, pinned }: { base: string; pinned: boolean }) {
  return (
    <Btn
      label={pinned ? 'Unpin ' + base : 'Pin ' + base + ' to the Radar'}
      on={pinned}
      onClick={() => setPinned(pinned ? null : base)}
    >
      📌
    </Btn>
  )
}

export function CoinWishlist() {
  useTick(1500, MARKET)
  const favs = useFavorites()
  const pinned = getPinned()

  return (
    <div className="card cwl mk-card" id="mkWatch">
      <div className="mk-head">
        <span className="mk-ico t-amber"><MkIco d={MK_ICONS.star} /></span>
        <span className="mk-ttl">
          <h3>Coin Wishlist</h3>
          <p>Your coins, in your order; the pinned one opens first on the Radar</p>
        </span>
        <span className="mk-right">
          <CoinPicker
            tabs={MARKET}
            onPick={(_, base) => {
              if (!favs.includes(base)) toggleFavorite(base)
            }}
            trigger={
              <>
                <span className="cp-ico">＋</span>
                <span className="cp-id">
                  <b>Add coin</b>
                  <small>Search or ★ any coin</small>
                </span>
              </>
            }
          />
        </span>
      </div>

      {favs.length === 0 ? (
        <div className="disclaimer">
          Your wishlist is empty. Add coins here, or star them (★) in any coin search. Order them by
          priority and pin one (📌) to make it the coin the Radar always opens on.
        </div>
      ) : (
        <div className="table-scroll">
          <table className="coins-table cmc-table">
            <thead>
              <tr>
                <th className="cmc-rank">#</th>
                <th>Coin</th>
                <th>Price</th>
                <th>24h %</th>
                <th>Volume (24h)</th>
                <th>Priority</th>
                <th aria-label="Pin and remove" />
              </tr>
            </thead>
            <tbody>
              {favs.map((b, i) => {
                const t = tick(b)
                return (
                  <tr key={b} data-sym={symOf(b)}>
                    <td className="cmc-rank">{i + 1}</td>
                    <td>
                      <div className="coin-cell">
                        <CoinBadge sym={symOf(b)} size={28} />
                        <div className="coin-nm">
                          <div className="cn">{COINS[b]?.name ?? b}</div>
                          <div className="cs">
                            {b}
                            {pinned === b ? ' · PINNED' : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="cmc-price">{t?.last ? '$' + pfmt(t.last) : '—'}</td>
                    <td>
                      <ChgPill pct={t?.pct} />
                    </td>
                    <td className="vol-dim">{t?.qvol ? cfmt(t.qvol) : '—'}</td>
                    <td>
                      <Btn
                        label={'Move ' + b + ' up'}
                        disabled={i === 0}
                        onClick={() => moveFavorite(b, -1)}
                      >
                        ▲
                      </Btn>{' '}
                      <Btn
                        label={'Move ' + b + ' down'}
                        disabled={i === favs.length - 1}
                        onClick={() => moveFavorite(b, 1)}
                      >
                        ▼
                      </Btn>
                    </td>
                    <td>
                      <PinBtn base={b} pinned={pinned === b} />{' '}
                      <Btn
                        label={'Remove ' + b + ' from wishlist'}
                        onClick={() => toggleFavorite(b)}
                      >
                        ✕
                      </Btn>
                    </td>
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
