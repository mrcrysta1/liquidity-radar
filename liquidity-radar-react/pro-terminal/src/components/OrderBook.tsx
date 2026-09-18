import { useMemo } from 'react';
import { useMarket } from '@/store/useMarket';
import { bookMetrics, fmt } from '@/core/scores/liquidityScore';
import { Panel } from './Panel'; import { Badge } from './Badge';

export function OrderBook() {
  const env = useMarket(s => s.book);
  const m = useMemo(() => (env ? bookMetrics(env.data) : undefined), [env]);
  if (!env || !m) return <Panel title="Order book" right={<Badge env={env} />}><div className="empty">Waiting for depth…</div></Panel>;
  const b = env.data; const n = 18; const bids = b.bids.slice(0, n), asks = b.asks.slice(0, n).reverse();
  const max = Math.max(...bids.map(l => l.size), ...asks.map(l => l.size), 1e-9);
  const wallSet = new Set(m.walls.map(w => `${w.side}:${w.price}`));
  const Lvl = ({ l, side }: { l: { price: number; size: number }; side: 'bid' | 'ask' }) => (
    <div className={`lvl ${side} ${wallSet.has(`${side}:${l.price}`) ? `wall ${side}` : ''}`}>
      <i style={{ width: `${(l.size / max) * 100}%` }} /><span>{l.price.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span><span>{l.size.toFixed(4)}</span>
    </div>);
  return (
    <Panel title="Order book" right={<Badge env={env} />} tight>
      <div className="book">
        <div>{asks.map(l => <Lvl key={l.price} l={l} side="ask" />)}</div>
        <div>{bids.map(l => <Lvl key={l.price} l={l} side="bid" />)}</div>
        <div className="mid">spread {m.spreadBps.toFixed(2)} bps · imbalance <span className={m.imbalance1 > 0 ? 'up' : 'down'}>{(m.imbalance1 * 100).toFixed(0)}%</span> · ±1% depth ${fmt(m.bidDepth1)} / ${fmt(m.askDepth1)}</div>
      </div>
      <div style={{ padding: '6px 10px' }}>
        <div className="muted" style={{ marginBottom: 4 }}>Slippage to fill at market</div>
        <table><thead><tr><th>Size</th><th>Buy</th><th>Sell</th></tr></thead><tbody>
          {[10_000, 100_000, 1_000_000].map(nt => { const bq = m.slippage.find(s => s.notional === nt && s.side === 'buy')!, sq = m.slippage.find(s => s.notional === nt && s.side === 'sell')!;
            return <tr key={nt}><td>${fmt(nt)}</td><td>{bq.filled ? bq.bps.toFixed(2) + ' bps' : 'unfilled'}</td><td>{sq.filled ? sq.bps.toFixed(2) + ' bps' : 'unfilled'}</td></tr>; })}
        </tbody></table>
        {m.walls.length > 0 && <div style={{ marginTop: 6 }}><div className="muted">Walls (≥5× avg level)</div>{m.walls.slice(0, 4).map(w => <div key={w.side + w.price}><span className={w.side === 'bid' ? 'up' : 'down'}>{w.side}</span> {w.price} · {w.size.toFixed(2)} ({w.multiple.toFixed(0)}×)</div>)}</div>}
      </div>
    </Panel>
  );
}
