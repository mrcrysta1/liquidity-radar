import type { CanonSymbol } from '../providers/types';
export const split = (s: CanonSymbol) => { const [base, quote] = s.split('-'); return { base, quote }; };
export const toBinance = (s: CanonSymbol) => s.replace('-', '');
export const toBybit = (s: CanonSymbol) => s.replace('-', '');
export const toOkxSpot = (s: CanonSymbol) => s;
export const toOkxSwap = (s: CanonSymbol) => `${s}-SWAP`;
export const fromBinance = (s: string, quotes = ['USDT','USDC','FDUSD','BTC','ETH','BNB']) => {
  for (const q of quotes) if (s.endsWith(q)) return `${s.slice(0, -q.length)}-${q}`;
  return s;
};
export const DEFAULT_SYMBOLS: CanonSymbol[] = ['BTC-USDT','ETH-USDT','SOL-USDT','BNB-USDT','XRP-USDT','DOGE-USDT','ADA-USDT','AVAX-USDT','LINK-USDT','SUI-USDT'];
