// Coin picker for the price-action chart: the current pair with its live price
// on the trigger, and a searchable list of every tracked coin underneath.
// The engine still owns the hidden <select id="symSelect"> (it fills it at
// boot and updates it on every symbol change); this reads the same state and
// switches through the same setSymbol.
import { useEffect, useMemo, useRef, useState } from 'react'
import { COINS } from '../../constants/market'
import { state } from '../../services/store'
import { baseOf, coinMeta } from '../../utils/coins'
import { pfmt } from '../../utils/format'
import { setSymbol } from '../../features/actions/userActions'
import { CHART_TABS, useTick } from '../useTick'

type Row = { key: string; sym: string; name: string; icon: string; color: string }

const ROWS: Row[] = Object.keys(COINS).map((k) => ({
  key: k,
  sym: COINS[k].sym,
  name: COINS[k].name,
  icon: COINS[k].icon,
  color: COINS[k].color,
}))

function Chg({ pct }: { pct: number | undefined }) {
  if (pct == null || !isFinite(pct)) return <span className="cp-chg">—</span>
  return (
    <span className={'cp-chg ' + (pct > 0 ? 'up' : pct < 0 ? 'dn' : '')}>
      {(pct > 0 ? '+' : '') + pct.toFixed(2)}%
    </span>
  )
}

function CoinIcon({ icon, color }: { icon: string; color: string }) {
  return (
    <span className="cp-ico" style={{ color, borderColor: color + '66', background: color + '1f' }}>
      {icon}
    </span>
  )
}

export function CoinPicker() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // The engine mutates `state` imperatively (symbol, tickers), so poll it —
  // the same approach the chart side panel takes.
  useTick(open ? 1000 : 1500, CHART_TABS)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Capture phase, so the engine's global Escape (which exits full screen)
      // does not also fire.
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('keydown', onEsc, true)
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onEsc, true)
    }
  }, [open])

  const q = query
    .trim()
    .toUpperCase()
    .replace(/\/?USDT$/, '')
  const rows = useMemo(
    () => (!q ? ROWS : ROWS.filter((r) => r.key.includes(q) || r.name.toUpperCase().includes(q))),
    [q],
  )
  // A pair that is not in the tracked list can still be opened by ticker.
  const custom =
    q && /^[A-Z0-9]{2,12}$/.test(q) && !ROWS.some((r) => r.key === q) ? q + 'USDT' : null
  const total = rows.length + (custom ? 1 : 0)

  const pick = (sym: string) => {
    setOpen(false)
    setQuery('')
    setHi(0)
    void setSymbol(sym)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The engine's global key handler owns the letter shortcuts.
    e.stopPropagation()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = total ? (hi + (e.key === 'ArrowDown' ? 1 : -1) + total) % total : 0
      setHi(n)
      listRef.current?.querySelectorAll('.cp-row')[n]?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const r = rows[hi]
      if (r) pick(r.sym)
      else if (custom) pick(custom)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const cur = state.symbol
  const meta = coinMeta(cur)
  const t = state.tickers[cur]

  return (
    <div className={'coin-picker' + (open ? ' open' : '')} ref={wrapRef}>
      <button
        type="button"
        className="cp-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={'Symbol: ' + baseOf(cur) + ' — change'}
        onClick={() => setOpen((o) => !o)}
      >
        <CoinIcon icon={meta.icon} color={meta.color} />
        <span className="cp-id">
          <b>
            {baseOf(cur)}
            <i>/USDT</i>
          </b>
          <small>{meta.name}</small>
        </span>
        <span className="cp-quote">
          <b>{t ? pfmt(t.last) : '—'}</b>
          <Chg pct={t?.pct} />
        </span>
        <svg viewBox="0 0 24 24" width="11" height="11" className="cp-caret" aria-hidden="true">
          <path
            d="m6 9 6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="cp-menu" onKeyDown={onKeyDown}>
          <div className="cp-search-wrap">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path
                d="m16 16 4.5 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <input
              ref={inputRef}
              className="cp-search"
              type="text"
              placeholder="Search coin or ticker…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHi(0)
              }}
              aria-label="Search coins"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                className="cp-clear"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
              >
                ✕
              </button>
            )}
          </div>
          <div className="cp-list" role="listbox" aria-label="Coins" ref={listRef}>
            {rows.map((r, i) => {
              const rt = state.tickers[r.sym]
              const sel = r.sym === cur
              return (
                <button
                  key={r.sym}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  className={'cp-row' + (sel ? ' sel' : '') + (i === hi ? ' hi' : '')}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(r.sym)}
                >
                  <CoinIcon icon={r.icon} color={r.color} />
                  <span className="cp-id">
                    <b>
                      {r.key}
                      <i>/USDT</i>
                    </b>
                    <small>{r.name}</small>
                  </span>
                  <span className="cp-quote">
                    <b>{rt ? pfmt(rt.last) : '—'}</b>
                    <Chg pct={rt?.pct} />
                  </span>
                </button>
              )
            })}
            {custom && (
              <button
                type="button"
                role="option"
                aria-selected={false}
                className={'cp-row cp-custom' + (hi === rows.length ? ' hi' : '')}
                onMouseEnter={() => setHi(rows.length)}
                onClick={() => pick(custom)}
              >
                <span className="cp-ico">＋</span>
                <span className="cp-id">
                  <b>
                    {q}
                    <i>/USDT</i>
                  </b>
                  <small>Open this pair</small>
                </span>
              </button>
            )}
            {!total && <div className="cp-empty">No coins match “{query}”.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
