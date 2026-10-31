// The coin picker: the one way to search for and select a market anywhere in
// the app — the chart, the header search, Analysis, Signals, Alerts, the
// Backtest Lab and every chart panel. Its list comes from features/markets/
// catalog (tracked coins, every Binance USDT pair, gold and the other
// instruments, and Yahoo's directory), so every picker finds the same markets
// and shows them the same way.
//
// Without `onPick` it drives the main chart: the trigger shows the charted
// pair and a pick goes through setSymbol (the engine still owns the hidden
// <select id="symSelect"> and keeps it in step). With `onPick` it hands the
// chosen symbol back instead, and `value` is what the trigger shows.
//
// CoinMenu is the search box and list on their own, for a container that
// supplies its own button (the header search).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { state } from '../../services/store'
import { loadExchangeInfo } from '../../services/symbolIndex'
import { yahooSearch } from '../../services/yahoo'
import type { YahooHit } from '../../services/yahoo'
import { pfmt } from '../../utils/format'
import { setSymbol } from '../../features/actions/userActions'
import { CHART_TABS, useTick } from '../useTick'
import { symOf, toggleFavorite, useFavorites } from '../../features/favorites/favorites'
import { commitMarket, marketRow, remoteMarket, searchMarkets } from '../../features/markets/catalog'
import type { MarketRow } from '../../features/markets/catalog'
import { parseSynthetic } from '../../services/syntheticSymbol'
import { isInstrument } from '../../constants/instruments'

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

/** Ticker, quote and name, as on every row and trigger. */
function CoinId({ r, name = true }: { r: MarketRow; name?: boolean }) {
  return (
    <span className="cp-id">
      <b>
        {r.ticker}
        {r.quote && <i>/{r.quote}</i>}
      </b>
      {name && <small>{r.name}</small>}
    </span>
  )
}

function Quote({ sym }: { sym: string }) {
  const t = state.tickers[sym]
  return (
    <span className="cp-quote">
      <b>{t ? pfmt(t.last) : '—'}</b>
      <Chg pct={t?.pct} />
    </span>
  )
}

export interface CoinMenuProps {
  /** Highlighted as the current choice. */
  value?: string
  onPick: (sym: string, row: MarketRow) => void
  onClose: () => void
  /** A fixed list of symbols: no search beyond it, no favourites. */
  markets?: readonly string[]
  /** Binance crypto pairs only. */
  cryptoOnly?: boolean
  /**
   * Offer a typed ratio / spread (BTCUSDT/ETHUSDT, BTCUSDT-ETHUSDT, BTCUSDT*2)
   * as a market. Only for callers that load bars through services/marketData
   * (the main chart, compare lines); the layout's other cells stream directly.
   */
  allowSynthetic?: boolean
  placeholder?: string
  /** Id for the search box (the header's is #coinSearch, for the "/" key). */
  inputId?: string
  className?: string
  style?: CSSProperties
  menuRef?: React.Ref<HTMLDivElement>
}

export function CoinMenu({
  value,
  onPick,
  onClose,
  markets,
  cryptoOnly = false,
  allowSynthetic = false,
  placeholder = 'Search coin, gold, forex, stock…',
  inputId,
  className = '',
  style,
  menuRef,
}: CoinMenuProps) {
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const [, setLoaded] = useState(0)
  const [remote, setRemote] = useState<YahooHit[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const favs = useFavorites()
  const fixed = !!markets
  const wide = !fixed && !cryptoOnly

  useEffect(() => {
    // A frame later: a floating menu is hidden until it has been positioned,
    // and a hidden input cannot take focus.
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    if (!fixed) void loadExchangeInfo().then(() => setLoaded((n) => n + 1))
    return () => cancelAnimationFrame(id)
  }, [fixed])

  const q = query.trim()

  // Yahoo's directory, for anything outside the curated tables. Debounced, and
  // kept after the local rows so a late answer never moves a row under the pointer.
  useEffect(() => {
    if (!wide) return
    let dead = false
    const id = window.setTimeout(() => {
      if (dead) return
      if (q.length < 2) return setRemote([])
      void yahooSearch(q.toLowerCase(), 6).then((hits) => {
        if (!dead) setRemote(hits)
      })
    }, 260)
    return () => {
      dead = true
      clearTimeout(id)
    }
  }, [q, wide])

  const rows = useMemo(() => {
    let list: MarketRow[]
    if (markets) {
      const all = markets.map(marketRow)
      const lq = q.toLowerCase()
      list = lq
        ? all.filter((r) => r.ticker.toLowerCase().includes(lq) || r.name.toLowerCase().includes(lq))
        : all
    } else {
      list = searchMarkets(q, { cryptoOnly })
      if (wide && q.length >= 2) {
        const have = new Set(list.map((r) => r.ticker.toUpperCase()))
        for (const h of remote) if (!have.has(h.yahoo.toUpperCase())) list.push(remoteMarket(h))
      }
    }
    if (fixed || q) return list
    // Starred markets first, in the order they were starred.
    const fav = favs
      .map((b) => list.find((r) => r.fav === b) ?? marketRow(symOf(b)))
      .filter((r) => !cryptoOnly || r.kind === 'crypto')
    return fav.concat(list.filter((r) => !r.fav || !favs.includes(r.fav)))
  }, [q, markets, cryptoOnly, wide, remote, favs, fixed])

  // A ticker not in any list can still be opened as a Binance pair.
  const up = q.toUpperCase().replace(/\/?USDT$/, '')
  const custom =
    !fixed && /^[A-Z0-9]{2,12}$/.test(up) && !rows.some((r) => r.ticker === up) ? up + 'USDT' : null
  const synth = allowSynthetic && !fixed ? parseSynthetic(q, isInstrument) : null
  // The expression goes first: anything the search matched is a fragment of it.
  const shown = synth ? [marketRow(synth.expr), ...rows] : rows
  const total = shown.length + (custom ? 1 : 0)

  const pick = (r: MarketRow) => onPick(commitMarket(r), r)

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
      const r = shown[hi]
      if (r) pick(r)
      else if (custom) pick(marketRow(custom))
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className={'cp-menu ' + className} style={style} ref={menuRef} onKeyDown={onKeyDown}>
      <div className="cp-search-wrap">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          id={inputId}
          className="cp-search"
          type="text"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setHi(0)
          }}
          aria-label="Search markets"
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
      <div className="cp-list" role="listbox" aria-label="Markets" ref={listRef}>
        {shown.map((r, i) => {
          const sel = r.sym === value
          const fav = !fixed && !!r.fav && favs.includes(r.fav)
          const prevFav = i > 0 && !!shown[i - 1].fav && favs.includes(shown[i - 1].fav!)
          return (
            <div key={r.kind + ':' + r.sym} className="cp-rowwrap">
              {!q && !fixed && i === 0 && fav && <div className="cp-group">★ Favorites</div>}
              {!q && !fixed && !fav && prevFav && <div className="cp-group">All markets</div>}
              <button
                type="button"
                role="option"
                aria-selected={sel}
                className={'cp-row' + (sel ? ' sel' : '') + (i === hi ? ' hi' : '')}
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(r)}
              >
                <CoinIcon icon={r.icon} color={r.color} />
                <CoinId r={r} />
                {r.tag && <span className="cp-tag">{r.tag}</span>}
                <Quote sym={r.priceSym} />
              </button>
              {!fixed && r.fav && (
                <button
                  type="button"
                  className={'cp-star' + (fav ? ' on' : '')}
                  aria-pressed={fav}
                  aria-label={(fav ? 'Remove ' : 'Add ') + r.ticker + (fav ? ' from' : ' to') + ' favorites'}
                  title={fav ? 'Remove from favorites' : 'Add to favorites'}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(r.fav!)
                  }}
                >
                  {fav ? '★' : '☆'}
                </button>
              )}
            </div>
          )
        })}
        {custom && (
          <button
            type="button"
            role="option"
            aria-selected={false}
            className={'cp-row cp-custom' + (hi === shown.length ? ' hi' : '')}
            onMouseEnter={() => setHi(shown.length)}
            onClick={() => pick(marketRow(custom))}
          >
            <span className="cp-ico">＋</span>
            <span className="cp-id">
              <b>
                {up}
                <i>/USDT</i>
              </b>
              <small>Open this pair</small>
            </span>
          </button>
        )}
        {!total && <div className="cp-empty">Nothing matches “{query}”.</div>}
      </div>
    </div>
  )
}

export function CoinPicker({
  value,
  onPick,
  trigger,
  tabs = CHART_TABS,
  markets,
  cryptoOnly,
  compact = false,
  float = false,
  label = 'Symbol',
  className = '',
  keepTab = false,
  allowSynthetic,
}: {
  /** The selected symbol; defaults to the charted one. */
  value?: string
  /** Switch the chart without bringing up the Radar tab (the chart toolbar). */
  keepTab?: boolean
  /** Called with the chosen symbol instead of switching the chart to it. */
  onPick?: (sym: string, base: string) => void
  /** Button content; defaults to the selected market and its price. */
  trigger?: ReactNode
  /** Tabs the picker is shown on (it only re-renders while one is open); null = always. */
  tabs?: readonly string[] | null
  /** A fixed list of symbols to choose from. */
  markets?: readonly string[]
  /** Binance crypto pairs only. */
  cryptoOnly?: boolean
  /** Offer typed ratio / spread expressions; defaults to on for the main chart. */
  allowSynthetic?: boolean
  /** Small trigger: icon and ticker only. */
  compact?: boolean
  /** Float the menu over the page — for containers that clip (chart panels, modals). */
  float?: boolean
  label?: string
  className?: string
} = {}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // The engine mutates `state` imperatively (symbol, tickers), so poll it —
  // the same approach the chart side panel takes.
  useTick(open ? 1000 : 1500, tabs)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!wrapRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
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

  // A floating menu sits (position: fixed) under its button, kept on screen,
  // and opens upwards when there is no room below.
  useLayoutEffect(() => {
    if (!open || !float) return
    const place = (e?: Event) => {
      // Scrolling the menu's own list does not move its anchor.
      if (e && menuRef.current?.contains(e.target as Node)) return
      const r = wrapRef.current?.getBoundingClientRect()
      if (!r) return
      const width = Math.min(360, window.innerWidth - 24)
      const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12))
      const below = window.innerHeight - r.bottom
      setPos(
        below < 320 && r.top > below
          ? { left, width, bottom: window.innerHeight - r.top + 6, top: 'auto' }
          : { left, width, top: r.bottom + 6 },
      )
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, float])

  const cur = value ?? (onPick ? '' : state.symbol)
  const r = cur ? marketRow(cur) : null

  const pick = (sym: string) => {
    setOpen(false)
    if (onPick) onPick(sym, marketRow(sym).ticker)
    else void setSymbol(sym, { keepTab })
  }

  const menu = open ? (
    <CoinMenu
      value={cur}
      onPick={pick}
      onClose={() => setOpen(false)}
      markets={markets}
      cryptoOnly={cryptoOnly}
      allowSynthetic={allowSynthetic ?? (!onPick && !markets)}
      className={float ? 'cp-float' : ''}
      style={float ? pos || { visibility: 'hidden' } : undefined}
      menuRef={menuRef}
    />
  ) : null

  return (
    <div
      className={'coin-picker' + (open ? ' open' : '') + (compact ? ' compact' : '') + (className ? ' ' + className : '')}
      ref={wrapRef}
    >
      <button
        type="button"
        className="cp-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={trigger ? undefined : label + ': ' + (r ? r.ticker : 'none') + ' — change'}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger ??
          (r ? (
            <>
              <CoinIcon icon={r.icon} color={r.color} />
              <CoinId r={r} name={!compact} />
              {!compact && <Quote sym={r.priceSym} />}
            </>
          ) : (
            <span className="cp-id">
              <b>Choose market</b>
            </span>
          ))}
        <svg viewBox="0 0 24 24" width="11" height="11" className="cp-caret" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {float ? menu && createPortal(menu, document.fullscreenElement ?? document.body) : menu}
    </div>
  )
}
