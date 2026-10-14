import { useMarket } from '@/store/useMarket';
import { Panel } from './Panel';
export function Tape() {
  const trades = useMarket(s => s.trades); const st = useMarket(s => s.wsStatus.spot);
  const buy = trades.filter(t => !t.isBuyerMaker).reduce((s, t) => s + t.qty * t.price, 0), sell = trades.filter(t => t.isBuyerMaker).reduce((s, t) => s + t.qty * t.price, 0);
  return (
    <Panel title="Trades" right={<span className={`badge ${st === 'open' ? 'LIVE' : 'OFFLINE'}`}>{st === 'open' ? 'LIVE' : 'ws ' + st}</span>} tight>
      {trades.length === 0 ? <div className="empty">No trades yet. Stream connects to Binance aggTrade.</div> : <>
        <div style={{ padding: '4px 10px' }} className="muted">last {trades.length}: <span className="up">buy ${(buy / 1e3).toFixed(1)}k</span> · <span className="down">sell ${(sell / 1e3).toFixed(1)}k</span></div>
        <table><tbody>{trades.slice(0, 40).map((t, i) => <tr key={t.ts + '-' + i}><td className={t.isBuyerMaker ? 'down' : 'up'}>{t.price.toLocaleString()}</td><td>{t.qty.toFixed(4)}</td><td className="muted">{new Date(t.ts).toLocaleTimeString()}</td></tr>)}</tbody></table></>}
    </Panel>
  );
}
