import { useEffect, useState } from 'react';
import { useApp } from '@/store/useApp';
import { useMarket } from '@/store/useMarket';
import { useUI } from '@/store/useUI';
import { PRESET_TIMEFRAMES, parseTimeframe, fmtTf } from '@/core/timeframes';
import { useCharts } from '@/store/useCharts';
import { fromBinance } from '@/core/symbols/registry';
import { getJSON } from '@/providers/http';
import { Badge } from './Badge';
import { IcPanelL, IcPanelR, IcPanelB } from './Icons';

export function Header() {
  const { symbol, interval, setSymbol, addToWatchlist } = useApp();
  const { charts, activeId, update, customTimeframes, addCustomTimeframe } = useCharts();
  const { view, toggleLeft, toggleRight, toggleDrawer, leftOpen, rightOpen, drawerOpen } = useUI();
  const setIv = (tf: string) => { const a = charts.find(c => c.id === activeId) ?? charts[0]; if (a) update(a.id, { timeframe: tf }); };
  const setSym = (s: string) => { setSymbol(s); const a = charts.find(c => c.id === activeId) ?? charts[0]; if (a) update(a.id, { symbol: s }); };
  const t = useMarket(s => s.ticker); const errors = useMarket(s => s.errors); const ws = useMarket(s => s.wsStatus);
  const [q, setQ] = useState(''); const [all, setAll] = useState<string[]>([]); const [open, setOpen] = useState(false); const [customTf, setCustomTf] = useState('');
  useEffect(() => { getJSON<any>(`${(import.meta as any).env?.VITE_BINANCE_SPOT ?? 'https://api.binance.com'}/api/v3/exchangeInfo?permissions=SPOT`).then(d => setAll(d.symbols.filter((s: any) => s.status === 'TRADING' && s.quoteAsset === 'USDT').map((s: any) => fromBinance(s.symbol)))).catch(() => setAll([])); }, []);
  const hits = q ? all.filter(s => s.toLowerCase().includes(q.toLowerCase())).slice(0, 30) : [];
  const pick = (s: string) => { setSym(s); addToWatchlist(s); setQ(''); setOpen(false); };
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); (document.getElementById('symsearch') as HTMLInputElement)?.focus(); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);
  const chg = t?.data.change24h ?? 0;
  return (
    <header className="topbar">
      <div className="sym-block">
        <div className="search"><input id="symsearch" placeholder="Search symbol  ⌘K" value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={e => { if (e.key === 'Enter' && hits[0]) pick(hits[0]); if (e.key === 'Escape') setOpen(false); }} />
          {open && hits.length > 0 && <div className="results">{hits.map(s => <div key={s} onMouseDown={() => pick(s)}>{s}</div>)}</div>}</div>
        <div className="sym-name"><b>{symbol.split('-')[0]}</b><span className="muted">/{symbol.split('-')[1]}</span></div>
        {t && <div className="price-block"><span className="price">{t.data.last.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span><span className={`chg ${chg >= 0 ? 'up' : 'down'}`}>{chg >= 0 ? '▲' : '▼'} {Math.abs(chg).toFixed(2)}%</span>
          <span className="muted hi-lo">H {t.data.high24h.toLocaleString()} · L {t.data.low24h.toLocaleString()} · Vol ${(t.data.quoteVolume24h / 1e6).toFixed(0)}M</span></div>}
        <Badge env={t} />
      </div>
      {view === 'terminal' && <div className="tf scroll-x">{[...PRESET_TIMEFRAMES, ...customTimeframes].map(i => <button key={i} className={i === interval ? 'on' : ''} onClick={() => setIv(i)} title={customTimeframes.includes(i) ? 'Custom timeframe' : i.endsWith('s') && i !== '1s' ? 'Built from 1s candles' : ''}>{i}</button>)}
        <form onSubmit={e => { e.preventDefault(); const sec = parseTimeframe(customTf); if (sec) { const tf = fmtTf(sec); addCustomTimeframe(tf); setIv(tf); setCustomTf(''); } }}><input value={customTf} onChange={e => setCustomTf(e.target.value)} placeholder="+ 45m" aria-label="Custom timeframe" className="tf-custom" /></form></div>}
      <span className="spacer" />
      <div className="top-right">
        <span className={`stat-chip ${ws.spot === 'open' ? 'ok' : 'bad'}`} title="WebSocket status"><i className={`dot ${ws.spot === 'open' ? 'ok' : 'bad'}`} />{ws.spot === 'open' ? 'streaming' : 'ws ' + ws.spot}</span>
        {errors.length > 0 && <span className="stat-chip warn" title={errors.join('\n')}>{errors.length} provider errors</span>}
        {view === 'terminal' && <div className="seg icon-seg"><button className={leftOpen ? 'on' : ''} onClick={toggleLeft} title="Watchlist column"><IcPanelL /></button><button className={rightOpen ? 'on' : ''} onClick={toggleRight} title="Sidebar"><IcPanelR /></button><button className={drawerOpen ? 'on' : ''} onClick={toggleDrawer} title="Bottom drawer"><IcPanelB /></button></div>}
      </div>
    </header>
  );
}
