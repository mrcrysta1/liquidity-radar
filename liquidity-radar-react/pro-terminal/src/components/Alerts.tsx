import { useEffect, useState } from 'react';
import { useAlerts, requestNotifications } from '@/store/useAlerts';
import { useApp } from '@/store/useApp';
import { ALERT_LIMITS, type AlertKind } from '@/core/alerts/engine';
import { Panel } from './Panel';

const PRICE = ['crosses_above', 'crosses_below', 'above', 'below', 'pct_change_24h_above', 'pct_change_24h_below'];
const TECH = ['rsi_above', 'rsi_below', 'ema_cross_up', 'ema_cross_down', 'macd_cross_up', 'macd_cross_down', 'close_above_sma', 'close_below_sma'];
const WATCH = ['any_pct_24h_above', 'any_pct_24h_below', 'count_above_pct'];

export function Alerts() {
  const { rules, events, add, remove, toggle, tick, counts, clearEvents, lastRun, error } = useAlerts();
  const { symbol, watchlists, activeWatchlist } = useApp();
  const [kind, setKind] = useState<AlertKind>('price'); const [cond, setCond] = useState(PRICE[0]); const [value, setValue] = useState(''); const [value2, setValue2] = useState(''); const [tf, setTf] = useState('15m'); const [once, setOnce] = useState(true); const [msg, setMsg] = useState<string>();
  const [notif, setNotif] = useState(typeof Notification !== 'undefined' && Notification.permission === 'granted');
  useEffect(() => { tick(); const id = setInterval(tick, 20_000); return () => clearInterval(id); }, []);
  const c = counts(); const conds = kind === 'price' ? PRICE : kind === 'technical' ? TECH : WATCH;
  const submit = () => {
    const v = Number(value); if (!Number.isFinite(v)) { setMsg('Enter a numeric value'); return; }
    const name = kind === 'watchlist' ? `${watchlists.find(w => w.id === activeWatchlist)?.name}: ${cond.replace(/_/g, ' ')} ${v}` : `${symbol} ${cond.replace(/_/g, ' ')} ${v}${value2 ? `/${value2}` : ''}`;
    const r = add({ kind, name, condition: cond as any, value: v, value2: value2 ? Number(value2) : undefined, once, symbol: kind === 'watchlist' ? undefined : symbol, watchlistId: kind === 'watchlist' ? activeWatchlist : undefined, timeframe: kind === 'technical' ? tf : undefined });
    setMsg(r.ok ? `Alert added for ${kind === 'watchlist' ? 'watchlist' : symbol}` : r.reason); if (r.ok) setValue('');
  };
  return (
    <Panel title="Alerts" right={<><span className="muted">{c.price}/{ALERT_LIMITS.price} price · {c.technical}/{ALERT_LIMITS.technical} technical · {c.watchlist}/{ALERT_LIMITS.watchlist} watchlist</span>{!notif && <button onClick={async () => setNotif(await requestNotifications())}>Enable browser notifications</button>}</>}
      foot={`Evaluated every 20s from Binance public data (1 request for all prices). ${lastRun ? `Last run ${new Date(lastRun).toLocaleTimeString()}.` : ''} ${error ? `Error: ${error}` : ''}`}>
      <div className="alert-form">
        <select value={kind} onChange={e => { const k = e.target.value as AlertKind; setKind(k); setCond((k === 'price' ? PRICE : k === 'technical' ? TECH : WATCH)[0]); }}><option value="price">Price</option><option value="technical">Technical</option><option value="watchlist">Watchlist</option></select>
        <span className="muted">{kind === 'watchlist' ? watchlists.find(w => w.id === activeWatchlist)?.name : symbol}</span>
        <select value={cond} onChange={e => setCond(e.target.value)}>{conds.map(x => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}</select>
        <input type="number" step="any" placeholder={cond.startsWith('ema') ? 'fast' : cond.includes('sma') ? 'length' : 'value'} value={value} onChange={e => setValue(e.target.value)} style={{ width: 90 }} />
        {(cond.startsWith('ema') || cond === 'count_above_pct') && <input type="number" step="any" placeholder={cond.startsWith('ema') ? 'slow' : 'count'} value={value2} onChange={e => setValue2(e.target.value)} style={{ width: 70 }} />}
        {kind === 'technical' && <select value={tf} onChange={e => setTf(e.target.value)}>{['1m', '5m', '15m', '1h', '4h', '1d'].map(x => <option key={x}>{x}</option>)}</select>}
        <label className="muted"><input type="checkbox" checked={once} onChange={e => setOnce(e.target.checked)} /> once</label>
        <button className="on" onClick={submit}>Create alert</button>
        {msg && <span className="muted">{msg}</span>}
      </div>
      <div className="alert-cols">
        <div><div className="muted" style={{ marginBottom: 4 }}>Rules ({rules.length})</div>
          {rules.length === 0 ? <div className="muted">No alerts yet.</div> : rules.slice(0, 200).map(r => <div key={r.id} className="alert-row"><input type="checkbox" checked={r.enabled} onChange={() => toggle(r.id)} /><span className={r.enabled ? '' : 'muted'}>{r.name}</span><span className="muted">{r.kind}{r.triggerCount ? ` · fired ${r.triggerCount}×` : ''}</span><button onClick={() => remove(r.id)}>×</button></div>)}
          {rules.length > 200 && <div className="muted">…and {rules.length - 200} more</div>}</div>
        <div><div className="muted" style={{ marginBottom: 4 }}>Triggered ({events.length}) {events.length > 0 && <button onClick={clearEvents}>clear</button>}</div>
          {events.length === 0 ? <div className="muted">Nothing triggered yet.</div> : events.slice(0, 50).map(e => <div key={e.id} className="alert-row"><span className="up">●</span><span>{e.name}</span><span className="muted">{e.message}</span><span className="muted">{new Date(e.ts).toLocaleTimeString()}</span></div>)}</div>
      </div>
    </Panel>
  );
}
