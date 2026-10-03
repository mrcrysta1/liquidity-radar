// Market tab chrome in the same style as the Signals / Self Learning pages:
// a page header with live stats, quick-jump chips, and card headers with an
// icon, a title and a one-line explanation. The numbers inside the stats and
// tables are still written by the engine (features/snapshots) into the same
// element ids as before — only the markup around them changed.
import type { ReactNode } from 'react'
import { HOT_LIST } from '../../constants/market'
import { MK_ICONS } from './mkIcons'

export function MkIco({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** Card header: icon tile, title, one-line explanation, optional badge/actions on the right. */
export function SecHead({ icon, title, sub, tone = 'green', right }: { icon: string; title: string; sub?: string; tone?: 'green' | 'purple' | 'pink' | 'amber' | 'cyan'; right?: ReactNode }) {
  return (
    <div className="mk-head">
      <span className={'mk-ico t-' + tone}><MkIco d={icon} /></span>
      <span className="mk-ttl">
        <h3>{title}</h3>
        {sub && <p>{sub}</p>}
      </span>
      {right && <span className="mk-right">{right}</span>}
    </div>
  )
}

const JUMPS: Array<[string, string]> = [
  ['mkWatch', 'Watchlist'],
  ['mkTop', 'Top coins'],
  ['mkFut', 'Futures'],
  ['mkCeleb', 'Celebrity coins'],
  ['mkMeme', 'Meme universe'],
]

export function MarketHead() {
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <>
      <header className="sg-head mk-page">
        <div className="sg-title">
          <span className="sg-logo"><MkIco d={MK_ICONS.market} size={28} /></span>
          <span>
            <h2>Market Overview</h2>
            <p>Live spot prices, perpetual futures and meme coins, straight from Binance</p>
          </span>
        </div>
        <div className="sg-stats">
          <div className="sg-stat">
            <span className="sg-stat-ico"><MkIco d={MK_ICONS.vol} size={20} /></span>
            <span><small>Tracked volume</small><b id="moVol">—</b><em>sum of {HOT_LIST.length} majors (24h)</em></span>
          </div>
          <div className="sg-stat">
            <span className="sg-stat-ico mk-ico-cyan"><MkIco d={MK_ICONS.breadth} size={20} /></span>
            <span><small>Market breadth</small><b><span className="up" id="moAdv">—</span> <i className="mk-vs">vs</i> <span className="dn" id="moDec">—</span></b><em>advancing vs declining</em></span>
          </div>
          <div className="sg-stat">
            <span className="sg-stat-ico"><MkIco d={MK_ICONS.gauge} size={20} /></span>
            <span><small>Fear &amp; Greed</small><b id="moFG">—</b><em id="moFGc" className="mk-wrap">market sentiment</em></span>
          </div>
        </div>
      </header>
      <nav className="sg-chips mk-jump" aria-label="Market sections">
        {JUMPS.map(([id, l]) => (
          <button key={id} type="button" onClick={() => jump(id)}>{l}</button>
        ))}
      </nav>
    </>
  )
}
