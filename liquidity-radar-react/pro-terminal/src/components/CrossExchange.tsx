import { useEffect, useState } from 'react';
import { useApp } from '@/store/useApp';
import { perExchange } from '@/providers';
import { bookMetrics, fmt } from '@/core/scores/liquidityScore';
import { Panel } from './Panel';
interface Row { id: string; last?: number; vol?: number; funding?: number; spread?: number; depth1?: number; err?: string }
export function CrossExchange() {
  const symbol = useApp(s => s.symbol); const [rows, setRows] = useState<Row[]>([]); const [ts, setTs] = useState(0);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const [tk, fd, dp] = await Promise.all([perExchange.ticker(symbol), perExchange.funding(symbol), perExchange.depth(symbol)]);
      const map = new Map<string, Row>();
      tk.forEach(r => { if (r.status === 'fulfilled') map.set(r.value.id, { id: r.value.id, last: r.value.t.last, vol: r.value.t.quoteVolume24h }); else map.set('?', { id: '?', err: String(r.reason) }); });
      dp.forEach(r => { if (r.status === 'fulfilled') { const m = bookMetrics(r.value.d); const row = map.get(r.value.id) ?? { id: r.value.id }; row.spread = m.spreadBps; row.depth1 = m.bidDepth1 + m.askDepth1; map.set(r.value.id, row); } });
      fd.forEach(r => { if (r.status === 'fulfilled') { const base = r.value.id.split('-')[0]; const row = map.get(base) ?? { id: base }; row.funding = r.value.f.rate; map.set(base, row); } });
      map.delete('?'); if (alive) { setRows([...map.values()]); setTs(Date.now()); }
    };
    run(); const t = setInterval(run, 15_000); return () => { alive = false; clearInterval(t); };
  }, [symbol]);
  const prices = rows.map(r => r.last).filter((x): x is number => !!x); const lo = Math.min(...prices), hi = Math.max(...prices);
  const gapBps = prices.length > 1 ? ((hi - lo) / lo) * 1e4 : 0;
  const fr = rows.map(r => r.funding).filter((x): x is number => x != null); const fSpread = fr.length > 1 ? (Math.max(...fr) - Math.min(...fr)) * 100 : 0;
  return (
    <Panel title="Cross-exchange radar" right={<span className="badge LIVE">{ts ? Math.round((Date.now() - ts) / 1000) + 's' : '…'}</span>} tight foot="Price gaps ignore fees, withdrawal status and transfer time. A gap is a signal to investigate, not a guaranteed profit.">
      <table><thead><tr><th>Venue</th><th>Last</th><th>24h vol</th><th>Spread</th><th>±1% depth</th><th>Funding</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.id} className="row-hover"><td>{r.id}</td><td className={r.last === hi ? 'up' : r.last === lo ? 'down' : ''}>{r.last?.toLocaleString() ?? '—'}</td><td>{r.vol ? '$' + fmt(r.vol) : '—'}</td><td>{r.spread != null ? r.spread.toFixed(2) + ' bps' : '—'}</td><td>{r.depth1 != null ? '$' + fmt(r.depth1) : '—'}</td><td className={r.funding != null ? (r.funding > 0 ? 'down' : 'up') : ''}>{r.funding != null ? (r.funding * 100).toFixed(4) + '%' : '—'}</td></tr>)}
      </tbody></table>
      {rows.length > 1 && <div style={{ padding: '6px 10px' }} className="muted">Price gap across venues: <b className={gapBps > 5 ? 'up' : ''}>{gapBps.toFixed(2)} bps</b> · funding dispersion: <b>{fSpread.toFixed(4)}%</b>{gapBps > 10 && <div className="regime"><b>Discrepancy signal</b>Gap above 10 bps between venues. Check withdrawal status and fees before acting.</div>}</div>}
    </Panel>
  );
}
