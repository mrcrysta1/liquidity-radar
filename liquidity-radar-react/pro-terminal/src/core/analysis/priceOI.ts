export type Regime = 'LONG_BUILDUP' | 'SHORT_COVERING' | 'SHORT_BUILDUP' | 'LONG_LIQUIDATION' | 'FLAT';
export interface PriceOI { priceChg: number; oiChg: number; regime: Regime; title: string; meaning: string }
/** Classic price × OI matrix. Interpretations are heuristics, not predictions. */
export function classifyPriceOI(priceChg: number, oiChg: number, eps = 0.15): PriceOI {
  const up = priceChg > eps, dn = priceChg < -eps, oiUp = oiChg > eps, oiDn = oiChg < -eps;
  if (up && oiUp) return { priceChg, oiChg, regime: 'LONG_BUILDUP', title: 'Price ↑ + OI ↑', meaning: 'New longs entering; trend supported by fresh positioning. Watch for crowding if funding also rises.' };
  if (up && oiDn) return { priceChg, oiChg, regime: 'SHORT_COVERING', title: 'Price ↑ + OI ↓', meaning: 'Shorts closing; rally driven by covering rather than new demand — often less durable.' };
  if (dn && oiUp) return { priceChg, oiChg, regime: 'SHORT_BUILDUP', title: 'Price ↓ + OI ↑', meaning: 'New shorts entering; downtrend supported by fresh positioning. Squeeze risk grows if funding turns very negative.' };
  if (dn && oiDn) return { priceChg, oiChg, regime: 'LONG_LIQUIDATION', title: 'Price ↓ + OI ↓', meaning: 'Longs closing or being liquidated; leverage flushing out — selling may exhaust as OI resets.' };
  return { priceChg, oiChg, regime: 'FLAT', title: 'Range', meaning: 'No meaningful change in price or positioning.' };
}
