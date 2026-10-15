// The Screener tab: every tracked crypto pair in one sortable, filterable table,
// TradingView-style. Rows come from the shared ticker poll; indicator columns
// load lazily for the rows on screen (features/screener/data). Clicking a row
// opens that coin on the Charts tab; the star adds it to the favourites.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CoinBadge } from '../common/CoinBadge'
import { Sk } from '../home/Skeleton'
import { useTick } from '../useTick'
import { getActiveTab, setSymbol, switchTab } from '../../features/actions/userActions'
import { toggleFavorite, useFavorites } from '../../features/favorites/favorites'
import { tickerFeed } from '../../services/failover'
import { cfmt, fmt, pfmt } from '../../utils/format'
import {
  buildRows,
  loadPrefs,
  requestTech,
  savePrefs,
  techStatus,
  useTechVersion,
  TECH_TOP_N,
} from '../../features/screener/data'
import {
  applyPreset,
  emaRelation,
  EMPTY_FILTERS,
  filterRows,
  needsTech,
  nextSort,
  PRESETS,
  RATING_LABEL,
  sortRows,
  type RatingFilter,
  type ScreenerFilters,
  type ScreenerPrefs,
  type ScreenerRow,
  type SortKey,
} from '../../features/screener/logic'

const TABS = ['screener'] as const

const COLS: Array<{ key: SortKey; label: string; title: string; tech?: boolean }> = [
  { key: 'sym', label: 'Symbol', title: 'Coin' },
  { key: 'price', label: 'Price', title: 'Last price (USDT)' },
  { key: 'pct', label: 'Chg %', title: '24h change, %' },
  { key: 'chg', label: 'Chg', title: '24h change, price' },
  { key: 'vol', label: 'Vol 24h', title: '24h volume (USDT)' },
  { key: 'mcap', label: 'Mkt cap', title: 'Market cap (CoinGecko, where tracked)' },
  { key: 'rsi', label: 'RSI 14', title: 'RSI(14), daily', tech: true },
  { key: 'macd', label: 'MACD', title: 'MACD(12,26,9), daily: line above (bull) or below (bear) its signal', tech: true },
  { key: 'ema', label: 'EMA 20·50·200', title: 'Price above (▲) or below (▼) the daily EMA 20, 50 and 200', tech: true },
  { key: 'atr', label: 'ATR %', title: 'Volatility: ATR(14) as % of price, daily', tech: true },
  { key: 'perf1W', label: 'Perf 1W', title: 'Performance over 7 days', tech: true },
  { key: 'perf1M', label: 'Perf 1M', title: 'Performance over 30 days', tech: true },
  { key: 'rating', label: 'Technical rating', title: 'Summary of moving-average and oscillator votes (daily)', tech: true },
]

const VOL_STEPS: Array<{ v: number; label: string }> = [
  { v: 0, label: 'Any volume' },
  { v: 1e6, label: 'Vol > $1M' },
  { v: 1e7, label: 'Vol > $10M' },
  { v: 1e8, label: 'Vol > $100M' },
  { v: 1e9, label: 'Vol > $1B' },
]

const RATING_OPTS: Array<{ v: RatingFilter; label: string }> = [
  { v: 'any', label: 'Any rating' },
  { v: 'buy_up', label: 'Buy or better' },
  { v: 'strong_buy', label: 'Strong buy' },
  { v: 'buy', label: 'Buy' },
  { v: 'neutral', label: 'Neutral' },
  { v: 'sell', label: 'Sell' },
  { v: 'strong_sell', label: 'Strong sell' },
  { v: 'sell_down', label: 'Sell or worse' },
]

const sign = (n: number) => (n > 0 ? '+' : '')
const tone = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'up' : n < 0 ? 'dn' : '')

function pctText(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : sign(n) + fmt(n, 2) + '%'
}

/** A change in price units, at the same precision as the price itself. */
function chgText(chg: number, price: number): string {
  if (!Number.isFinite(chg)) return '—'
  const d = price >= 100 ? 2 : price >= 1 ? 4 : price >= 0.01 ? 5 : price >= 0.0001 ? 6 : 8
  return sign(chg) + fmt(chg, d)
}

function numOrNull(s: string): number | null {
  if (s.trim() === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function openChart(sym: string): void {
  switchTab('multichart')
  void setSymbol(sym, { keepTab: true })
}

/** A cell that needs indicators: skeleton while loading, a dash when unavailable. */
function TechCell({
  row,
  className = '',
  children,
}: {
  row: ScreenerRow
  className?: string
  children: (t: NonNullable<ScreenerRow['tech']>) => ReactNode
}) {
  if (row.tech) return <td className={className}>{children(row.tech)}</td>
  const st = techStatus(row.sym)
  return (
    <td className={className}>
      {st === 'loading' ? <Sk w={42} h={9} /> : <span className="sc-na" title={st === 'error' ? 'Could not load daily candles' : 'Not loaded yet'}>—</span>}
    </td>
  )
}

function EmaDots({ row }: { row: ScreenerRow }) {
  const t = row.tech!
  const marks = [
    ['20', t.ema20],
    ['50', t.ema50],
    ['200', t.ema200],
  ] as const
  return (
    <span className="sc-ema">
      {marks.map(([n, v]) => {
        const rel = emaRelation(row.price, v)
        return (
          <i
            key={n}
            className={rel === 'above' ? 'up' : rel === 'below' ? 'dn' : ''}
            title={'EMA ' + n + (v == null ? ': not enough history' : ' ' + pfmt(v) + ' — price ' + rel)}
          >
            {rel === 'above' ? '▲' : rel === 'below' ? '▼' : '·'}
          </i>
        )
      })}
    </span>
  )
}

function RatingPill({ row }: { row: ScreenerRow }) {
  const t = row.tech!
  if (!t.rating) return <span className="sc-na">—</span>
  const title =
    'Moving averages: ' + t.maVotes.buy + ' buy / ' + t.maVotes.neutral + ' neutral / ' + t.maVotes.sell + ' sell · ' +
    'Oscillators: ' + t.oscVotes.buy + ' buy / ' + t.oscVotes.neutral + ' neutral / ' + t.oscVotes.sell + ' sell'
  return (
    <span className={'sc-pill ' + t.rating} title={title}>
      {RATING_LABEL[t.rating]}
    </span>
  )
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <tr key={i} className="sc-skel" aria-hidden="true">
          <td className="sc-symcol">
            <span className="sc-sym">
              <Sk w={22} h={22} round />
              <Sk w={70 + (i % 3) * 12} h={10} />
            </span>
          </td>
          {COLS.slice(1).map((c) => (
            <td key={c.key}>
              <Sk w={c.key === 'rating' ? 64 : 46} h={9} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export function Screener() {
  useTick(3000, TABS)
  useTechVersion()
  const favs = useFavorites()
  const [prefs, setPrefs] = useState<ScreenerPrefs>(loadPrefs)
  const { filters: f, sort } = prefs

  useEffect(() => savePrefs(prefs), [prefs])

  // Rebuilt on every tick: the engine mutates state.tickers in place.
  const all = buildRows()
  const shown = sortRows(filterRows(all, f), sort)

  // Which rows need indicators: the top of the list as it would be shown with
  // only the price filters, so an RSI or rating filter has values to test.
  const techFilter = needsTech(f)
  const candidates = techFilter
    ? sortRows(filterRows(all, { ...f, rsiMin: null, rsiMax: null, rating: 'any' }), sort)
    : shown
  const wantKey = candidates
    .slice(0, TECH_TOP_N)
    .map((r) => r.sym)
    .join(',')
  // No dependency list on purpose: every render (a tick, or a snapshot landing)
  // re-checks freshness; requestTech skips anything cached or already queued.
  // Nothing is fetched while another tab is open.
  useEffect(() => {
    if (wantKey && getActiveTab() === 'screener') requestTech(wantKey.split(','))
  })

  const loadedTech = all.filter((r) => r.tech).length

  const set = (patch: Partial<ScreenerFilters>) =>
    setPrefs((p) => ({ ...p, filters: { ...p.filters, ...patch }, preset: null }))
  const reset = () => setPrefs((p) => ({ ...p, filters: EMPTY_FILTERS, preset: null }))
  const filtered = JSON.stringify(f) !== JSON.stringify(EMPTY_FILTERS)

  const offline = tickerFeed.freshness === 'OFFLINE' || tickerFeed.freshness === 'STALE'
  const loading = !all.length && !offline

  return (
    <div className="card sc-card">
      <div className="sc-toolbar">
        <div className="sc-presets" role="group" aria-label="Presets">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={'sc-chip' + (prefs.preset === p.id ? ' on' : '')}
              aria-pressed={prefs.preset === p.id}
              onClick={() => setPrefs((cur) => (cur.preset === p.id ? { ...cur, filters: { ...EMPTY_FILTERS, q: cur.filters.q }, preset: null } : applyPreset(cur, p.id)))}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="sc-filters">
          <label className="sc-search">
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
              <path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              placeholder="Search coin"
              aria-label="Search coins"
              value={f.q}
              onChange={(e) => set({ q: e.target.value })}
            />
          </label>
          <select aria-label="Minimum 24h volume" value={f.minVol} onChange={(e) => set({ minVol: Number(e.target.value) })}>
            {VOL_STEPS.map((s) => (
              <option key={s.v} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
          <span className="sc-range" title="24h change, %">
            <span>Chg %</span>
            <input type="number" inputMode="decimal" aria-label="Minimum 24h change %" placeholder="min" value={f.chgMin ?? ''} onChange={(e) => set({ chgMin: numOrNull(e.target.value) })} />
            <span aria-hidden="true">–</span>
            <input type="number" inputMode="decimal" aria-label="Maximum 24h change %" placeholder="max" value={f.chgMax ?? ''} onChange={(e) => set({ chgMax: numOrNull(e.target.value) })} />
          </span>
          <span className="sc-range" title="RSI(14), daily">
            <span>RSI</span>
            <input type="number" min={0} max={100} aria-label="Minimum RSI" placeholder="min" value={f.rsiMin ?? ''} onChange={(e) => set({ rsiMin: numOrNull(e.target.value) })} />
            <span aria-hidden="true">–</span>
            <input type="number" min={0} max={100} aria-label="Maximum RSI" placeholder="max" value={f.rsiMax ?? ''} onChange={(e) => set({ rsiMax: numOrNull(e.target.value) })} />
          </span>
          <select aria-label="Technical rating" value={f.rating} onChange={(e) => set({ rating: e.target.value as RatingFilter })}>
            {RATING_OPTS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
          {filtered && (
            <button type="button" className="sc-reset" onClick={reset}>
              Reset
            </button>
          )}
        </div>
      </div>

      <div className="sc-status" role="status">
        <span>
          {shown.length} of {all.length} coins
        </span>
        <span className="sc-dot" aria-hidden="true" />
        <span>
          Indicators (1D): {loadedTech}/{Math.min(all.length, TECH_TOP_N)} loaded
        </span>
        {offline && all.length > 0 && <span className="sc-warn">Prices delayed · {tickerFeed.name || 'feed'} unavailable</span>}
      </div>

      <div className="sc-scroll">
        <table className="sc-table">
          <thead>
            <tr>
              {COLS.map((c) => {
                const on = sort.key === c.key
                return (
                  <th
                    key={c.key}
                    className={c.key === 'sym' ? 'sc-symcol' : c.key === 'rating' ? 'sc-ratecol' : ''}
                    aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button
                      type="button"
                      title={c.title}
                      className={on ? 'on' : ''}
                      onClick={() => setPrefs((p) => ({ ...p, sort: nextSort(p.sort, c.key), preset: null }))}
                    >
                      {c.label}
                      <span className="sc-arrow" aria-hidden="true">
                        {on ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows n={12} />}
            {!loading &&
              shown.map((r) => {
                const fav = favs.includes(r.base)
                return (
                  <tr
                    key={r.sym}
                    tabIndex={0}
                    onClick={() => openChart(r.sym)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') openChart(r.sym)
                    }}
                    aria-label={'Open ' + r.base + ' chart'}
                  >
                    <td className="sc-symcol">
                      <span className="sc-sym">
                        <button
                          type="button"
                          className={'sc-star' + (fav ? ' on' : '')}
                          aria-label={(fav ? 'Remove ' : 'Add ') + r.base + (fav ? ' from' : ' to') + ' favourites'}
                          aria-pressed={fav}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleFavorite(r.base)
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          {fav ? '★' : '☆'}
                        </button>
                        <CoinBadge sym={r.sym} size={22} />
                        <span className="sc-name">
                          <b>{r.base}</b>
                          <small>{r.name}</small>
                        </span>
                      </span>
                    </td>
                    <td>{pfmt(r.price)}</td>
                    <td className={tone(r.pct)}>{pctText(r.pct)}</td>
                    <td className={tone(r.chg)}>{chgText(r.chg, r.price)}</td>
                    <td>{cfmt(r.vol)}</td>
                    <td>{r.mcap ? cfmt(r.mcap) : <span className="sc-na">—</span>}</td>
                    <TechCell row={r}>
                      {(t) =>
                        t.rsi == null ? '—' : <span className={t.rsi < 30 ? 'up' : t.rsi > 70 ? 'dn' : ''}>{fmt(t.rsi, 1)}</span>
                      }
                    </TechCell>
                    <TechCell row={r}>
                      {(t) =>
                        t.macdState == null ? (
                          '—'
                        ) : (
                          <span
                            className={'sc-macd ' + (t.macdState === 'bull' ? 'up' : 'dn')}
                            title={'MACD ' + pfmt(t.macd ?? NaN) + ' · signal ' + pfmt(t.macdSignal ?? NaN)}
                          >
                            {t.macdState === 'bull' ? 'Bull' : 'Bear'}
                          </span>
                        )
                      }
                    </TechCell>
                    <TechCell row={r}>{() => <EmaDots row={r} />}</TechCell>
                    <TechCell row={r}>{(t) => (t.atrPct == null ? '—' : fmt(t.atrPct, 2) + '%')}</TechCell>
                    <TechCell row={r}>{(t) => <span className={tone(t.perf1W)}>{pctText(t.perf1W)}</span>}</TechCell>
                    <TechCell row={r}>{(t) => <span className={tone(t.perf1M)}>{pctText(t.perf1M)}</span>}</TechCell>
                    <TechCell row={r} className="sc-ratecol">
                      {() => <RatingPill row={r} />}
                    </TechCell>
                  </tr>
                )
              })}
          </tbody>
        </table>
        {!loading && !all.length && (
          <div className="sc-empty">
            <b>Market data is unavailable</b>
            <span>Every price feed failed to answer. The table fills in as soon as one is back.</span>
          </div>
        )}
        {!loading && all.length > 0 && !shown.length && (
          <div className="sc-empty">
            <b>No coins match these filters</b>
            <span>
              {techFilter && loadedTech < Math.min(all.length, TECH_TOP_N)
                ? 'Indicators are still loading — more coins may appear in a moment.'
                : 'Loosen a filter or clear them all.'}
            </span>
            <button type="button" className="sc-reset" onClick={reset}>
              Clear filters
            </button>
          </div>
        )}
      </div>
      <div className="disclaimer">
        Prices and 24h figures update live from the exchange ticker. Indicators use daily candles and refresh every
        few minutes. The technical rating averages two groups — moving averages (price vs SMA/EMA 10–200) and
        oscillators (RSI, Stochastic, CCI, ADX, Awesome, Momentum, MACD, Williams %R) — the same scheme as
        TradingView's. Not financial advice.
      </div>
    </div>
  )
}

