import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/store/useApp';
import { useMarket } from '@/store/useMarket';
import { binanceKlines } from '@/providers/binance';
import { oiHistory } from '@/providers';
import type { Candle, OIPoint } from '@/core/providers/types';
import { buildHeatmap, MODELS, COLORMAPS, colorAt, clipLevel } from '@/core/liquidity/heatmap';
import { Panel } from './Panel';

const RANGES = [{ id: '12h', l: '12 hour', tf: '1m', bars: 720 }, { id: '24h', l: '24 hour', tf: '5m', bars: 288 }, { id: '3d', l: '3 day', tf: '15m', bars: 288 }, { id: '1w', l: '1 week', tf: '1h', bars: 168 }, { id: '1m', l: '1 month', tf: '4h', bars: 180 }];
const fmtUsd = (v: number) => (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0));

export function LiqHeatmap({ full = false }: { full?: boolean }) {
  const symbol = useApp(s => s.symbol); const mark = useMarket(s => s.mark);
  const [range, setRange] = useState('24h'); const [modelId, setModelId] = useState('m1'); const [cmap, setCmap] = useState<keyof typeof COLORMAPS>('viridis'); const [threshold, setThreshold] = useState(0.85); const [showCandles, setShowCandles] = useState(true);
  const [candles, setCandles] = useState<Candle[]>([]); const [oi, setOi] = useState<OIPoint[]>([]); const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading'); const [err, setErr] = useState<string>();
  const canvas = useRef<HTMLCanvasElement>(null); const wrap = useRef<HTMLDivElement>(null); const [hover, setHover] = useState<{ x: number; y: number; price: number; value: number; time: number } | null>(null);
  const r = RANGES.find(x => x.id === range)!; const model = MODELS.find(m => m.id === modelId)!;

  useEffect(() => {
    let alive = true; setStatus('loading');
    Promise.all([binanceKlines(symbol, r.tf, r.bars), oiHistory.get(symbol, r.tf === '1m' || r.tf === '5m' ? '5m' : r.tf === '15m' ? '15m' : r.tf === '1h' ? '1h' : '4h', 300).then(e => e.data).catch(() => [] as OIPoint[])])
      .then(([c, o]) => { if (!alive) return; setCandles(c); setOi(o); setStatus('ok'); setErr(undefined); }).catch(e => { if (!alive) return; setStatus('error'); setErr(e instanceof Error ? e.message : String(e)); });
    const id = setInterval(() => binanceKlines(symbol, r.tf, r.bars).then(c => alive && setCandles(c)).catch(() => {}), 60_000);
    return () => { alive = false; clearInterval(id); };
  }, [symbol, range]);

  const heat = useMemo(() => (candles.length ? buildHeatmap(candles, { bins: full ? 260 : 160, model, oi }) : null), [candles, model, oi, full]);

  // draw
  useEffect(() => {
    const cv = canvas.current, el = wrap.current; if (!cv || !el) return;
    const draw = () => {
      const W = el.clientWidth, H = el.clientHeight; if (!W || !H) return; const dpr = window.devicePixelRatio || 1; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
      const ctx = cv.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const padL = 44, padR = 64, padB = 22, padT = 6; const gw = W - padL - padR, gh = H - padT - padB; ctx.fillStyle = '#0f1318'; ctx.fillRect(0, 0, W, H);
      if (!heat) return;
      const map = COLORMAPS[cmap]; const clip = clipLevel(heat, threshold); const colW = gw / heat.cols, binH = gh / heat.bins;
      // background = lowest color
      const [br, bg, bb] = colorAt(map, 0); ctx.fillStyle = `rgb(${br | 0},${bg | 0},${bb | 0})`; ctx.fillRect(padL, padT, gw, gh);
      // heat cells (draw via ImageData for speed)
      const img = ctx.createImageData(Math.max(1, Math.round(gw * dpr)), Math.max(1, Math.round(gh * dpr))); const iw = img.width, ih = img.height; const d = img.data;
      for (let px = 0; px < iw; px++) { const col = Math.min(heat.cols - 1, Math.floor(px / iw * heat.cols)); for (let py = 0; py < ih; py++) { const bin = heat.bins - 1 - Math.min(heat.bins - 1, Math.floor(py / ih * heat.bins)); const v = heat.grid[col * heat.bins + bin]; const t = Math.min(1, v / clip); const [cr, cg, cb] = colorAt(map, t); const o = (py * iw + px) * 4; d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = 255; } }
      const off = document.createElement('canvas'); off.width = iw; off.height = ih; off.getContext('2d')!.putImageData(img, 0, 0); ctx.drawImage(off, padL, padT, gw, gh);
      const yOf = (p: number) => padT + gh - ((p - heat.priceMin) / (heat.priceMax - heat.priceMin)) * gh;
      // candles overlay
      if (showCandles) { const cw = Math.max(1, colW * 0.6); heat.candles.forEach((k, i) => { const x = padL + (i + 0.5) * colW; const up = k.close >= k.open; ctx.strokeStyle = ctx.fillStyle = up ? '#19c37d' : '#f0475f'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, yOf(k.high)); ctx.lineTo(x, yOf(k.low)); ctx.stroke(); const y1 = yOf(Math.max(k.open, k.close)), y2 = yOf(Math.min(k.open, k.close)); ctx.fillRect(x - cw / 2, y1, cw, Math.max(1, y2 - y1)); }); }
      // current price line
      const last = mark?.mark ?? heat.candles[heat.candles.length - 1].close; const yl = yOf(last); ctx.strokeStyle = '#ffffff'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, yl); ctx.lineTo(padL + gw, yl); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(padL + gw, yl - 8, padR - 4, 16); ctx.fillStyle = '#0f1318'; ctx.font = '600 10px Manrope, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(last.toLocaleString(undefined, { maximumFractionDigits: 2 }), padL + gw + 4, yl + 4);
      // y axis
      ctx.fillStyle = '#b4bdc8'; ctx.font = '10px Manrope, sans-serif'; const ticks = 8; for (let i = 0; i <= ticks; i++) { const p = heat.priceMin + (heat.priceMax - heat.priceMin) * i / ticks; const y = yOf(p); if (Math.abs(y - yl) < 10) continue; ctx.fillText(p.toLocaleString(undefined, { maximumFractionDigits: p > 100 ? 0 : 4 }), padL + gw + 4, y + 3); }
      // x axis
      ctx.textAlign = 'center'; const step = Math.max(1, Math.floor(heat.cols / Math.max(3, Math.floor(gw / 90)))); for (let i = 0; i < heat.cols; i += step) { const t = new Date(heat.times[i] * 1000); ctx.fillText(r.tf === '1h' || r.tf === '4h' ? t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + t.getHours().toString().padStart(2, '0') + ':00' : t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), padL + (i + 0.5) * colW, H - 7); }
      // color bar
      const cbX = 8, cbW = 14; for (let y = 0; y < gh; y++) { const [cr, cg, cb] = colorAt(map, 1 - y / gh); ctx.fillStyle = `rgb(${cr | 0},${cg | 0},${cb | 0})`; ctx.fillRect(cbX, padT + y, cbW, 1.5); }
      ctx.fillStyle = '#b4bdc8'; ctx.textAlign = 'left'; ctx.font = '10px Manrope, sans-serif'; ctx.save(); ctx.translate(cbX + cbW + 3, padT + 8); ctx.fillText(fmtUsd(clip), 0, 0); ctx.restore(); ctx.fillText('0', cbX + cbW + 3, padT + gh - 2);
    };
    draw(); const ro = new ResizeObserver(draw); ro.observe(el); return () => ro.disconnect();
  }, [heat, cmap, threshold, showCandles, mark?.mark, r.tf]);

  const onMove = (e: React.MouseEvent) => {
    const el = wrap.current; if (!el || !heat) return; const rect = el.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top; const padL = 44, padR = 64, padB = 22, padT = 6; const gw = rect.width - padL - padR, gh = rect.height - padT - padB;
    if (x < padL || x > padL + gw || y < padT || y > padT + gh) return setHover(null);
    const col = Math.min(heat.cols - 1, Math.floor((x - padL) / gw * heat.cols)); const bin = heat.bins - 1 - Math.min(heat.bins - 1, Math.floor((y - padT) / gh * heat.bins));
    setHover({ x, y, price: heat.priceMin + (bin + 0.5) * heat.binSize, value: heat.grid[col * heat.bins + bin], time: heat.times[col] });
  };
  const title = `${symbol.replace('-', '/')} Liquidation Heatmap`;
  return (
    <Panel title={title} tight right={<>
      <div className="seg">{MODELS.map(m => <button key={m.id} className={modelId === m.id ? 'on' : ''} onClick={() => setModelId(m.id)} title={m.description}>{m.name}</button>)}</div>
      <select value={range} onChange={e => setRange(e.target.value)}>{RANGES.map(x => <option key={x.id} value={x.id}>{x.l}</option>)}</select>
      <div className="cmaps">{(Object.keys(COLORMAPS) as (keyof typeof COLORMAPS)[]).map(k => { const m = COLORMAPS[k]; return <button key={k} className={`cmap ${cmap === k ? 'on' : ''}`} onClick={() => setCmap(k)} title={k} style={{ background: `linear-gradient(to top, rgb(${m[0].join(',')}), rgb(${m[Math.floor(m.length / 2)].join(',')}), rgb(${m[m.length - 1].join(',')}))` }} />; })}</div>
      <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>Liquidity Threshold = {threshold.toFixed(2)} <input type="range" min={0} max={1} step={0.01} value={threshold} onChange={e => setThreshold(Number(e.target.value))} style={{ width: 110, accentColor: 'var(--accent)' }} /></label>
      <label className="muted"><input type="checkbox" checked={showCandles} onChange={e => setShowCandles(e.target.checked)} /> price</label>
    </>} foot={<>Estimated from Binance {r.tf} candles{oi.length ? ' + open-interest changes' : ''} using leverage tiers {model.tiers.map(t => `${t.lev}x`).join('/')} — {model.description}. Bands persist until price trades through them. This is a model, not exchange position data.</>}>
      <div className={`heat-wrap ${full ? 'full' : ''}`} ref={wrap} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <canvas ref={canvas} />
        {status === 'loading' && !heat && <div className="empty" style={{ position: 'absolute', top: 8, left: 52 }}>Loading {r.bars} × {r.tf} candles…</div>}
        {status === 'error' && <div className="empty down" style={{ position: 'absolute', top: 8, left: 52 }}>Heatmap unavailable: {err}</div>}
        {hover && heat && <div className="heat-tip" style={{ left: Math.min(hover.x + 12, (wrap.current?.clientWidth ?? 400) - 190), top: Math.max(4, hover.y - 48) }}>
          <div><b>{hover.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</b></div>
          <div className="muted">{new Date(hover.time * 1000).toLocaleString()}</div>
          <div>Liquidity est. <b>${fmtUsd(hover.value)}</b></div>
        </div>}
      </div>
      {heat && heat.levels.length > 0 && <div className="heat-levels">{heat.levels.slice(0, 6).map(l => { const last = heat.candles[heat.candles.length - 1].close; return <span key={l.price} className={l.price > last ? 'up' : 'down'} title="Strongest current liquidity clusters">{l.price.toLocaleString(undefined, { maximumFractionDigits: 0 })} <small className="muted">${fmtUsd(l.value)}</small></span>; })}</div>}
    </Panel>
  );
}
