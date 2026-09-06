// CoinSearchWidget — Phase 3 first componentization slice (CR-P3-004).
// React extraction of the former imperative search feature
// (src/features/search/search.ts). P0 isolated widget: the engine never writes
// into #searchResults, so it can be fully owned by React. Behavior is preserved
// 1:1: exchangeInfo preload (module-level, once per page load), type-ahead
// filtering capped at 30, live price + 24h change from state.tickers, popular
// coin (COIN_ALIASES / TOP16) highlight, no-match + pair-count footer, setSymbol
// on select, outside-click close, and / focus shortcut via the preserved input id.
import { useEffect, useMemo, useRef, useState } from 'react'
import { COIN_ALIASES, TOP16 } from '../../constants/market'
import { state } from '../../services/store'
import { setSymbol } from '../../features/actions/userActions'
import { chgCls, pfmt } from '../../utils/format'

interface RawSymbol {
  symbol: string
  status: string
  baseAsset: string
  quoteAsset: string
  filters: Array<{ filterType: string; tickSize?: string }>
}

interface SearchSymbol {
  sym: string
  base: string
  quote: string
  prec: string | undefined
}

// Module-level cache: fetched once, shared across remounts (same as before).
let allBinanceSymbols: SearchSymbol[] = []
let exchangeInfoFetch: Promise<void> | null = null

function loadExchangeInfo(): Promise<void> {
  if (!exchangeInfoFetch) {
    exchangeInfoFetch = (async () => {
      try {
        const r = await fetch('https://api.binance.com/api/v3/exchangeInfo')
        const d = (await r.json()) as { symbols: RawSymbol[] }
        allBinanceSymbols = d.symbols
          .filter((s) => s.status === 'TRADING' && s.symbol.endsWith('USDT'))
          .map((s) => {
            const pf = s.filters.find((f) => f.filterType === 'PRICE_FILTER')
            return {
              sym: s.symbol,
              base: s.baseAsset,
              quote: s.quoteAsset,
              prec: pf ? pf.tickSize : '0.01',
            }
          })
        allBinanceSymbols.sort((a, b) => a.base.localeCompare(b.base))
      } catch {
        /* silent — empty list → "No matches" path, as before */
      }
    })()
  }
  return exchangeInfoFetch
}

export function CoinSearchWidget() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(-1)
  const [symbols, setSymbols] = useState<SearchSymbol[]>(allBinanceSymbols)
  const resultsRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    loadExchangeInfo().then(() => setSymbols(allBinanceSymbols))
  }, [])

  const q = query.trim().toLowerCase()

  const matches = useMemo(() => {
    if (q.length < 1) return []
    return symbols
      .filter(
        (s) => s.base.toLowerCase().indexOf(q) !== -1 || s.sym.toLowerCase().indexOf(q) !== -1,
      )
      .slice(0, 30)
  }, [q, symbols])

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

  function select(sym: string) {
    setSymbol(sym)
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
      if (index >= 0 && index < matches.length) select(matches[index].sym)
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
                const known = COIN_ALIASES[s.base.toUpperCase()]
                const isPopular = Boolean(known) || TOP16.indexOf(s.base.toUpperCase()) !== -1
                const active = i === index
                return (
                  <div
                    className={'search-item' + (active ? ' active' : '')}
                    key={s.sym}
                    data-sym={s.sym}
                    role="option"
                    id={'coin-search-option-' + i}
                    aria-selected={active}
                    style={active ? { background: 'rgb(var(--pRGB)/.1)' } : undefined}
                    onClick={() => select(s.sym)}
                  >
                    <span
                      className="si-sym"
                      style={{ color: isPopular ? 'var(--cyan)' : 'var(--muted)' }}
                    >
                      {s.base}
                    </span>
                    <span className="si-name">{s.base}/USDT</span>
                    <span className="si-price">{price}</span>
                    <span className="si-chg">{chg}</span>
                  </div>
                )
              })}
              <div className="search-count">{matches.length} pairs found</div>
            </>
          ) : (
            <div className="search-count">No matches for &quot;{q}&quot;</div>
          ))}
      </div>
    </div>
  )
}
