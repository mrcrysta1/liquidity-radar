// Settings: what this app talks to, what each feed is for, and whether it is
// answering right now.
//
// The register is the source of truth (services/dataSources); this renders it
// and overlays live traffic recorded by the API client, so a feed that has gone
// quiet is visible instead of silently missing from the UI.
import { useEffect, useMemo, useState } from 'react'
import {
  ALL_SOURCES,
  SOURCE_GROUPS,
  sourceStats,
  unmatchedHosts,
} from '../services/dataSources'
import type { DataSource, Transport } from '../services/dataSources'
import { cooldownLeft, isRateLimited } from '../api/rateLimit'
import { PALETTES, applyPalette, activePalette } from '../features/theme/theme'

const AGO = (ms: number): string => {
  if (!ms) return 'never'
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return s + 's ago'
  const m = Math.floor(s / 60)
  return m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ago'
}

function TransportTag({ t }: { t: Transport }) {
  const cls = t === 'WebSocket' ? 'ws' : t === 'RSS' ? 'rss' : 'rest'
  return <span className={'ds-tp ' + cls}>{t === 'WebSocket' ? 'WS' : t}</span>
}

function Row({ s, now }: { s: DataSource; now: number }) {
  const st = sourceStats()[s.id]
  const state = !st ? 'idle' : st.lastOk ? 'ok' : 'fail'
  const label = !st ? 'no traffic yet' : st.lastOk ? 'healthy' : 'failing'
  void now // re-render clock
  return (
    <tr className="row-hover">
      <td>
        <span className={'ds-dot ' + state} title={label} />
        <span className="ds-name" title={s.purpose}>
          {s.name}
        </span>
        <TransportTag t={s.transport} />
        {s.note && (
          <span className="ds-info" title={s.note} aria-label={s.note}>
            i
          </span>
        )}
        <span className="ds-purpose">{s.purpose}</span>
      </td>
      <td className="ds-mono">{s.provider}</td>
      <td className="ds-mono ds-ep" title={s.endpoint}>
        {s.endpoint}
      </td>
      <td className="ds-mono">{s.cadence}</td>
      <td className="ds-mono ds-num">{st ? st.calls : '—'}</td>
      <td className={'ds-mono ds-num ' + (st && st.errors ? 'dn' : '')}>{st ? st.errors : '—'}</td>
      <td className="ds-mono ds-num">{st && st.lastMs ? st.lastMs + 'ms' : '—'}</td>
      <td className="ds-mono ds-num">{st ? AGO(st.lastAt) : '—'}</td>
    </tr>
  )
}

export function SettingsPage() {
  const [now, setNow] = useState(() => Date.now())
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'all' | Transport>('all')

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 2000)
    return () => clearInterval(id)
  }, [])

  const needle = q.trim().toLowerCase()
  const groups = useMemo(
    () =>
      SOURCE_GROUPS.map((g) => ({
        ...g,
        sources: g.sources.filter(
          (s) =>
            (only === 'all' || s.transport === only) &&
            (!needle ||
              (s.name + ' ' + s.provider + ' ' + s.purpose + ' ' + s.usedBy + ' ' + s.endpoint)
                .toLowerCase()
                .includes(needle)),
        ),
      })).filter((g) => g.sources.length),
    [needle, only],
  )

  const stats = sourceStats()
  const live = ALL_SOURCES.filter((s) => stats[s.id]).length
  const failing = ALL_SOURCES.filter((s) => stats[s.id] && !stats[s.id].lastOk).length
  const calls = Object.values(stats).reduce((a, b) => a + b.calls, 0)
  const errors = Object.values(stats).reduce((a, b) => a + b.errors, 0)
  const stray = Object.entries(unmatchedHosts())
  const cool = isRateLimited() ? Math.ceil(cooldownLeft() / 1000) : 0
  const pal = activePalette()

  return (
    <>
      <div className="ds-stats">
        <div className="metric">
          <div className="ml">
            <span>Registered sources</span>
          </div>
          <div className="mv">{ALL_SOURCES.length}</div>
          <div className="ms">{SOURCE_GROUPS.length} groups · none require an API key</div>
        </div>
        <div className="metric">
          <div className="ml">
            <span>Answering</span>
            <span className={'badge ' + (failing ? 'b-amber' : 'b-green')}>
              {failing ? failing + ' FAILING' : 'HEALTHY'}
            </span>
          </div>
          <div className="mv">
            {live}
            <small style={{ fontSize: '14px', color: 'var(--dim)' }}> / {ALL_SOURCES.length}</small>
          </div>
          <div className="ms">seen since this page loaded the app</div>
        </div>
        <div className="metric">
          <div className="ml">
            <span>Requests this session</span>
          </div>
          <div className="mv">{calls}</div>
          <div className="ms">{errors} failed</div>
        </div>
        <div className="metric">
          <div className="ml">
            <span>Binance rate limit</span>
            <span className={'badge ' + (cool ? 'b-red' : 'b-green')}>
              {cool ? 'COOLING' : 'CLEAR'}
            </span>
          </div>
          <div className="mv">{cool ? cool + 's' : 'OK'}</div>
          <div className="ms">
            {cool ? 'requests are held until this clears' : 'calls are spaced and budget-capped'}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="sec-head">
          <div className="sec-title">Data Sources</div>
          <span className="badge b-cyan">LIVE STATUS</span>
        </div>
        <div className="dt-bar">
          <span className="dt-search">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search sources, providers, purposes…"
              aria-label="Search data sources"
              autoComplete="off"
            />
          </span>
          <span className="ds-filters">
            {(['all', 'REST', 'WebSocket'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className={'sig-chip' + (only === t ? ' on' : '')}
                onClick={() => setOnly(t)}
              >
                {t === 'all' ? 'All' : t === 'WebSocket' ? 'Streams' : 'REST'}
              </button>
            ))}
          </span>
        </div>

        {groups.length === 0 && <div className="sig-empty">No source matches “{q}”.</div>}

        {groups.map((g) => (
          <div className="ds-group" key={g.id}>
            <div className="ds-group-head">
              <b>{g.label}</b>
              <span>{g.blurb}</span>
            </div>
            <div className="table-scroll">
              <table className="fc-table ds-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Provider</th>
                    <th>Endpoint</th>
                    <th>Cadence</th>
                    <th className="ds-num">Calls</th>
                    <th className="ds-num">Errors</th>
                    <th className="ds-num">Last</th>
                    <th className="ds-num">Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {g.sources.map((s) => (
                    <Row key={s.id} s={s} now={now} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <div className="fc-note">
          Hover any source name for what it is used for. Everything here is a public, keyless
          endpoint — no credentials are stored or sent by this app. Counts cover this browser
          session only.
        </div>
      </div>

      {stray.length > 0 && (
        <div className="card">
          <div className="sec-head">
            <div className="sec-title">Unregistered traffic</div>
            <span className="badge b-amber">{stray.length} HOSTS</span>
          </div>
          <div className="fc-note" style={{ marginTop: 0 }}>
            These hosts were called but are not in the register above — either a new source was
            added without documenting it, or something is calling out that should not be.
          </div>
          <ul className="ds-stray">
            {stray.map(([host, n]) => (
              <li key={host}>
                <b>{host}</b>
                <span>{n} calls</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="sec-head">
          <div className="sec-title">Appearance</div>
          <span className="badge b-purple">{pal.name.toUpperCase()}</span>
        </div>
        <div className="ds-pal">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={'ds-pal-card' + (p.id === pal.id ? ' on' : '')}
              onClick={() => applyPalette(p.id)}
              title={p.desc.replace(/&amp;/g, '&')}
            >
              <span className="ds-pal-sw">
                {p.sw.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <b>{p.name}</b>
              <small>{p.desc.replace(/&amp;/g, '&')}</small>
            </button>
          ))}
        </div>
        <div className="fc-note">
          Light and dark are switched with the <b>D</b>/<b>L</b> button in the header; each palette
          carries both faces.
        </div>
      </div>
    </>
  )
}
