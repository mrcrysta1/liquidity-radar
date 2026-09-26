// Small shared pieces for the Neural Net and Self Learning pages.
import type { ReactNode } from 'react'
import { state } from '../../services/store'
import { baseOf, coinMeta } from '../../utils/coins'
import { instrumentOf } from '../../constants/instruments'
import { signalData } from '../../features/signals/signals'
import { useTick } from '../useTick'
import { NI } from './icons'

export function Ico({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export function NnCard({ title, icon, right, className, id, children }: {
  title: ReactNode
  icon?: string
  right?: ReactNode
  className?: string
  id?: string
  children: ReactNode
}) {
  return (
    <section className={'card nn-card ' + (className || '')} id={id}>
      <header className="nn-head">
        {icon && <span className="nn-ico"><Ico d={icon} size={16} /></span>}
        <h3>{title}</h3>
        {right}
      </header>
      {children}
    </section>
  )
}

export function CoinBadge({ sym, size = 28 }: { sym: string; size?: number }) {
  const meta = coinMeta(sym)
  const inst = instrumentOf(sym)
  const img = (state.marketCaps as Record<string, { image?: string }> | undefined)?.[baseOf(sym)]?.image
  return (
    <span className="coin-badge" style={{
      width: size, height: size, color: meta.color, borderColor: meta.color + '66',
      background: meta.color + '1f', fontSize: size * 0.5, flexShrink: 0,
    }}>
      {img && !inst ? <img src={img} alt="" width={size} height={size} loading="lazy" decoding="async" /> : meta.icon}
    </span>
  )
}

/** Account growth, compounded; red below the start line. */
export function EquityCurve({ equity, height = 120 }: { equity: number[]; height?: number }) {
  if (equity.length < 2) return <p className="nn-empty">No trades yet — the curve starts with the first closed trade.</p>
  const W = 600
  const lo = Math.min(...equity, 1)
  const hi = Math.max(...equity, 1)
  const y = (v: number) => 6 + ((hi - v) / (hi - lo || 1)) * (height - 12)
  const pts = equity.map((v, i) => `${(i / (equity.length - 1)) * W},${y(v)}`).join(' ')
  const up = equity[equity.length - 1] >= 1
  return (
    <svg className="nn-eq" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" height={height} aria-label="Equity curve">
      <defs>
        <linearGradient id={up ? 'nnEqU' : 'nnEqD'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={up ? '#22e08a' : '#ff4d5e'} stopOpacity=".3" />
          <stop offset="1" stopColor={up ? '#22e08a' : '#ff4d5e'} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={y(1)} y2={y(1)} stroke="var(--hair-2)" strokeDasharray="4 4" />
      <polygon points={`0,${height} ${pts} ${W},${height}`} fill={`url(#${up ? 'nnEqU' : 'nnEqD'})`} />
      <polyline points={pts} fill="none" stroke={up ? '#22e08a' : '#ff4d5e'} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Bar({ v, cls = '' }: { v: number; cls?: string }) {
  return <span className={'nn-bar ' + cls}><i style={{ width: Math.max(0, Math.min(100, v * 100)) + '%' }} /></span>
}

/** Every public read of the crowd the app keeps, side by side. */
export function SentimentPanel() {
  useTick(3000, ['neuralnet'])
  const fg = state.fg as { value?: string | number; value_classification?: string } | null
  const ls = (state.ls as Array<{ longAccount?: number | string; shortAccount?: number | string }> | null) ?? []
  const lsl = ls[ls.length - 1]
  const long = lsl ? Number(lsl.longAccount) : null
  const fr = state.fr as { lastFundingRate?: string | number } | null
  const rate = fr?.lastFundingRate != null ? Number(fr.lastFundingRate) : null
  const sig = signalData as Array<{ master: { type: string } }>
  const buys = sig.filter((s) => s.master.type === 'BUY').length
  const sells = sig.filter((s) => s.master.type === 'SELL').length
  const bids = state.ob.bids.slice(0, 50).reduce((a, r) => a + Number(r[0]) * Number(r[1]), 0)
  const asks = state.ob.asks.slice(0, 50).reduce((a, r) => a + Number(r[0]) * Number(r[1]), 0)
  const rows: Array<[string, string, number | null, string]> = [
    ['Fear & Greed', fg?.value != null ? fg.value + ' · ' + (fg.value_classification ?? '') : '—', fg?.value != null ? Number(fg.value) / 100 : null, 'alternative.me, daily'],
    ['Accounts long', long != null ? (long * 100).toFixed(1) + '%' : '—', long, 'Binance futures long/short ratio'],
    ['Funding', rate != null ? (rate * 100).toFixed(4) + '%' : '—', rate != null ? Math.max(0, Math.min(1, 0.5 + rate * 500)) : null, 'positive = longs pay shorts'],
    ['Scanner breadth', sig.length ? `${buys} buy · ${sells} sell of ${sig.length}` : 'scanning…', buys + sells ? buys / (buys + sells) : null, 'signal scanner, 19 markets'],
    ['Order book bids', bids + asks ? ((bids / (bids + asks)) * 100).toFixed(1) + '%' : '—', bids + asks ? bids / (bids + asks) : null, 'top 50 levels, focused market'],
  ]
  return (
    <div className="nn-sentp">
      {rows.map(([k, v, f, note]) => (
        <div key={k} className="nn-sentr">
          <span><b>{k}</b><small>{note}</small></span>
          <em>{v}</em>
          <Bar v={f ?? 0} cls={f == null ? '' : f >= 0.55 ? 'g' : f <= 0.45 ? 'r' : 'a'} />
        </div>
      ))}
      <p className="nn-note"><Ico d={NI.gauge} size={12} /> Bars lean right when the crowd leans long.</p>
    </div>
  )
}
