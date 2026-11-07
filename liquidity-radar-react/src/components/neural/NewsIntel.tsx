// "News trading intelligence": which US economic releases move BTC, ETH and
// gold, how the bot's strategies did around them, why a trade is (or is not)
// called news-driven, and how the next release compares with past ones.
// Every rate is counted per release, with its sample size, a 95% range and a
// reliability label. Statistics: features/selflearn/newsIntel.ts; data: the
// bot's econ_events / econ_reactions / market_context and its trades.
import { useEffect, useMemo, useState } from 'react'
import { SERVER_BOT, loadNewsIntel } from '../../features/selflearn/serverBot'
import type { NewsIntelData } from '../../features/selflearn/serverBot'
import { ATTRIBUTION_LABEL, CATEGORY_LABEL, HORIZONS, attribute, categoryPerformance, categoryReactions, comparables, groupEvents } from '../../features/selflearn/newsIntel'
import type { Attribution, Reliability, Stat } from '../../features/selflearn/newsIntel'
import { NnCard } from './parts'
import { NI } from './icons'
import './NewsIntel.css'

const dash = '—'
const pct = (v: number | null | undefined, d = 0) => (v == null ? dash : (v * 100).toFixed(d) + '%')
const rr = (v: number | null | undefined) => (v == null ? dash : (v >= 0 ? '+' : '') + v.toFixed(2) + 'R')
const p2 = (v: number | null | undefined) => (v == null ? dash : v.toFixed(2) + '%')
const cls = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'up' : v < 0 ? 'dn' : '')
const range = (s: Stat, f: (v: number) => string) => (s.lo != null && s.hi != null ? `${f(s.lo)} to ${f(s.hi)}` : `${s.n} obs.`)
const hz = (h: number) => (h < 60 ? `${h}m` : h < 1440 ? `${h / 60}h` : '24h')
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const label = (c: string) => CATEGORY_LABEL[c] ?? c
const RELIABILITY: Record<Reliability, string> = { none: 'no data', anecdotal: 'anecdotal', weak: 'weak', moderate: 'moderate', usable: 'usable' }
const ASSETS: Array<[string, string]> = [['BTCUSDT', 'BTC'], ['ETHUSDT', 'ETH'], ['XAUUSDT', 'Gold']]
const PERIODS: Array<[string, string, number]> = [['all', 'All history', Infinity], ['1y', 'Last year', 365], ['90d', 'Last 90 days', 90], ['30d', 'Last 30 days', 30]]

export function NewsIntelCard() {
  const [data, setData] = useState<NewsIntelData | null | undefined>(undefined)
  const [err, setErr] = useState('')
  const [f, setF] = useState({ period: 'all', asset: 'BTCUSDT', horizon: '60', strategy: 'all', category: 'all' })
  useEffect(() => {
    if (!SERVER_BOT) return
    let alive = true
    loadNewsIntel().then((x) => alive && setData(x)).catch((e) => alive && setErr(String(e)))
    return () => {
      alive = false
    }
  }, [])
  const view = useMemo(() => {
    if (!data) return null
    const days = PERIODS.find((p) => p[0] === f.period)?.[2] ?? Infinity
    const from = Number.isFinite(days) ? data.now - days * 86_400_000 : -Infinity
    const all = groupEvents(data.events)
    const past = all.filter((e) => e.time <= data.now && e.time >= from && (f.category === 'all' || e.category === f.category))
    const reactions = data.reactions.filter((r) => r.time >= from)
    const trades = data.trades.filter((t) => t.entryTime >= from && (f.strategy === 'all' || t.strategy === f.strategy))
    const attributed = trades.map((t) => ({ t, a: attribute(t, past, reactions, data.context) }))
    const counts = {} as Record<Attribution, number>
    for (const x of attributed) counts[x.a.kind] = (counts[x.a.kind] ?? 0) + 1
    const next = all.find((e) => e.time > data.now && (f.category === 'all' || e.category === f.category)) ?? null
    const regimeNow = data.context.at(-1)?.regime ?? null
    return {
      past,
      reactionsN: new Set(reactions.filter((r) => r.asset !== 'none').map((r) => r.time)).size,
      cats: categoryReactions(past, reactions),
      perf: categoryPerformance(past, trades, reactions),
      trades: trades.length,
      counts,
      newsTrades: attributed.filter((x) => x.a.kind === 'news' || x.a.kind === 'mixed').slice(-8).reverse(),
      next,
      comps: next ? comparables(next, all, data.reactions, data.context, regimeNow) : [],
      regimeNow,
      first: all.find((e) => e.time <= data.now)?.time ?? null,
    }
  }, [data, f])
  if (!SERVER_BOT || data === null) return null
  const set = (k: keyof typeof f, v: string) => setF((o) => ({ ...o, [k]: v }))
  const sel = (k: keyof typeof f, aria: string, opts: Array<[string, string]>) => (
    <select value={f[k]} onChange={(e) => set(k, e.target.value)} aria-label={aria}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
  const h = Number(f.horizon)
  const assetName = ASSETS.find((a) => a[0] === f.asset)?.[1] ?? f.asset
  return (
    <NnCard title="News trading intelligence" icon={NI.flag} className="ni" right={<small className="ni-sub">US releases · per event, not per trade</small>}>
      {err && <p className="nn-err">{err}</p>}
      {data === undefined && !err && <p className="nn-empty">Loading releases and reactions…</p>}
      {data && view && !data.events.length && (
        <p className="nn-empty">No releases recorded yet. The bot collects the calendar every hour{data.missing.length ? ` (not set up yet: ${data.missing.join(', ')})` : ''}; past releases since 2019 appear once a FRED key is added.</p>
      )}
      {data && view && data.events.length > 0 && (
        <>
          <div className="lab-filters">
            {sel('period', 'Period', PERIODS.map(([v, l]) => [v, l]))}
            {sel('asset', 'Asset', ASSETS)}
            {sel('horizon', 'Time after release', HORIZONS.map((x) => [String(x), `+${hz(x)}`]))}
            {sel('category', 'Release', [['all', 'All releases'], ...[...new Set(data.events.map((e) => e.category))].sort().map((c): [string, string] => [c, label(c)])])}
            {sel('strategy', 'Strategy', [['all', 'All strategies'], ...[...new Set(data.trades.map((t) => t.strategy))].sort().map((s): [string, string] => [s, s.toUpperCase()])])}
            <small>{view.past.length} releases{view.first ? ` since ${day(view.first)}` : ''} · {view.reactionsN} with reactions</small>
          </div>

          <h4 className="ni-h">Which releases move {assetName} <small>+{hz(h)} after the release · mean size, 95% range across releases</small></h4>
          <div className="nn-tbl">
            <table className="lab-table ni-table">
              <thead><tr><th>Release</th><th>Events</th><th>Avg move</th><th title="Move in units of the asset's usual move over the same time">Avg size (σ)</th><th>Big moves (≥2σ)</th><th>Went up</th><th title="Correlation of the surprise (actual − forecast) with BTC's 1 h return">Surprise ↔ BTC</th></tr></thead>
              <tbody>
                {view.cats.map((c) => {
                  const x = c.assets[f.asset]?.[h]
                  return (
                    <tr key={c.category}>
                      <td><b>{label(c.category)}</b></td>
                      <td>{c.events}<small>{x ? `${x.n} measured` : 'none measured'}</small></td>
                      <td>{p2(x?.absRet.mean)}<small>{x ? range(x.absRet, (v) => v.toFixed(2)) : dash}</small></td>
                      <td>
                        <span className="ni-bar"><i style={{ width: Math.min(100, ((x?.absZ ?? 0) / 4) * 100) + '%' }} /></span>
                        {x?.absZ == null ? dash : x.absZ.toFixed(1) + 'σ'}
                      </td>
                      <td>{pct(x?.bigShare)}</td>
                      <td>{pct(x?.upShare)}<small className={cls(x?.ret.mean)}>avg {p2(x?.ret.mean)}</small></td>
                      <td>{c.surpriseCorr == null ? <span className="ni-dim">too few</span> : c.surpriseCorr.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <h4 className="ni-h">How the strategies did around releases <small>trades entered from the release to 24 h after · {view.trades} trades in the filter</small></h4>
          <div className="nn-tbl">
            <table className="lab-table ni-table">
              <thead><tr><th>Release</th><th title="Releases with at least one trade: the independent count">Events / trades</th><th>Won / lost</th><th title="Shrunk toward the strategy's overall win rate; 95% interval">Win chance</th><th>Avg win / loss</th><th>Expectancy</th><th>PF · DD</th><th>Long / short</th><th>Evidence</th></tr></thead>
              <tbody>
                {view.perf.map((p) => (
                  <tr key={p.category}>
                    <td><b>{label(p.category)}</b><small>BTC ±{p2(p.btc1h)} · gold ±{p2(p.gold1h)} in 1 h</small></td>
                    <td>{p.eventsWithTrades} / {p.trades}</td>
                    <td>{p.wins} / {p.losses}</td>
                    <td>{p.trades ? pct(p.win.p) : dash}<small>{p.trades ? `${pct(p.win.lo)}–${pct(p.win.hi)} · raw ${pct(p.win.raw)}` : dash}</small></td>
                    <td><span className="up">{rr(p.avgWin)}</span> / <span className="dn">{rr(p.avgLoss)}</span></td>
                    <td className={cls(p.expectancy.mean)}>{rr(p.expectancy.mean)}<small>{range(p.expectancy, (v) => rr(v))}</small></td>
                    <td>{p.pf == null ? dash : p.pf.toFixed(2)}<small>DD {p.maxDdR.toFixed(1)}R</small></td>
                    <td>{p.long.n ? rr(p.long.mean) : dash} / {p.short.n ? rr(p.short.mean) : dash}<small>{p.long.n} / {p.short.n}</small></td>
                    <td><span className={'ni-rel ni-' + p.reliability}>{RELIABILITY[p.reliability]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ni-note">
            A historical win rate is not the chance the next trade wins. The win chance is shrunk toward the strategy’s overall rate and its interval shows the uncertainty. Evidence: anecdotal under 5 independent releases, weak under 20, moderate under 50.
          </p>

          <div className="ni-cols">
            <section>
              <h4 className="ni-h">Why the trades happened</h4>
              <ul className="ni-attr">
                {(Object.keys(ATTRIBUTION_LABEL) as Attribution[]).map((k) => (
                  <li key={k}><span>{ATTRIBUTION_LABEL[k]}</span><b>{view.counts[k] ?? 0}</b></li>
                ))}
              </ul>
              <p className="ni-note">News-driven needs all three: entered within 4 h after a release, the market really moved (≥ 2σ in 1 h) and the trade went with it. Being near a release is not enough.</p>
              {view.newsTrades.length > 0 && (
                <ul className="ni-why">
                  {view.newsTrades.map(({ t, a }) => (
                    <li key={t.key}><b>{t.strategy.toUpperCase()} {t.symbol.replace('USDT', '')} {t.side > 0 ? 'long' : 'short'}</b> <span className={cls(t.r)}>{rr(t.r)}</span> — {a.why}</li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4 className="ni-h">Next release and comparable past ones</h4>
              {view.next ? (
                <>
                  <p className="ni-next">
                    <b>{label(view.next.category)}</b> · {view.next.title} · {when(view.next.time)}
                    <small>forecast {view.next.forecast ?? dash} · previous {view.next.previous ?? dash}{view.regimeNow ? ` · regime now ${view.regimeNow}` : ''}</small>
                  </p>
                  {view.comps.length ? (
                    <div className="nn-tbl">
                      <table className="lab-table ni-table">
                        <thead><tr><th>Past release</th><th>Regime then</th><th>Surprise</th><th>BTC 1 h</th><th>Gold 1 h</th></tr></thead>
                        <tbody>
                          {view.comps.map((c) => (
                            <tr key={c.event.time}>
                              <td>{day(c.event.time)}{c.event.decision && <small>{c.event.decision}</small>}</td>
                              <td>{c.regime ?? <span className="ni-dim">not recorded</span>}{c.sameRegime && <small>same as now</small>}</td>
                              <td>{c.event.surprise == null ? <span className="ni-dim">unknown</span> : (c.event.surprise > 0 ? '+' : '') + c.event.surprise}</td>
                              <td className={cls(c.btc1h?.ret)}>{p2(c.btc1h?.ret)}<small>{c.btc1h?.z == null ? '' : c.btc1h.z.toFixed(1) + 'σ'}</small></td>
                              <td className={cls(c.gold1h?.ret)}>{p2(c.gold1h?.ret)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="nn-empty">No earlier release of this kind recorded yet.</p>}
                  <p className="ni-note">Same category does not mean the same event: compare the regime and the surprise. Past reactions describe what happened, not what will.</p>
                </>
              ) : <p className="nn-empty">No upcoming release in the calendar.</p>}
            </section>
          </div>
        </>
      )}
    </NnCard>
  )
}
