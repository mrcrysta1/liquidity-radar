// Cross-exchange radar: every free public venue we can reach from the browser,
// in a table you can search and sort.
//
// The engine mutates `state.crossEx` imperatively on its own poll, so this
// polls it back — the same approach the chart's side panel uses.
import { useEffect, useMemo, useState } from 'react'
import { state } from '../../services/store'
import { cfmt, pfmt } from '../../utils/format'
import type { CrossExRow } from '../../features/advanced/advancedData'
import { useTick } from '../useTick'

type Col = 'name' | 'last' | 'vol' | 'spread' | 'funding'
type Dir = 'asc' | 'desc'

const COLS: Array<{ key: Col; label: string; num: boolean; title: string }> = [
  { key: 'name', label: 'Venue', num: false, title: 'Exchange' },
  { key: 'last', label: 'Last', num: true, title: 'Last traded price' },
  { key: 'vol', label: '24h Volume', num: true, title: '24h volume in quote currency' },
  { key: 'spread', label: 'Spread', num: true, title: 'Best bid to ask, in basis points' },
  { key: 'funding', label: 'Funding', num: true, title: 'Perpetual funding rate' },
]

/** Missing values sort last whichever way the column is pointing. */
function compare(a: CrossExRow, b: CrossExRow, key: Col, dir: Dir): number {
  if (key === 'name') {
    const r = a.name.localeCompare(b.name)
    return dir === 'asc' ? r : -r
  }
  const av = a[key]
  const bv = b[key]
  if (av == null && bv == null) return 0
  if (av == null) return 1
  if (bv == null) return -1
  return dir === 'asc' ? av - bv : bv - av
}

export function CrossExchangeTable() {
  // Re-reads state.crossEx every 2s — only while the Radar tab is open.
  useTick(2000, ['radar'])
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: Col; dir: Dir }>({ key: 'vol', dir: 'desc' })

  const src = state.crossEx as CrossExRow[] | null
  const rows = useMemo(() => src ?? [], [src])
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const hit = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle)) : rows
    return [...hit].sort((a, b) => compare(a, b, sort.key, sort.dir))
  }, [rows, q, sort])

  const live = rows.filter((r) => r.last != null)
  const prices = live.map((r) => r.last as number)
  const lo = prices.length ? Math.min(...prices) : 0
  const hi = prices.length ? Math.max(...prices) : 0
  const gapBps = prices.length > 1 && lo > 0 ? ((hi - lo) / lo) * 1e4 : 0
  const frs = live.map((r) => r.funding).filter((f): f is number => f != null)
  const frSpread = frs.length > 1 ? (Math.max(...frs) - Math.min(...frs)) * 100 : 0

  const pick = (key: Col) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )

  return (
    <>
      <div className="dt-bar">
        <span className="dt-search">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search venues…"
            aria-label="Search venues"
            autoComplete="off"
          />
        </span>
        <span className="dt-count">
          {view.length}/{rows.length} · {live.length} live
        </span>
      </div>
      <div className="table-scroll">
        <table className="fc-table dt-table">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  title={c.title}
                  className={
                    (c.num ? 'dt-num ' : '') +
                    'dt-th' +
                    (sort.key === c.key ? ' on ' + sort.dir : '')
                  }
                  aria-sort={
                    sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button type="button" onClick={() => pick(c.key)}>
                    {c.label}
                    <i aria-hidden="true" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr>
                <td colSpan={COLS.length} className="muted">
                  {rows.length ? 'No venue matches “' + q + '”.' : 'Polling venues…'}
                </td>
              </tr>
            )}
            {view.map((r) => (
              <tr key={r.id} className="row-hover">
                <td>
                  <span className="dt-venue">{r.name}</span>
                  {r.usd && (
                    <span className="dt-tag" title="Quoted in USD, not USDT">
                      USD
                    </span>
                  )}
                  {r.kind === 'perp' && (
                    <span className="dt-tag perp" title="Perpetual, not spot">
                      PERP
                    </span>
                  )}
                </td>
                <td className={'dt-num ' + (r.last === hi ? 'up' : r.last === lo ? 'down' : '')}>
                  {r.last != null ? pfmt(r.last) : <span className="muted">{r.err ?? '—'}</span>}
                </td>
                <td className="dt-num">{r.vol != null ? cfmt(r.vol) : '—'}</td>
                <td className="dt-num">{r.spread != null ? r.spread.toFixed(2) + ' bps' : '—'}</td>
                <td
                  className={'dt-num ' + (r.funding == null ? '' : r.funding > 0 ? 'down' : 'up')}
                >
                  {r.funding != null ? (r.funding * 100).toFixed(4) + '%' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fc-note">
        Price gap across venues: <b>{gapBps.toFixed(2)} bps</b> · funding dispersion:{' '}
        <b>{frSpread.toFixed(4)}%</b>
        {gapBps > 10 && (
          <>
            {' '}
            · <span className="up">discrepancy signal</span> — check fees and withdrawal status
            before acting.
          </>
        )}
      </div>
    </>
  )
}
