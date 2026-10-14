import { useMarket } from '@/store/useMarket';
import { useApp } from '@/store/useApp';
import { toBinance } from '@/core/symbols/registry';
import { Panel } from './Panel';
export function Liquidations() {
  const liqs = useMarket(s => s.liquidations); const st = useMarket(s => s.wsStatus.fut); const sym = useApp(s => s.symbol);
  const recent = liqs.filter(l => Date.now() - l.ts < 5 * 60_000);
  const longs = recent.filter(l => l.side === 'SELL').reduce((s, l) => s + l.price * l.qty, 0), shorts = recent.filter(l => l.side === 'BUY').reduce((s, l) => s + l.price * l.qty, 0);
  const mine = liqs.filter(l => l.symbol === toBinance(sym));
  return (
    <Panel title="Liquidations (all Binance perps)" right={<span className={`badge ${st === 'open' ? 'LIVE' : 'OFFLINE'}`}>{st === 'open' ? 'LIVE' : 'ws ' + st}</span>} tight
      foot="Binance throttles this stream to ~1 event/s per symbol; totals are a lower bound. No free historical source — this session's events only.">
      <div style={{ padding: '4px 10px' }} className="muted">5m: <span className="down">longs ${(longs / 1e3).toFixed(0)}k</span> · <span className="up">shorts ${(shorts / 1e3).toFixed(0)}k</span> · {mine.length} on {sym}</div>
      {liqs.length === 0 ? <div className="empty">Listening for forced orders…</div> :
        <table><thead><tr><th>Symbol</th><th>Side</th><th>Price</th><th>Value</th><th>Time</th></tr></thead><tbody>
          {liqs.slice(0, 60).map((l, i) => <tr key={l.ts + i} className="row-hover" style={{ fontWeight: l.price * l.qty > 100_000 ? 600 : 400 }}><td>{l.symbol}</td><td className={l.side === 'SELL' ? 'down' : 'up'}>{l.side === 'SELL' ? 'long liq' : 'short liq'}</td><td>{l.price}</td><td>${((l.price * l.qty) / 1e3).toFixed(1)}k</td><td className="muted">{new Date(l.ts).toLocaleTimeString()}</td></tr>)}
        </tbody></table>}
    </Panel>
  );
}
