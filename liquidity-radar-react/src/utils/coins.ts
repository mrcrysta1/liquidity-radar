import { COINS, COIN_ALIASES } from '../constants/market'
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
  const b = baseOf(sym)
  return COINS[b] || { sym: sym, name: b, icon: '🪙', color: '#2962FF' }
}
