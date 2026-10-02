// The Signals tab, laid out after the owner's reference design: a scanner
// header with today's figures, quick filters and a search, a grid of signal
// cards (mini chart, levels, reasons), and a side column with filters,
// market sentiment and the strongest symbols.
//
// Everything is read from the scanner's own sweep (`signalData`), which the
// engine refreshes every two minutes; prices come from the live tickers. The
// reference's "Scalping" and "Swing" labels do not exist in the scanner, so
// they are defined here from what it does measure: a scalp is a call the 1H
// timeframe agrees with, a swing one the 4H and 1D both agree with.
import { useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { state } from '../../services/store'
import { baseOf, coinMeta } from '../../utils/coins'
import { pfmt } from '../../utils/format'
import { instrumentOf, isInstrument } from '../../constants/instruments'
import { signalData, signalHitRate } from '../../features/signals/signals'
import { useTick } from '../useTick'
import { CoinBadge } from '../common/CoinBadge'

type Candle = { t: number; o: number; h: number; l: number; c: number; v: number }
type Side = 'BUY' | 'SELL' | 'WAIT'
type Brk = { tf: string; score: number; type: Side }
type Sig = {
  sym: string
  score: number
  master: { type: Side; breakdown: Brk[] }
  tfScores: Array<{ tf: string; candles?: Candle[]; reasons: string[] } | null>
  t?: { last?: number; pct?: number }
  reasons: string[]
  plan: { entry: number; stop: number; t1: number; t2: number; rr: number } | null
  conv?: { tier: 'STRONG' | 'MODERATE' | 'WEAK'; agree: number; of: number }
}
type Quick = 'all' | 'long' | 'short' | 'scalp' | 'swing' | 'high'
type Venue = 'all' | 'crypto' | 'macro'

const w = window as unknown as {
  switchTab?: (t: string) => void
  setSymbol?: (s: string) => void
  switchSigMode?: (m: string) => void
  analyzeSigCoin?: (s: string) => void
}
const SIGNALS = ['signals']
const QUICK: Array<[Quick, string]> = [
  ['all', 'All'],
  ['long', 'Long'],
  ['short', 'Short'],
  ['scalp', 'Scalping'],
  ['swing', 'Swing'],
  ['high', 'High Confidence'],
]
const TFS = ['1h', '4h', '1d']
// [chip text, css class, full name]. The chip is short so it fits on the
// title row beside the side and timeframe, as in the reference design.
const CONF: Record<string, [string, string, string]> = {
  STRONG: ['High', 'hi', 'High confidence'],
  MODERATE: ['Medium', 'md', 'Medium confidence'],
  WEAK: ['Low', 'lo', 'Low confidence'],
}
const TIPS = [
  'Look for confluence: RSI + MACD + volume + key levels. Higher-timeframe trend gives better accuracy.',
  'A signal all three timeframes agree on beats a loud one only a single timeframe believes.',
  'Size the position from the stop, not the target — the stop is the part you control.',
  'Signals refresh every two minutes. A setup that flips between sweeps is noise, not a trade.',
]

/** Markets the sweep scored from nothing (no candles, no quote) are left off:
 *  a card of dashes says nothing about the market. */
const hasData = (s: Sig) => !!s.t?.last || s.tfScores.some((x) => (x?.candles?.length ?? 0) > 2)
/** Levels in a quarter-width column: big prices lose their cents, not their digits. */
const lv = (v: number) =>
  v >= 10000 ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : pfmt(v)
const sigs = () => (signalData as Sig[]).filter(hasData)
const label = (sym: string) => {
  const inst = instrumentOf(sym)
  return inst ? inst.sym : baseOf(sym) + '/USDT'
}
const sub = (sym: string) => instrumentOf(sym)?.name ?? coinMeta(sym).name ?? baseOf(sym)
const livePx = (s: Sig) => {
  const t = state.tickers[s.sym] as { last?: number; pct?: number } | undefined
  return { last: t?.last ?? s.t?.last, pct: t?.pct ?? s.t?.pct }
}
/** The timeframe that carries the call: the loudest one pointing its way. */
function leadTf(s: Sig): string {
  const dir = s.master.type
  const same = s.master.breakdown.filter((b) => b.type === dir)
  const pool = same.length ? same : s.master.breakdown
  const top = pool.slice().sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0]
  return top?.tf ?? '4h'
}
const agrees = (s: Sig, tf: string) =>
  s.master.type !== 'WAIT' && s.master.breakdown.some((b) => b.tf === tf && b.type === s.master.type)

function matches(s: Sig, q: Quick, tf: string, venue: Venue, text: string): boolean {
  const t = s.master.type
  if (q === 'long' && t !== 'BUY') return false
  if (q === 'short' && t !== 'SELL') return false
  if (q === 'scalp' && !agrees(s, '1h')) return false
  if (q === 'swing' && !(agrees(s, '4h') && agrees(s, '1d'))) return false
  if (q === 'high' && s.conv?.tier !== 'STRONG') return false
  if (tf !== 'all' && !agrees(s, tf)) return false
  if (venue === 'crypto' && isInstrument(s.sym)) return false
  if (venue === 'macro' && !isInstrument(s.sym)) return false
  if (text) {
    const hay = (s.sym + ' ' + sub(s.sym)).toLowerCase()
    if (!hay.includes(text.toLowerCase())) return false
  }
  return true
}


const Ico = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
const BOLT = 'M13 2 3 14h9l-1 8 10-12h-9l1-8z'
const TARGET = 'M12 2a10 10 0 1 0 10 10M12 6a6 6 0 1 0 6 6M12 10a2 2 0 1 0 2 2M22 2l-10 10'
const FUNNEL = 'M3 4h18l-7 8v6l-4 2v-8L3 4z'
const SEARCH = 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3'
const ARROW = 'M5 12h14M13 6l6 6-6 6'
const CHECK = 'M4 12l5 5L20 6'
const CHART = 'M3 3v18h18M7 15l4-4 3 3 5-6'

// ---- header ----------------------------------------------------------------

function Stat({ icon, label: l, value, sub: s }: { icon: ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="sg-stat">
      <span className="sg-stat-ico">{icon}</span>
      <span>
        <small>{l}</small>
        <b>{value}</b>
        {s && <em>{s}</em>}
      </span>
    </div>
  )
}

function Ring({ v }: { v: number | null }) {
  const r = 13
  const c = 2 * Math.PI * r
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
      <circle cx="17" cy="17" r={r} fill="none" stroke="var(--hair-2)" strokeWidth="4" />
      <circle cx="17" cy="17" r={r} fill="none" stroke="var(--green)" strokeWidth="4" strokeLinecap="round"
        strokeDasharray={`${c * (v ?? 0)} ${c}`} transform="rotate(-90 17 17)" />
    </svg>
  )
}

export function SignalsHead() {
  useTick(3000, SIGNALS)
  const list = sigs()
  const active = list.filter((s) => s.master.type !== 'WAIT')
  const hit = signalHitRate()
  const rrs = active.map((s) => s.plan?.rr).filter((x): x is number => !!x && isFinite(x))
  const rr = rrs.length ? rrs.reduce((a, b) => a + b, 0) / rrs.length : null
  return (
    <header className="sg-head">
      <div className="sg-title">
        <span className="sg-logo"><Ico d={BOLT} size={30} /></span>
        <span>
          <h2>Signal Scanner</h2>
          <p>Real-time trading signals with multi-timeframe analysis &amp; smart filters</p>
        </span>
      </div>
      <div className="sg-stats">
        <Stat icon={<Ico d={BOLT} size={22} />} label="Active Signals"
          value={list.length ? `${active.length} Now` : 'Scanning…'}
          sub={list.length ? `of ${list.length} markets` : undefined} />
        <Stat icon={<Ring v={hit?.rate ?? null} />} label="Win Rate"
          value={hit ? Math.round(hit.rate * 100) + '%' : 'Learning'}
          sub={hit ? `${hit.n} calls scored` : 'needs 10+ calls'} />
        <Stat icon={<Ico d={TARGET} size={22} />} label="Avg. RR"
          value={rr ? '1:' + rr.toFixed(1) : '—'} sub="to target 2" />
      </div>
    </header>
  )
}

// ---- card ------------------------------------------------------------------

/** A small candlestick chart with a price axis and a last-price tag. */
function MiniCandles({ candles, side, last }: { candles: Candle[]; side: Side; last?: number }) {
  const bars = candles.slice(-42)
  const W = 300
  const H = 96
  if (bars.length < 3) return <div className="sg-mini sg-mini-empty">No chart data</div>
  const hi = Math.max(...bars.map((b) => b.h))
  const lo = Math.min(...bars.map((b) => b.l))
  // The axis column fits its longest label ("87,220.00" at 11px needs ~66 units).
  const AX = Math.max(52, Math.ceil(Math.max(pfmt(hi).length, pfmt(lo).length, pfmt(last ?? hi).length) * 6.8) + 8)
  const span = hi - lo || hi * 0.01 || 1
  const y = (v: number) => 4 + ((hi - v) / span) * (H - 8)
  const step = (W - AX) / bars.length
  const bw = Math.max(1.5, step * 0.6)
  const px = last ?? bars[bars.length - 1].c
  const tagY = Math.min(H - 8, Math.max(8, y(Math.min(hi, Math.max(lo, px)))))
  const col = side === 'SELL' ? 'var(--red)' : side === 'BUY' ? 'var(--green)' : 'var(--amber)'
  const k = 2 / 11
  const ema: string[] = []
  for (let i = 0, e = bars[0].c; i < bars.length; i++) {
    e = i ? bars[i].c * k + e * (1 - k) : bars[i].c
    ema.push(`${(i + 0.5) * step},${y(e)}`)
  }
  const ticks = [hi, lo + span * 0.66, lo + span * 0.33, lo]
  return (
    <svg className="sg-mini" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`sgf-${side}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={col} stopOpacity=".22" />
          <stop offset="1" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${step * 0.5},${H} ${ema.join(' ')} ${(bars.length - 0.5) * step},${H}`} fill={`url(#sgf-${side})`} />
      <polyline points={ema.join(' ')} fill="none" stroke={col} strokeWidth="1.2" strokeOpacity=".8" />
      {bars.map((b, i) => {
        const x = (i + 0.5) * step
        const up = b.c >= b.o
        const c = up ? 'var(--green)' : 'var(--red)'
        const top = y(Math.max(b.o, b.c))
        return (
          <g key={b.t}>
            <line x1={x} x2={x} y1={y(b.h)} y2={y(b.l)} stroke={c} strokeWidth="1" />
            <rect x={x - bw / 2} y={top} width={bw} height={Math.max(1, y(Math.min(b.o, b.c)) - top)} fill={c} />
          </g>
        )
      })}
      {ticks.map((v, i) => {
        const ty = i === 0 ? 10 : i === 3 ? H - 2 : y(v) + 3
        // An axis label under the last-price tag would print over it.
        if (Math.abs(ty - (tagY + 3.5)) < 18) return null
        return (
          <text key={i} x={W - 2} y={ty} textAnchor="end" className="sg-ax">
            {pfmt(v)}
          </text>
        )
      })}
      <rect x={W - AX + 2} y={tagY - 7} width={AX - 2} height={14} rx="3" fill={col} />
      <text x={W - 3} y={tagY + 3.5} textAnchor="end" className="sg-tag">{pfmt(px)}</text>
    </svg>
  )
}

function SignalCard({ s }: { s: Sig }) {
  const side = s.master.type
  const tf = leadTf(s)
  const ts = s.tfScores.find((x) => x?.tf === tf) ?? s.tfScores.find((x) => x?.candles?.length)
  const { last, pct } = livePx(s)
  const conf = CONF[s.conv?.tier ?? 'WEAK']
  const cls = side === 'BUY' ? 'long' : side === 'SELL' ? 'short' : 'watch'
  const p = s.plan
  const reasons = (s.reasons.length ? s.reasons : ts?.reasons ?? []).slice(0, 3)
  return (
    <article className={'sg-card ' + cls}>
      <div className="sg-card-top">
        <CoinBadge size={36} sym={s.sym} />
        <span className="sg-id">
          <b>{label(s.sym)}</b>
          <small>{sub(s.sym)}</small>
        </span>
        <span className={'sg-side ' + cls}>★ {side === 'BUY' ? 'LONG' : side === 'SELL' ? 'SHORT' : 'WATCH'}</span>
        <span className="sg-tf">{tf}</span>
        <span
          className={'sg-conf ' + conf[1]}
          title={conf[2] + (s.conv ? `: ${s.conv.agree} of ${s.conv.of} timeframes agree` : '')}
          aria-label={conf[2]}
        >
          ★ {conf[0]}
        </span>
      </div>
      <MiniCandles candles={ts?.candles ?? []} side={side} last={last} />
      <div className="sg-px">
        <b>{last ? '$' + pfmt(last) : '—'}</b>
        {pct != null && <i className={pct >= 0 ? 'up' : 'dn'}>{(pct >= 0 ? '+' : '') + pct.toFixed(2)}%</i>}
        <span className="sg-score" title="Blended multi-timeframe score">{(s.score > 0 ? '+' : '') + s.score}</span>
      </div>
      {p ? (
        <dl className="sg-lv">
          <div><dt>Entry</dt><dd>{lv(p.entry)}</dd></div>
          <div><dt>SL</dt><dd className="dn">{lv(p.stop)}</dd></div>
          <div><dt>TP1</dt><dd className="up">{lv(p.t1)}</dd></div>
          <div><dt>TP2</dt><dd className="up">{lv(p.t2)}</dd></div>
        </dl>
      ) : (
        <p className="sg-nolv">No trade plan — the score is inside the ±15 dead zone, so the scanner is only watching.</p>
      )}
      <div className="sg-foot">
        <ul className="sg-why">
          {reasons.length ? reasons.map((r, i) => (
            <li key={i}><Ico d={CHECK} size={14} />{r}</li>
          )) : <li className="dim">No standout readings</li>}
        </ul>
        <div className="sg-acts">
          <button type="button" className="sg-chart" title="Open chart" aria-label={'Open ' + label(s.sym) + ' chart'}
            onClick={() => { w.setSymbol?.(s.sym); w.switchTab?.('radar') }}>
            <Ico d={CHART} size={15} />
          </button>
          <button type="button" className={'sg-go ' + cls}
            onClick={() => { w.switchSigMode?.('search'); w.analyzeSigCoin?.(baseOf(s.sym) || s.sym) }}>
            View Details <Ico d={ARROW} size={14} />
          </button>
        </div>
      </div>
    </article>
  )
}

// ---- side column -----------------------------------------------------------

function Sentiment({ list }: { list: Sig[] }) {
  const v = list.length ? list.reduce((a, s) => a + (s.score + 100) / 2, 0) / list.length : 50
  const pctv = Math.round(v)
  const word = pctv >= 55 ? 'Bullish' : pctv <= 45 ? 'Bearish' : 'Neutral'
  const col = pctv >= 55 ? 'var(--green)' : pctv <= 45 ? 'var(--red)' : 'var(--amber)'
  const r = 38
  const arc = Math.PI * r * 1.5
  const buys = list.filter((s) => s.master.type === 'BUY').length
  const sells = list.filter((s) => s.master.type === 'SELL').length
  return (
    <section className="card sg-box">
      <h3><Ico d={CHART} size={16} /> Market Sentiment</h3>
      <div className="sg-sent">
        <svg width="104" height="92" viewBox="0 0 104 92" aria-hidden="true">
          <circle cx="52" cy="52" r={r} fill="none" stroke="var(--hair-2)" strokeWidth="8"
            strokeDasharray={`${arc} 999`} transform="rotate(135 52 52)" strokeLinecap="round" />
          <circle cx="52" cy="52" r={r} fill="none" stroke={col} strokeWidth="8"
            strokeDasharray={`${arc * (pctv / 100)} 999`} transform="rotate(135 52 52)" strokeLinecap="round" />
          <text x="52" y="52" textAnchor="middle" className="sg-sent-v" fill={col}>{list.length ? pctv + '%' : '—'}</text>
          <text x="52" y="68" textAnchor="middle" className="sg-sent-w">{list.length ? word : 'Scanning'}</text>
        </svg>
        <div className="sg-sent-bars">
          <span><i className="up" style={{ height: `${list.length ? (buys / list.length) * 100 : 0}%` }} /><small>{buys} long</small></span>
          <span><i className="dn" style={{ height: `${list.length ? (sells / list.length) * 100 : 0}%` }} /><small>{sells} short</small></span>
        </div>
      </div>
      <p className="sg-note">Average scanner score across {list.length || '—'} markets</p>
    </section>
  )
}

function TopSymbols({ list, onAll }: { list: Sig[]; onAll: () => void }) {
  const top = list.slice().sort((a, b) => Math.abs(b.score) - Math.abs(a.score)).slice(0, 5)
  return (
    <section className="card sg-box">
      <h3><Ico d={TARGET} size={16} /> Top Symbols</h3>
      <div className="sg-top-h"><span>Symbol</span><span>Strength</span></div>
      <ul className="sg-top">
        {top.map((s) => (
          <li key={s.sym}>
            <button type="button" onClick={() => { w.setSymbol?.(s.sym); w.switchTab?.('radar') }}>
              <CoinBadge sym={s.sym} size={20} />
              <b>{instrumentOf(s.sym)?.sym ?? baseOf(s.sym)}</b>
              <span className="sg-bar"><i className={s.score >= 0 ? 'up' : 'dn'} style={{ width: Math.abs(s.score) + '%' }} /></span>
              <em className={s.score >= 0 ? 'up' : 'dn'}>{Math.abs(s.score)}%</em>
            </button>
          </li>
        ))}
        {!top.length && <li className="sg-note">Waiting for the first sweep…</li>}
      </ul>
      <button type="button" className="sg-all" onClick={onAll}>View All <Ico d={ARROW} size={13} /></button>
    </section>
  )
}

// ---- board -----------------------------------------------------------------

export function SignalsBoard() {
  useTick(2000, SIGNALS)
  const [quick, setQuick] = useState<Quick>('all')
  const [tf, setTf] = useState('all')
  const [venue, setVenue] = useState<Venue>('all')
  const [draft, setDraft] = useState<{ tf: string; venue: Venue }>({ tf: 'all', venue: 'all' })
  const [text, setText] = useState('')
  const [tip, setTip] = useState(0)
  const list = sigs()
  const TIER: Record<string, number> = { STRONG: 2, MODERATE: 1, WEAK: 0 }
  const shown = list
    .filter((s) => matches(s, quick, tf, venue, text.trim()))
    .sort((a, b) => {
      const wa = a.master.type === 'WAIT' ? 1 : 0
      const wb = b.master.type === 'WAIT' ? 1 : 0
      if (wa !== wb) return wa - wb
      const t = (TIER[b.conv?.tier ?? 'WEAK'] ?? 0) - (TIER[a.conv?.tier ?? 'WEAK'] ?? 0)
      return t || Math.abs(b.score) - Math.abs(a.score)
    })
  const counts: Record<Quick, number> = { all: 0, long: 0, short: 0, scalp: 0, swing: 0, high: 0 }
  QUICK.forEach(([q]) => { counts[q] = list.filter((s) => matches(s, q, 'all', 'all', '')).length })
  const chips = (cls: string) => (
    <div className={cls} role="group" aria-label="Quick filters">
      {QUICK.map(([q, l]) => (
        <button key={q} type="button" className={quick === q ? 'on' : ''} onClick={() => setQuick(q)}>
          {l}{list.length > 0 && <i>{counts[q]}</i>}
        </button>
      ))}
    </div>
  )
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !text.trim() || shown.length) return
    w.switchSigMode?.('search')
    w.analyzeSigCoin?.(text.trim())
  }
  const reset = () => {
    setQuick('all'); setTf('all'); setVenue('all'); setText(''); setDraft({ tf: 'all', venue: 'all' })
    document.getElementById('sgGrid')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return (
    <div className="sg-body">
      <div className="sg-main">
        <div className="sg-bar-row">
          {chips('sg-chips')}
          <label className="sg-search">
            <Ico d={SEARCH} size={15} />
            <input type="search" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onSearchKey}
              placeholder="Search coin (e.g. BTC, ETH, SOL…)" aria-label="Search signals" />
          </label>
          <button type="button" className={'sg-funnel' + (tf !== 'all' || venue !== 'all' ? ' on' : '')}
            title="Signal filters" aria-label="Jump to signal filters"
            onClick={() => document.getElementById('sgFilters')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
            <Ico d={FUNNEL} size={16} />
          </button>
        </div>
        <div className="sg-grid" id="sgGrid">
          {!list.length && Array.from({ length: 6 }, (_, i) => <div key={i} className="sg-card sg-skel" />)}
          {shown.map((s) => <SignalCard key={s.sym} s={s} />)}
          {list.length > 0 && !shown.length && (
            <div className="sg-empty">
              No signals match these filters.
              {text.trim() && <> Press <b>Enter</b> to run a full analysis of “{text.trim()}”.</>}
              <button type="button" onClick={reset}>Clear filters</button>
            </div>
          )}
        </div>
        <div className="card sg-tip">
          <span className="sg-tip-ico"><Ico d={TARGET} size={20} /></span>
          <b>Pro Tip:</b>
          <p>{TIPS[tip % TIPS.length]}</p>
          <button type="button" className="sg-tip-next" onClick={() => setTip((n) => n + 1)} aria-label="Next tip">›</button>
          <button type="button" className="sg-trade" onClick={() => w.switchTab?.('pro')}>
            Trade Smart <Ico d={ARROW} size={14} />
          </button>
        </div>
      </div>
      <aside className="sg-side">
        <section className="card sg-box" id="sgFilters">
          <h3><Ico d={FUNNEL} size={16} /> Signal Filters</h3>
          <small className="sg-lbl">Quick Filters</small>
          {chips('sg-chips sg-chips-side')}
          <label className="sg-lbl" htmlFor="sgTf">Timeframe</label>
          <select id="sgTf" className="sg-sel" value={draft.tf} onChange={(e) => setDraft({ ...draft, tf: e.target.value })}>
            <option value="all">All timeframes</option>
            {TFS.map((t) => <option key={t} value={t}>{t} agrees</option>)}
          </select>
          <label className="sg-lbl" htmlFor="sgVenue">Exchange</label>
          <select id="sgVenue" className="sg-sel" value={draft.venue}
            onChange={(e) => setDraft({ ...draft, venue: e.target.value as Venue })}>
            <option value="all">All markets</option>
            <option value="crypto">Crypto · Binance</option>
            <option value="macro">Metals, FX &amp; indices · Yahoo</option>
          </select>
          <button type="button" className="sg-apply" onClick={() => { setTf(draft.tf); setVenue(draft.venue) }}>
            <Ico d={FUNNEL} size={15} /> Apply Filters
          </button>
        </section>
        <Sentiment list={list} />
        <TopSymbols list={list} onAll={reset} />
      </aside>
    </div>
  )
}
