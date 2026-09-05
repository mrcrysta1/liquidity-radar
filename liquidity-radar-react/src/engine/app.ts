// Liquidity Radar — engine (Phase 1 migration).
// Faithful port of the original inline <script>, transpiled mechanically to
// TypeScript. Logic is intentionally untouched; only module boundaries,
// the $ helper return type, and the bootstrap call differ. Interactive
// sections are progressively being converted to declarative React.
// @ts-nocheck
import * as LightweightCharts from 'lightweight-charts'
import { COINS, TOP16, CELEBS, TICKER_COINS } from '../constants/market'
import { esc, fmt, pfmt, cfmt, nfmt, timeAgo, chgHtml, chgCls, sigOf } from '../utils/format'
import {
  calcRSI,
  calcMACD,
  calcBB,
  calcATR,
  volTrend,
  linReg,
  emaArr,
  aiComposite,
  forecastFrom,
  supportResistance,
  smaArr,
  vwapSeries,
  macdSeries,
  calcBBList,
} from '../utils/indicators'
import { baseOf, coinMeta } from '../utils/coins'
import { $, showToast, openModal, closeModal } from '../utils/dom'
import { fetchForexEvents } from '../features/analysis/calendar'
import { fetchNews, fetchTrending, fetchBreaking, wireNewsUI } from '../features/news/newsFeed'

import { state } from '../services/store'
import {
  md,
  mdHealth,
  mdSym,
  mdTf,
  mdFlat,
  mdFromK,
  mdVal,
  mdStoreTicker,
  mdStoreCandles,
  mdStoreOB,
  mdDataAge,
  mdCacheGet,
  mdCachePut,
  mdHearbeat,
  mdRefreshHealth,
  mdRestOk,
  mdRestErr,
  mdPill,
  mdDebug,
  mdToggleDebug,
} from '../services/market'
import { jget } from '../api/client'
import { storageGet, storageSet, storageGetRaw, storageSetRaw } from '../services/storage'
import { connectStreams } from '../services/streams'
import {
  initChart,
  applyChartTheme,
  chartTheme,
  updateChartData,
  updateChartLast,
  renderOB,
  renderHero,
  renderTicker,
  mapCandle,
  isLightTheme,
  resizeChart,
} from '../features/charts/chartRender'
import {
  initMultiCharts,
  mcApplyTheme,
  mcAdd,
  mcRemove,
  mcChangeInterval,
  mcChangeSymbol,
} from '../features/charts/multiCharts'
import { switchTab, setSymbol, wireUserActions } from '../features/actions/userActions'
import { applySigAnaTheme, analyzeSigCoin, onSigSearch, startAutoScan, switchSigMode } from '../features/signals'
import { initBubbles, renderBubbles, renderMemeUniverse } from '../features/bubbles'
import { initHeatMap } from '../features/heatmap'
import { pushMsg } from '../features/chat'
import { renderFG, renderTopCoins, renderWhales } from '../features/snapshots'
import { addPosition, removePosition, renderPortfolio } from '../features/portfolio'
import { addAlert, checkAlerts, enableAlerts, removeAlert, renderAlerts } from '../features/alerts'


function runAnalytics(){
  if(state.candles.length<30)return;
  const closes=state.candles.map(c=>c.c);
  const vols=state.candles.map(c=>c.v);
  const a=aiComposite(state.candles,closes,vols);
  const last=a.last;

  const rsiZone=a.rsi>70?['OVERBOUGHT','b-red']:a.rsi<30?['OVERSOLD','b-green']:a.rsi>55?['BULLISH','b-green']:a.rsi<45?['BEARISH','b-red']:['NEUTRAL','b-gray'];
  $('mRSI').textContent=a.rsi.toFixed(1);
  $('mRSI').style.color=rsiZone[0]==='OVERBOUGHT'?'var(--red)':rsiZone[0]==='OVERSOLD'?'var(--green)':'var(--txt)';
  $('mRSIZone').textContent=rsiZone[0];$('mRSIZone').className='badge '+rsiZone[1];
  $('indRSI').textContent=a.rsi.toFixed(1);
  $('indRSIb').textContent=rsiZone[0];$('indRSIb').className='badge '+rsiZone[1];

  const mBull=a.macd.hist>0;
  const histPct=((a.macd.hist/(last*0.002))*100).toFixed(0);
  $('mMACD').textContent=(mBull?'+':'')+histPct+'%';
  $('mMACD').style.color=mBull?'var(--green)':'var(--red)';
  $('mMACDZone').textContent=mBull?'BULLISH':'BEARISH';$('mMACDZone').className='badge '+(mBull?'b-green':'b-red');
  $('indMACD').textContent=a.macd.hist.toFixed(last>100?2:6);
  $('indMACDb').textContent=mBull?'HIST > 0':'HIST < 0';$('indMACDb').className='badge '+(mBull?'b-green':'b-red');

  const above=last>a.e20;
  $('mEMA').textContent=pfmt(a.e20);
  $('mEMAZone').textContent=above?'PRICE ABOVE':'PRICE BELOW';$('mEMAZone').className='badge '+(above?'b-green':'b-red');
  $('mEMASub').textContent=(above?'uptrend bias':'downtrend bias')+' · Δ '+(((last/a.e20)-1)*100).toFixed(2)+'%';
  $('indEMA').textContent=pfmt(a.e20);
  $('indEMAb').textContent=above?'ABOVE ✓':'BELOW ✕';$('indEMAb').className='badge '+(above?'b-green':'b-red');

  const pb=a.bb.pctB;
  const bbZone=pb>95?['UPPER BREAK','b-amber']:pb>70?['HIGH','b-green']:pb<5?['LOWER BREAK','b-amber']:pb<30?['LOW','b-red']:['MID RANGE','b-gray'];
  $('mBB').textContent=pb.toFixed(1)+'%';
  $('mBBZone').textContent=bbZone[0];$('mBBZone').className='badge '+bbZone[1];
  $('indBB').textContent=pb.toFixed(1)+'%';
  $('indBBb').textContent=bbZone[0];$('indBBb').className='badge '+bbZone[1];
  $('indBBs').textContent='bands '+pfmt(a.bb.lo)+' – '+pfmt(a.bb.up);

  $('indVT').textContent=a.vt;
  const vtc=a.vt==='RISING'?['RISING ↑','b-green']:a.vt==='FALLING'?['FALLING ↓','b-red']:['FLAT →','b-gray'];
  $('indVTb').textContent=vtc[0];$('indVTb').className='badge '+vtc[1];

  $('mAIScore').textContent=(a.score>0?'+':'')+a.score;
  $('mAIScore').style.color=a.color;
  $('mAIZone').textContent=a.label;$('mAIZone').className='badge '+a.badge;
  const mkPos=50+a.score/2;
  $('mAIMarker').style.left='calc('+mkPos+'% - 2px)';
  $('indScoreMarker').style.left='calc('+mkPos+'% - 2px)';
  $('indScoreLbl').textContent=(a.score>0?'+':'')+a.score+' · '+a.label;
  $('indScoreLbl').style.color=a.color;

  const rets=[];
  for(let i=1;i<closes.length;i++)rets.push(closes[i]/closes[i-1]-1);
  const mr=rets.reduce((x,y)=>x+y,0)/rets.length;
  const sd=Math.sqrt(rets.reduce((x,y)=>x+(y-mr)*(y-mr),0)/rets.length);
  const dv=sd*Math.sqrt(96)*100;
  $('mVol').textContent=dv.toFixed(2)+'%';
  $('mVol').style.color=dv>4?'var(--red)':dv>1.5?'var(--amber)':'var(--green)';

  const fc=forecastFrom(closes);
  $('fcBias').textContent=fc.bias;
  $('fcBias').style.color=fc.bias.indexOf('UP')===0?'var(--green)':'var(--red)';
  $('fcConf').textContent=fc.rows[3].conf+'%';
  $('fcRows').innerHTML=fc.rows.map(r=>{
    const cls=r.dp>=0?'hl-g':'hl-r';
    const col=r.dp>=0?'var(--green)':'var(--red)';
    return'<tr><td>'+r.label+'</td><td><b>'+pfmt(r.pred)+'</b></td><td style="color:'+col+'">'+(r.dp>0?'+':'')+r.dp.toFixed(2)+'%</td><td>'+pfmt(r.lo)+' – '+pfmt(r.hi)+'</td><td>'+r.conf+'%<span class="conf-bar"><i style="width:'+r.conf+'%"></i></span></td></tr>';
  }).join('');

  const sr=supportResistance(state.candles);
  if(sr)state._sr=sr;
  state._atr=calcATR(state.candles);
  state._ai=a;
  renderAnalysis();
  document.title=baseOf(state.symbol)+' '+pfmt(last)+' · Liquidity Radar';
}

function renderAnalysis(){
  const base=baseOf(state.symbol);
  const mark=state.fr?parseFloat(state.fr.markPrice):(state._ai?state._ai.last:null);
  $('liqSym').textContent=state.symbol;
  $('vpSym').textContent=state.symbol+' · 96 BARS';
  if(mark!=null)$('liqMark').textContent='$'+pfmt(mark);
  if(state.fr){
    const rate=parseFloat(state.fr.lastFundingRate);
    $('mFR').textContent=(rate*100).toFixed(4)+'%';
    $('mFR').style.color=rate>0?'var(--green)':rate<0?'var(--red)':'var(--txt)';
    $('mFRNext').textContent=rate>0?'longs pay shorts':rate<0?'shorts pay longs':'flat';
    if(state.fr.nextFundingTime){
      const upd=()=>{
        const ms=state.fr.nextFundingTime-Date.now();
        if(ms<0)return;
        const hh=Math.floor(ms/3600000),mm=Math.floor((ms%3600000)/60000),ss=Math.floor((ms%60000)/1000);
        $('mFRNext').textContent=(rate>0?'longs pay · ':'shorts pay · ')+String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0')+':'+String(ss).padStart(2,'0')+' to funding';
      };
      upd();clearInterval(state._frTimer);state._frTimer=setInterval(upd,1000);
    }
  }
  if(state.oi&&mark!=null){
    const oiN=parseFloat(state.oi.openInterest)*mark;
    $('mOI').textContent=cfmt(oiN);
    $('mOISub').textContent=nfmt(parseFloat(state.oi.openInterest))+' '+base+' contracts';
    $('liqOI').textContent=cfmt(oiN);
    const atr=state._atr||mark*0.004;
    $('liqATR').textContent='$'+pfmt(atr);
    const sr=state._sr||{sup:mark*0.97,res:mark*1.03};
    const lz={lo:sr.sup-1.1*atr,hi:sr.sup-0.3*atr};
    const sz={lo:sr.res+0.3*atr,hi:sr.res+1.1*atr};
    $('liqLongRange').textContent='$'+pfmt(lz.lo)+' — $'+pfmt(lz.hi);
    $('liqShortRange').textContent='$'+pfmt(sz.lo)+' — $'+pfmt(sz.hi);
    const leLong=oiN*0.22,leShort=oiN*0.16;
    $('liqLongEst').textContent='estimated trapped-notional magnet: '+cfmt(leLong)+' ('+(((lz.hi/mark)-1)*100).toFixed(2)+'% below mark)';
    $('liqShortEst').textContent='estimated trapped-notional magnet: '+cfmt(leShort)+' ('+(((sz.lo/mark)-1)*100).toFixed(2)+'% above mark)';
    const liqSpan=Math.max(atr*2.8*3,mark*0.003);
    const liqLBars=Math.max(8,Math.min(100,Math.round(((lz.hi/mark-1)*100)/(liqSpan/mark*100)*100)));
    const liqSBars=Math.max(8,Math.min(100,Math.round(((sz.lo/mark-1)*100)/(liqSpan/mark*100)*100)));
    const lB=$('liqLongBar'),sB=$('liqShortBar');
    if(lB)lB.style.width=liqLBars+'%';
    if(sB)sB.style.width=liqSBars+'%';
    const srDist=((sr.sup-mark)/mark*100).toFixed(2);
    $('liqLev').textContent=Math.abs(srDist)+'% below support at $'+pfmt(sr.sup);
    state._liq={lz:lz,sz:sz,oiN:oiN};
  }
  if(!state.candles.length)return;
  const w=state.candles.slice(-96);
  const lo=Math.min.apply(null,w.map(c=>c.l)),hi=Math.max.apply(null,w.map(c=>c.h));
  const bins=22;
  const buckets=new Array(bins).fill(0);
  w.forEach(c=>{
    let bi=Math.floor((c.c-lo)/((hi-lo)||1)*bins);
    bi=Math.min(bins-1,bi);
    buckets[bi]+=c.v;
  });
  const maxB=Math.max.apply(null,buckets)||1;
  const pocIdx=buckets.indexOf(maxB);
  const lastP=w[w.length-1].c;
  let html='';
  for(let i=bins-1;i>=0;i--){
    const pl=lo+i*((hi-lo)/bins);
    const midP=pl+((hi-lo)/bins)/2;
    const wpct=buckets[i]/maxB*100;
    const isPoc=i===pocIdx,isCur=lastP>=pl&&lastP<=pl+((hi-lo)/bins);
    html+='<div class="vp-row'+(isPoc?' poc':'')+(isCur?' cur':'')+'"><span class="vp-lbl">'+pfmt(midP)+'</span><span class="vp-zone"><span class="vp-bar" style="width:'+Math.max(2,wpct).toFixed(1)+'%"></span></span><span class="vp-val">'+nfmt(buckets[i])+'</span><span class="vp-flag">'+(isPoc?'★POC':isCur?'◀ LIVE':'')+'</span></div>';
  }
  $('vpList').innerHTML=html;
}

async function fetchTickers(){
  try{
    const syms=Object.values(COINS).map(c=>c.sym);
    const url='https://api.binance.com/api/v3/ticker/24hr?symbols='+encodeURIComponent(JSON.stringify(syms));
    const data=await jget(url);
    data.forEach(d=>{
      state.tickers[d.symbol]={last:+d.lastPrice,pct:+d.priceChangePercent,high:+d.highPrice,low:+d.lowPrice,qvol:+d.quoteVolume,trades:+d.count};
    });
    renderTicker();renderHero();renderTopCoins();renderPortfolio();checkAlerts();renderBubbles();
    $('topCoinsUpd').textContent='LIVE · '+new Date().toLocaleTimeString();
  }catch(e){console.warn('tickers',e)}
}
async function fetchKlines(sym){
  try{
    const inter=mdTf(state.tf||'15m');
    const data=await jget('https://api.binance.com/api/v3/klines?symbol='+mdSym(sym)+'&interval='+inter+'&limit=200');
    const candles=data.map(mdFromK).filter(Boolean);
    if(!candles.length)throw new Error('empty');
    state.candles=candles;
    mdStoreCandles(state.symbol,inter,candles);
    mdCachePut(state.symbol,inter,candles);
    updateChartData();runAnalytics();
  }catch(e){
    console.warn('klines',e);
    // REST fallback: serve recent cached candles so the chart isn't left blank
    const inter=mdTf(state.tf);
    const cached=mdCacheGet(state.symbol,inter)||md.candles[mdSym(state.symbol)+'|'+inter]||null;
    if(cached&&cached.length){
      state.candles=cached;
      updateChartData();runAnalytics();
      $('wsKlineState').textContent='CACHE';$('wsKlineState').className='badge b-amber';
      mdDebug.log('klines','serving cached '+state.symbol+' '+inter);
      showToast('Klines live stream down — showing cached data');
    }else{
      showToast('Klines unavailable — check network/Binance access');
    }
  }
}
async function fetchOB(){
  try{
    const d=await jget('https://api.binance.com/api/v3/depth?symbol='+mdSym(state.symbol)+'&limit=15');
    const ob={bids:d.bids.map(b=>[+b[0],+b[1]]),asks:d.asks.map(a=>[+a[0],+a[1]])};
    if(!mdStoreOB(state.symbol,ob))return;
    state.ob=ob;
    renderOB();
  }catch(e){console.warn('depth',e)}
}
async function fetchFR(){
  try{
    state.fr=await jget('https://fapi.binance.com/fapi/v1/premiumIndex?symbol='+state.symbol);
    runAnalytics();renderHero();
  }catch(e){console.warn('premiumIndex',e);$('mFR').textContent='N/A'}
}
async function fetchOI(){
  try{
    state.oi=await jget('https://fapi.binance.com/fapi/v1/openInterest?symbol='+state.symbol);
    runAnalytics();
  }catch(e){console.warn('openInterest',e);$('mOI').textContent='N/A'}
}
async function fetchFG(){
  try{
    const d=await jget('https://api.alternative.me/fng/');
    if(d.data&&d.data[0]){state.fg=d.data[0];renderFG()}
  }catch(e){console.warn('fng',e);$('fngClass').textContent='feed unreachable'}
}
async function fetchWhales(){
  try{
    const trades=await jget('https://api.binance.com/api/v3/trades?symbol='+state.symbol+'&limit=1000');
    const big=trades
      .map(t=>({id:t.id,time:t.time,price:+t.price,qty:+t.qty,usd:+t.price*+t.qty,maker:t.isBuyerMaker}))
      .filter(t=>t.usd>=50000)
      .sort((a,b)=>b.time-a.time)
      .slice(0,40);
    state.whales=big;
    renderWhales();
  }catch(e){console.warn('trades',e)}
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

const SHORTCUT_TABS={'r':'radar','c':'multichart','s':'signals','m':'market','b':'bubbles','a':'analysis','n':'news','p':'portfolio','t':'chat'};
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(document.documentElement.classList.contains('radar-fs')){
      document.documentElement.classList.remove('radar-fs');
      const b=$('fsBtn');if(b){b.textContent='⛶';b.title='Full screen [F]';}
      resizeChart();
    }
    const modals=document.querySelectorAll('.modal-overlay.open');
    modals.forEach(m=>m.classList.remove('open'));
    return;
  }
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  const t=e.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable))return;
  if(e.key==='/'){
    e.preventDefault();
    const cs=$('coinSearch');
    if(cs){cs.focus();cs.select()}
    return;
  }
  if(e.key==='?'){
    e.preventDefault();
    const hints=['R Radar','C Charts','S Signals','M Market','B Bubbles','A Analysis','N News','P Portfolio','T Chat','F Fullscreen','/ Search','Esc Close'];
    showToast('Shortcuts: '+hints.join('   '));
    return;
  }
  if(e.key==='f'||e.key==='F'){
    $('fsBtn').click();
    return;
  }
  const k=e.key.toLowerCase();
  if(SHORTCUT_TABS[k]){switchTab(SHORTCUT_TABS[k])}
});

function init(){
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
  initSearch();
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

// ============================================================
// COLOR PALETTE SYSTEM
// User-selectable theme combos. Applies CSS variables as inline
// styles on <html> (overrides :root + light block). Palettes carry
// BOTH dark and light color sets; the right set is applied based on
// the current theme and re-applied on theme toggle. Charts read the
// live CSS variables via getComputedStyle so they follow too.
// ============================================================
const PALETTES=[
  {id:'classic',name:'Navy Classic',desc:'Current look — trusty deep blue on near-black',
   sw:['#2962FF','#00E5FF','#B388FF','#00E676','#FF1744'],
   rgb:{p:'41,98,255',c:'0,229,255',g:'0,230,118',r:'255,23,68',a:'255,179,0',u:'179,136,255',k:'255,64,129'},
   dark:{bg:'#060B18',card:'#0D1628',card2:'#101C33',border:'#1A2D4A',border2:'#22385E',primary:'#2962FF',green:'#00E676',red:'#FF1744',amber:'#FFB300',cyan:'#00E5FF',purple:'#B388FF',pink:'#FF4081',txt:'#E8EEF9',muted:'#8FA3BF',dim:'#5A6E8F'},
   light:{bg:'#F0F2F5',card:'#FFFFFF',card2:'#F8F9FA',border:'#D1D5DB',border2:'#9CA3AF',primary:'#2563EB',green:'#16A34A',red:'#DC2626',amber:'#D97706',cyan:'#0891B2',purple:'#7C3AED',pink:'#DB2777',txt:'#1F2937',muted:'#6B7280',dim:'#9CA3AF'}},
  {id:'cyber',name:'Cyber Gold',desc:'Premium black &amp; gold — wealth instinct, luxurious fintech',
   sw:['#F0B90B','#22D3EE','#A78BFA','#34D399','#F87171'],
   rgb:{p:'240,185,11',c:'34,211,238',g:'52,211,153',r:'248,113,113',a:'251,146,60',u:'167,139,250',k:'244,114,182'},
   dark:{bg:'#07090F',card:'#0D1017',card2:'#131722',border:'#1B2233',border2:'#262F45',primary:'#F0B90B',green:'#34D399',red:'#F87171',amber:'#FB923C',cyan:'#22D3EE',purple:'#A78BFA',pink:'#F472B6',txt:'#F1F5F9',muted:'#94A3B8',dim:'#556078'},
   light:{bg:'#F7F8FA',card:'#FFFFFF',card2:'#F9FAFB',border:'#D7DCE3',border2:'#A9B0BC',primary:'#C9930A',green:'#059669',red:'#DC2626',amber:'#D97706',cyan:'#0E7490',purple:'#7C3AED',pink:'#DB2777',txt:'#16181D',muted:'#5D6572',dim:'#9AA1AD'}},
  {id:'indigo',name:'Deep Indigo',desc:'Calm trust + electric violet — easy on the eyes, AI / analytics feel',
   sw:['#6366F1','#8B5CF6','#22D3EE','#10B981','#F43F5E'],
   rgb:{p:'99,102,241',c:'34,211,238',g:'16,185,129',r:'244,63,94',a:'245,158,11',u:'139,92,246',k:'236,72,153'},
   dark:{bg:'#0B0E1A',card:'#12162A',card2:'#171C33',border:'#232A4A',border2:'#2F3760',primary:'#6366F1',green:'#10B981',red:'#F43F5E',amber:'#F59E0B',cyan:'#22D3EE',purple:'#8B5CF6',pink:'#EC4899',txt:'#E7EAF6',muted:'#9AA3C0',dim:'#5C6585'},
   light:{bg:'#F4F5FB',card:'#FFFFFF',card2:'#F8F9FE',border:'#D8DBEE',border2:'#AEB3D9',primary:'#4F46E5',green:'#059669',red:'#E11D48',amber:'#D97706',cyan:'#0E7490',purple:'#7C3AED',pink:'#DB2777',txt:'#171A2E',muted:'#5B6180',dim:'#979DB8'}},
  {id:'emerald',name:'Emerald Sea',desc:'Growth + calm teal — soothing, subconscious “money growing”',
   sw:['#10B981','#2DD4BF','#A3E635','#34D399','#F87171'],
   rgb:{p:'16,185,129',c:'45,212,191',g:'52,211,153',r:'248,113,113',a:'251,191,36',u:'16,185,129',k:'244,114,182'},
   dark:{bg:'#041210',card:'#0A1F1D',card2:'#0E2825',border:'#123733',border2:'#1A4A45',primary:'#10B981',green:'#34D399',red:'#F87171',amber:'#FBBF24',cyan:'#2DD4BF',purple:'#34D399',pink:'#F472B6',txt:'#E6F3F0',muted:'#9FBDB8',dim:'#5E7A75'},
   light:{bg:'#F1F8F6',card:'#FFFFFF',card2:'#F7FBFA',border:'#CFE3DE',border2:'#9FC4BD',primary:'#0E9F6E',green:'#059669',red:'#DC2626',amber:'#D97706',cyan:'#0E7490',purple:'#0E9F6E',pink:'#DB2777',txt:'#0F2420',muted:'#4E736C',dim:'#8AA49F'}},
  {id:'aurora',name:'Midnight Aurora',desc:'Dusk blue with warm amber — energetic, action-ready',
   sw:['#F59E0B','#FB7185','#38BDF8','#34D399','#F87171'],
   rgb:{p:'245,158,11',c:'56,189,248',g:'52,211,153',r:'248,113,113',a:'251,191,36',u:'167,139,250',k:'251,113,133'},
   dark:{bg:'#0A0E1F',card:'#121830',card2:'#171E3A',border:'#242D4E',border2:'#303C66',primary:'#F59E0B',green:'#34D399',red:'#F87171',amber:'#FBBF24',cyan:'#38BDF8',purple:'#A78BFA',pink:'#FB7185',txt:'#EAF0F9',muted:'#9AA8C0',dim:'#5E6B85'},
   light:{bg:'#F7F8FC',card:'#FFFFFF',card2:'#FAFAFD',border:'#D9DEEB',border2:'#ACB7CC',primary:'#D97706',green:'#059669',red:'#DC2626',amber:'#B45309',cyan:'#0E7490',purple:'#7C3AED',pink:'#DB2777',txt:'#171B27',muted:'#5C6576',dim:'#98A0B0'}}
];
function activePalette(){
  return PALETTES.find(p=>p.id===storageGetRaw('lr-palette'))||PALETTES[0];
}
function applyPalette(id){
  var p=PALETTES.find(x=>x.id===id)||PALETTES[0];
  storageSetRaw('lr-palette',p.id);
  var s=isLightTheme()?p.light:p.dark;
  var root=document.documentElement;
  ['bg','card','card2','border','border2','primary','green','red','amber','cyan','purple','pink','txt','muted','dim'].forEach(function(k){
    root.style.setProperty('--'+k,s[k]);
  });
  if(p.rgb){
    var rgbmap={pRGB:p.rgb.p,cRGB:p.rgb.c,gRGB:p.rgb.g,rRGB:p.rgb.r,aRGB:p.rgb.a,uRGB:p.rgb.u,kRGB:p.rgb.k};
    Object.keys(rgbmap).forEach(function(k){root.style.setProperty('--'+k,String(rgbmap[k]).replace(/,/g,' '));});
  }
  applyChartTheme();
  mcApplyTheme();
  applySigAnaTheme();
  renderPalettePicker();
  var meta=document.querySelector('meta[name=theme-color]');
  if(meta)meta.setAttribute('content',s.bg);
}
function renderPalettePicker(){
  var box=$('palGrid');if(!box)return;
  var cur=(activePalette().id);
  box.innerHTML=PALETTES.map(function(p,i){
    return '<div class="pal-card'+(p.id===cur?' active':'')+'" onclick="selectPalette(\''+p.id+'\')">'
      +'<div class="pal-sw">'+p.sw.map(function(c){return'<i style="background:'+c+'"></i>'}).join('')
      +'</div><div class="pal-info"><div class="pal-name">'+p.name+'</div><div class="pal-desc">'+p.desc+'</div></div></div>';
  }).join('');
}
function selectPalette(id){
  applyPalette(id);
  closeModal('thModal');
}

function initTheme(){
  var savedPal=storageGetRaw('lr-palette')||'classic';
  applyPalette(savedPal);
  var saved=storageGetRaw('lr-theme');
  if(saved==='light'){document.documentElement.setAttribute('data-theme','light');$('themeBtn').textContent='L'}
  $('paletteBtn').addEventListener('click',function(){renderPalettePicker();openModal('thModal')});
  $('themeBtn').addEventListener('click',function(){
    var cur=document.documentElement.getAttribute('data-theme');
    if(cur==='light'){
      document.documentElement.removeAttribute('data-theme');
      storageSetRaw('lr-theme','dark');
      $('themeBtn').textContent='D';
    }else{
      document.documentElement.setAttribute('data-theme','light');
      storageSetRaw('lr-theme','light');
      $('themeBtn').textContent='L';
    }
    applyPalette(activePalette().id);
  });
}

let allBinanceSymbols=[];
async function initSearch(){
  try{
    const r=await fetch('https://api.binance.com/api/v3/exchangeInfo');
    const d=await r.json();
    allBinanceSymbols=d.symbols.filter(s=>s.status==='TRADING'&&s.symbol.endsWith('USDT')).map(s=>({sym:s.symbol,base:s.baseAsset,quote:s.quoteAsset,prec:s.filters.find(f=>f.filterType==='PRICE_FILTER')?s.filters.find(f=>f.filterType==='PRICE_FILTER').tickSize:'0.01'}));
    allBinanceSymbols.sort((a,b)=>a.base.localeCompare(b.base));
  }catch(e){}
  const input=$('coinSearch');
  const results=$('searchResults');
  input.addEventListener('input',function(){
    const q=this.value.trim().toLowerCase();
    if(q.length<1){results.classList.remove('show');return}
    const matches=allBinanceSymbols.filter(s=>s.base.toLowerCase().indexOf(q)!==-1||s.sym.toLowerCase().indexOf(q)!==-1).slice(0,30);
    if(!matches.length){results.innerHTML='<div class="search-count">No matches for "'+esc(q)+'"</div>';results.classList.add('show');return}
    results.innerHTML=matches.map(s=>{
      const t=state.tickers[s.sym];
      const price=t?'$'+pfmt(t.last):'—';
      const chg=t?chgHtml(t.pct):'<span class="chg flat">—</span>';
      const known=COIN_ALIASES[s.base.toUpperCase()];
      const isPopular=known||TOP16.indexOf(s.base.toUpperCase())!==-1;
      return'<div class="search-item" data-sym="'+s.sym+'"><span class="si-sym" style="color:'+(isPopular?'var(--cyan)':'var(--muted)')+'">'+s.base+'</span><span class="si-name">'+s.base+'/USDT</span><span class="si-price">'+price+'</span><span class="si-chg">'+chg+'</span></div>';
    }).join('')+'<div class="search-count">'+matches.length+' pairs found</div>';
    results.classList.add('show');
  });
  input.addEventListener('focus',function(){if(this.value.trim().length>=1)results.classList.add('show')});
  results.addEventListener('click',function(e){
    const item=e.target.closest('.search-item');
    if(item){setSymbol(item.dataset.sym);input.value='';results.classList.remove('show')}
  });
  document.addEventListener('click',function(e){if(!e.target.closest('.search-wrap'))results.classList.remove('show')});
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
  init()
}

// keep module-local copies accessible to console debugging
export { switchTab, setSymbol, initChart }
