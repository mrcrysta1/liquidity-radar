// The chart side panel's Watchlist tab: the user's named watchlists, one at a
// time. Click a row to chart it; pin, reorder or drop coins; create, rename,
// switch and delete lists. The first list is the Favourites list every star
// in the app edits (see features/favorites).
//
// Prices come from the tracked universe (state.tickers); anything outside it
// is fetched through the alert engine's paced 24h-ticker top-up, so this
// panel never opens a stream of its own.
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { state } from '../../services/store'
import { COINS } from '../../constants/market'
import { pfmt } from '../../utils/format'
import { setSymbol } from '../../features/actions/userActions'
import { ensureTickers, liveTicker } from '../../features/alerts/alerts'
import {
  addToWatchlist,
  createWatchlist,
  deleteWatchlist,
  moveInWatchlist,
  removeFromWatchlist,
  renameWatchlist,
  setActiveWatchlist,
  symOf,
  togglePinInWatchlist,
  useWatchlists,
} from '../../features/favorites/favorites'
import { FAV_ID, MAX_NAME, activeList, orderedSymbols } from '../../features/favorites/watchlists'
import { CoinBadge } from '../common/CoinBadge'
import { Btn, ChgPill } from '../market/CoinWishlist'
import { CoinPicker } from './CoinPicker'
import { CHART_TABS } from '../useTick'

type Edit = null | 'new' | 'rename'

/** Monochrome line icons (currentColor), matching the drawing strip. Emoji
 *  rendered in full colour, ignored the theme and differed per OS. */
const ICON_PATHS = {
  plus: 'M12 5v14M5 12h14',
  pencil: 'M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  pin: 'M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7',
} as const
function Glyph({ d }: { d: keyof typeof ICON_PATHS }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        d={ICON_PATHS[d]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function WatchlistPanel() {
  const st = useWatchlists()
  const wl = activeList(st)
  const rows = orderedSymbols(wl)
  const [edit, setEdit] = useState<Edit>(null)
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Off-universe coins get their price fetched now and every 20s after
  // (the top-up itself refreshes each one at most once a minute).
  const symKey = rows.map(symOf).join(',')
  useEffect(() => {
    if (!symKey) return
    const syms = symKey.split(',')
    const run = () => {
      if (!document.hidden) ensureTickers(syms)
    }
    run()
    const id = setInterval(run, 20000)
    return () => clearInterval(id)
  }, [symKey])

  useEffect(() => {
    if (edit) inputRef.current?.focus()
  }, [edit])

  const startEdit = (kind: Edit) => {
    setName(kind === 'rename' ? wl.name : '')
    setEdit(kind)
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (edit === 'new') createWatchlist(name)
    else if (edit === 'rename') renameWatchlist(wl.id, name)
    setEdit(null)
  }
  const canDelete = wl.id !== FAV_ID && st.lists.length > 1

  return (
    <div className="cs-wl">
      {edit ? (
        <form className="cs-wl-bar" onSubmit={submit}>
          <input
            ref={inputRef}
            className="cs-wl-input"
            value={name}
            maxLength={MAX_NAME}
            placeholder={edit === 'new' ? 'New list name' : 'List name'}
            aria-label={edit === 'new' ? 'New watchlist name' : 'Rename watchlist'}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setEdit(null)
              }
            }}
          />
          <button type="submit" className="chart-tool-btn" aria-label="Save list name" title="Save">
            ✓
          </button>
          <Btn label="Cancel" onClick={() => setEdit(null)}>
            ✕
          </Btn>
        </form>
      ) : (
        <div className="cs-wl-bar">
          <select
            className="cs-wl-select"
            value={wl.id}
            aria-label="Watchlist"
            onChange={(e) => setActiveWatchlist(e.target.value)}
          >
            {st.lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.symbols.length})
              </option>
            ))}
          </select>
          <Btn label="New watchlist" onClick={() => startEdit('new')}>
            <Glyph d="plus" />
          </Btn>
          <Btn label={'Rename ' + wl.name} onClick={() => startEdit('rename')}>
            <Glyph d="pencil" />
          </Btn>
          <Btn
            label={canDelete ? 'Delete ' + wl.name : 'The Favourites list cannot be deleted'}
            disabled={!canDelete}
            onClick={() => {
              if (window.confirm('Delete the watchlist "' + wl.name + '"?')) deleteWatchlist(wl.id)
            }}
          >
            <Glyph d="trash" />
          </Btn>
        </div>
      )}

      <CoinPicker
        tabs={CHART_TABS}
        float
        className="cs-wl-add"
        onPick={(_, base) => addToWatchlist(wl.id, base)}
        trigger={
          <>
            <span className="cp-ico">
              <Glyph d="plus" />
            </span>
            <span className="cp-id">
              <b>Add coin</b>
              <small>to {wl.name}</small>
            </span>
          </>
        }
      />

      {rows.length === 0 ? (
        <div className="cs-empty">
          {wl.name} is empty. Add a coin above
          {wl.id === FAV_ID ? ', or star (★) one in any coin search.' : '.'}
        </div>
      ) : (
        <ul className="cs-wl-list" aria-label={wl.name}>
          {rows.map((b, i) => {
            const sym = symOf(b)
            const t = liveTicker(sym)
            const isPin = wl.pinned.includes(b)
            const first = i === 0 || (!isPin && wl.pinned.includes(rows[i - 1]))
            const last = i === rows.length - 1 || (isPin && !wl.pinned.includes(rows[i + 1]))
            const on = state.symbol === sym
            return (
              <li key={b} className={'cs-wl-row' + (on ? ' on' : '') + (isPin ? ' pinned' : '')}>
                <button
                  type="button"
                  className="cs-wl-main"
                  aria-current={on ? 'true' : undefined}
                  aria-label={'Chart ' + b}
                  onClick={() => void setSymbol(sym, { keepTab: true })}
                >
                  <CoinBadge sym={sym} size={22} />
                  <span className="cs-wl-id">
                    <b>{b}</b>
                    <small>{COINS[b]?.name ?? (isPin ? 'Pinned' : '')}</small>
                  </span>
                  <span className="cs-wl-q">
                    <span className="cs-wl-px">{t && t.last ? pfmt(t.last) : '—'}</span>
                    <ChgPill pct={t?.pct} />
                  </span>
                </button>
                <span className="cs-wl-acts">
                  <Btn
                    label={isPin ? 'Unpin ' + b : 'Pin ' + b + ' to the top'}
                    on={isPin}
                    onClick={() => togglePinInWatchlist(wl.id, b)}
                  >
                    <Glyph d="pin" />
                  </Btn>
                  <Btn label={'Move ' + b + ' up'} disabled={first} onClick={() => moveInWatchlist(wl.id, b, -1)}>
                    ▲
                  </Btn>
                  <Btn label={'Move ' + b + ' down'} disabled={last} onClick={() => moveInWatchlist(wl.id, b, 1)}>
                    ▼
                  </Btn>
                  <Btn label={'Remove ' + b + ' from ' + wl.name} onClick={() => removeFromWatchlist(wl.id, b)}>
                    ✕
                  </Btn>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
