// Right-hand side panel on the price-action chart: an icon rail that opens
// Order book, Liquidity, Futures or Structure — the Pro terminal's side tabs,
// built on this app's own market state.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { state } from '../../services/store'
import { cfmt, pfmt } from '../../utils/format'
import { calcATR, calcRSI } from '../../utils/indicators'
import {
  bookMetrics,
  classifyPriceOI,
  fmtUsd,
  liquidityScore,
  structureEvents,
  swings,
} from '../../features/charts/sidePanels/metrics'
import type { Level } from '../../features/charts/sidePanels/metrics'
import { storageGetRaw, storageSetRaw } from '../../services/storage'
import { syncStageHeight } from '../../features/charts/companionCharts'

type TabId = 'book' | 'liquidity' | 'futures' | 'structure'

const S = {
  fill: 'none',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function TabIcon({ id }: { id: TabId }) {
  const p = { width: 17, height: 17, viewBox: '0 0 24 24', 'aria-hidden': true as const }
  if (id === 'book')
    return (
      <svg {...p}>
        <path d="M3.5 6h9M3.5 9.5h6M3.5 13h7.5" stroke="var(--green)" {...S} />
        <path d="M20.5 18h-9M20.5 14.5h-6M20.5 11h-7.5" stroke="var(--red)" {...S} />
      </svg>
    )
  if (id === 'liquidity')
    return (
      <svg {...p}>
        <path
          d="M12 3c4 5 6.5 7.6 6.5 11a6.5 6.5 0 0 1-13 0C5.5 10.6 8 8 12 3Z"
          stroke="var(--cyan)"
          {...S}
        />
        <path
          d="M9 15.5a3 3 0 0 0 3 3"
          stroke="var(--cyan)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
    )
  if (id === 'futures')
    return (
      <svg {...p}>
        <path d="M3 17.5 8.5 11l4 3.5L21 5" stroke="var(--amber)" {...S} />
        <path d="M15.5 5H21v5.5" stroke="var(--amber)" {...S} />
      </svg>
    )
  return (
    <svg {...p}>
      <path d="M3 19l4-8 4 5 3.5-9 3 7 3.5-4" stroke="var(--purple)" {...S} />
      <circle cx="7" cy="11" r="1.7" fill="var(--purple)" />
      <circle cx="14.5" cy="7" r="1.7" fill="var(--purple)" />
    </svg>
  )
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'book', label: 'Order book' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'futures', label: 'Futures' },
  { id: 'structure', label: 'Structure' },
]

const OPEN_KEY = 'lr-chartSide'
const TAB_KEY = 'lr-chartSideTab'

/**
 * `tools` are the chart's own controls (style, drawings, indicators, panes,
 * replay). They share the rail with the panel tabs so the chart has one
 * toolbar: down the right side on a wide or landscape screen, along the bottom
 * on a portrait phone.
 */
export function ChartSidePanel({ tools }: { tools?: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(() => storageGetRaw(OPEN_KEY) === '1')
  const [tab, setTab] = useState<TabId>(() => {
    const v = storageGetRaw(TAB_KEY)
    return TABS.some((t) => t.id === v) ? (v as TabId) : 'book'
  })
  // The engine mutates `state` imperatively, so poll it while the panel is up.
  // The same tick doubles as the clock for the funding countdown.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [open])

  // The stage sizes itself differently with the panel out, and it is a plain
  // element in the shell rather than part of this component's tree.
  useEffect(() => {
    const stage = rootRef.current?.parentElement
    if (!stage) return
    stage.classList.toggle('side-open', open)
    syncStageHeight()
    return () => {
      stage.classList.remove('side-open')
      syncStageHeight()
    }
  }, [open])

  const pick = (id: TabId) => {
    if (open && tab === id) {
      setOpen(false)
      storageSetRaw(OPEN_KEY, '0')
      return
    }
    setTab(id)
    setOpen(true)
    storageSetRaw(OPEN_KEY, '1')
    storageSetRaw(TAB_KEY, id)
  }

  return (
    <div className={'chart-side' + (open ? ' open' : '')} ref={rootRef}>
      <div className="cs-rail">
        {tools && (
          <>
            <div className="cs-tools" role="toolbar" aria-label="Chart tools">
              {tools}
            </div>
            <span className="cs-rail-sep" aria-hidden="true" />
          </>
        )}
        <div className="cs-tabs" role="tablist" aria-label="Chart side panels">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={open && tab === t.id}
              className={'cs-rail-btn' + (open && tab === t.id ? ' on' : '')}
              title={t.label}
              aria-label={t.label}
              onClick={() => pick(t.id)}
            >
              <TabIcon id={t.id} />
              <span className="cs-rail-tip">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      {open && (
        <div
          className="cs-panel"
          role="tabpanel"
          aria-label={TABS.find((t) => t.id === tab)?.label}
        >
          <div className="cs-head">
            <span className="cs-head-icon">
              <TabIcon id={tab} />
            </span>
            <span className="cs-head-title">{TABS.find((t) => t.id === tab)?.label}</span>
            <button
              type="button"
              className="cs-close"
              onClick={() => {
                setOpen(false)
                storageSetRaw(OPEN_KEY, '0')
              }}
              aria-label="Close panel"
              title="Close"
            >
              ✕
            </button>
          </div>
          <div className="cs-body">
            {tab === 'book' && <BookPanel />}
            {tab === 'liquidity' && <LiquidityPanel />}
            {tab === 'futures' && <FuturesPanel now={now} />}
            {tab === 'structure' && <StructurePanel />}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Depth from the deep REST book when it has arrived, else the live 15-level
 * stream. `deep` matters: a 15-level book is fine to draw a ladder from, but
 * scoring depth off it would understate the market by orders of magnitude.
 */
function readBook(): { bids: Level[]; asks: Level[]; deep: boolean } | null {
  const deep = state.deepOb
  if (deep && deep.bids.length) return { bids: deep.bids, asks: deep.asks, deep: true }
  const ob = state.ob
  if (!ob || !ob.bids?.length) return null
  return {
    bids: ob.bids.map((b) => ({ price: +b[0], size: +b[1] })),
    asks: ob.asks.map((a) => ({ price: +a[0], size: +a[1] })),
    deep: false,
  }
}

/** What a level is worth, which is what makes it worth looking at. */
const notionalOf = (l: Level): number => l.price * l.size

/**
 * Bar scale for a depth ladder: the 85th percentile of the values on screen,
 * not their maximum. One wall thirty times its neighbours would otherwise
 * flatten every other bar to an invisible sliver; here it simply fills its
 * track, and the figure printed beside each row keeps the true magnitudes.
 */
function pctScale(values: number[]): number {
  if (!values.length) return 1e-9
  const sorted = [...values].sort((a, b) => a - b)
  return Math.max(sorted[Math.floor(sorted.length * 0.85)] ?? 0, 1e-9)
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="cs-empty">{children}</div>
}

function BookPanel() {
  const book = readBook()
  const m = useMemo(() => (book ? bookMetrics(book.bids, book.asks) : null), [book])
  if (!book || !m) return <Empty>Waiting for depth…</Empty>
  const n = 14
  const bids = book.bids.slice(0, n)
  const asks = book.asks.slice(0, n).reverse()
  // Scaled by notional rather than raw size — $2m resting at one price is the
  // level that will actually stop the tape — and topped out at the 85th
  // percentile, because a single wall many times its neighbours would leave
  // every other bar invisible. Walls are marked in their own right.
  const max = pctScale(bids.concat(asks).map(notionalOf))
  const spreadAbs = m.best.ask - m.best.bid
  const wall = new Set(m.walls.map((w) => w.side + ':' + w.price))
  const Row = ({ l, side }: { l: Level; side: 'bid' | 'ask' }) => (
    <div className={'cs-lvl ' + side + (wall.has(side + ':' + l.price) ? ' wall' : '')}>
      <i style={{ width: Math.min(1, notionalOf(l) / max) * 100 + '%' }} />
      <span className="cs-lvl-px">{pfmt(l.price)}</span>
      <span className="cs-lvl-sz">{l.size.toFixed(4)}</span>
    </div>
  )
  return (
    <>
      <div className="cs-book">
        {asks.map((l) => (
          <Row key={'a' + l.price} l={l} side="ask" />
        ))}
        <div className="cs-mid">
          <b>{pfmt(m.mid)}</b>
          <span>
            {spreadAbs.toFixed(m.best.ask < 1 ? 6 : 2)} · {m.spreadBps.toFixed(2)} bps
          </span>
        </div>
        {bids.map((l) => (
          <Row key={'b' + l.price} l={l} side="bid" />
        ))}
      </div>
      <div className="cs-imb">
        <div className="cs-imb-bar">
          <i className="bid" style={{ width: ((1 + m.imbalance1) / 2) * 100 + '%' }} />
        </div>
        <div className="cs-imb-lbl">
          <span className="up">${fmtUsd(m.bidDepth1)}</span>
          <b>{(m.imbalance1 * 100).toFixed(0)}% imbalance</b>
          <span className="dn">${fmtUsd(m.askDepth1)}</span>
        </div>
      </div>
      <div className="cs-sec">Slippage to fill at market</div>
      <table className="cs-table">
        <thead>
          <tr>
            <th>Size</th>
            <th>Buy</th>
            <th>Sell</th>
          </tr>
        </thead>
        <tbody>
          {[10000, 100000, 1000000].map((nt) => {
            const b = m.slippage.find((s) => s.notional === nt && s.side === 'buy')
            const a = m.slippage.find((s) => s.notional === nt && s.side === 'sell')
            return (
              <tr key={nt}>
                <td>${fmtUsd(nt)}</td>
                <td>{b?.filled ? b.bps.toFixed(2) + ' bps' : 'unfilled'}</td>
                <td>{a?.filled ? a.bps.toFixed(2) + ' bps' : 'unfilled'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {m.walls.length > 0 && (
        <>
          <div className="cs-sec">Walls (≥5× average level)</div>
          {m.walls.slice(0, 4).map((w) => (
            <div className="cs-wall" key={w.side + w.price}>
              <span className={w.side === 'bid' ? 'up' : 'dn'}>{w.side}</span>
              <b>{pfmt(w.price)}</b>
              <span>{w.size.toFixed(2)}</span>
              <span className="cs-mult">{w.multiple.toFixed(0)}×</span>
            </div>
          ))}
        </>
      )}
    </>
  )
}

function LiquidityPanel() {
  const book = readBook()
  const tk = state.tickers?.[state.symbol]
  const m = useMemo(() => (book ? bookMetrics(book.bids, book.asks) : null), [book])
  // Only the deep book gets scored — see readBook.
  const score = useMemo(
    () => (m && book?.deep ? liquidityScore(m, tk?.qvol) : null),
    [m, book?.deep, tk?.qvol],
  )
  if (!book || !m) return <Empty>Needs the order book.</Empty>
  const tone = !score ? '' : score.value >= 70 ? 'good' : score.value >= 45 ? 'mid' : 'poor'
  return (
    <>
      {score ? (
        <>
          <div
            className={'cs-dial ' + tone}
            style={{ ['--v' as string]: score.value } as React.CSSProperties}
          >
            <svg viewBox="0 0 120 120" aria-hidden="true">
              <circle cx="60" cy="60" r="52" className="cs-dial-track" />
              <circle
                cx="60"
                cy="60"
                r="52"
                className="cs-dial-fill"
                strokeDasharray={Math.PI * 2 * 52}
                strokeDashoffset={Math.PI * 2 * 52 * (1 - score.value / 100)}
              />
            </svg>
            <div className="cs-dial-val">
              <b>{score.value}</b>
              <small>/ 100</small>
            </div>
          </div>
          {score.components.map((c) => (
            <div className="cs-comp" key={c.key}>
              <div className="cs-comp-top">
                <span>
                  {c.label} <i>×{c.weight}</i>
                </span>
                <b>{Math.round(c.score)}</b>
              </div>
              <div className="cs-comp-bar">
                <i style={{ width: c.score + '%' }} />
              </div>
              <small>{c.reason}</small>
            </div>
          ))}
          <div className="cs-note">
            Weighted average of the five components above — fixed weights, no hidden factors.
          </div>
        </>
      ) : (
        <div className="cs-note">
          Waiting for the deep order book. The live stream carries 15 levels, which is enough to
          draw the ladder below but would badly understate depth if it were scored.
        </div>
      )}
      <HeatLadder bids={book.bids} asks={book.asks} mid={m.mid} />
    </>
  )
}

/**
 * Resting size by price as a heat ladder — the Radar tab's old standalone
 * heatmap, moved into the space under the score where it reads against the
 * numbers that describe it. Intensity is notional, so a level glows because
 * real money is parked there, not because the coin is cheap.
 */
function HeatLadder({ bids, asks, mid }: { bids: Level[]; asks: Level[]; mid: number }) {
  const n = 8
  const a = asks.slice(0, n)
  const b = bids.slice(0, n)
  const scale = pctScale(a.concat(b).map(notionalOf))
  const Row = ({ l, side }: { l: Level; side: 'bid' | 'ask' }) => {
    const v = notionalOf(l)
    const r = Math.min(1, v / scale)
    return (
      <div className="cs-hm">
        <span className="cs-hm-px">{pfmt(l.price)}</span>
        <span className="cs-hm-zone">
          <i
            className={side}
            style={{ width: Math.max(3, r * 100).toFixed(1) + '%', opacity: 0.3 + r * 0.7 }}
          />
        </span>
        <span className="cs-hm-v">{cfmt(v)}</span>
      </div>
    )
  }
  return (
    <>
      <div className="cs-sec">Resting liquidity by price</div>
      {[...a].reverse().map((l) => (
        <Row key={'a' + l.price} l={l} side="ask" />
      ))}
      <div className="cs-hm-mid">mid {pfmt(mid)}</div>
      {b.map((l) => (
        <Row key={'b' + l.price} l={l} side="bid" />
      ))}
    </>
  )
}

function FuturesPanel({ now }: { now: number }) {
  const fr = state.fr as {
    lastFundingRate?: string
    markPrice?: string
    indexPrice?: string
    nextFundingTime?: number
  } | null
  const oi = state.oi as { openInterest?: string } | null
  const oiH = state.oiHist
  const ls = state.ls
  const candles = state.candles
  const rate = fr?.lastFundingRate != null ? Number(fr.lastFundingRate) : null
  const mark = fr?.markPrice ? Number(fr.markPrice) : null
  const index = fr?.indexPrice ? Number(fr.indexPrice) : null
  const mins = fr?.nextFundingTime
    ? Math.max(0, Math.round((fr.nextFundingTime - now) / 60000))
    : null
  const lsLast = ls && ls.length ? ls[ls.length - 1] : null

  const regime = useMemo(() => {
    if (!oiH || oiH.length < 5 || !candles || candles.length < 5) return null
    const a = oiH[oiH.length - 5].openInterest
    const b = oiH[oiH.length - 1].openInterest
    if (!a) return null
    const oiChg = ((b - a) / a) * 100
    const from = oiH[oiH.length - 5].ts
    const k0 = candles.find((c) => c.t >= from) ?? candles[Math.max(0, candles.length - 17)]
    const priceChg = k0.c ? ((candles[candles.length - 1].c - k0.c) / k0.c) * 100 : 0
    return classifyPriceOI(priceChg, oiChg)
  }, [oiH, candles])

  const annual = rate != null ? rate * 3 * 365 * 100 : null
  const fundTone = rate == null ? '' : rate > 0.0005 ? 'dn' : rate < -0.0002 ? 'up' : ''
  return (
    <>
      <div className="cs-stats">
        <div className="cs-stat">
          <small>Funding (8h)</small>
          <b className={fundTone}>{rate != null ? (rate * 100).toFixed(4) + '%' : '—'}</b>
          <small>
            {annual != null
              ? annual.toFixed(1) + '% annualised' + (mins != null ? ' · next ' + mins + 'm' : '')
              : ''}
          </small>
        </div>
        <div className="cs-stat">
          <small>Open interest</small>
          <b>{oi?.openInterest ? fmtUsd(Number(oi.openInterest)) : '—'}</b>
          <small>contracts</small>
        </div>
        <div className="cs-stat">
          <small>Long / short</small>
          <b>{lsLast ? lsLast.ratio.toFixed(2) : '—'}</b>
          <small>
            {lsLast
              ? (lsLast.longAccount * 100).toFixed(0) +
                '% long · ' +
                (lsLast.shortAccount * 100).toFixed(0) +
                '% short'
              : ''}
          </small>
        </div>
      </div>
      <dl className="cs-kv">
        <dt>Mark</dt>
        <dd>{mark != null ? pfmt(mark) : '—'}</dd>
        <dt>Index</dt>
        <dd>{index != null ? pfmt(index) : '—'}</dd>
        <dt>Basis</dt>
        <dd className={mark != null && index ? (mark > index ? 'up' : 'dn') : ''}>
          {mark != null && index ? (((mark - index) / index) * 1e4).toFixed(2) + ' bps' : '—'}
        </dd>
        <dt>OI change (4h)</dt>
        <dd className={regime ? (regime.oiChg > 0 ? 'up' : 'dn') : ''}>
          {regime ? regime.oiChg.toFixed(2) + '%' : '—'}
        </dd>
        <dt>Price change (4h)</dt>
        <dd className={regime ? (regime.priceChg > 0 ? 'up' : 'dn') : ''}>
          {regime ? regime.priceChg.toFixed(2) + '%' : '—'}
        </dd>
      </dl>
      {regime && regime.regime !== 'FLAT' && (
        <div className="cs-regime">
          <b>
            {regime.title}
            <i>{regime.matrix}</i>
          </b>
          {regime.meaning}
        </div>
      )}
      {rate != null && Math.abs(rate) > 0.0005 && (
        <div className="cs-regime warn">
          <b>Funding extreme</b>
          {rate > 0
            ? 'Longs paying heavily — crowded long positioning, squeeze risk if price stalls.'
            : 'Shorts paying heavily — crowded short positioning, squeeze risk on strength.'}
        </div>
      )}
      <div className="cs-note">Heuristics from public exchange data, not predictions.</div>
    </>
  )
}

function StructurePanel() {
  const candles = state.candles
  const v = useMemo(() => {
    if (!candles || candles.length < 30) return null
    // Structure only ever reports the recent picture, so cap the window rather
    // than walking every bar the chart has paged in.
    const win = candles.length > 600 ? candles.slice(-600) : candles
    const sw = swings(win)
    const ev = structureEvents(win, sw).slice(-5).reverse()
    const closes = win.map((c) => c.c)
    const last = closes[closes.length - 1]
    const lastH = [...sw].reverse().find((s) => s.type === 'high')
    const lastL = [...sw].reverse().find((s) => s.type === 'low')
    return {
      // HH / HL / LH / LL where the engine could name it — the sequence is the
      // whole point of a structure read, and bare H/L throws half of it away.
      seq: sw.slice(-6).map((s) => ({
        text: s.label ?? (s.type === 'high' ? 'H' : 'L'),
        up: s.type === 'high',
      })),
      ev,
      lastH,
      lastL,
      last,
      rsi: calcRSI(closes, 14),
      atr: calcATR(win, 14),
    }
  }, [candles])
  if (!v) return <Empty>Needs at least 30 candles.</Empty>
  return (
    <>
      <div className="cs-seq">
        {v.seq.map((s, i) => (
          <span key={i} className={s.up ? 'up' : 'dn'}>
            {s.text}
          </span>
        ))}
      </div>
      <dl className="cs-kv">
        <dt>Resistance</dt>
        <dd>
          {v.lastH ? pfmt(v.lastH.price) : '—'}
          <i>
            {v.lastH ? ' +' + (((v.lastH.price - v.last) / v.last) * 100).toFixed(2) + '%' : ''}
          </i>
        </dd>
        <dt>Support</dt>
        <dd>
          {v.lastL ? pfmt(v.lastL.price) : '—'}
          <i>{v.lastL ? ' ' + (((v.lastL.price - v.last) / v.last) * 100).toFixed(2) + '%' : ''}</i>
        </dd>
        <dt>RSI 14</dt>
        <dd className={v.rsi > 70 ? 'dn' : v.rsi < 30 ? 'up' : ''}>{v.rsi.toFixed(1)}</dd>
        <dt>ATR 14</dt>
        <dd>
          {pfmt(v.atr)}
          <i> {((v.atr / v.last) * 100).toFixed(2)}%</i>
        </dd>
      </dl>
      <div className="cs-sec">Recent structure events</div>
      {v.ev.length === 0 ? (
        <div className="cs-note">None in the loaded range.</div>
      ) : (
        v.ev.map((e) => (
          <div className="cs-ev" key={e.index + e.type}>
            <span className={'cs-ev-tag ' + e.direction}>{e.type}</span>
            <span>through {pfmt(e.price)}</span>
            <small>bar {e.index}</small>
          </div>
        ))
      )}
      <div className="cs-note">
        Swings are 3-bar fractals; BOS/CHoCH fire on closes through the last confirmed swing.
      </div>
    </>
  )
}
