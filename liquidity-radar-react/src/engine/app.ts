// Liquidity Radar — engine (Phase 1 migration).
// Faithful port of the original inline <script>, transpiled mechanically to
// TypeScript. Logic is intentionally untouched; only module boundaries,
// the $ helper return type, and the bootstrap call differ. Interactive
// sections are progressively being converted to declarative React.
// @ts-nocheck
import * as LightweightCharts from 'lightweight-charts'
import { COINS, CELEBS, TICKER_COINS } from '../constants/market'
import { esc, fmt, pfmt, timeAgo, chgCls, sigOf } from '../utils/format'
import {
  calcRSI,
  calcMACD,
  calcBB,
  volTrend,
  linReg,
  emaArr,
  smaArr,
  vwapSeries,
  macdSeries,
  calcBBList,
} from '../utils/indicators'
import { baseOf, coinMeta } from '../utils/coins'
import { $, showToast, closeModal } from '../utils/dom'
import { fetchForexEvents } from '../features/analysis/calendar'
import { computeAnalytics, renderAnalysis } from '../features/analysis'
import { fetchNews, fetchTrending, fetchBreaking, wireNewsUI } from '../features/news/newsFeed'

import { state } from '../services/store'
import { mdTf, mdPill, mdToggleDebug } from '../services/market'
import { storageGet, storageSet } from '../services/storage'
import { connectStreams } from '../services/streams'
import {
  fetchTickers,
  fetchKlines,
  fetchOB,
  fetchFR,
  fetchOI,
  fetchFG,
  fetchWhales,
  wireMarketHooks,
} from '../services/marketData'
import {
  initChart,
  chartTheme,
  updateChartData,
  updateChartLast,
  renderOB,
  renderHero,
  renderTicker,
  mapCandle,
} from '../features/charts/chartRender'
import {
  initMultiCharts,
  mcAdd,
  mcRemove,
  mcChangeInterval,
  mcChangeSymbol,
} from '../features/charts/multiCharts'
import { switchTab, setSymbol, wireUserActions } from '../features/actions/userActions'
import { analyzeSigCoin, onSigSearch, startAutoScan, switchSigMode } from '../features/signals'
import { initBubbles, renderBubbles, renderMemeUniverse } from '../features/bubbles'
import { initHeatMap } from '../features/heatmap'
import { pushMsg } from '../features/chat'
import { renderFG, renderTopCoins, renderWhales } from '../features/snapshots'
import { addPosition, removePosition, renderPortfolio } from '../features/portfolio'
import { addAlert, checkAlerts, enableAlerts, removeAlert, renderAlerts } from '../features/alerts'
import { initTheme, selectPalette } from '../features/theme'
import { initKeyboard } from '../features/keyboard'


function runAnalytics(){
  const s = computeAnalytics()
  if (!s) return
  renderAnalysis(s)
  document.title = baseOf(state.symbol)+' '+pfmt(s.last)+' · Liquidity Radar'
}


function setWsStatus(){
  // primary status derived from live stream count (unchanged behavior)
  const ok=state.wsOpen>0;
  $('statusPill').classList.toggle('off',!ok);
  $('statusTxt').textContent=ok?('LIVE · '+state.wsOpen+' STREAMS'):'RECONNECTING…';
  // secondary: refresh health monitor + pill (non-disruptive augmentation)
  try{mdPill()}catch(e){}
}
const streamCb={
  onStatus:setWsStatus,
  onHero:renderHero,
  onTickerLive:function(t){
    document.querySelectorAll('#tickerTrack [data-sym="'+state.symbol+'"]').forEach(function(el){
    el.querySelector('.tp').textContent='$'+pfmt(t.last);
    const cEl=el.querySelector('.chg');
    cEl.className='chg '+chgCls(t.pct);
    cEl.textContent=(t.pct>0?'+':'')+t.pct.toFixed(2)+'%';
    });
  },
  onKlineLive:function(){
    const ks=$('wsKlineState');
    ks.textContent='WS LIVE';ks.className='badge b-green';
  },
  onChartLast:updateChartLast,
  onAnalytics:runAnalytics,
  onOB:function(){
    if(!renderOB._pend){renderOB._pend=true;requestAnimationFrame(function(){renderOB();renderOB._pend=false})}
  }
};

document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
$('tickerTrack').addEventListener('click',e=>{
  const t=e.target.closest('[data-sym]');
  if(t)setSymbol(t.dataset.sym);
});
document.addEventListener('click',e=>{
  const row=e.target.closest('tr[data-sym],.celeb-card[data-sym]');
  if(row)setSymbol(row.dataset.sym);
});
$('symSelect').addEventListener('change',e=>setSymbol(e.target.value));

const TF_LABELS={'1m':'1 Min','5m':'5 Min','15m':'15 Min','1h':'1 Hour','4h':'4 Hour','1d':'1 Day'};
document.querySelectorAll('#tfSwitch .tf-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('#tfSwitch .tf-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    const tf=btn.dataset.tf;
    state.tf=mdTf(tf);
    $('chartTitle').textContent='Price Action · '+TF_LABELS[state.tf]+' Candles';
    fetchKlines(state.symbol);
    connectStreams(streamCb); // restart live kline stream at the new, consistent interval
  });
});

function init(){
  initKeyboard();
  const sel=$('symSelect');
  sel.innerHTML=Object.keys(COINS).map(k=>'<option value="'+COINS[k].sym+'">'+k+'/USDT — '+esc(COINS[k].name)+'</option>').join('');
  sel.value=state.symbol;

  initChart();
  renderPortfolio();
  renderAlerts();

  pushMsg('Welcome to <b>Liquidity Radar v5.0</b>. Multi-chart workspace, live signal scanner, and AI analysis. Try: <i>"analyze eth"</i>, <i>"show meme coins"</i>, <i>"should i buy pepe?"</i>, <i>"what is inflation?"</i>, <i>"show news"</i>, <i>"forex events"</i>, <i>"tell me a joke"</i>.','ai');

  fetchTickers();
  fetchFG();
  fetchNews();
  fetchTrending();
  fetchBreaking();
  wireNewsUI();
  fetchKlines(state.symbol);
  fetchOB();
  fetchFR();
  fetchOI();
  fetchWhales();
  connectStreams(streamCb);
  initTheme();
  fetchForexEvents();
  initMultiCharts();
  renderMemeUniverse();
  initBubbles();
  initHeatMap();
  startAutoScan();

  setInterval(fetchTickers,20000);
  setInterval(fetchWhales,10000);
  setInterval(fetchFR,30000);
  setInterval(fetchOI,30000);
  setInterval(fetchFG,300000);
  setInterval(fetchNews,300000);
  setInterval(fetchForexEvents,600000);
  setInterval(function(){renderMemeUniverse();mdPill()},20000);
  setInterval(renderBubbles,30000);
}

// --- expose module-scope functions to window (classic-script globals no
// longer exist in ES modules; inline/generated onclick handlers rely on them)
const __LR_EXPOSE:[string,any][]=[
  ['$',$,],['switchTab',switchTab,],['switchSigMode',switchSigMode,],
  ['onSigSearch',onSigSearch,],['analyzeSigCoin',analyzeSigCoin,],
  ['closeModal',closeModal,],['addPosition',addPosition,],
  ['addAlert',addAlert,],['enableAlerts',enableAlerts,],
  ['removePosition',removePosition,],['removeAlert',removeAlert,],
  ['selectPalette',selectPalette,],['mcChangeInterval',mcChangeInterval,],
  ['mcChangeSymbol',mcChangeSymbol,],['mcRemove',mcRemove,],['mcAdd',mcAdd,],
  ['setSymbol',setSymbol,],['mdToggleDebug',mdToggleDebug,],
]
function exposeGlobals(){
  const w=window as any
  for(const pair of __LR_EXPOSE)w[pair[0]]=pair[1]
}

export function initApp(){
  exposeGlobals()
  wireUserActions({
    fetchKlines,
    fetchOB,
    fetchFR,
    fetchOI,
    fetchWhales,
    connectStreams,
    streamCb,
    renderHero,
    renderTicker,
  })
  wireMarketHooks({
    onTickers() {
      renderTicker();renderHero();renderTopCoins();renderPortfolio();checkAlerts();renderBubbles();
      $('topCoinsUpd').textContent='LIVE · '+new Date().toLocaleTimeString();
    },
    onKlines(){ updateChartData();runAnalytics(); },
    onKlineCache(){
      updateChartData();runAnalytics();
      $('wsKlineState').textContent='CACHE';$('wsKlineState').className='badge b-amber';
      showToast('Klines live stream down — showing cached data');
    },
    onKlineFail(){ showToast('Klines unavailable — check network/Binance access'); },
    onOB(){ renderOB(); },
    onFR(){ runAnalytics();renderHero(); },
    onFRfail(){ $('mFR').textContent='N/A'; },
    onOI(){ runAnalytics(); },
    onOIfail(){ $('mOI').textContent='N/A'; },
    onFG(){ renderFG(); },
    onFGfail(){ $('fngClass').textContent='feed unreachable'; },
    onWhales(){ renderWhales(); },
  })
  init()
}

// keep module-local copies accessible to console debugging
export { switchTab, setSymbol, initChart }
