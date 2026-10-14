import { useMemo } from 'react';
import { useMarket } from '@/store/useMarket';
import { swings, structureEvents } from '@/core/analysis/structure';
import { rsi, atr } from '@/core/indicators';
import { Panel } from './Panel'; import { Badge } from './Badge';
export function Structure() {
  const env = useMarket(s => s.candles);
  const v = useMemo(() => {
    const c = env?.data; if (!c || c.length < 30) return undefined;
    const sw = swings(c); const ev = structureEvents(c, sw); const close = c.map(k => k.close);
    const r = rsi(close)[close.length - 1] as number; const a = atr(c)[c.length - 1] as number;
    const lastH = [...sw].reverse().find(s => s.type === 'high'), lastL = [...sw].reverse().find(s => s.type === 'low');
    const seq = sw.slice(-6).map(s => s.label ?? (s.type === 'high' ? 'H' : 'L'));
    return { sw, ev: ev.slice(-5).reverse(), r, a, lastH, lastL, seq, last: close[close.length - 1] };
  }, [env]);
  return (
    <Panel title="Market structure" right={<Badge env={env} />} foot="Swings use 3-bar fractals; BOS/CHoCH fire on closes through the last confirmed swing.">
      {!v ? <div className="empty">Needs ≥30 candles.</div> : <>
        <dl className="kv">
          <dt>Last swings</dt><dd>{v.seq.join(' → ')}</dd>
          <dt>Nearest resistance</dt><dd>{v.lastH ? v.lastH.price.toLocaleString() : '—'} <span className="muted">{v.lastH ? `(+${(((v.lastH.price - v.last) / v.last) * 100).toFixed(2)}%)` : ''}</span></dd>
          <dt>Nearest support</dt><dd>{v.lastL ? v.lastL.price.toLocaleString() : '—'} <span className="muted">{v.lastL ? `(${(((v.lastL.price - v.last) / v.last) * 100).toFixed(2)}%)` : ''}</span></dd>
          <dt>RSI 14</dt><dd className={v.r > 70 ? 'down' : v.r < 30 ? 'up' : ''}>{v.r.toFixed(1)}</dd>
          <dt>ATR 14</dt><dd>{v.a.toFixed(4)} <span className="muted">({((v.a / v.last) * 100).toFixed(2)}%)</span></dd>
        </dl>
        <div className="muted" style={{ marginTop: 8 }}>Recent structure events</div>
        {v.ev.length === 0 ? <div className="muted">none</div> : v.ev.map(e => <div key={e.index}><span className={e.direction === 'bull' ? 'up' : 'down'}>{e.type} {e.direction}</span> through {e.price.toLocaleString()} <span className="muted">bar {e.index}</span></div>)}
      </>}
    </Panel>
  );
}
