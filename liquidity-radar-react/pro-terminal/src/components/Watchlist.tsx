import { useEffect, useState } from 'react';
import { useApp } from '@/store/useApp';
import { ticker } from '@/providers';
import type { Ticker } from '@/core/providers/types';
import { Panel } from './Panel';
export function Watchlist() {
  const { watchlists, activeWatchlist, symbol, setSymbol, removeFromWatchlist, togglePin, setActiveWatchlist, createWatchlist } = useApp();
  const wl = watchlists.find(w => w.id === activeWatchlist) ?? watchlists[0];
  const [tk, setTk] = useState<Record<string, Ticker>>({});
  useEffect(() => {
    let alive = true;
    const run = async () => { const out: Record<string, Ticker> = {}; await Promise.all(wl.symbols.map(async s => { try { out[s] = (await ticker.get(s)).data; } catch { /* keep blank */ } })); if (alive) setTk(out); };
    run(); const t = setInterval(run, 10_000); return () => { alive = false; clearInterval(t); };
  }, [wl.symbols.join(',')]);
  const ordered = [...wl.pinned.filter(s => wl.symbols.includes(s)), ...wl.symbols.filter(s => !wl.pinned.includes(s))];
  return (
    <Panel title="Watchlist" tight right={<>
      <select value={activeWatchlist} onChange={e => setActiveWatchlist(e.target.value)} style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 4 }}>{watchlists.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      <button onClick={() => { const n = prompt('Watchlist name'); if (n) createWatchlist(n); }} title="New watchlist">+</button></>}>
      <div className="list">{ordered.length === 0 && <div className="empty">Empty. Search a symbol above and press Enter to add it.</div>}
        {ordered.map(s => { const t = tk[s]; return (
          <div key={s} className={`item ${s === symbol ? 'on' : ''}`} onClick={() => setSymbol(s)} onKeyDown={e => e.key === 'Enter' && setSymbol(s)} tabIndex={0} role="button">
            <span><span className={`pin ${wl.pinned.includes(s) ? 'on' : ''}`} onClick={e => { e.stopPropagation(); togglePin(s); }} title="Pin">●</span> {s.replace('-USDT', '')}</span>
            <span>{t ? t.last.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}</span>
            <span className={t ? (t.change24h >= 0 ? 'up' : 'down') : 'muted'} onDoubleClick={e => { e.stopPropagation(); removeFromWatchlist(s); }} title="Double-click to remove">{t ? `${t.change24h >= 0 ? '+' : ''}${t.change24h.toFixed(2)}%` : ''}</span>
          </div>); })}
      </div>
    </Panel>
  );
}
