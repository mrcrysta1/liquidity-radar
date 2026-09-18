import type { Candle } from '../providers/types';
export interface VPBin { price: number; volume: number; buy: number; sell: number }
export interface VolumeProfile { bins: VPBin[]; step: number; poc: number; vah: number; val: number; maxVol: number }
/** Volume profile over `candles`: each candle's volume spread evenly across the price bins it touches. Value area = 70% around POC. */
export function volumeProfile(candles: Candle[], rows = 48, valueArea = 0.7): VolumeProfile | null {
  if (candles.length < 2) return null;
  let lo = Infinity, hi = -Infinity; candles.forEach(k => { lo = Math.min(lo, k.low); hi = Math.max(hi, k.high); });
  if (!(hi > lo)) return null;
  const step = (hi - lo) / rows; const bins: VPBin[] = Array.from({ length: rows }, (_, i) => ({ price: lo + step * (i + 0.5), volume: 0, buy: 0, sell: 0 }));
  for (const k of candles) {
    const a = Math.max(0, Math.floor((k.low - lo) / step)), b = Math.min(rows - 1, Math.floor((k.high - lo) / step)); const n = b - a + 1; const v = k.volume / n;
    const up = k.close >= k.open;
    for (let i = a; i <= b; i++) { bins[i].volume += v; if (up) bins[i].buy += v; else bins[i].sell += v; }
  }
  let pocI = 0; bins.forEach((x, i) => { if (x.volume > bins[pocI].volume) pocI = i; });
  const total = bins.reduce((s, x) => s + x.volume, 0); let acc = bins[pocI].volume, l = pocI, r = pocI;
  while (acc < total * valueArea && (l > 0 || r < rows - 1)) {
    const lv = l > 0 ? bins[l - 1].volume : -1, rv = r < rows - 1 ? bins[r + 1].volume : -1;
    if (rv >= lv) { r++; acc += rv; } else { l--; acc += lv; }
  }
  return { bins, step, poc: bins[pocI].price, vah: bins[r].price + step / 2, val: bins[l].price - step / 2, maxVol: bins[pocI].volume };
}
