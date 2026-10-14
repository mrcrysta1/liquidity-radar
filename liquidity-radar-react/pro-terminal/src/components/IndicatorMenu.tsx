import { useMemo, useState } from 'react';
import { INDICATORS, SOURCES, indicatorDef, type IndicatorInstance, type Computed } from '@/core/indicators/registry';
import { PINE_LIBRARY, PINE_TEMPLATE } from '@/core/pine/library';
import { parse } from '@/core/pine/parser';
import { useCharts } from '@/store/useCharts';
import { usePine } from '@/store/usePine';

type Tab = 'search' | 'editor' | 'onchart';
/** TradingView-style indicator dialog: search (built-in library + native + my scripts), Pine editor, and on-chart list with inputs. */
export function IndicatorMenu({ chartId, instances, computed, onClose }: { chartId: string; instances: IndicatorInstance[]; computed: Computed[]; onClose: () => void }) {
  const { addIndicator, addPine, removeIndicator, updateIndicator } = useCharts(); const { scripts, save, remove } = usePine();
  const [tab, setTab] = useState<Tab>('search'); const [q, setQ] = useState(''); const [code, setCode] = useState(PINE_TEMPLATE); const [editId, setEditId] = useState<string>(); const [name, setName] = useState('My Indicator'); const [err, setErr] = useState<string>(); const [msg, setMsg] = useState<string>();
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const lib = PINE_LIBRARY.filter(i => !t || i.name.toLowerCase().includes(t) || i.tags.some(x => x.includes(t)) || i.category.toLowerCase().includes(t)).map(i => ({ kind: 'pine' as const, id: i.id, name: i.name, sub: `${i.category} · Pine`, script: i.script }));
    const mine = scripts.filter(s => !t || s.name.toLowerCase().includes(t)).map(s => ({ kind: 'pine' as const, id: s.id, name: s.name, sub: 'My script · Pine', script: s.script }));
    const native = INDICATORS.filter(i => !t || i.name.toLowerCase().includes(t) || i.id.includes(t)).map(i => ({ kind: 'native' as const, id: i.id, name: i.name, sub: 'Built-in (native)', script: '' }));
    return [...mine, ...lib, ...native];
  }, [q, scripts]);
  const compile = (src: string) => { try { parse(src); setErr(undefined); return true; } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return false; } };
  const apply = () => { if (!compile(code)) return; const m = /indicator\s*\(\s*["']([^"']+)/.exec(code) ?? /study\s*\(\s*["']([^"']+)/.exec(code); const t = m?.[1] ?? name; addPine(chartId, code, t); setMsg(`Added "${t}" to chart`); };
  const sourceOptions = (before?: string) => { const opts: { v: string; l: string }[] = SOURCES.map(s => ({ v: s, l: s })); for (const i of instances) { if (i.uid === before) break; const d = i.type === 'pine' ? undefined : indicatorDef(i.type); d?.outputs.forEach(o => opts.push({ v: `${i.uid}.${o.key}`, l: `${d.name}(${Object.values(i.params).join(',')}) → ${o.label}` })); const pc = computed.find(c => c.uid === i.uid && c.pine); pc?.def.outputs.forEach(o => opts.push({ v: `${i.uid}.${o.key}`, l: `${pc.def.name} → ${o.label}` })); } return opts; };
  return (
    <div className="menu" role="dialog" aria-label="Indicators">
      <div className="menu-head">
        <button className={tab === 'search' ? 'on' : ''} onClick={() => setTab('search')}>Indicators</button>
        <button className={tab === 'editor' ? 'on' : ''} onClick={() => setTab('editor')}>Pine editor</button>
        <button className={tab === 'onchart' ? 'on' : ''} onClick={() => setTab('onchart')}>On chart ({instances.length})</button>
        <span className="spacer" />{msg && <span className="muted">{msg}</span>}<button onClick={onClose}>Close</button>
      </div>
      {tab === 'search' && <>
        <input autoFocus placeholder="Search indicators (RSI, MACD, Supertrend, Ichimoku…)" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', margin: '6px 0' }} />
        <div className="menu-list search-list">{results.map(r => (
          <div key={r.kind + r.id} className="menu-row">
            <span style={{ flex: 1 }}>{r.name} <span className="muted">— {r.sub}</span></span>
            {r.kind === 'pine' && <button onClick={() => { setCode(r.script); setName(r.name); setEditId(scripts.some(s => s.id === r.id) ? r.id : undefined); setTab('editor'); }}>Source</button>}
            {r.kind === 'pine' && scripts.some(s => s.id === r.id) && <button onClick={() => remove(r.id)}>Delete</button>}
            <button className="on" onClick={() => { if (r.kind === 'native') addIndicator(chartId, r.id); else addPine(chartId, r.script, r.name); setMsg(`Added ${r.name}`); }}>Add</button>
          </div>))}{results.length === 0 && <div className="muted">No matches. Paste your own script in the Pine editor.</div>}</div>
        <div className="muted" style={{ marginTop: 6 }}>Library scripts are original Pine implementations of the standard formulas and run in our own engine. Paste any public Pine v5 script in the editor.</div>
      </>}
      {tab === 'editor' && <>
        <div className="menu-add"><input value={name} onChange={e => setName(e.target.value)} placeholder="Script name" style={{ width: 200 }} />
          <button onClick={() => compile(code) && setMsg('Compiled OK')}>Compile</button>
          <button className="on" onClick={apply}>Add to chart</button>
          <button onClick={() => { if (!compile(code)) return; const it = save(name, code, editId); setEditId(it.id); setMsg(`Saved "${it.name}" to My scripts`); }}>Save</button>
          <button onClick={() => { setCode(PINE_TEMPLATE); setEditId(undefined); setName('My Indicator'); setErr(undefined); }}>New</button></div>
        <textarea className="pine" value={code} onChange={e => setCode(e.target.value)} spellCheck={false} aria-label="Pine Script source" />
        {err ? <div className="down">{err}</div> : <div className="muted">Supported: indicator/input.*/plot/hline/plotshape, var, :=, [n] history, if/for/while, functions, tuples, ta.* (sma ema rma wma hma vwma rsi macd stoch bb kc atr tr cci wpr mfi obv vwap dmi sar supertrend crossover crossunder highest lowest change mom roc cum stdev dev linreg pivothigh pivotlow valuewhen barssince tsi cmo correlation percentrank median…), math.*, color.*. Not supported: strategy.* orders, label/line/box/table drawing, request.security.</div>}
      </>}
      {tab === 'onchart' && <div className="menu-list">
        {instances.length === 0 && <div className="muted">Nothing on this chart yet.</div>}
        {instances.map(i => { const pc = computed.find(c => c.uid === i.uid); if (i.type === 'pine') return (
          <div key={i.uid} className="menu-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={i.visible} onChange={e => updateIndicator(chartId, i.uid, { visible: e.target.checked })} /><b style={{ flex: 1 }}>{i.title}</b><span className="muted">Pine</span>
              <button onClick={() => { setCode(i.script ?? ''); setName(i.title ?? ''); setEditId(undefined); setTab('editor'); }}>Source</button><button onClick={() => removeIndicator(chartId, i.uid)}>×</button></div>
            {pc?.pine?.error && <div className="down">{pc.pine.error}</div>}
            {pc?.pine?.warnings.length ? <div className="muted">Ignored (unsupported): {pc.pine.warnings.join(', ')}</div> : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>{pc?.pine?.inputs.map(inp => (
              <label key={inp.key} className="muted">{inp.title}{' '}
                {inp.type === 'bool' ? <input type="checkbox" checked={!!(i.pineInputs?.[inp.key] ?? inp.def)} onChange={e => updateIndicator(chartId, i.uid, { pineInputs: { ...i.pineInputs, [inp.key]: e.target.checked } })} />
                : inp.type === 'source' ? <select value={String(i.pineInputs?.[inp.key] ?? inp.def)} onChange={e => updateIndicator(chartId, i.uid, { pineInputs: { ...i.pineInputs, [inp.key]: e.target.value } })}>{SOURCES.map(s => <option key={s}>{s}</option>)}</select>
                : inp.options ? <select value={String(i.pineInputs?.[inp.key] ?? inp.def)} onChange={e => updateIndicator(chartId, i.uid, { pineInputs: { ...i.pineInputs, [inp.key]: e.target.value } })}>{inp.options.map(o => <option key={o}>{o}</option>)}</select>
                : inp.type === 'string' ? <input value={String(i.pineInputs?.[inp.key] ?? inp.def)} style={{ width: 90 }} onChange={e => updateIndicator(chartId, i.uid, { pineInputs: { ...i.pineInputs, [inp.key]: e.target.value } })} />
                : <input type="number" step={inp.step ?? (inp.type === 'int' ? 1 : 'any')} min={inp.min} max={inp.max} value={Number(i.pineInputs?.[inp.key] ?? inp.def)} style={{ width: 70 }} onChange={e => updateIndicator(chartId, i.uid, { pineInputs: { ...i.pineInputs, [inp.key]: Number(e.target.value) } })} />}
              </label>))}</div>
          </div>);
          const d = indicatorDef(i.type); if (!d) return null; return (
          <div key={i.uid} className="menu-row">
            <input type="checkbox" checked={i.visible} onChange={e => updateIndicator(chartId, i.uid, { visible: e.target.checked })} /><span style={{ minWidth: 110 }}>{d.name}</span>
            {d.params.map(p => <label key={p.key} className="muted">{p.label} <input type="number" value={i.params[p.key] ?? p.default} min={p.min} max={p.max} step={p.step} style={{ width: 62 }} onChange={e => updateIndicator(chartId, i.uid, { params: { ...i.params, [p.key]: Number(e.target.value) } })} /></label>)}
            {d.seriesInput && <select value={i.source} onChange={e => updateIndicator(chartId, i.uid, { source: e.target.value })}>{sourceOptions(i.uid).map(o => <option key={o.v} value={o.v}>{o.l}</option>)}</select>}
            <span className="spacer" /><button onClick={() => removeIndicator(chartId, i.uid)}>×</button>
          </div>); })}
      </div>}
    </div>
  );
}
