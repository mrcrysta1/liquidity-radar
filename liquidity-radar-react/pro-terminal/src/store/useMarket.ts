import { create } from 'zustand';
import type { Envelope, Candle, Ticker, BookSnapshot, Funding, OpenInterest, OIPoint, LongShort, Liquidation, Trade } from '@/core/providers/types';
import type { MarkPrice } from '@/core/ws/binanceStream';

/** Tick-rate data (book, trades, liquidations) lives here but panels subscribe to slices only. */
interface MarketState {
  candles?: Envelope<Candle[]>; ticker?: Envelope<Ticker>; book?: Envelope<BookSnapshot>;
  funding?: Envelope<Funding>; oi?: Envelope<OpenInterest>; oiHist?: Envelope<OIPoint[]>; ls?: Envelope<LongShort[]>;
  mark?: MarkPrice; trades: Trade[]; liquidations: Liquidation[]; wsStatus: { spot: string; fut: string };
  errors: string[];
  set: (p: Partial<MarketState>) => void; pushTrade: (t: Trade) => void; pushLiq: (l: Liquidation) => void; pushError: (e: string) => void; resetSymbol: () => void;
}
export const useMarket = create<MarketState>()((set) => ({
  trades: [], liquidations: [], wsStatus: { spot: 'closed', fut: 'closed' }, errors: [],
  set: p => set(p),
  pushTrade: t => set(s => ({ trades: [t, ...s.trades].slice(0, 60) })),
  pushLiq: l => set(s => ({ liquidations: [l, ...s.liquidations].slice(0, 200) })),
  pushError: e => set(s => ({ errors: [e, ...s.errors].slice(0, 20) })),
  resetSymbol: () => set({ candles: undefined, ticker: undefined, book: undefined, funding: undefined, oi: undefined, oiHist: undefined, ls: undefined, mark: undefined, trades: [] }),
}));
