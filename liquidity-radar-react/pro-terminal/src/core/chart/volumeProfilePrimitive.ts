import type { IChartApi, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time, IPrimitivePaneView, IPrimitivePaneRenderer } from 'lightweight-charts';
import type { VolumeProfile } from '../indicators/volumeProfile';

/** Draws a volume profile (buy/sell split, POC, value area) anchored to the right edge of the price pane. */
export class VolumeProfilePrimitive implements ISeriesPrimitive<Time> {
  private chart?: IChartApi; private series?: ISeriesApi<any>; private requestUpdate?: () => void;
  constructor(private vp: VolumeProfile | null, private widthFrac = 0.22) {}
  setData(vp: VolumeProfile | null) { this.vp = vp; this.requestUpdate?.(); }
  attached(p: SeriesAttachedParameter<Time>) { this.chart = p.chart; this.series = p.series; this.requestUpdate = p.requestUpdate; }
  detached() { this.chart = undefined; this.series = undefined; }
  paneViews(): readonly IPrimitivePaneView[] { return [this.view]; }
  private view: IPrimitivePaneView = {
    zOrder: () => 'bottom' as const,
    renderer: (): IPrimitivePaneRenderer | null => {
      const vp = this.vp, series = this.series, chart = this.chart; if (!vp || !series || !chart) return null;
      const w = chart.timeScale().width();
      const rows = vp.bins.map(b => ({ y: series.priceToCoordinate(b.price), yTop: series.priceToCoordinate(b.price + vp.step / 2), yBot: series.priceToCoordinate(b.price - vp.step / 2), buy: b.buy, sell: b.sell, vol: b.volume }));
      const poc = series.priceToCoordinate(vp.poc), vah = series.priceToCoordinate(vp.vah), val = series.priceToCoordinate(vp.val);
      const frac = this.widthFrac;
      return {
        draw: (target: any) => target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hp, verticalPixelRatio: vpx }: { context: CanvasRenderingContext2D; horizontalPixelRatio: number; verticalPixelRatio: number }) => {
          const maxW = w * frac * hp; const x0 = w * hp;
          ctx.save();
          if (vah != null && val != null) { ctx.fillStyle = 'rgba(233,180,76,0.06)'; ctx.fillRect(0, vah * vpx, x0, (val - vah) * vpx); }
          for (const r of rows) {
            if (r.yTop == null || r.yBot == null) continue; const h = Math.max(1, (r.yBot - r.yTop) * vpx - 1); const bw = (r.vol / vp.maxVol) * maxW; const buyW = bw * (r.buy / (r.vol || 1));
            ctx.fillStyle = 'rgba(52,195,143,0.35)'; ctx.fillRect(x0 - bw, r.yTop * vpx, buyW, h);
            ctx.fillStyle = 'rgba(239,86,112,0.35)'; ctx.fillRect(x0 - bw + buyW, r.yTop * vpx, bw - buyW, h);
          }
          if (poc != null) { ctx.strokeStyle = '#e9b44c'; ctx.lineWidth = 1 * vpx; ctx.setLineDash([4 * hp, 3 * hp]); ctx.beginPath(); ctx.moveTo(0, poc * vpx); ctx.lineTo(x0, poc * vpx); ctx.stroke(); }
          ctx.restore();
        }),
      };
    },
  };
}
