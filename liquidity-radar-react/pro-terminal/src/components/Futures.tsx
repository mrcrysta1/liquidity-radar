import { useMemo } from 'react';
import { useMarket } from '@/store/useMarket';
import { classifyPriceOI } from '@/core/analysis/priceOI';
import { fmt } from '@/core/scores/liquidityScore';
import { Panel } from './Panel'; import { Badge } from './Badge';

export function Futures() {
  const f = useMarket(s => s.funding), oi = useMarket(s => s.oi), oiH = useMarket(s => s.oiHist), ls = useMarket(s => s.ls), mark = useMarket(s => s.mark), c = useMarket(s => s.candles);
  const rate = mark?.fundingRate ?? f?.data.rate; const next = mark?.nextFundingTime ?? f?.data.nextFundingTime;
  const regime = useMemo(() => {
    const h = oiH?.data; const k = c?.data; if (!h || h.length < 5 || !k || k.length < 5) return undefined;
    const oiChg = ((h[h.length - 1].openInterest - h[h.length - 5].openInterest) / h[h.length - 5].openInterest) * 100;
    const t4 = h[h.length - 5].ts / 1000; const k0 = k.find(x => x.time >= t4) ?? k[Math.max(0, k.length - 17)];
    const priceChg = ((k[k.length - 1].close - k0.close) / k0.close) * 100;
    return classifyPriceOI(priceChg, oiChg);
  }, [oiH, c]);
  const lsLast = ls?.data[ls.data.length - 1];
  const annual = rate != null ? rate * 3 * 365 * 100 : undefined;
  const fundingTone = rate == null ? '' : rate > 0.0005 ? 'down' : rate < -0.0002 ? 'up' : '';
  const mins = next ? Math.max(0, Math.round((next - Date.now()) / 60000)) : undefined;
  return (
    <Panel title="Futures" right={<Badge env={f} />} foot="Interpretations are heuristics from public exchange data, not predictions.">
      <div className="grid3">
        <div className="stat"><small>Funding (8h)</small><b className={fundingTone}>{rate != null ? (rate * 100).toFixed(4) + '%' : '—'}</b><small>{annual != null ? `${annual.toFixed(1)}% annualised · next in ${mins}m` : ''}</small></div>
        <div className="stat"><small>Open interest</small><b>{oi ? fmt(oi.data.openInterest) : '—'}</b><small>{oi?.data.openInterestValue ? '$' + fmt(oi.data.openInterestValue) : oi ? 'contracts' : ''}</small></div>
        <div className="stat"><small>Long/short accounts</small><b>{lsLast ? lsLast.ratio.toFixed(2) : '—'}</b><small>{lsLast ? `${(lsLast.longAccount * 100).toFixed(0)}% long · ${(lsLast.shortAccount * 100).toFixed(0)}% short` : ''}</small></div>
      </div>
      <dl className="kv" style={{ marginTop: 10 }}>
        <dt>Mark</dt><dd>{mark ? mark.mark.toLocaleString() : f ? f.data.markPrice.toLocaleString() : '—'}</dd>
        <dt>Index</dt><dd>{mark ? mark.index.toLocaleString() : '—'}</dd>
        <dt>Basis (mark−index)</dt><dd className={mark && mark.mark > mark.index ? 'up' : 'down'}>{mark && mark.index ? (((mark.mark - mark.index) / mark.index) * 1e4).toFixed(2) + ' bps' : '—'}</dd>
        <dt>OI change (4h)</dt><dd className={regime && regime.oiChg > 0 ? 'up' : 'down'}>{regime ? regime.oiChg.toFixed(2) + '%' : '—'}</dd>
        <dt>Price change (4h)</dt><dd className={regime && regime.priceChg > 0 ? 'up' : 'down'}>{regime ? regime.priceChg.toFixed(2) + '%' : '—'}</dd>
      </dl>
      {regime && regime.regime !== 'FLAT' && <div className="regime"><b>{regime.title}</b>{regime.meaning}</div>}
      {rate != null && Math.abs(rate) > 0.0005 && <div className="regime" style={{ borderColor: 'var(--warn)' }}><b>Funding extreme</b>{rate > 0 ? 'Longs paying heavily — crowded long positioning; squeeze risk if price stalls.' : 'Shorts paying heavily — crowded short positioning; short-squeeze risk on strength.'}</div>}
    </Panel>
  );
}
