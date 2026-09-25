// CoinSearchWidget — Phase 3 first componentization slice (CR-P3-004).
// React extraction of the former imperative search feature
// (src/features/search/search.ts). P0 isolated widget: the engine never writes
// into #searchResults, so it can be fully owned by React. Behavior is preserved
// 1:1: exchangeInfo preload (module-level, once per page load), type-ahead
// filtering capped at 30, live price + 24h change from state.tickers, popular
// coin (COIN_ALIASES / HOT_LIST) highlight, no-match + pair-count footer, setSymbol
// on select, outside-click close, and / focus shortcut via the preserved input id.
import { useEffect, useMemo, useRef, useState } from 'react'
import { COINS, COIN_ALIASES, HOT_LIST } from '../../constants/market'
import { ASSET_CLASS_LABEL, INSTRUMENTS, registerInstrument } from '../../constants/instruments'
import { allBinanceSymbols, loadExchangeInfo } from '../../services/symbolIndex'
import type { ExchangeSymbol } from '../../services/symbolIndex'
import { yahooSearch } from '../../services/yahoo'
import type { YahooHit } from '../../services/yahoo'
import { state } from '../../services/store'
import { setSymbol } from '../../features/actions/userActions'
import { chgCls, pfmt } from '../../utils/format'

/** One row of the dropdown, whatever kind of thing it points at. */
interface Row {
  kind: 'crypto' | 'instrument' | 'remote'
  /** What to hand setSymbol. */
  sym: string
  /** Shown on the left. */
  ticker: string
  /** Shown next to it: the pair, or the instrument's full name. */
  sub: string
  /** Small right-hand label: asset class, or the exchange for a remote hit. */
  tag?: string
  /** Present only for a directory hit, which must be registered before use. */
  hit?: YahooHit
}

/** Display names, lowercased once, keyed by ticker — so the query can be
 *  matched against "pax gold" as well as "PAXG". */
const COIN_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(COINS).map(([k, meta]) => [k, meta.name.toLowerCase()]),
)

export function CoinSearchWidget() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(-1)
  const [symbols, setSymbols] = useState<ExchangeSymbol[]>(allBinanceSymbols())
  const resultsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    loadExchangeInfo().then(() => setSymbols(allBinanceSymbols()))
  }, [])

  const q = query.trim().toLowerCase()

  // Yahoo's symbol directory, for anything outside the curated tables. Kept
  // apart from the local matches because it arrives late, and a late arrival
  // must never reorder rows already under the user's finger.
  const [remote, setRemote] = useState<YahooHit[]>([])
  useEffect(() => {
    let dead = false
    // Everything, including clearing, goes through the timer: the debounce is
    // what keeps a keystroke from firing a request, and setting state straight
    // from an effect body is both a lint error and an extra render per letter.
    const id = window.setTimeout(() => {
      if (dead) return
      if (q.length < 2) {
        setRemote([])
        return
      }
      void yahooSearch(q, 6).then((hits) => {
        if (!dead) setRemote(hits)
      })
    }, 260)
    return () => {
      dead = true
      clearTimeout(id)
    }
  }, [q])

  const matches = useMemo(() => {
    if (q.length < 1) return []
    // Match the ticker, the display name and the aliases, not just the pair
    // text — "gold" has to find both PAXG and spot gold, "ripple" has to find
    // XRP, and none of those words appear in the Binance symbol. Ranked so an
    // exact ticker beats a name that merely contains the query; without that,
    // typing "btc" buries BTCUSDT under every name holding those letters.
    const rankOf = (ticker: string, name?: string, aliases?: string[]): number => {
      const t = ticker.toLowerCase()
      if (t === q) return 0
      if (aliases && aliases.indexOf(q) !== -1) return 1
      if (t.indexOf(q) === 0) return 2
      if (name && name.indexOf(q) === 0) return 3
      if (aliases && aliases.some((a) => a.indexOf(q) === 0)) return 4
      if (t.indexOf(q) !== -1) return 5
      if (name && name.indexOf(q) !== -1) return 6
      if (aliases && aliases.some((a) => a.indexOf(q) !== -1)) return 7
      return -1
    }

    const scored: Array<{ row: Row; rank: number }> = []
    for (const s of symbols) {
      const upper = s.base.toUpperCase()
      const rank = rankOf(s.base, COIN_NAMES[upper], COIN_ALIASES[upper])
      if (rank === -1) continue
      scored.push({
        row: { kind: 'crypto', sym: s.sym, ticker: s.base, sub: s.base + '/USDT' },
        // Within a rank, a coin the app already has metadata for comes first.
        rank: rank * 3 + (COIN_NAMES[upper] ? 0 : 1),
      })
    }
    for (const inst of Object.values(INSTRUMENTS)) {
      const rank = rankOf(inst.sym, inst.name.toLowerCase(), inst.aliases)
      if (rank === -1) continue
      scored.push({
        row: { kind: 'instrument', sym: inst.sym, ticker: inst.sym, sub: inst.name, tag: ASSET_CLASS_LABEL[inst.cls] },
        rank: rank * 3,
      })
    }
    scored.sort((a, b) => a.rank - b.rank || a.row.ticker.localeCompare(b.row.ticker))
    const rows = scored.slice(0, 26).map((x) => x.row)

    // Directory hits go last, and only when not already listed above.
    const have = new Set(rows.map((r) => r.ticker.toUpperCase()))
    for (const h of remote) {
      const up = h.yahoo.toUpperCase()
      if (have.has(up) || INSTRUMENTS[up]) continue
      have.add(up)
      rows.push({ kind: 'remote', sym: h.yahoo, ticker: h.yahoo, sub: h.name, tag: h.exchange || h.kind, hit: h })
    }
    return rows.slice(0, 30)
  }, [q, symbols, remote])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.search-wrap')) {
        setOpen(false)
        setIndex(-1)
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  useEffect(() => {
    if (open && index >= 0) {
      resultsRef.current?.querySelector('.search-item.active')?.scrollIntoView({ block: 'nearest' })
    }
  }, [open, index])

  function select(row: Row) {
    // A directory hit is not in the instrument table yet, so teach the app
    // about it before switching — otherwise the symbol would be mistaken for
    // a Binance pair and every request for it would 400.
    if (row.kind === 'remote' && row.hit) {
      registerInstrument({
        sym: row.hit.yahoo,
        yahoo: row.hit.yahoo,
        name: row.hit.name,
        cls: 'stock',
        icon: '•',
        color: 'var(--primary)',
        aliases: [row.hit.name.toLowerCase()],
        dp: 2,
      })
    }
    setSymbol(row.sym)
    setQuery('')
    setOpen(false)
    setIndex(-1)
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.currentTarget.value
    setQuery(v)
    setOpen(v.trim().length >= 1)
    setIndex(-1)
  }

  function handleFocus() {
    if (q.length >= 1) setOpen(true)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (matches.length) setIndex((i) => (i + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (matches.length)
        setIndex((i) => (i < 0 ? matches.length - 1 : (i - 1 + matches.length) % matches.length))
    } else if (e.key === 'Enter') {
      if (index >= 0 && index < matches.length) select(matches[index])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setIndex(-1)
    }
  }

  return (
    <div className="search-wrap">
      <span className="search-icon">🔍</span>
      <input
        className="search-box"
        id="coinSearch"
        type="text"
        placeholder="Search any coin... (e.g. PEPE, SOL, DOGE, PEPEPE, TRUMP)"
        autoComplete="off"
        maxLength={50}
        value={query}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-label="Search coins"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={index >= 0 ? `coin-search-option-${index}` : undefined}
      />
      <div
        className={`search-results${open ? ' show' : ''}`}
        id="searchResults"
        role="listbox"
        aria-label="Coin search results"
        ref={resultsRef}
      >
        {open &&
          q.length >= 1 &&
          (matches.length ? (
            <>
              {matches.map((s, i) => {
                const t = state.tickers[s.sym]
                const price = t ? '$' + pfmt(t.last) : '\u2014'
                const chg = t ? (
                  <span className={'chg ' + chgCls(t.pct)}>
                    {(t.pct > 0 ? '+' : '') + t.pct.toFixed(2) + '%'}
                  </span>
                ) : (
                  <span className="chg flat">—</span>
                )
                const up = s.ticker.toUpperCase()
                const isPopular =
                  s.kind !== 'crypto' ||
                  Boolean(COIN_ALIASES[up]) ||
                  HOT_LIST.indexOf(up) !== -1
                const active = i === index
                return (
                  <div
                    className={'search-item' + (active ? ' active' : '')}
                    key={s.kind + ':' + s.sym}
                    data-sym={s.sym}
                    role="option"
                    id={'coin-search-option-' + i}
                    aria-selected={active}
                    style={active ? { background: 'rgb(var(--pRGB)/.1)' } : undefined}
                    onClick={() => select(s)}
                  >
                    <span
                      className="si-sym"
                      style={{ color: isPopular ? 'var(--cyan)' : 'var(--muted)' }}
                    >
                      {s.ticker}
                    </span>
                    <span className="si-name">{s.sub}</span>
                    {s.tag && <span className="si-tag">{s.tag}</span>}
                    <span className="si-price">{price}</span>
                    <span className="si-chg">{chg}</span>
                  </div>
                )
              })}
              <div className="search-count">
                {matches.length} {matches.length === 1 ? 'market' : 'markets'} found
              </div>
            </>
          ) : (
            <div className="search-count">Nothing found</div>
          ))}
      </div>
    </div>
  )
}
