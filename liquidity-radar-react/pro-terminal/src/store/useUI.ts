import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export type View = 'terminal' | 'heatmap' | 'news' | 'alerts' | 'watchlist';
export type SideTab = 'book' | 'liquidity' | 'futures' | 'structure';
export type DrawerTab = 'trades' | 'liquidations' | 'heatmap' | 'crossex' | 'news' | 'alerts';
interface UI { view: View; setView: (v: View) => void; side: SideTab; setSide: (t: SideTab) => void; drawer: DrawerTab; setDrawer: (t: DrawerTab) => void; drawerOpen: boolean; toggleDrawer: () => void; leftOpen: boolean; toggleLeft: () => void; rightOpen: boolean; toggleRight: () => void }
export const useUI = create<UI>()(persist(set => ({
  view: 'terminal', setView: view => set({ view }), side: 'book', setSide: side => set({ side }), drawer: 'trades', setDrawer: drawer => set({ drawer, drawerOpen: true }),
  drawerOpen: true, toggleDrawer: () => set(s => ({ drawerOpen: !s.drawerOpen })), leftOpen: true, toggleLeft: () => set(s => ({ leftOpen: !s.leftOpen })), rightOpen: true, toggleRight: () => set(s => ({ rightOpen: !s.rightOpen })),
}), { name: 'liquidity-radar-ui-v1' }));
