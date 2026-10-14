import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, AreaSeries, HistogramSeries, createSeriesMarkers, type IChartApi, type ISeriesApi, type UTCTimestamp, type IPriceLine, type ISeriesMarkersPluginApi, type SeriesMarker, type Time } from 'lightweight-charts';
import { useCharts, type ChartConfig, type ChartType } from '@/store/useCharts';
import { useCandles } from '@/hooks/useCandles';
import { computeAll } from '@/core/indicators/registry';
import { volumeProfile } from '@/core/indicators/volumeProfile';
import { VolumeProfilePrimitive } from '@/core/chart/volumeProfilePrimitive';
import { buildRangeBars } from '@/core/chart/rangeBars';
import { atr } from '@/core/indicators';
import { isSubMinute } from '@/core/timeframes';
import { IndicatorMenu } from './IndicatorMenu';
import { Badge } from './Badge';

const TYPES: { v: ChartType; l: string }[] = [{ v: 'candles', l: 'Candles' }, { v: 'line', l: 'Line' }, { v: 'area', l: 'Area' }, { v: 'range', l: 'Range bars' }];

export function ChartInstance({ cfg, active, compact }: { cfg: ChartConfig; active: boolean; compact: boolean }) {
  const { update, setActive } = useCharts();
  const { env, loadMore, loadingMore, exhausted, bars, maxBars } = useCandles(cfg.symbol, cfg.timeframe);
  const ref = useRef<HTMLDivElement>(null); const chart = useRef<IChartApi | undefined>(undefined);
  const main = useRef<ISeriesApi<any> | undefined>(undefined); const mainType = useRef<ChartType>('candles');
  const lines = useRef<Record<string, ISeriesApi<any>>>({}); const vpPrim = useRef<VolumeProfilePrimitive | undefined>(undefined);
  const priceLines = useRef<{ s: ISeriesApi<any>; l: IPriceLine }[]>([]); const markers = useRef<Map<string, ISeriesMarkersPluginApi<Time>>>(new Map());
  const [menu, setMenu] = useState(false); const [symInput, setSymInput] = useState(cfg.symbol);
  // Bar replay
  const [replay, setReplay] = useState<{ on: boolean; idx: number; playing: boolean; speed: number }>({ on: false, idx: 0, playing: false, speed: 1 });

  const source = env?.data ?? [];
  const rangeSize = useMemo(() => cfg.type !== 'range' || !source.length ? 0 : cfg.rangeSize ?? Math.max(1e-8, (atr(source.slice(-300), 14).filter(Boolean).at(-1) as number) || (source.at(-1)!.close * 0.002)), [cfg.type, cfg.rangeSize, source]);
  const series = useMemo(() => (cfg.type === 'range' ? buildRangeBars(source, rangeSize) : source), [source, cfg.type, rangeSize]);
  const shown = useMemo(() => (replay.on ? series.slice(0, Math.max(1, Math.min(replay.idx, series.length))) : series), [series, replay.on, replay.idx]);
  const computed = useMemo(() => computeAll(cfg.indicators, shown), [cfg.indicators, shown]);
  const vpInst = cfg.indicators.find(i => i.type === 'vp' && i.visible);
  const vp = useMemo(() => (vpInst ? volumeProfile(shown.slice(-Math.min(shown.length, 2000)), vpInst.params.rows ?? 48, (vpInst.params.va ?? 70) / 100) : null), [vpInst, shown]);

  useEffect(() => {
    if (!ref.current) return;
    const c = createChart(ref.current, { layout: { background: { color: '#151a21' }, textColor: '#a7b3c0', fontFamily: 'Manrope', attributionLogo: false }, grid: { vertLines: { color: '#1b222b' }, horzLines: { color: '#1b222b' } }, crosshair: { mode: 0 }, rightPriceScale: { borderColor: '#262f3b' }, timeScale: { borderColor: '#262f3b', timeVisible: true }, autoSize: true });
    chart.current = c;
    const onRange = () => { const r = c.timeScale().getVisibleLogicalRange(); if (r && r.from < 50) loadMoreRef.current(); };
    c.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => { c.remove(); chart.current = undefined; main.current = undefined; lines.current = {}; vpPrim.current = undefined; };
  }, []);
  const loadMoreRef = useRef(loadMore); loadMoreRef.current = loadMore;
  useEffect(() => { chart.current?.applyOptions({ timeScale: { secondsVisible: isSubMinute(cfg.timeframe) || cfg.type === 'range' } }); }, [cfg.timeframe, cfg.type]);

  // main series (re-create when type changes)
  useEffect(() => {
    const c = chart.current; if (!c) return;
    if (!main.current || mainType.current !== cfg.type) {
      if (main.current) c.removeSeries(main.current);
      main.current = cfg.type === 'line' ? c.addSeries(LineSeries, { color: '#5ba8f5', lineWidth: 2 }) : cfg.type === 'area' ? c.addSeries(AreaSeries, { lineColor: '#5ba8f5', topColor: 'rgba(91,168,245,.35)', bottomColor: 'rgba(91,168,245,0)' })
        : c.addSeries(CandlestickSeries, { upColor: '#19c37d', downColor: '#f0475f', wickUpColor: '#19c37d', wickDownColor: '#f0475f', borderVisible: false });
      mainType.current = cfg.type; vpPrim.current = undefined; markers.current.clear(); priceLines.current = priceLines.current.filter(x => x.s !== main.current);
    }
    const s = main.current;
    s.setData(cfg.type === 'line' || cfg.type === 'area' ? shown.map(k => ({ time: k.time as UTCTimestamp, value: k.close })) : shown.map(k => ({ time: k.time as UTCTimestamp, open: k.open, high: k.high, low: k.low, close: k.close })));
    // volume profile primitive
    if (vp) { if (!vpPrim.current) { vpPrim.current = new VolumeProfilePrimitive(vp); s.attachPrimitive(vpPrim.current); } else vpPrim.current.setData(vp); }
    else if (vpPrim.current) { s.detachPrimitive(vpPrim.current); vpPrim.current = undefined; }
  }, [shown, cfg.type, vp]);

  // indicator series: one lightweight series per output, placed on price pane or its own/its source's pane.
  // Pine plots also carry per-bar colors, hlines (price lines) and plotshape markers.
  useEffect(() => {
    const c = chart.current; if (!c || !main.current) return;
    const t = (i: number) => shown[i].time as UTCTimestamp; const live = new Set<string>();
    const paneIndex = new Map<string, number>(); paneIndex.set('price', 0); let next = 1;
    priceLines.current.forEach(({ s, l }) => { try { s.removePriceLine(l); } catch { /* series gone */ } }); priceLines.current = [];
    const usedMarkers = new Set<string>();
    for (const comp of computed) {
      const pane = comp.paneKey === 'price' ? 0 : (paneIndex.get(comp.paneKey) ?? (paneIndex.set(comp.paneKey, next), next++));
      let firstSeries: ISeriesApi<any> | undefined = pane === 0 ? main.current : undefined;
      for (const o of comp.def.outputs) {
        const key = `${comp.uid}.${o.key}`; live.add(key); const data = comp.outputs[o.key] ?? [];
        const plot = comp.pine?.plots.find(p => p.key === o.key); const colors = plot?.colors; const style = plot?.style ?? (o.kind === 'histogram' ? 'histogram' : 'line');
        const pts = data.map((v, i) => (v == null || i >= shown.length ? null : { time: t(i), value: v, ...(colors?.[i] ? { color: colors[i] } : o.kind === 'histogram' && !plot ? { color: v >= 0 ? o.color : 'rgba(239,86,112,.6)' } : {}) })).filter(Boolean) as any[];
        let s = lines.current[key];
        if (!s) {
          s = o.kind === 'histogram' ? c.addSeries(HistogramSeries, { color: o.color, priceLineVisible: false, lastValueVisible: false, priceFormat: comp.def.id === 'volume' ? { type: 'volume' } : undefined }, pane)
            : style === 'area' ? c.addSeries(AreaSeries, { lineColor: o.color, topColor: o.color.replace(')', ',0.25)').replace('rgb(', 'rgba('), bottomColor: 'rgba(0,0,0,0)', lineWidth: (plot?.linewidth ?? 1) as any, priceLineVisible: false, lastValueVisible: pane !== 0 }, pane)
            : c.addSeries(LineSeries, { color: o.color, lineWidth: Math.min(4, Math.max(1, plot?.linewidth ?? 1)) as any, lineStyle: style === 'circles' || style === 'cross' ? 1 : 0, lineType: style === 'stepline' ? 1 : 0, pointMarkersVisible: style === 'circles' || style === 'cross', priceLineVisible: false, lastValueVisible: pane !== 0 }, pane);
          lines.current[key] = s;
        } else if (s.getPane().paneIndex() !== pane) s.moveToPane(pane);
        s.setData(pts); firstSeries ??= s;
      }
      if (comp.pine && firstSeries) {
        for (const h of comp.pine.hlines) priceLines.current.push({ s: firstSeries, l: firstSeries.createPriceLine({ price: h.price, color: h.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: h.title }) });
        const mk: SeriesMarker<Time>[] = comp.pine.shapes.filter(sh => sh.bar < shown.length).slice(-500).map(sh => ({ time: t(sh.bar), position: sh.position === 'below' ? 'belowBar' : 'aboveBar', color: sh.color, shape: (sh.shape === 'arrowDown' ? 'arrowDown' : sh.shape === 'square' ? 'square' : sh.shape === 'circle' ? 'circle' : 'arrowUp') as any, text: sh.text }));
        const target = comp.paneKey === 'price' ? main.current : firstSeries; const mkKey = comp.uid;
        if (mk.length) { let m = markers.current.get(mkKey); if (!m) { m = createSeriesMarkers(target, mk); markers.current.set(mkKey, m); } else m.setMarkers(mk); usedMarkers.add(mkKey); }
      }
    }
    for (const [k, m] of markers.current) if (!usedMarkers.has(k)) { try { m.setMarkers([]); m.detach(); } catch { /* ignore */ } markers.current.delete(k); }
    for (const k of Object.keys(lines.current)) if (!live.has(k)) { c.removeSeries(lines.current[k]); delete lines.current[k]; }
    c.panes().forEach((p, i) => p.setStretchFactor(i === 0 ? 4 : 1));
  }, [computed, shown]);

  // replay playback
  useEffect(() => { if (!replay.on || !replay.playing) return; const id = setInterval(() => setReplay(r => (r.idx >= series.length ? { ...r, playing: false } : { ...r, idx: r.idx + 1 })), 600 / replay.speed); return () => clearInterval(id); }, [replay.on, replay.playing, replay.speed, series.length]);

  const last = shown.at(-1); const prev = shown.at(-2); const chg = last && prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
  return (
    <section className={`chart-cell ${active ? 'active' : ''}`} onMouseDown={() => setActive(cfg.id)} aria-label={`Chart ${cfg.symbol}`}>
      <header>
        <form onSubmit={e => { e.preventDefault(); const s = symInput.trim().toUpperCase(); if (s) update(cfg.id, { symbol: s.includes('-') ? s : `${s}-USDT` }); }}><input value={symInput} onChange={e => setSymInput(e.target.value)} style={{ width: compact ? 88 : 110 }} aria-label="Symbol" /></form>
        <span className="muted">{cfg.timeframe}</span>
        {last && <span className={chg >= 0 ? 'up' : 'down'}>{last.close.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>}
        {!compact && <select value={cfg.type} onChange={e => update(cfg.id, { type: e.target.value as ChartType })}>{TYPES.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}</select>}
        {cfg.type === 'range' && <label className="muted">range <input type="number" step="any" placeholder={rangeSize.toPrecision(3)} value={cfg.rangeSize ?? ''} onChange={e => update(cfg.id, { rangeSize: e.target.value ? Number(e.target.value) : null })} style={{ width: 72 }} /></label>}
        <button onClick={() => setMenu(m => !m)}>{compact ? `Ind. ${cfg.indicators.length}` : `Indicators (${cfg.indicators.length})`}</button>
        {!compact && <button className={replay.on ? 'on' : ''} onClick={() => setReplay(r => ({ ...r, on: !r.on, idx: r.on ? 0 : Math.max(50, Math.floor(series.length * 0.6)), playing: false }))}>Replay</button>}
        <span className="spacer" />
        {!compact && <span className="muted" title="Loaded bars / maximum">{bars.toLocaleString()} / {maxBars.toLocaleString()} bars{loadingMore ? ' …' : exhausted ? ' (end)' : ''}</span>}
        <Badge env={env} />
      </header>
      {replay.on && (
        <div className="replay">
          <button onClick={() => setReplay(r => ({ ...r, idx: Math.max(1, r.idx - 1) }))}>‹</button>
          <button className={replay.playing ? 'on' : ''} onClick={() => setReplay(r => ({ ...r, playing: !r.playing }))}>{replay.playing ? 'Pause' : 'Play'}</button>
          <button onClick={() => setReplay(r => ({ ...r, idx: Math.min(series.length, r.idx + 1) }))}>›</button>
          <input type="range" min={1} max={series.length} value={replay.idx} onChange={e => setReplay(r => ({ ...r, idx: Number(e.target.value) }))} />
          <select value={replay.speed} onChange={e => setReplay(r => ({ ...r, speed: Number(e.target.value) }))}>{[0.5, 1, 2, 5, 10].map(s => <option key={s} value={s}>{s}×</option>)}</select>
          <span className="muted">bar {replay.idx} / {series.length}{last ? ` · ${new Date(last.time * 1000).toLocaleString()}` : ''}</span>
        </div>
      )}
      <div className="chart-body">
        <div ref={ref} style={{ position: 'absolute', inset: 0 }} />
        {source.length === 0 && <div className="empty" style={{ position: 'absolute', top: 8, left: 12 }}>{env?.error ? `Candles unavailable: ${env.error}` : 'Loading candles…'}</div>}
        {vp && <div className="vp-legend">POC {vp.poc.toLocaleString(undefined, { maximumFractionDigits: 4 })} · VA {vp.val.toLocaleString(undefined, { maximumFractionDigits: 4 })}–{vp.vah.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>}
        {menu && <IndicatorMenu chartId={cfg.id} instances={cfg.indicators} computed={computed} onClose={() => setMenu(false)} />}
      </div>
    </section>
  );
}
