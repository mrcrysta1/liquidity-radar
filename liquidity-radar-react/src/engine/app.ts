// Liquidity Radar — engine (Phase 1 migration).
// Faithful port of the original inline <script>, transpiled mechanically to
// TypeScript. Logic is intentionally untouched; only module boundaries,
// the $ helper return type, and the bootstrap call differ. Interactive
// sections are progressively being converted to declarative React.
// @ts-nocheck
import * as LightweightCharts from 'lightweight-charts'
import { COINS, CELEBS, TICKER_COINS } from '../constants/market'
import { binancePerpOf } from '../constants/instruments'
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
import { computeAnalytics, renderAnalysis } from '../features/analysis'
import { fetchNews, fetchTrending, fetchBreaking, wireNewsUI, primeNewsCache } from '../features/news/newsFeed'

import { state } from '../services/store'
import { mdPill, mdToggleDebug } from '../services/market'
import { storageGet, storageSet } from '../services/storage'
import { onTimeframeChange, syncChartTitle } from '../features/charts/timeframes'
import { applyLayout, watchStageHeight } from '../features/charts/companionCharts'
import { connectStreams, disconnectStreams } from '../services/streams'
import { fetchMarketCaps } from '../services/coingecko'
import { fetchFuturesSnapshot } from '../services/futures'
import { poll } from '../services/pollScheduler'
import { cooldownLeft } from '../api/rateLimit'
import { initAdvanced } from '../features/advanced'
import {
  fetchTickers,
  fetchKlines,
  fetchOB,
  fetchFR,
  fetchOI,
  fetchFG,
  fetchWhales,
  resetCandles,
  wireMarketHooks,
} from '../services/marketData'
import { noteKlineLive, renderKlineBadge, tickerFeed } from '../services/failover'
import {
  initChart,
  chartTheme,
  updateChartData,
  isNewDataset,
  showChartStatus,
  updateChartLast,
  renderHero,
  renderTicker,
  mapCandle,
  renderWhaleBubbles,
} from '../features/charts/chartRender'
import {
  initMultiCharts,
  mcAdd,
  mcRemove,
  mcChangeInterval,
  mcChangeSymbol,
} from '../features/charts/multiCharts'
import { switchTab, setSymbol, wireUserActions, getActiveTab, subscribeActiveTab, subscribeSymbol } from '../features/actions/userActions'
import { exitReplay } from '../features/charts/replay'
import { analyzeSigCoin, onSigSearch, startAutoScan, switchSigMode, setSigFilter } from '../features/signals'
import { renderMemeUniverse } from '../features/bubbles'
import { pushMsg } from '../features/chat/log' // not ../features/chat: keeps the assistant out of the boot bundle
import { renderFG, renderTopCoins, renderFutures, renderWhales } from '../features/snapshots'
import { startConfluence } from '../features/analysis/confluence'
import { startDivergenceWatch } from '../features/analysis/oiDivergence'
import { mlOnCandles, setMLWanted } from '../features/ml/store'
import { refreshInstrumentQuotes, refreshPerpQuotes } from '../services/instrumentFeed'
import { getShowMLPrediction, onOverlayTogglesChange } from '../features/charts/overlayToggles'
import { checkRLPriceTick } from '../features/ml/rlStore'
import { addAlert, checkAlerts, enableAlerts, removeAlert, renderAlerts, syncAlertLines } from '../features/alerts'
import { initTheme, selectPalette } from '../features/theme'
import { initKeyboard } from '../features/keyboard'


// The direction model is only worth its main-thread cost while something
// that displays it is visible: the chart's ML panel, or the neural-net page.
// Training it eagerly on load froze phones for the first minute.
function syncMLWanted(){
  const tab=getActiveTab();
  setMLWanted(tab==='selflearn' || (tab==='radar' && getShowMLPrediction()));
}
subscribeActiveTab(syncMLWanted);
onOverlayTogglesChange(syncMLWanted);

function runAnalytics(){
  const s = computeAnalytics()
  if (!s) return
  renderAnalysis(s)
  document.title = baseOf(state.symbol)+' '+pfmt(s.last)+' · Liquidity Radar'
}


function setWsStatus(){
  // primary status derived from live stream count (unchanged behavior)
  const ok=state.wsOpen>0;
  const pill=$('statusPill');
  pill.classList.toggle('off',!ok);
  $('statusTxt').textContent=ok?'Live':'Try';
  // The stream count still matters when diagnosing, so keep it on hover.
  pill.title=ok?(state.wsOpen+' live stream'+(state.wsOpen===1?'':'s')):'No live streams';
  // secondary: refresh health monitor + pill (non-disruptive augmentation)
  try{mdPill()}catch(e){}
}
const streamCb={
  onStatus:setWsStatus,
  onHero:renderHero,
  onTickerLive:function(t){
    checkRLPriceTick(state.symbol, t.last);
    document.querySelectorAll('#tickerTrack [data-sym="'+state.symbol+'"]').forEach(function(el){
    el.querySelector('.tp').textContent='$'+pfmt(t.last);
    const cEl=el.querySelector('.chg');
    cEl.className='chg '+chgCls(t.pct);
    cEl.textContent=(t.pct>0?'+':'')+t.pct.toFixed(2)+'%';
    });
  },
  // The badge reports freshness + source (services/failover), not just the socket.
  onKlineLive:noteKlineLive,
  onChartLast:updateChartLast,
  onAnalytics:runAnalytics,
  // The socket came back after missing bars: reload the series to fill them.
  onKlineGap:()=>fetchKlines(state.symbol),
};

// Gold refreshes every 5s. Rebuilding the whole ticker tape for it re-created
// every row, coin logos included (22 <img> elements, each a fresh image
// request when the cache is cold), for one changed price. Write just those
// rows' price and change instead, exactly as renderTicker would. Returns false
// when a full render is still needed: a row is missing or still a placeholder,
// or a coin logo has arrived since the tape was last drawn.
const goldSyms=TICKER_COINS.map(k=>COINS[k].sym).filter(s=>!!binancePerpOf(s));
function patchTickerPrices(syms){
  const track=$('tickerTrack');
  if(!track)return false;
  const logos=TICKER_COINS.filter(k=>/^https:\/\//.test(state.marketCaps?.[k]?.image||'')).length*2;
  if(track.querySelectorAll('.tk-ico img').length!==logos)return false;
  for(const sym of syms){
    const t=state.tickers[sym];
    const rows=track.querySelectorAll('[data-sym="'+sym+'"]');
    if(!t||!rows.length)return false;
    for(const el of rows){
      const tp=el.querySelector('.tp'),c=el.querySelector('.chg');
      if(!tp||!c||tp.textContent==='…')return false;
      tp.textContent='$'+pfmt(t.last);
      c.className='chg '+chgCls(t.pct);
      c.textContent=(t.pct>0?'+':'')+t.pct.toFixed(2)+'%';
    }
  }
  return true;
}

$('tickerTrack').addEventListener('click',e=>{
  const t=e.target.closest('[data-sym]');
  if(t)setSymbol(t.dataset.sym);
});
document.addEventListener('click',e=>{
  const row=e.target.closest('tr[data-sym],.celeb-card[data-sym]');
  if(row)setSymbol(row.dataset.sym);
});
$('symSelect').addEventListener('change',e=>setSymbol(e.target.value));

// The <TimeframePicker/> component owns the toolbar UI and state.tf; the
// engine only supplies the reload when the interval changes.
// Replay is a position in one market's bars; a new market or interval ends it.
subscribeSymbol(exitReplay);
onTimeframeChange(()=>{
  exitReplay();
  resetCandles(); // the previous interval's bars must not stand in for this one's
  updateChartData(true); // …nor stay on the chart while the new ones load
  fetchKlines(state.symbol);
  connectStreams(streamCb); // restart live kline stream at the new, consistent interval
});

function init(){
  initKeyboard();
  syncChartTitle(); // state.tf was restored from storage when the picker loaded
  const sel=$('symSelect');
  sel.innerHTML=Object.keys(COINS).map(k=>'<option value="'+COINS[k].sym+'">'+(COINS[k].sym.endsWith('USDT')?k+'/USDT':k)+' — '+esc(COINS[k].name)+'</option>').join('');
  sel.value=state.symbol;

  initChart();
  applyLayout(); // restores the saved multi-chart layout around the main chart
  watchStageHeight();
  renderAlerts();

  pushMsg('Welcome to <b>Liquidity Radar v5.0</b>. Multi-chart workspace, live signal scanner, and AI analysis. Try: <i>"analyze eth"</i>, <i>"show meme coins"</i>, <i>"should i buy pepe?"</i>, <i>"what is inflation?"</i>, <i>"show news"</i>, <i>"forex events"</i>, <i>"tell me a joke"</i>.','ai');

  // Boot in waves rather than all at once.
  //
  // Everything below used to fire in the same tick: sixteen network
  // operations, including three news feeds and a nineteen-market scanner
  // sweep, all competing with the one request the user is actually waiting
  // for. On a fast connection that is invisible. Measured on a ~450 KB/s link
  // with ~1s to open a connection, it put the first live price 22-39 seconds
  // after load, because the chart's own data queued behind a scanner warming
  // up markets nobody was looking at yet.
  //
  // Nothing is removed and no cadence changes — the polls below still own the
  // steady state. This only decides what goes first.
  const wave = (ms: number, label: string, fn: () => void): void => {
    setTimeout(() => {
      try { fn() } catch (e) { console.warn('boot wave ' + label, e) }
    }, ms)
  }

  // Wave 0 — the screen the user is looking at. Price, chart, live stream.
  fetchTickers();
  const goldQuotes=()=>refreshPerpQuotes().then(()=>{if(!patchTickerPrices(goldSyms))renderTicker();renderTopCoins()});
  goldQuotes();
  fetchKlines(state.symbol);
  connectStreams(streamCb);
  initTheme();
  syncMLWanted();
  wireNewsUI();
  // The last wire from lr_news_cache, so the News tab and the dashboard's
  // headlines are not blank until the feeds are asked in wave 4.
  primeNewsCache();

  // Wave 1 — the rest of the charted symbol's own context.
  wave(1200, 'symbol-context', () => {
    fetchOB();
    fetchFR();
    fetchOI();
    fetchWhales();
    initMultiCharts();
    initAdvanced();
  });

  // Wave 2 — panels that are real but not what anyone opens the app for.
  wave(4000, 'secondary-panels', () => {
    refreshInstrumentQuotes();
    fetchMarketCaps();
    fetchFuturesSnapshot().then(renderFutures);
    fetchFG();
    renderMemeUniverse();
    startConfluence();
    startDivergenceWatch();
  });

  // Wave 3 — the scanner. It sweeps nineteen markets across three timeframes,
  // which is by far the heaviest thing here, and its own loop is two minutes
  // wide, so starting it a few seconds late costs nothing.
  wave(8000, 'scanner', () => {
    startAutoScan();
  });

  // Wave 4 — the wire. Several different hosts, each needing its own
  // connection, and none of it is why the app was opened.
  wave(12000, 'news', () => {
    fetchNews();
    fetchTrending();
    fetchBreaking();
  });

  poll(fetchTickers,20000);
  poll(refreshInstrumentQuotes,20000);
  poll(goldQuotes,5000);
  poll(fetchMarketCaps,60000);
  poll(function(){fetchFuturesSnapshot().then(renderFutures)},60000);
  poll(fetchWhales,10000);
  poll(fetchFR,30000);
  poll(fetchOI,30000);
  poll(fetchFG,300000);
  poll(renderMemeUniverse,20000);
  // The status pill follows the streams within seconds rather than on a 20s
  // poll, so a brief stall neither lingers on "Try" nor recovers late.
  poll(function(){try{mdPill()}catch(e){}},3000);
  poll(fetchNews,300000);
}

// --- expose module-scope functions to window (classic-script globals no
// longer exist in ES modules; inline/generated onclick handlers rely on them)
const __LR_EXPOSE:[string,any][]=[
  ['$',$,],['switchTab',switchTab,],['switchSigMode',switchSigMode,],['setSigFilter',setSigFilter,],
  ['onSigSearch',onSigSearch,],['analyzeSigCoin',analyzeSigCoin,],
  ['closeModal',closeModal,],
  ['addAlert',addAlert,],['enableAlerts',enableAlerts,],
  ['removeAlert',removeAlert,],
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
    disconnectStreams,
    streamCb,
    renderHero,
    renderTicker,
  })
  wireMarketHooks({
    onTickers() {
      renderTicker();renderHero();renderTopCoins();checkAlerts();
      $('topCoinsUpd').textContent=(tickerFeed.freshness==='LIVE'?'LIVE':tickerFeed.freshness+' · '+tickerFeed.name.toUpperCase())+' · '+new Date().toLocaleTimeString();
    },
    onTickersStale(){
      $('topCoinsUpd').textContent=tickerFeed.freshness+' · '+new Date(tickerFeed.ts).toLocaleTimeString();
    },
    onKlines(){ updateChartData(isNewDataset());runAnalytics();mlOnCandles(state.symbol, state.tf, state.candles);syncAlertLines(); },
    onKlineCache(){ syncAlertLines();
      updateChartData(isNewDataset());runAnalytics();
      renderKlineBadge();
      showToast('Klines live stream down — showing cached data');
    },
    onKlineFail(){
      // Say so on the chart itself — a toast disappears and the legend would
      // otherwise sit on "Loading chart…" forever. fetchKlines retries.
      // The WS badge is left alone: it reports the socket, which can be live
      // while the REST history is missing.
      // A rate-limit cooldown is named explicitly: "retrying…" reads like a
      // bug when the honest answer is that Binance is making us wait.
      const cool=cooldownLeft();
      if(cool>0){
        const secs=Math.ceil(cool/1000);
        const left=secs>90?Math.ceil(secs/60)+' min':secs+'s';
        $('legendOHLC').textContent='Binance rate limit — chart resumes in '+left;
        showChartStatus('Binance rate limit — the chart resumes in '+left+'.');
        showToast('Binance rate limit reached — resuming in '+left);
        return;
      }
      $('legendOHLC').textContent='Chart data unavailable — retrying…';
      showChartStatus('Chart data is unavailable. Retrying automatically.', ()=>fetchKlines(state.symbol));
      showToast('Klines unavailable — check network/Binance access');
    },
    onFR(){ runAnalytics();renderHero(); },
    onFRfail(){ $('mFR').textContent='N/A'; },
    onOI(){ runAnalytics(); },
    onOIfail(){ $('mOI').textContent='N/A'; },
    onFG(){ renderFG(); },
    onFGfail(){ $('fngClass').textContent='feed unreachable'; },
    onWhales(){ renderWhales(); renderWhaleBubbles(); },
  })
  init()
}

// keep module-local copies accessible to console debugging
export { switchTab, setSymbol, initChart }
