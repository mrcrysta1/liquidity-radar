import type React from 'react';
import { useDataLoop } from '@/store/dataLoop';
import { useUI, type SideTab, type DrawerTab, type View } from '@/store/useUI';
import { Header } from '@/components/Header';
import { ChartGrid } from '@/components/ChartGrid';
import { OrderBook } from '@/components/OrderBook';
import { Tape } from '@/components/Tape';
import { Futures } from '@/components/Futures';
import { Liquidations } from '@/components/Liquidations';
import { LiquidityScorePanel } from '@/components/LiquidityScore';
import { CrossExchange } from '@/components/CrossExchange';
import { Structure } from '@/components/Structure';
import { Watchlist } from '@/components/Watchlist';
import { Alerts } from '@/components/Alerts';
import { NewsView } from '@/components/NewsView';
import { IcChart, IcNews, IcBell, IcList, IcRadar, IcHeat } from '@/components/Icons';
import { LiqHeatmap } from '@/components/LiqHeatmap';

const SIDE: { id: SideTab; l: string }[] = [{ id: 'book', l: 'Order book' }, { id: 'liquidity', l: 'Liquidity' }, { id: 'futures', l: 'Futures' }, { id: 'structure', l: 'Structure' }];
const DRAWER: { id: DrawerTab; l: string }[] = [{ id: 'trades', l: 'Trades' }, { id: 'liquidations', l: 'Liquidations' }, { id: 'heatmap', l: 'Liq. heatmap' }, { id: 'crossex', l: 'Cross-exchange' }, { id: 'news', l: 'News' }, { id: 'alerts', l: 'Alerts' }];
const NAV: { id: View; l: string; I: () => React.ReactElement }[] = [{ id: 'terminal', l: 'Terminal', I: IcChart }, { id: 'heatmap', l: 'Heatmap', I: IcHeat }, { id: 'news', l: 'News', I: IcNews }, { id: 'alerts', l: 'Alerts', I: IcBell }, { id: 'watchlist', l: 'Watchlist', I: IcList }];

export default function App() {
  useDataLoop();
  const { view, setView, side, setSide, drawer, setDrawer, drawerOpen, toggleDrawer, leftOpen, rightOpen } = useUI();
  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="brand" title="Liquidity Radar"><IcRadar /></div>
        {NAV.map(n => <button key={n.id} className={view === n.id ? 'on' : ''} onClick={() => setView(n.id)} title={n.l} aria-label={n.l}><n.I /><span>{n.l}</span></button>)}
        <span className="spacer" />
        <div className="rail-foot" title="Free public data · no ads · installable PWA">free · no ads</div>
      </nav>
      <div className="main">
        <Header />
        {view === 'terminal' && (
          <main className={`term ${leftOpen ? '' : 'no-left'} ${rightOpen ? '' : 'no-right'} ${drawerOpen ? '' : 'no-drawer'}`}>
            {leftOpen && <aside className="left"><Watchlist /></aside>}
            <section className="center"><ChartGrid /></section>
            {rightOpen && <aside className="right">
              <div className="tabs">{SIDE.map(t => <button key={t.id} className={side === t.id ? 'on' : ''} onClick={() => setSide(t.id)}>{t.l}</button>)}</div>
              <div className="tab-body">{side === 'book' && <OrderBook />}{side === 'liquidity' && <LiquidityScorePanel />}{side === 'futures' && <Futures />}{side === 'structure' && <Structure />}</div>
            </aside>}
            <section className="drawer">
              <div className="tabs">{DRAWER.map(t => <button key={t.id} className={drawer === t.id && drawerOpen ? 'on' : ''} onClick={() => setDrawer(t.id)}>{t.l}</button>)}<span className="spacer" /><button className="ghost" onClick={toggleDrawer}>{drawerOpen ? 'Hide' : 'Show'}</button></div>
              {drawerOpen && <div className="tab-body">{drawer === 'trades' && <Tape />}{drawer === 'liquidations' && <Liquidations />}{drawer === 'heatmap' && <LiqHeatmap />}{drawer === 'crossex' && <CrossExchange />}{drawer === 'news' && <NewsView compact />}{drawer === 'alerts' && <Alerts />}</div>}
            </section>
          </main>
        )}
        {view === 'heatmap' && <main className="page"><LiqHeatmap full /></main>}
        {view === 'news' && <main className="page"><NewsView /></main>}
        {view === 'alerts' && <main className="page"><Alerts /></main>}
        {view === 'watchlist' && <main className="page two"><Watchlist /><Structure /></main>}
      </div>
    </div>
  );
}
