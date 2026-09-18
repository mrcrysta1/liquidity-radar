import { useEffect, useState } from 'react';
import { useCharts, LAYOUTS } from '@/store/useCharts';
import { useApp } from '@/store/useApp';
import { streamHub, MAX_PARALLEL_STREAMS } from '@/core/ws/streamHub';
import { ChartInstance } from './ChartInstance';

/** Up to 16 charts per tab. The active chart drives the order book / futures / structure panels. */
export function ChartGrid() {
  const { charts, layout, activeId, setLayout } = useCharts(); const setSymbol = useApp(s => s.setSymbol); const setTf = useApp(s => s.setInterval);
  const active = charts.find(c => c.id === activeId) ?? charts[0];
  const [streams, setStreams] = useState(0); useEffect(() => { const id = setInterval(() => setStreams(streamHub.streamCount), 1000); return () => clearInterval(id); }, []);
  useEffect(() => { if (active) { setSymbol(active.symbol); setTf(active.timeframe as any); } }, [active?.symbol, active?.timeframe]);
  const shown = charts.slice(0, layout); const cols = layout <= 1 ? 1 : layout <= 4 ? 2 : layout <= 9 ? 3 : 4;
  return (
    <section className="panel" aria-label="Charts">
      <header><span className="muted">{shown.length} chart{shown.length>1?"s":""} · {streams}/{MAX_PARALLEL_STREAMS} streams</span><span className="spacer" />
        <div className="chips">{LAYOUTS.map(n => <button key={n} className={layout === n ? 'on' : ''} onClick={() => setLayout(n)} title={`${n} chart${n > 1 ? 's' : ''}`}>{n}</button>)}</div>
      </header>
      <div className="chart-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {shown.map(c => <ChartInstance key={c.id} cfg={c} active={c.id === active?.id} compact={layout > 4} />)}
      </div>
    </section>
  );
}
