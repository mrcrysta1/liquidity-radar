import { COINS, COIN_ALIASES } from '../constants/market'
import { instrumentOf } from '../constants/instruments'
import type { CoinMeta } from '../types/market'

export function findCoin(text: string): string | null {
  const flat: Array<{ k: string; a: string }> = []
  for (const k in COIN_ALIASES) COIN_ALIASES[k].forEach((a) => flat.push({ k, a: a }))
  flat.sort((x, y) => y.a.length - x.a.length)
  for (const it of flat) {
    if (new RegExp('\\b' + it.a.replace(/ /g, '\\s+') + '\\b').test(text)) return it.k
  }
  return null
}

export function baseOf(sym: string): string {
  for (const k in COINS) if (COINS[k].sym === sym) return k
  return sym.replace('USDT', '')
}

export function coinMeta(sym: string): CoinMeta {
  // Metals, FX, indices and equities have their own registry and are not
  // Binance pairs; check it first so the hero reads "Gold (Spot)" rather than
  // the raw ticker under a generic coin icon.
  const inst = instrumentOf(sym)
  if (inst) return { sym: inst.sym, name: inst.name, icon: inst.icon, color: inst.color }
  const b = baseOf(sym)
  return COINS[b] || { sym: sym, name: b, icon: '🪙', color: '#2962FF' }
}

/** Where a symbol's prices come from, for the line under the hero name. */
export function venueOf(sym: string): string {
  const inst = instrumentOf(sym)
  if (!inst) return 'BINANCE SPOT'
  const label: Record<string, string> = {
    metal: 'SPOT METAL',
    energy: 'ENERGY',
    forex: 'FX',
    index: 'INDEX',
    stock: 'EQUITY',
  }
  return (label[inst.cls] || 'MARKET') + ' · YAHOO'
}
