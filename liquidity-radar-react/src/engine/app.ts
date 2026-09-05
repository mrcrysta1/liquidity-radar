// Liquidity Radar — engine (Phase 1 migration).
// Faithful port of the original inline <script>, transpiled mechanically to
// TypeScript. Logic is intentionally untouched; only module boundaries,
// the $ helper return type, and the bootstrap call differ. Interactive
// sections are progressively being converted to declarative React.
// @ts-nocheck
import * as LightweightCharts from 'lightweight-charts'
import { COINS, TOP16, CELEBS, TICKER_COINS } from '../constants/market'
import { esc, fmt, pfmt, cfmt, nfmt, timeAgo, chgHtml, sigOf } from '../utils/format'
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
import { findCoin, baseOf, coinMeta } from '../utils/coins'
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
import { jget, jget2 } from '../api/client'
import { storageGet, storageSet, storageGetRaw, storageSetRaw } from '../services/storage'
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

function fngColor(v){
  if(v==null)return'#8FA3BF';
  if(v<25)return'#FF1744';
  if(v<45)return'#FFB300';
  if(v<=55)return'#78909C';
  return'#00E676';
}
function drawGauge(v){
  const cv=$('gauge');
  const dpr=window.devicePixelRatio||1;
  cv.width=130*dpr;cv.height=130*dpr;
  const x=cv.getContext('2d');
  x.scale(dpr,dpr);
  const cx=65,cy=70,r=48;
  const segs=[[0,25,'#FF1744'],[25,45,'#FFB300'],[45,55,'#78909C'],[55,75,'#8BC34A'],[75,100,'#00E676']];
  segs.forEach(function(seg){
    const a0=Math.PI+(seg[0]/100)*Math.PI,a1=Math.PI+(seg[1]/100)*Math.PI;
    x.beginPath();
    x.arc(cx,cy,r,a0+0.015,a1-0.015);
    x.strokeStyle=seg[2];x.lineWidth=13;x.lineCap='butt';
    x.shadowColor=seg[2];x.shadowBlur=(v>=seg[0]&&v<=seg[1])?10:0;
    x.stroke();
  });
  x.shadowBlur=0;
  for(let i=0;i<=10;i++){
    const ang=Math.PI+(i/10)*Math.PI;
    x.beginPath();
    x.moveTo(cx+Math.cos(ang)*(r-11),cy+Math.sin(ang)*(r-11));
    x.lineTo(cx+Math.cos(ang)*(r-16),cy+Math.sin(ang)*(r-16));
    x.strokeStyle='#33486F';x.lineWidth=i%5===0?2:1;x.stroke();
  }
  const na=Math.PI+(v/100)*Math.PI;
  x.beginPath();
  x.moveTo(cx-Math.cos(na)*8,cy-Math.sin(na)*8);
  x.lineTo(cx+Math.cos(na)*(r-19),cy+Math.sin(na)*(r-19));
  x.strokeStyle='#FFFFFF';x.lineWidth=2.5;x.lineCap='round';
  x.shadowColor='#FFFFFF';x.shadowBlur=6;x.stroke();
  x.shadowBlur=0;
  x.beginPath();x.arc(cx,cy,4.5,0,Math.PI*2);x.fillStyle='#0D1628';x.fill();
  x.strokeStyle='#FFFFFF';x.lineWidth=2;x.stroke();
  x.font='700 17px JetBrains Mono, monospace';
  x.textAlign='center';
  x.fillStyle=fngColor(v);
  x.fillText(String(v),cx,cy+34);
  x.font='600 8px Inter, sans-serif';
  x.fillStyle='#5A6E8F';
  x.fillText('FEAR / GREED',cx,cy+46);
}
function renderFG(){
  if(!state.fg)return;
  const v=parseInt(state.fg.value,10);
  drawGauge(v);
  $('fngVal').textContent=v;
  $('fngVal').style.color=fngColor(v);
  $('fngClass').textContent=state.fg.classification.toUpperCase();
  $('fngClass').style.color=fngColor(v);
  const map={'Extreme Fear':'Capitulation zone — historically where contrarian entries print.','Fear':'Anxious tape — sellers still in control but exhaustion nears.','Neutral':'Balanced sentiment — trend and structure lead from here.','Greed':'Risk appetite building — momentum tends to extend.','Extreme Greed':'Euphoria — statistically a poor zone to chase breakouts.'};
  $('fngNote').textContent=map[state.fg.classification]||'';
}

function renderTopCoins(){
  $('coinsBody').innerHTML=TOP16.map(k=>{
    const c=COINS[k],t=state.tickers[c.sym];
    if(!t)return'';
    const sg=sigOf(t.pct);
    return'<tr data-sym="'+c.sym+'">'
      +'<td><div class="coin-cell"><div class="coin-ci" style="color:'+c.color+';border-color:'+c.color+'44">'+c.icon+'</div><div class="coin-nm"><div class="cn">'+esc(c.name)+'</div><div class="cs">'+k+'/USDT</div></div></div></td>'
      +'<td>$'+pfmt(t.last)+'</td>'
      +'<td>'+chgHtml(t.pct)+'</td>'
      +'<td class="vol-dim">'+cfmt(t.qvol)+'</td>'
      +'<td><span class="badge '+sg[1]+'">'+sg[0]+'</span></td>'
      +'</tr>';
  }).join('');

  $('celebGrid').innerHTML=CELEBS.map(k=>{
    const c=COINS[k],t=state.tickers[c.sym];
    if(!t)return'';
    const sg=sigOf(t.pct);
    return'<div class="celeb-card" data-sym="'+c.sym+'">'
      +'<div class="celeb-top"><span class="celeb-em">'+c.icon+'</span><span class="badge '+sg[1]+'">'+sg[0]+'</span></div>'
      +'<div class="celeb-nm">'+esc(c.name)+'</div>'
      +'<div class="celeb-pr">$'+pfmt(t.last)+'</div>'
      +'<div class="celeb-mt"><span>'+chgHtml(t.pct)+'</span><span>'+cfmt(t.qvol)+'</span></div>'
      +'</div>';
  }).join('');

  const ts=TOP16.map(k=>state.tickers[COINS[k].sym]).filter(Boolean);
  if(ts.length){
    const vol=ts.reduce((a,t)=>a+t.qvol,0);
    const adv=ts.filter(t=>t.pct>0).length;
    const dec=ts.filter(t=>t.pct<0).length;
    $('moVol').textContent=cfmt(vol);
    $('moAdv').textContent=adv;
    $('moDec').textContent=dec;
    const sorted=[...ts].sort((a,b)=>b.pct-a.pct);
    const top=sorted[0],bot=sorted[sorted.length-1];
    const topKey=Object.keys(COINS).find(k=>state.tickers[COINS[k].sym]===top);
    const botKey=Object.keys(COINS).find(k=>state.tickers[COINS[k].sym]===bot);
    $('moFGc').innerHTML=topKey?('leader <span style="color:var(--green)">'+topKey+' '+(top.pct>0?'+':'')+top.pct.toFixed(1)+'%</span> · laggard <span style="color:var(--red)">'+botKey+' '+bot.pct.toFixed(1)+'%</span>'):'';
  }
  if(state.fg){
    $('moFG').textContent=state.fg.value;
    $('moFG').style.color=fngColor(parseInt(state.fg.value,10));
  }
}

function renderWhales(){
  const list=state.whales;
  $('whaleCount').textContent=list.length+' BLOCK TRADES · ≥ $50,000';
  if(!list.length){$('whaleList').innerHTML='<div class="fc-note">No block trades ≥ $50k in the recent tape. Quiet book.</div>';return}
  $('whaleList').innerHTML=list.slice(0,24).map(w=>{
    const buy=!w.maker;
    return'<div class="whale-item">'
      +'<div class="whale-ic '+(buy?'wi-buy':'wi-sell')+'">'+(buy?'B':'S')+'</div>'
      +'<div class="whale-info">'
      +'<div class="whale-line1">'
      +'<span class="side-tag '+(buy?'side-buy':'side-sell')+'">'+(buy?'BUY':'SELL')+'</span>'
      +'<span class="whale-amt" style="color:'+(buy?'var(--green)':'var(--red)')+'">'+cfmt(w.usd)+'</span>'
      +'<span class="whale-sub">@ '+pfmt(w.price)+'</span>'
      +'</div>'
      +'<div class="whale-sub">'+nfmt(w.qty)+' '+baseOf(state.symbol)+' · tape print</div>'
      +'</div>'
      +'<div class="whale-time">'+timeAgo(w.time)+'</div>'
      +'</div>';
  }).join('');
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
let wsTk=null,wsKl=null,wsDp=null;
function closeWS(ws){if(ws){ws._dead=true;try{ws.close()}catch(e){}}}
function connectStreams(){
  closeWS(wsTk);closeWS(wsKl);closeWS(wsDp);
  wsTk=null;wsKl=null;wsDp=null;
  const s=mdSym(state.symbol).toLowerCase();
  const tf=mdTf(state.tf);
  md.series={symbol:state.symbol,tf:tf};
  // exponential backoff per stream with jitter + attempt cap
  const backoff={n:0}; // multiplier: (2^n) * 1200ms, capped 30s
  const make=function(key,url,onMsg){
    let ws;
    try{ws=new WebSocket(url)}catch(e){mdDebug.log('ws','create fail '+key);return null}
    if(key==='tk')wsTk=ws;else if(key==='kl')wsKl=ws;else wsDp=ws;
    const attempts=(state[key+'_retry']=((state[key+'_retry']||0)+1));
    ws._attempts=attempts;
    ws.onopen=function(){
      state.wsOpen++;state[key+'_retry']=0;
      mdHearbeat('ws');md.conn.ws.streams=state.wsOpen;md.conn.ws.up=true;
      setWsStatus();
    };
    ws.onmessage=function(ev){
      var d=null;
      try{d=JSON.parse(ev.data)}catch(e){mdDebug.log('ws','bad json '+key);return}
      if(!mdVal.wsMsg(d)){mdDebug.log('ws','invalid '+key,ev.data&&ev.data.slice?ev.data.slice(0,60):'');return}
      mdHearbeat('ws');
      try{onMsg(d)}catch(e){mdDebug.log('ws','handler '+key,e)}
    };
    ws.onclose=function(){
      state.wsOpen=Math.max(0,state.wsOpen-1);md.conn.ws.streams=Math.max(0,md.conn.ws.streams-1);
      setWsStatus();
      if(ws._dead)return;
      md.conn.ws.reconnects++;mdHealth.wsReconnects++;
      // subscription restoration: only revive if this stream is still wanted & symbol unchanged
      if(state[key+'_want']!==url||state.symbol!==md.series.symbol)return;
      const exp=(state[key+'_retry']||0);
      const cap=30;
      backoff.n=Math.min(backoff.n+1,cap);
      const delay=Math.min(30000,1200*Math.pow(2,Math.min(exp,cap)))+Math.floor(Math.random()*400);
      setTimeout(function(){
        if(!ws._dead&&state[key+'_want']===url&&state.symbol===md.series.symbol)make(key,url,onMsg);
      },delay);
    };
    ws.onerror=function(){/* recovery handled via onclose */};
    state[key+'_want']=url;
    return ws;
  };
  make('tk','wss://stream.binance.com:9443/ws/'+s+'@ticker',function(d){
    if(!mdVal.price(+d.c))return;
    const t=state.tickers[state.symbol]||{last:0,pct:0,high:0,low:0,qvol:0,trades:0};
    t.last=+d.c;t.pct=+d.P;t.high=+d.h;t.low=+d.l;t.qvol=+d.q;t.trades=+d.n;
    state.tickers[state.symbol]=t;
    mdStoreTicker(state.symbol,{last:t.last,pct:t.pct,high:t.high,low:t.low,qvol:t.qvol,trades:t.trades});
    renderHero();
    document.querySelectorAll('#tickerTrack [data-sym="'+state.symbol+'"]').forEach(el=>{
      el.querySelector('.tp').textContent='$'+pfmt(t.last);
      const cEl=el.querySelector('.chg');
      cEl.className='chg '+chgCls(t.pct);
      cEl.textContent=(t.pct>0?'+':'')+t.pct.toFixed(2)+'%';
    });
  });
  make('kl','wss://stream.binance.com:9443/ws/'+s+'@kline_'+tf,function(d){
    const k=d.k;
    const c={t:k.t,o:+k.o,h:+k.h,l:+k.l,c:+k.c,v:+k.v};
    if(!mdVal.candle(c))return;
    const arr=state.candles;
    const ks=$('wsKlineState');
    ks.textContent='WS LIVE';ks.className='badge b-green';
    if(arr.length&&arr[arr.length-1].t===c.t){
      arr[arr.length-1]=c;
    }else if(arr.length&&c.t>arr[arr.length-1].t){
      arr.push(c);
      if(arr.length>240)arr.shift();
    }else{return}
    mdStoreCandles(state.symbol,tf,arr);
    updateChartLast(c);
    state.klineTick++;
    if(state.klineTick%8===0||k.x)runAnalytics();
  });
  make('dp','wss://stream.binance.com:9443/ws/'+s+'@depth15@100ms',function(d){
    if(!d.bids||!d.bids.length)return;
    const ob={bids:d.bids.map(b=>[+b[0],+b[1]]),asks:d.asks.map(a=>[+a[0],+a[1]])};
    if(!mdStoreOB(state.symbol,ob))return;
    state.ob=ob;
    if(!renderOB._pend){renderOB._pend=true;requestAnimationFrame(function(){renderOB();renderOB._pend=false})}
  });
}


async function loadCtx(base){
  const sym=COINS[base]?COINS[base].sym:base+'USDT';
  const c=state.ctxCache[base];
  if(c&&Date.now()-c.ts<60000)return c.data;
  const data=await jget('https://api.binance.com/api/v3/klines?symbol='+sym+'&interval=15m&limit=120');
  const candles=data.map(k=>({t:k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}));
  const closes=candles.map(x=>x.c);
  const out={
    closes:closes,
    candles:candles,
    ai:aiComposite(candles,closes,candles.map(x=>x.v)),
    fc:forecastFrom(closes)
  };
  state.ctxCache[base]={ts:Date.now(),data:out};
  return out;
}
async function safeCtx(base){
  if(COINS[base]&&COINS[base].sym===state.symbol&&state.candles.length>=30){
    const closes=state.candles.map(c=>c.c);
    return{closes:closes,candles:state.candles,ai:state._ai||aiComposite(state.candles,closes,state.candles.map(c=>c.v)),fc:forecastFrom(closes)};
  }
  return await loadCtx(base);
}
async function ensureAnalysis(base){
  if(base===baseOf(state.symbol)&&state._liq)return;
  await safeCtx(base);
}

function chip(txt,cls){return'<span class="kv '+(cls||'')+'">'+txt+'</span>'}

function coinBrief(base,d){
  const meta=COINS[base]||{name:base,icon:'🪙'};
  const t=state.tickers[(COINS[base]||{}).sym];
  const a=d.ai,fc=d.fc;
  let s='<b>'+(meta.icon||'')+' '+esc(meta.name||base)+' ('+base+')</b><br>';
  if(t)s+='Live: '+chip('$'+pfmt(t.last))+' · 24h '+chip((t.pct>0?'+':'')+t.pct.toFixed(2)+'%',t.pct>=0?'hl-g':'hl-r')+' · Vol '+chip(cfmt(t.qvol))+'<br>24h range: '+chip(pfmt(t.low)+' – '+pfmt(t.high))+'<br><br>';
  s+='<b>Indicators (15m):</b><br>• RSI(14): <span class="'+(a.rsi>70?'hl-r':a.rsi<30?'hl-g':'')+'">'+a.rsi.toFixed(1)+'</span> '+(a.rsi>70?'— overbought':a.rsi<30?'— oversold':'— neutral zone')+'<br>';
  s+='• MACD(12,26,9): histogram <span class="'+(a.macd.hist>0?'hl-g':'hl-r')+'">'+(a.macd.hist>0?'positive — bullish momentum':'negative — bearish momentum')+'</span><br>';
  s+='• EMA(20): price trading <b>'+(a.last>a.e20?'above ✅':'below ⛔')+'</b> ('+pfmt(a.e20)+')<br>';
  s+='• Bollinger %B: '+a.bb.pctB.toFixed(0)+'% of band<br>';
  s+='• Volume: '+a.vt.toLowerCase()+'<br><br>';
  s+='<b>AI composite:</b> <span class="'+(a.score>15?'hl-g':a.score<-15?'hl-r':'hl-a')+'">'+(a.score>0?'+':'')+a.score+' — '+a.label+'</span><br>';
  const fcCol=fc.bias.indexOf('UP')===0?'hl-g':'hl-r';
  s+='<b>ML bias (linreg):</b> <span class="'+fcCol+'">'+fc.bias+'</span> · 1H target ~'+chip('$'+pfmt(fc.rows[0].pred))+', 24H ~'+chip('$'+pfmt(fc.rows[3].pred));
  return s;
}

const IND_EXPLAIN={
  rsi:'<b>RSI — Relative Strength Index (14)</b><br>Momentum oscillator built from average gains vs losses over 14 bars. Reads 0–100.<br>• <span class="hl-r">&gt;70 overbought</span> — hot, pullback risk<br>• <span class="hl-g">&lt;30 oversold</span> — washed out, bounce risk<br>• 40–60 = chop/noise. Best used as confluence, never solo.',
  macd:'<b>MACD (12,26,9)</b><br>Difference between fast EMA(12) and slow EMA(26), plus a 9-period signal line of that difference.<br>• Histogram <span class="hl-g">&gt; 0</span>: bullish momentum expanding<br>• Histogram <span class="hl-r">&lt; 0</span>: bearish momentum<br>• Crossovers flag regime shifts; divergence with price is the highest-value signal.',
  ema:'<b>EMA — Exponential Moving Average (20)</b><br>A weighted mean that reacts faster than SMA because recent bars count more. Price above EMA20 = short-term uptrend bias; below = downtrend bias. Traders stack EMA20/50/200 as dynamic support/resistance.',
  sma:'<b>SMA — Simple Moving Average</b><br>The flat arithmetic mean of the last N closes. Slower but smoother than EMA. The SMA50/SMA200 "golden cross / death cross" is the classic long-cycle regime signal.',
  bollinger:'<b>Bollinger Bands (20, 2σ)</b><br>A moving-average envelope at ±2 standard deviations — ~95% of price action lands inside.<br>• Touching the upper band = stretched (not automatically a sell)<br>• Squeeze (narrow bands) precedes volatility expansion<br>• %B tells you exactly where price sits within the band.',
  bb:null,
  atr:'<b>ATR — Average True Range</b><br>The mean bar range including gaps. A pure volatility gauge — used for stop sizing (e.g., a 2×ATR trailing stop) rather than direction.'
};
IND_EXPLAIN.bb=IND_EXPLAIN.bollinger;

async function generateReply(raw){
  const text=' '+raw.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()+' ';
  const has=function(w){return new RegExp('\\b'+w.replace(/ /g,'\\s+')+'\\b').test(text)};

  if(/^(hi|hello|hey|yo|sup|gm|good morning)\s/.test(text)||has('help')||has('what can you do')||has('commands')){
    return 'I\'m <b>Radar AI</b>, your microstructure co-pilot. Try me with:<br><br>• Any coin — <i>"analyze solana"</i>, <i>"pepe price"</i>, <i>"should I buy trump?"</i><br>• Indicators — <i>"explain rsi"</i>, <i>"current macd"</i>, <i>"bollinger squeeze?"</i><br>• Derivatives — <i>"funding rate"</i>, <i>"open interest"</i>, <i>"liquidation zones"</i><br>• Flow — <i>"whale activity"</i>, <i>"support and resistance"</i>, <i>"breakout levels"</i><br>• Signals — <i>"show signals"</i>, <i>"best signal"</i>, <i>"scan the market"</i><br>• Economics — <i>"what is inflation?"</i>, <i>"fed rates"</i>, <i>"nfp impact"</i><br>• Crypto basics — <i>"what is bitcoin?"</i>, <i>"explain defi"</i>, <i>"layer 2 scaling"</i><br>• Trading — <i>"position sizing"</i>, <i>"stop loss"</i>, <i>"take profit strategy"</i><br>• News — <i>"show news"</i>, <i>"forex events"</i>, <i>"what is happening today?"</i><br>• Conversation — <i>"tell me a joke"</i>, <i>"how to trade?"</i><br><br>I scan 10 coins every 2 min, detect patterns, track whale flow, and auto-learn from predictions.';
  }
  if(has('thank'))return 'Anytime — Radar never sleeps.';
  if((has('what did i ask')||has('history')||has('remember')||has('repeat that')||has('what were we'))&&state.mem.topics.length){
    const last=state.mem.topics[state.mem.topics.length-1];
    return 'From memory, your last question was: <i>"'+esc(last)+'"</i>'
      +(state.mem.lastCoin?'. We last focused on <b>'+esc(state.mem.lastCoin)+'</b>':'.')
      +(state.mem.topics.length>1?('<br><br>Earlier: '+state.mem.topics.slice(0,-1).map(function(t){return'&bull; '+esc(t)}).join('<br>')):'');
  }

  if(has('signal')||has('scanner')||has('show signal')){
    var top3=signalData.slice(0,3);
    if(!top3.length)return 'Signal scanner is warming up — give me 30 seconds and ask again.';
    var s='<b>Multi-Timeframe Signal Scanner — Top 3:</b><br><br>';
    top3.forEach(function(sig){
      var type=sig.master.type;
      var cls=type==='BUY'?'hl-g':type==='SELL'?'hl-r':'hl-a';
      var tfStr=sig.master.breakdown.map(function(b){return b.tf+':'+b.type}).join(' ');
      s+='&bull; <b>'+baseOf(sig.sym)+'</b>: <span class="'+cls+'">'+type+'</span> ('+(sig.score>0?'+':'')+sig.score+')<br>';
      s+='&nbsp;&nbsp;'+tfStr+'<br>';
      if(sig.whaleText)s+='&nbsp;&nbsp;<span style="color:var(--muted)">'+esc(sig.whaleText)+'</span><br>';
    });
    s+='<br>Each signal covers 15m, 1H, 4H, 1D timeframes weighted into a Master signal. Whale flow and auto-learning included.';
    return s;
  }

  if(has('pattern')||has('patterns')){
    var patBase=coin||baseOf(state.symbol);
    try{
      return safeCtx(patBase).then(function(ctx){
        var patterns=detectPatterns(ctx.closes,state.candles.map(function(c){return c.v}));
        var s='<b>Multi-TF Pattern Scan — '+patBase+'</b><br><br>';
        if(!patterns.length)s+='No notable patterns detected right now — market may be in consolidation.';
        else patterns.forEach(function(p){
          var icon=p.type==='bullish'?'[BULL]':'[BEAR]';
          var cls=p.type==='bullish'?'hl-g':'hl-r';
          s+='<span class="'+cls+'">'+icon+' '+p.text+'</span> (strength: '+p.strength+'%)<br>';
        });
        var sig=signalData.find(function(x){return x.sym===patBase+'USDT'});
        if(sig){
          s+='<br><b>Multi-TF signal:</b> ';
          sig.master.breakdown.forEach(function(b){
            var cls2=b.type==='BUY'?'hl-g':b.type==='SELL'?'hl-r':'hl-a';
            s+=b.tf+'=<span class="'+cls2+'">'+b.type+'</span> ';
          });
          s+='<br>Master: <b>'+sig.master.type+' ('+(sig.score>0?'+':'')+sig.score+')</b>';
          if(sig.whaleText)s+='<br>Whale: '+esc(sig.whaleText);
        }
        s+='<br><br>Patterns combine RSI divergence, MACD crossovers, Bollinger band position, volume spikes, and swing structure across 15m/1H/4H/1D.';
        return s;
      });
    }catch(e){return 'Pattern scan unavailable right now.'}
  }

  if(has('meme')||has('meme coin')||has('dog coin')||has('show meme')){
    var s='<b>Meme Coin Universe — Live:</b><br><br>';
    var memes=['PEPE','WIF','FLOKI','SHIB','BONK','DOGE','TRUMP'];
    memes.forEach(function(k){
      var t=state.tickers[COINS[k]?COINS[k].sym:k+'USDT'];
      if(t)s+='&bull; <b>'+k+'</b> '+chip('$'+pfmt(t.last))+chip((t.pct>0?'+':'')+t.pct.toFixed(2)+'%',t.pct>=0?'hl-g':'hl-r')+' vol '+chip(cfmt(t.qvol))+'<br>';
    });
    s+='<br>Full meme scanner on the <b>Market tab</b> — 20+ meme coins with signals.';
    return s;
  }

  if(has('elon')||has('musk')){
    let s='🚀 <b>Elon Musk watchlist</b> — his posts historically move:<br>';
    for(const k of ['DOGE','FLOKI','SHIB']){
      const t=state.tickers[COINS[k].sym];
      let extra='';
      try{const d=await safeCtx(k);extra=' · RSI '+d.ai.rsi.toFixed(0)}catch(e){}
      s+='• <b>'+COINS[k].icon+' '+k+'</b> '+(t?chip('$'+pfmt(t.last))+chip((t.pct>0?'+':'')+t.pct.toFixed(2)+'%',t.pct>=0?'hl-g':'hl-r'):'')+extra+'<br>';
    }
    s+='<br>DOGE is the canonical "Elon coin"; FLOKI and SHIB ride the same dog-themed beta. One tweet ≠ due diligence — size accordingly.';
    return s;
  }

  if(has('fear')||has('greed')||has('sentiment')){
    if(state.fg){
      const v=parseInt(state.fg.value,10);
      let interp;
      if(v<25)interp='<span class="hl-r">Extreme Fear</span> — capitulation vibes. Historically decent accumulation zones, terrible for leverage longs.';
      else if(v<45)interp='<span class="hl-a">Fear</span> — cautious tape. Watch whether price holds higher lows while sentiment stays soft.';
      else if(v<=55)interp='Gray zone — pure neutral. Structure and flow matter more than sentiment here.';
      else if(v<75)interp='<span class="hl-g">Greed</span> — risk appetite building. Momentum strategies tend to keep working until they don\'t.';
      else interp='<span class="hl-g">Extreme Greed</span> — euphoria readings cluster near local tops. Tighten stops, trim into strength.';
      return '😱/🤑 <b>Fear &amp; Greed Index: <span style="color:'+fngColor(v)+'">'+v+' — '+state.fg.classification.toUpperCase()+'</span></b><br><br>'+interp+'<br><br>The full gauge lives on the <b>Radar tab</b> 🎯';
    }
    return 'Sentiment feed is unreachable right now — check the gauge widget later. General rule: extreme fear favors staged accumulation, extreme greed favors trimming.';
  }

  const indMatch=['rsi','macd','bollinger','ema','sma','atr'].find(has);
  let coin=findCoin(text);
  const followUp=has('it')||has('its')||has('that')||has('this')||has('the coin')||has('same')||has('again');
  if(!coin&&followUp&&state.mem.lastCoin)coin=state.mem.lastCoin;
  if(coin)state.mem.lastCoin=coin;

  if(indMatch){
    let s=IND_EXPLAIN[indMatch];
    const focus=coin||baseOf(state.symbol);
    try{
      const d=(coin||(state.candles.length<30))?await safeCtx(focus):{ai:state._ai};
      if(d&&d.ai){
        const a=d.ai;
        s+='<br><br><b>Live read — '+focus+' (15m):</b><br>';
        if(indMatch==='rsi')s+='RSI = '+chip(a.rsi.toFixed(1))+' → '+(a.rsi>70?'<span class="hl-r">overbought</span>':a.rsi<30?'<span class="hl-g">oversold</span>':'neutral');
        else if(indMatch==='macd'){const last=a.last;s+='Histogram = '+chip((a.macd.hist>0?'+':'')+a.macd.hist.toFixed(last>100?2:6))+' → '+(a.macd.hist>0?'<span class="hl-g">bullish</span>':'<span class="hl-r">bearish</span>')}
        else if(indMatch==='ema'||indMatch==='sma')s+='EMA20 = '+chip('$'+pfmt(a.e20))+', price '+pfmt(a.last)+' → trading <b>'+(a.last>a.e20?'above':'below')+'</b>';
        else if(indMatch==='bollinger'||indMatch==='bb')s+='%B = '+chip(a.bb.pctB.toFixed(0)+'%')+' → '+(a.bb.pctB>80?'stretched upper':a.bb.pctB<20?'stretched lower':'mid-range');
        else s+='ATR(14×15m) context available on the Analysis tab';
      }
    }catch(e){}
    return s;
  }

  if(has('funding')){
    if(state.fr&&!coin){
      const rate=parseFloat(state.fr.lastFundingRate);
      return '💸 <b>'+baseOf(state.symbol)+' perpetual funding:</b> '+chip((rate*100).toFixed(4)+'%')+' '+(rate>0?'— <span class="hl-g">longs pay shorts</span> (crowd leans long)':rate<0?'— <span class="hl-r">shorts pay longs</span> (crowd leans short)':'— flat')+'<br>Annualized ≈ '+chip((rate*3*365*100).toFixed(1)+'%')+(state.fr.nextFundingTime?' · next payout ~<span class="hl-c">'+new Date(state.fr.nextFundingTime).toUTCString().slice(17,22)+' UTC</span>':'')+'.<br><br>Persistently positive funding = crowded long side = fuel for long squeezes.';
    }
    return '💸 Funding = periodic payments between perp longs &amp; shorts anchoring futures to spot.<br>• Positive → longs pay (crowded long side)<br>• Negative → shorts pay (crowded short side)<br>Live rates sit on the Radar metrics strip — ask again while viewing any chart.';
  }
  if(has('oi')||has('open interest')){
    if(state.oi&&state.fr&&!coin){
      const mark=parseFloat(state.fr.markPrice);
      const oiN=parseFloat(state.oi.openInterest)*mark;
      return '🧊 <b>'+baseOf(state.symbol)+' open interest:</b> '+chip(cfmt(oiN))+' across '+chip(nfmt(parseFloat(state.oi.openInterest))+' contracts')+'<br><br>OI rising + price rising = fresh longs confirming trend. OI falling into a rally = short covering (weaker hands). OI is also the fuel gauge for liquidation cascades.';
    }
    return '🧊 Open Interest = total value of outstanding derivative contracts. Rising OI validates trends; collapsing OI signals deleveraging. The live figure is in the Radar metrics strip.';
  }
  if(has('liquidation')||has('liquidated')||has('liq zones')){
    const base=coin||baseOf(state.symbol);
    try{
      await ensureAnalysis(base);
      const L=(base===baseOf(state.symbol)&&state._liq)?state._liq:null;
      if(L)return '💥 <b>'+base+' liquidation clusters (heuristic):</b><br>• Long liqs: '+chip('$'+pfmt(L.lz.lo)+' – $'+pfmt(L.lz.hi))+' <span class="hl-g">below swing low</span><br>• Short liqs: '+chip('$'+pfmt(L.sz.lo)+' – $'+pfmt(L.sz.hi))+' <span class="hl-r">above swing high</span><br>• Open interest at play: '+chip(cfmt(L.oiN))+'<br><br>Price gravitates toward dense liquidation pools ("liquidity magnets"). Full breakdown: <b>Analysis tab</b>.';
    }catch(e){}
    return '💥 Liquidation = forced closure when margin can\'t cover losses. Clusters form where over-leveraged positions sit; price often wicks into them before reversing. See the Analysis tab for estimated zones on the active symbol.';
  }
  if(has('leverage')){
    return '[BAL] <b>Leverage reality check:</b><br>• 10x → ~9.5% adverse move liquidates you<br>• 25x → ~3.8%<br>• 50x → ~1.9% (one bad candle)<br>Crypto 15m volatility alone can exceed those numbers on alts. Pros use low leverage with wide ATR-sized stops — not max leverage plus hope.';
  }

  if(has('support')||has('resistance')||has('breakout')||has('levels')){
    const base=coin||baseOf(state.symbol);
    try{
      let sr;
      if(base===baseOf(state.symbol)&&state._sr)sr=state._sr;
      else{
        const d=await safeCtx(base);
        const w=d.candles.slice(-96);
        sr={res:Math.max.apply(null,w.map(c=>c.h)),sup:Math.min.apply(null,w.map(c=>c.l))};
      }
      const px=state.tickers[(COINS[base]||{}).sym];
      const last=px?px.last:(state._ai?state._ai.last:null);
      return '[LVL] <b>'+base+' key levels (96x15m structure):</b><br>• Resistance: <span class="hl-r">'+chip('$'+pfmt(sr.res))+'</span>'+(last?' (+'+((sr.res/last-1)*100).toFixed(2)+'%)':'')+'<br>• Support: <span class="hl-g">'+chip('$'+pfmt(sr.sup))+'</span>'+(last?' ('+((sr.sup/last-1)*100).toFixed(2)+'%)':'')+'<br><br><b>Breakout playbook:</b> wait for a 15m candle to <i>close</i> beyond the level with expanding volume — wicks through don\'t count. Failed breakdowns that reclaim support are among the highest-probability reversals there are.';
    }catch(e){}
    return '[S/R] Support/resistance are zones where pending orders historically absorb flow. Real breakouts need candle-close confirmation + volume expansion. Load a chart on the Radar tab and ask again for exact numbers.';
  }

  if(has('best performer')||has('top gainer')||has('biggest gainer')||has('worst performer')||has('biggest loser')){
    const ts=TOP16.map(k=>({k:k,t:state.tickers[COINS[k].sym]})).filter(x=>x.t);
    if(!ts.length)return 'Market snapshot still loading — give me a few seconds and ask again.';
    ts.sort((a,b)=>b.t.pct-a.t.pct);
    if(has('worst')||has('loser')){
      const w=ts[ts.length-1];
      return '📉 Worst of the tracked 16: <b>'+COINS[w.k].icon+' '+w.k+'</b> '+chip(w.t.pct.toFixed(2)+'%','hl-r')+' at '+chip('$'+pfmt(w.t.last))+'. Rotation day.';
    }
    const b=ts[0];
    let out='[GAIN] Today\'s leader of the tracked 16: <b>'+COINS[b.k].icon+' '+b.k+'</b> '+chip('+'+b.t.pct.toFixed(2)+'%','hl-g')+' at '+chip('$'+pfmt(b.t.last))+' · vol '+chip(cfmt(b.t.qvol));
    if(ts.length>=2)out+='<br><br>Runner-up: '+ts[1].k+' ('+ts[1].t.pct.toFixed(2)+'%). Say <i>"analyze '+b.k.toLowerCase()+'"</i> for the full workup.';else out+='<br><br>Say <i>"analyze '+b.k.toLowerCase()+'"</i> for the full workup.';
    return out;
  }

  if(has('whale')||has('block trade')||has('smart money')||has('onchain')||has('on chain')){
    const w=state.whales;
    let s='[W] <b>Whale radar — '+baseOf(state.symbol)+'</b><br>';
    if(w.length){
      const buys=w.filter(x=>!x.maker),sell=w.filter(x=>x.maker);
      const buyUsd=buys.reduce((a,x)=>a+x.usd,0),sellUsd=sell.reduce((a,x)=>a+x.usd,0);
      s+=w.length+' block trades ≥$50k in recent tape.<br>• Buy-side flow: <span class="hl-g">'+cfmt(buyUsd)+'</span> ('+buys.length+' prints)<br>• Sell-side flow: <span class="hl-r">'+cfmt(sellUsd)+'</span> ('+sell.length+' prints)<br>• Largest print: '+chip(cfmt(Math.max.apply(null,w.map(x=>x.usd))))+' '+(w[0].maker?'SELL':'BUY')+' '+timeAgo(w[0].time)+'<br><br>Net read: <b>'+(buyUsd>sellUsd?'<span class="hl-g">accumulative tilt</span>':'<span class="hl-r">distribution tilt</span>')+'</b>. Live feed on the Radar tab refreshes every 10s.';
    }else{
      s+='No ≥$50k prints detected recently — either a quiet book or you\'re early. The tracker rescans every 10 seconds.<br><br>Note: this watches exchange tape flow. True on-chain whale wallets need blockchain indexing — different discipline, same paranoia.';
    }
    return s;
  }
  if(has('gas')||has('gwei')){
    return '[GAS] <b>Gas / Gwei 101:</b><br>Gwei = a tiny fraction of ETH (1 ETH = 10^9 gwei) pricing Ethereum computation. Gas spikes with mempool congestion — NFT mints, airdrop claims, on-chain liquidation cascades. High gas ≠ bullish; it means urgent demand for blockspace. For perp traders it matters mostly during DeFi liquidation waves.';
  }

  if(has('defi')||has('dex')||has('lending')||has('yield')||has('staking')||has('tvl')||has('dao')||has('liquidity mining')){
    return '[DEFI] <b>DeFi quick glossary:</b><br>• <b>DEX</b> — on-chain AMM swaps (Uniswap etc.); no orderbook, pools price assets<br>• <b>Lending</b> — supply collateral, borrow against it (Aave, Compound)<br>• <b>Yield farming</b> — earning tokens for providing liquidity; APYs inversely correlate with sustainability<br>• <b>Staking</b> — securing PoS networks for emission rewards<br>• <b>TVL</b> — total value locked; the sector\'s core health metric<br>• <b>DAO</b> — token-voted governance over a treasury<br><br>This terminal tracks the derivatives layer — where DeFi tokens like UNI, AAVE &amp; MKR play the same whale games as everything else.';
  }

  if(has('should i buy')||has('should i sell')||has('long')||has('short')||has('entry')||has('trade plan')||((has('buy')||has('sell'))&&!coin)){
    const base=coin||baseOf(state.symbol);
    try{
      const d=(base===baseOf(state.symbol)&&state.candles.length>=30)?await safeCtx(base):await safeCtx(base);
      const a=d.ai,fc=d.fc||forecastFrom(d.closes);
      const px=state.tickers[(COINS[base]||{}).sym];
      const dir=a.score>15?'LONG bias':a.score<-15?'SHORT bias':'NO-TRADE / wait';
      const cls=a.score>15?'hl-g':a.score<-15?'hl-r':'hl-a';
      let patStr=generateSignalSummary(base,a,fc);
      return '<b>'+base+' tactical read:</b> '+(px?'spot '+chip('$'+pfmt(px.last)):'')+'<br>• AI composite: <span class="'+cls+'">'+(a.score>0?'+':'')+a.score+' ('+a.label+')</span><br>• Trend: price '+(a.last>a.e20?'<span class="hl-g">above</span>':'<span class="hl-r">below</span>')+' EMA20 &middot; MACD '+(a.macd.hist>0?'<span class="hl-g">positive</span>':'<span class="hl-r">negative</span>')+' &middot; volume '+a.vt.toLowerCase()+'<br>• ML projection: <span class="'+cls+'">'+fc.bias+'</span> (1H ~ $'+pfmt(fc.rows[0].pred)+')<br><br>'+patStr+'<br><br><span class="hl-a">Not financial advice — markets can invalidate any model instantly.</span>';
    }catch(e){
      return 'Couldn\'t pull live context for that one — try again shortly. Standing disclaimer: I provide analysis frameworks, not financial advice.';
    }
  }

  if(has('buy')||has('sell')){
    const base=coin||baseOf(state.symbol);
    try{
      const d=await safeCtx(base);
      const a=d.ai;
      return coinBrief(base,d)+'<br><br><span class="hl-a">⚠ Analysis only — never financial advice.</span>';
    }catch(e){}
  }

  if(has('pump')||has('mooning')||has('moon')||has('to the moon')){
  // === CONVERSATION ===
  if(/^(how are you|how r u|hru|you good|you ok)\s/.test(text)||has('how are you')){
    return 'Running at full strength — all streams connected, scanner humming. What do you need?';
  }
  if(/^(who made you|who built you|who created you|who are you|what are you|your name)/.test(text)||has('who made you')||has('your name')){
    return '<b>Liquidity Radar v5.0</b> — built by <b>Zain</b> as a self-contained crypto microstructure terminal. I run entirely in your browser with live Binance data. No backend, no API keys, no nonsense.';
  }
  if(has('tell me a joke')||has('joke')||has('funny')){
    var jokes=['Why did the trader bring a ladder to the bar? Because the drinks were on the house and the charts were going to the moon.<br><br>...I\'ll stick to analyzing candles.','What\'s a crypto trader\'s favorite exercise? Jumping to conclusions.<br><br>...and then getting rekt.','Why don\'t traders trust atoms? Because they make up everything — including your portfolio value.<br><br>I prefer data.'];
    return jokes[Math.floor(Math.random()*jokes.length)];
  }
  if(has('best time')||has('when to trade')||has('trading hours')){
    return '<b>Best crypto trading windows:</b><br>• US market open (13:30-14:00 UTC) — highest volatility<br>• London session overlap (07:00-09:00 UTC) — EUR/GBP pairs + BTC spillover<br>• Asian session open (00:00-02:00 UTC) — JPY pairs, sometimes BTC dumps<br>• 24/7 nature means there\'s always a session — but liquidity clusters around banking hours. Weekends are thinner and easier to whipsaw.';
  }
  if(has('position sizing')||has('how much to')||has('risk per trade')||has('risk management')){
    return '<b>Position Sizing 101:</b><br>• Never risk more than 1-2% of total capital on a single trade<br>• Position size = (Account x Risk%) / (Entry - Stop Loss)<br>• Example: $10K account, 1% risk, $100 stop = $1,000 / $100 = 10 units<br>• Kelly criterion for the advanced: f* = (bp - q) / b<br>Most blowups come from sizing too large, not from bad analysis.';
  }
  if(has('stop loss')||has('sl')||has('where to put stop')){
    return '<b>Stop Loss placement:</b><br>• Below last swing low (longs) / above last swing high (shorts)<br>• ATR-based: entry ± 1.5x ATR(14)<br>• Structure-based: below support zone with buffer<br>• Never use round numbers (everyone else does too)<br><br>The stop is where your thesis is <i>wrong</i>, not where it hurts. If it\'s too tight, you get stopped out by noise. Too wide, and one trade ruins your month.';
  }

  // === ECONOMICS & MACRO ===
  if(has('inflation')||has('cpi')||has('consumer price')){
    return '<b>Inflation / CPI explained:</b><br>• CPI measures average price change of a consumer basket<br>• Rising CPI = prices going up = USD purchasing power declining<br>• Fed raises rates to fight inflation = risk assets sell off (usually)<br>• Falling CPI = rate cut expectations = risk-on (usually)<br><br>Crypto correlation: BTC tends to rally when CPI comes in soft (rate cut bets) and dump on hot CPI (tightening fears). Not 1:1, but the first 30 minutes after CPI print are pure volatility.';
  }
  if(has('federal reserve')||has('fed rate')||has('interest rate')||has('rate cut')||has('rate hike')){
    return '<b>The Federal Reserve / Interest Rates:</b><br>• Fed funds rate = what banks charge each other overnight<br>• Higher rates = borrowing costs up = stocks/bonds reprice = crypto correlation varies<br>• Rate cuts = liquidity expectations = risk assets tend to rally<br>• "Higher for longer" = the market\'s worst nightmare in 2023-24<br><br>Crypto impact: BTC was born in a ZIRP (zero interest rate) world. True stress test came with rates at 5.25%. Watch FOMC statements and dot plots — they move everything.';
  }
  if(has('quantitative easing')||has('qe')||has('quantitative tightening')||has('qt')||has('money printing')){
    return '<b>QE vs QT — The Liquidity Machine:</b><br>• QE: Fed buys bonds, injects money into system = "money printing" = risk assets moon<br>• QT: Fed lets bonds mature off balance sheet = drains liquidity = headwind for risk<br>• QE started March 2020 → BTC went from $5K to $69K<br>• QT started mid-2022 → BTC dropped from $47K to $15K<br><br>Crypto is essentially a liquidity beta play. When the money printer goes brrr, crypto benefits first and most.';
  }
  if(has('gdp')||has('gross domestic product')){
    return '<b>GDP — Gross Domestic Product:</b><br>• Total value of goods/services produced in a country<br>• Rising GDP = economy growing = generally risk-on<br>• Falling GDP / negative = recession fears = flight to safety<br>• Crypto correlation: indirect. GDP growth supports risk appetite, but crypto is more driven by liquidity and monetary policy than by GDP itself.';
  }
  if(has('non farm')||has('nfp')||has('payroll')||has('jobs report')){
    return '<b>Non-Farm Payrolls (NFP):</b><br>• Released first Friday of each month<br>• Counts new jobs added excluding agriculture<br>• Strong jobs = economy hot = Fed keeps rates high = USD strong = BTC weak<br>• Weak jobs = economy cooling = Fed may cut = USD weak = BTC strong<br><br>First 5 minutes after NFP release are pure chaos. Wait for the dust to settle.';
  }
  if(has('recession')||has('economic downturn')){
    return '<b>Recession in Crypto Context:</b><br>• Recession = two consecutive quarters of negative GDP growth<br>• Historically, BTC drops 70-80% from ATH during macro recessions<br>• BUT recovery is also faster than traditional assets<br>• The "money printer will save us" trade has historically worked<br><br>Key indicator: yield curve inversion (2Y > 10Y Treasury). When it un-inverts, recession historically follows within 6-18 months.';
  }

  // === CRYPTO BASICS ===
  if(has('what is bitcoin')||has('explain bitcoin')||has('about bitcoin')||has('tell me about btc')){
    return '<b>Bitcoin (BTC) — The Original:</b><br>• Created 2009 by Satoshi Nakamoto (pseudonymous)<br>• First decentralized digital currency — no middleman<br>• Fixed supply: 21M coins (deflationary by design)<br>• Proof-of-work mining secures the network<br>• Block time: ~10 minutes, halving every 4 years<br><br>Current price and analysis: try <i>"analyze btc"</i> for live data.';
  }
  if(has('what is ethereum')||has('explain ethereum')||has('about eth')){
    return '<b>Ethereum (ETH) — The World Computer:</b><br>• Created 2015 by Vitalik Buterin<br>• Smart contract platform — runs dApps, DeFi, NFTs, tokens<br>• Transitioned to Proof-of-Stake (The Merge, Sept 2022)<br>• EIP-1559 burns base fee — deflationary pressure<br>• Gas fees = cost of computation on Ethereum<br><br>ETH is the collateral layer of DeFi. Everything runs on top of it.';
  }
  if(has('what is blockchain')||has('explain blockchain')){
    return '<b>Blockchain — Distributed Ledger 101:</b><br>• Chain of blocks, each containing verified transactions<br>• Every node holds a copy = no single point of failure<br>• Immutability: once confirmed, altering a block requires 51% of network hash<br>• Consensus mechanisms: PoW (Bitcoin) or PoS (Ethereum)<br><br>It\'s not magic — it\'s an agreed-upon way to maintain a shared truth without trusting a middleman.';
  }
  if(has('what is an nft')||has('explain nft')){
    return '<b>NFTs — Non-Fungible Tokens:</b><br>• Unique tokens on a blockchain representing ownership<br>• "Non-fungible" = one-of-one, not interchangeable like ETH<br>• Use cases: digital art, collectibles, game items, membership passes<br>• Most speculation was in JPEGs during 2021-22 mania<br><br>The tech has utility (provenance, royalties, ticketing) even if most profile-picture projects went to zero.';
  }
  if(has('what is defi')||has('explain defi')){
    return '<b>DeFi — Decentralized Finance:</b><br>• Financial services built on smart contracts, no banks<br>• Lending (Aave/Compound), swaps (Uniswap), derivatives (dYdX)<br>• TVL (Total Value Locked) = health metric of the sector<br>• Yield farming: earn tokens by providing liquidity<br><br>DeFi is how crypto earns its "financial system replacement" narrative. Most of it runs on Ethereum.';
  }
  if(has('what is solana')||has('about sol')){
    return '<b>Solana (SOL) — High-Performance L1:</b><br>• PoH (Proof of History) + PoS = extremely fast<br>• 65,000 TPS theoretical, ~4,000 actual<br>• Near-zero fees (fractions of a cent)<br>• Has had multiple outages — reliability is its Achilles heel<br><br>Solana is Ethereum\'s main competitor for speed-sensitive applications. The "Ethereum killer" narrative comes and goes.';
  }
  if(has('layer 2')||has('l2')||has('scaling solution')){
    return '<b>Layer 2 Scaling Solutions:</b><br>• Ethereum L2s: Arbitrum, Optimism, Base, zkSync<br>• Off-chain execution, on-chain settlement = faster + cheaper<br>• Rollups batch transactions and post compressed data to L1<br>• ZK-rollups vs Optimistic rollups: different tradeoffs in proof generation<br><br>L2s are how Ethereum scales without compromising decentralization.';
  }
  if(has('altcoin')||has('alt season')||has('altcoin season')){
    return '<b>Altcoins / Alt Season:</b><br>• Everything that isn\'t Bitcoin = altcoin<br>• "Alt season" = capital rotates from BTC into alts (usually after BTC stabilizes near ATH)<br>• BTC dominance chart is the alt season indicator<br>• Alt season playbook: BTC moons → BTC consolidates → ETH follows → large caps → mid → small caps → everything bleeds back to BTC<br><br>Alt seasons make people rich and then destroy them. Know where you are in the cycle.';
  }

  // === TRADING CONCEPTS ===
  if(has('what is leverage')||has('explain leverage')){
    return '<b>Leverage — Amplified Exposure:</b><br>• 10x leverage: $1,000 controls $10,000 worth<br>• Your PnL is multiplied by 10x, but so are losses<br>• Liquidation happens when losses eat your margin<br>• At 10x: a ~10% adverse move wipes you out<br>• At 50x: a ~2% adverse move wipes you out<br><br>Leverage is a tool for capital efficiency, not a money multiplier. Most leveraged traders lose. The house (exchange) always wins.';
  }
  if(has('margin call')||has('margin')){
    return '<b>Margin Call — The Warning Bell:</b><br>• When your account equity falls below maintenance margin<br>• Exchange demands you deposit more funds or they liquidate<br>• On Binance: margin ratio below 1.1 triggers auto-liquidation<br><br>Prevention: use stop losses, reduce leverage, don\'t over-allocate. A margin call is the exchange telling you "your trade is wrong and I\'m closing it for you."';
  }
  if(has('what is short')||has('short selling')||has('shorting')){
    return '<b>Short Selling — Profiting From Drops:</b><br>• Borrow an asset, sell it high, buy it back low, return it<br>• In futures: open a short position = same economic exposure<br>• Risk: theoretically unlimited upside = unlimited loss potential<br>• Short squeezes: when shorts are forced to buy back, accelerating the rally<br><br>Famous squeeze: GameStop 2021. In crypto: short squeezes happen when funding is heavily negative and price starts rising.';
  }
  if(has('liquidation cascade')||has('cascade')){
    return '<b>Liquidation Cascades — The Domino Effect:</b><br>• Price drops → overleveraged longs get liquidated → their forced sells push price lower → more longs liquidated → repeat<br>• Creates violent V-shaped moves (both directions)<br>• Most common when OI is high and funding is positive<br><br>This is why I track liquidation zones on the Analysis tab. Dense liquidation clusters act as magnets for price.';
  }
  if(has('take profit')||has('when to take profit')||has('tp')){
    return '<b>Take Profit Strategy:</b><br>• Scale out in portions, not all at once<br>• First target: 1:1 risk-reward (take 50%)<br>• Second target: move stop to breakeven, let rest run<br>• Trail with ATR: stop moves 1.5x ATR behind price<br>• Key: have a plan BEFORE entry, not after<br><br>The hardest part isn\'t getting in — it\'s selling at the right time. Most traders give back gains by holding too long.';
  }

  // === ON-CHAIN & NETWORK ===
  if(has('what is tvl')||has('explain tvl')){
    return '<b>TVL — Total Value Locked:</b><br>• Sum of assets deposited in DeFi protocols<br>• Higher TVL = more capital trusting the protocols<br>• Aave, Lido, MakerDAO typically lead<br>• TVL/Market Cap ratio indicates DeFi utilization<br><br>TVL rising + token price rising = healthy growth. TVL rising + price flat = value hasn\'t been priced in yet.';
  }
  if(has('what are gas fees')||has('gas fees explained')){
    return '<b>Gas Fees — Transaction Cost:</b><br>• Fee paid to process transactions on blockchain<br>• Ethereum: measured in gwei (1 gwei = 0.000000001 ETH)<br>• High demand = high gas = expensive transactions<br>• L2s (Arbitrum, Base) reduce gas by 10-100x<br><br>Gas is the "toll booth" of blockchain. During NFT mints or market crashes, gas can spike 100x.';
  }
  if(has('proof of work')||has('pow')||has('proof of stake')||has('pos')||has('mining')||has('staking explained')){
    return '<b>PoW vs PoS — Consensus Mechanisms:</b><br>• PoW: miners compete to solve puzzles, winner adds block (Bitcoin, pre-merge ETH)<br>• PoS: validators stake coins, random selection adds block (Ethereum, Solana)<br>• PoW: energy-intensive but battle-tested, very secure<br>• PoS: energy-efficient, faster, but newer and more centralized<br><br>BTC will always be PoW. ETH switched to PoS. The debate is philosophical, not technical.';
  }

  // === NEWS & EVENTS ===
  if(has('news')||has('breaking')||has('what is happening')||has('what is going on')){
    try{
      var newsData=await jget('https://cryptocurrency.cv/api/news');
      if(newsData&&newsData.data&&newsData.data.length){
        var s='<b>Latest Crypto News:</b><br><br>';
        newsData.data.slice(0,6).forEach(function(n,i){
          s+=(i+1)+'. <b>'+esc(n.title||'')+'</b><br><span style="color:var(--dim);font-size:11px">'+esc(n.source||'')+' · '+esc(n.date||'')+'</span><br><br>';
        });
        s+='Source: cryptocurrency.cv — updates in real time.';
        return s;
      }
    }catch(e){}
    return 'News feed temporarily unavailable. Try the <b>News tab</b> for live updates.';
  }
  if(has('forex')||has('forex event')||has('macro event')||has('economic calendar')||has('this week event')){
    var calData=null;
    try{
      calData=await jget2('https://nfs.faireconomy.media/ff_calendar_thisweek.json',{to:10000,retries:1,dedup:true});
      if(!calData||!calData.length)throw new Error('empty');
    }catch(e1){
      try{calData=await fetchFromXoomar();}catch(e2){}
    }
    if(calData&&calData.length){
      var s='<b>This Week\'s Macro Events:</b><br><br>';
      var important=calData.filter(function(e){return e.impact==='High'});
      if(important.length){
        important.slice(0,6).forEach(function(e,i){
          s+='<span style="color:'+(e.impact==='High'?'var(--amber)':'var(--dim)')+'">[IMPACT: '+e.impact+']</span> <b>'+esc(e.title||'')+'</b><br>'+esc(e.country||'')+' · '+esc(e.date||'')+' '+esc(e.time||'')+'<br><br>';
        });
      }else{
        calData.slice(0,6).forEach(function(e,i){
          s+=esc(e.title||'')+' — '+esc(e.country||'')+' · '+esc(e.date||'')+'<br>';
        });
      }
      s+='Source: economic calendar — High impact events move crypto via USD correlation.';
      return s;
    }
    return 'Forex calendar temporarily unavailable.';
  }
  if(has('crypto today')||has('market today')||has('what is happening in crypto')){
    try{
      var newsData2=await jget('https://cryptocurrency.cv/api/news');
      var fgText=state.fg?'Fear &amp; Greed: '+state.fg.value+' ('+state.fg.classification+')':'sentiment unavailable';
      var s='<b>Crypto Market Overview — Today:</b><br><br>';
      s+='Sentiment: <b>'+fgText+'</b><br><br>';
      var top5=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'];
      top5.forEach(function(sym2){
        var t=state.tickers[sym2];
        if(t)s+='&bull; <b>'+baseOf(sym2)+'</b>: '+chip('$'+pfmt(t.last))+' '+chip((t.pct>0?'+':'')+t.pct.toFixed(2)+'%',t.pct>=0?'hl-g':'hl-r')+'<br>';
      });
      if(newsData2&&newsData2.data&&newsData2.data.length){
        s+='<br><b>Headlines:</b><br>';
        newsData2.data.slice(0,3).forEach(function(n){
          s+='&bull; '+esc(n.title||'')+'<br>';
        });
      }
      return s;
    }catch(e){}
    return 'Market overview temporarily unavailable. Check the Radar tab for live prices.';
  }
  if(has('opinion')||has('your opinion')||has('what do you think')){
    if(coin){
      var t2=state.tickers[COINS[coin].sym];
      if(t2){
        var dir=t2.pct>2?'bullish momentum':'cautiously positive';
        if(t2.pct<-2)dir='bearish pressure';
        if(t2.pct>-0.5&&t2.pct<0.5)dir='consolidation zone — no clear bias';
        return '<b>'+coin+' opinion:</b> Currently in '+dir+' ('+(t2.pct>0?'+':'')+t2.pct.toFixed(2)+'% today). For a real view, say <i>"analyze '+coin.toLowerCase()+'"</i> and check the multi-TF signals, whale flow, and verdict. Don\'t trade on opinions — trade on confluence.';
      }
    }
    return 'Give me a coin name and I\'ll share a data-driven view. "Opinion" without data is just a guess.';
  }

  // === MARKET PHILOSOPHY ===
  if(has('how to trade')||has('trading strategy')||has('how to make money')){
    return '<b>Framework for Trading:</b><br>1. <b>Plan:</b> Define entry, stop, target BEFORE the trade<br>2. <b>Edge:</b> What is your statistical advantage? (momentum, mean reversion, breakout)<br>3. <b>Size:</b> Risk 1-2% max per trade<br>4. <b>Execute:</b> Follow the plan, no emotional overrides<br>5. <b>Review:</b> Journal every trade — patterns emerge<br><br>The market doesn\'t care about your entry. It will humble anyone who trades on feelings instead of process.';
  }
  if(has('what is an edge')||has('trading edge')){
    return '<b>Trading Edge — The Whole Game:</b><br>• An edge = a repeatable statistical advantage<br>• Without an edge, you\'re gambling with extra steps<br>• Edges decay over time as others discover them<br>• Building an edge: backtest → paper trade → small live → scale<br><br>My signal scanner is one such edge: multi-TF confluence + whale flow + auto-learning. Use it as input, not as gospel.';
  }

  // === FLOW & MACRO QUERY (when user asks about the market broadly) ===
  if(has('scan the market')||has('scan market')||has('market scan')){
    if(signalData.length){
      var s='<b>Market Scan — Top Signals:</b><br><br>';
      signalData.slice(0,5).forEach(function(sig){
        var type=sig.master.type;
        var cls=type==='BUY'?'hl-g':type==='SELL'?'hl-r':'hl-a';
        s+='&bull; <b>'+baseOf(sig.sym)+'</b>: <span class="'+cls+'">'+type+'</span> ('+(sig.score>0?'+':'')+sig.score+')<br>';
        if(sig.whaleText)s+='&nbsp;&nbsp;'+esc(sig.whaleText)+'<br>';
      });
      s+='<br>Full scanner on the <b>Signals tab</b>.';
      return s;
    }
    return 'Scanner warming up — ask again in 30 seconds.';
  }
  if(has('best signal')||has('strongest signal')||has('top signal')){
    if(signalData.length){
      var top=signalData[0];
      var type2=top.master.type;
      var cls2=type2==='BUY'?'hl-g':type2==='SELL'?'hl-r':'hl-a';
      return '<b>Strongest Signal Right Now:</b><br><br>&bull; <b>'+baseOf(top.sym)+'</b>: <span class="'+cls2+'">'+type2+'</span> ('+(top.score>0?'+':'')+top.score+')<br>'+top.master.breakdown.map(function(b){return b.tf+': '+b.type}).join(' | ')+'<br>'+(top.whaleText?esc(top.whaleText)+'<br>':'')+'<br>Check the <b>Signals tab</b> for full multi-TF breakdown.';
    }
    return 'Scanner still warming up.';
  }
  if(has('whales doing')||has('whale activity')||has('smart money doing')){
    if(signalData.length){
      var whaleSignals=signalData.filter(function(s){return s.whaleText&&s.whaleText.indexOf('balanced')===-1});
      if(whaleSignals.length){
        var s='<b>Whale Activity Across Scanner Coins:</b><br><br>';
        whaleSignals.slice(0,5).forEach(function(s2){
          s+='&bull; <b>'+baseOf(s2.sym)+'</b>: '+esc(s2.whaleText)+'<br>';
        });
        return s;
      }
      return 'Whale flow is balanced across scanner coins right now — no strong accumulation or distribution signals.';
    }
    return 'Whale data loading. Ask again shortly.';
  }

  if(coin){
      const t=state.tickers[COINS[coin].sym];
      if(t)return '🌙 '+COINS[coin].icon+' <b>'+coin+'</b> is '+(t.pct>5?'<span class="hl-g">pumping +'+t.pct.toFixed(1)+'%</span> right now':t.pct>0?'up '+t.pct.toFixed(2)+'% — drifting, not mooning':t.pct>-5?'flat-ish ('+t.pct.toFixed(2)+'%) — rocket still on the pad':'<span class="hl-r">dumping '+t.pct.toFixed(1)+'% today</span> — more lunar debris than launch')+'. Chasing green candles after +10% is how bags get made (the wrong kind). Ask <i>"analyze '+coin.toLowerCase()+'"</i> first.';
    }
    return '🌙 "To the moon" energy is fun; portfolio math is survival. Name a coin and I\'ll tell you whether it\'s actually moving or just trending on X.';
  }
  if(has('dump')||has('crash')||has('rekt')||has('rug')){
    const t=state.tickers[state.symbol];
    return '💀 Dump/rekt checklist:<br>• Is 24h change worse than −8%? '+(t&&t.pct<-8?'<span class="hl-r">Yes — active flush on '+baseOf(state.symbol)+'</span>':'Not currently on the active chart')+'<br>• Volume spike + close back inside range = capitulation wick, sometimes a gift<br>• No-bid slow bleed = worse than violent dumps<br><br>Anti-rekt protocol: hard stops pre-placed, no averaging into falling knives without a thesis, never leverage a meme. <span class="hl-a">Survive first, profit second.</span>';
  }
  if(has('hodl')||has('diamond hands')){
    return '💎🙌 <b>HODL doctrine:</b> fine for spot BTC/ETH with a multi-year horizon and money you don\'t need. Fatal when applied to leveraged positions or low-liquidity memes — those need exits because they can go structurally to zero. HODL is a strategy for assets, not an excuse for absent risk management.';
  }
  if(has('ath')||has('all time high')){
    const t=state.tickers[coin?COINS[coin].sym:state.symbol];
    return '[ATH] <b>All-time high</b> = the highest price ever printed. Psychologically massive — old bagholders sell into it, breakout traders buy through it.'+(t?'<br><br>'+(coin||baseOf(state.symbol))+' 24h high: '+chip('$'+pfmt(t.high))+' — current '+chip('$'+pfmt(t.last))+' sits '+(((t.last/t.high)-1)*100).toFixed(2)+'% from it. (Full ATH history needs longer lookbacks than this terminal\'s feeds.)':'');
  }
  if(has('atl')||has('all time low')){
    return '[ATL] All-time lows mark maximum pessimism. Some become generational entries; others become delistings. The tell: does volume dry up at the lows (seller exhaustion) or keep accelerating (no floor yet)?';
  }
  if(has('bull run')||has('bull market')||has('bullish cycle')){
    const v=state.fg?parseInt(state.fg.value,10):null;
    return '[BULL] <b>Bull run dashboard:</b><br>• Sentiment: '+(v!=null?'Fear &amp; Greed at <span style="color:'+fngColor(v)+'">'+v+' ('+state.fg.classification+')</span>':'unavailable')+'<br>• Breadth: check advancers vs decliners on the Market tab<br>• Structure test: are 15m pullbacks holding above prior highs?<br><br>Textbook bulls: price above rising EMA20/50, funding positive-but-not-extreme, alt breadth expanding. Extreme greed + vertical candles = late-stage, not early-stage.';
  }
  if(has('bear market')||has('bearish cycle')||(has('bear')&&!coin)){
    return '[BEAR] Bear-market tells: lower highs stacking on higher timeframes, rallies sold within days, funding pinned negative while OI decays, blue chips bleeding slower than alts. Survival kit: smaller size, fewer trades, stablecoin yield starts outcompeting delta. Every bear in history has been someone\'s buying opportunity eventually.';
  }
  if(has('dip')||has('buy the dip')){
    const a=state._ai;
    const base=coin||baseOf(state.symbol);
    let extra='';
    if(a&&!coin)extra='<br><br>Active chart ('+base+'): RSI '+a.rsi.toFixed(0)+' — '+(a.rsi<35?'<span class="hl-g">technically dipped into value zone</span>':a.rsi>65?'this isn\'t a dip, it\'s a summit':'mid-range, not a dip by oscillator standards')+'.';
    return '🩸 <b>"Buy the dip"</b> only works with definitions:<br>1. Dip to <i>what</i>? Prior resistance-turned-support or a measured level — not just "red"<br>2. Confirmation: selling volume exhausting while price holds the level<br>3. Invalidation pre-defined — if the level breaks, the dip was actually a trend change'+extra+'<br><br>Catching knives without levels is called donating.';
  }

  if(coin){
    try{
      const d=await safeCtx(coin);
      return coinBrief(coin,d);
    }catch(e){
      const t=state.tickers[COINS[coin].sym];
      if(t)return COINS[coin].icon+' <b>'+coin+'</b>: '+chip('$'+pfmt(t.last))+' · 24h '+chip((t.pct>0?'+':'')+t.pct.toFixed(2)+'%',t.pct>=0?'hl-g':'hl-r')+' (deeper analytics temporarily unavailable)';
      return 'I recognize <b>'+coin+'</b> but couldn\'t reach the API just now.';
    }
  }

  if(has('price')||has('chart')||has('analysis')||has('market')||has('crypto')){
    const t=state.tickers[state.symbol];
    return 'You\'re looking for specifics — give me a ticker! Try <i>"bitcoin"</i>, <i>"solana"</i>, <i>"trump coin"</i>, <i>"wif"</i>… or ask for <i>"best performer today"</i>.'+(t?' Meanwhile: '+baseOf(state.symbol)+' is '+chip('$'+pfmt(t.last))+' '+chip((t.pct>0?'+':'')+t.pct.toFixed(2)+'%',t.pct>=0?'hl-g':'hl-r')+'.':'');
  }

  return 'I didn\'t catch that. I\'m sharpest on:<br>• <b>Coins</b> — btc, eth, sol, doge, pepe, trump, wif + 20 more (nicknames &amp; typos welcome)<br>• <b>Indicators</b> — rsi, macd, bollinger, ema, atr<br>• <b>Microstructure</b> — whales, funding, open interest, liquidations, support/resistance<br>• <b>Patterns</b> — rsi divergence, macd crossover, bb squeeze, volume spike<br>• <b>Signals</b> — "show signals", "best signal", "scan the market"<br>• <b>Economics</b> — inflation, fed rates, gdp, nfp, quantitative easing<br>• <b>Crypto basics</b> — bitcoin, ethereum, blockchain, defi, layer 2, nfts<br>• <b>Trading</b> — position sizing, stop loss, take profit, leverage, margin<br>• <b>News</b> — "show news", "forex events", "what is happening today"<br>• <b>Conversation</b> — greetings, jokes, opinions on any coin<br><br>Rephrase and fire again.';
}

function switchTab(tab){
  state.tab=tab;
  document.querySelectorAll('.tab-btn').forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false')});
  document.querySelectorAll('.tab-section').forEach(s=>s.classList.toggle('active',s.id==='tab-'+tab));
  window.scrollTo({top:0});
}
async function setSymbol(sym){
  if(!sym)return;
  if(state.symbol===sym){switchTab('radar');return}
  state.symbol=sym;
  Object.keys(state.ctxCache).forEach(k=>delete state.ctxCache[k]);
  state._liq=null;state._sr=null;state._ai=null;state.whales=[];
  $('heroPrice').textContent='—';$('heroPrice').dataset.p='0';
  $('wsKlineState').textContent='SYNCING';$('wsKlineState').className='badge b-amber';
  var sel=$('symSelect');
  if(!sel.querySelector('option[value="'+sym+'"]')){
    var base=sym.replace(/USDT$/,'');
    var opt=document.createElement('option');
    opt.value=sym;opt.textContent=base+'/USDT';
    sel.appendChild(opt);
  }
  sel.value=sym;
  renderTicker();
  switchTab('radar');
  await Promise.all([fetchKlines(sym),fetchOB(),fetchFR(),fetchOI(),fetchWhales()]);
  connectStreams();
  renderHero();
}
function COIN_ALIASESHas(sym){return Object.values(COINS).some(c=>c.sym===sym)}

const chatLog=$('chatLog'),chatForm=$('chatForm'),chatInput=$('chatInput'),sendBtn=$('sendBtn');
function pushMsg(html,who){
  const div=document.createElement('div');
  div.className='msg '+who;
  if(who==='user')div.textContent=html;else div.innerHTML=html;
  chatLog.appendChild(div);
  chatLog.scrollTop=chatLog.scrollHeight;
  return div;
}
let chatBusy=false;
async function sendChat(text){
  if(!text.trim()||chatBusy)return;
  chatBusy=true;sendBtn.disabled=true;
  pushMsg(text,'user');
  chatInput.value='';
  const typing=pushMsg('<span class="typing"><i></i><i></i><i></i></span>','ai');
  try{
    await new Promise(r=>setTimeout(r,420));
    const reply=await generateReply(text);
    typing.innerHTML=reply;
    state.mem.topics.push(text);
    if(state.mem.topics.length>6)state.mem.topics.shift();
  }catch(e){
    typing.innerHTML='Connection hiccup — try again in a moment.';
  }
  chatLog.scrollTop=chatLog.scrollHeight;
  chatBusy=false;sendBtn.disabled=false;
}
chatForm.addEventListener('submit',e=>{e.preventDefault();sendChat(chatInput.value)});
document.querySelectorAll('#chatChips .chip').forEach(c=>c.addEventListener('click',()=>sendChat(c.dataset.q)));

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
    connectStreams(); // restart live kline stream at the new, consistent interval
  });
});

const PF_KEY='lr_portfolio_v1';
function loadPortfolio(){return storageGet(PF_KEY, [])}
function savePortfolio(p){storageSet(PF_KEY,p)}
function renderPortfolio(){
  const p=loadPortfolio();
  const rows=$('pfRows');
  if(!rows)return;
  const tks=state.tickers||{};
  let total=0,dayTot=0,lastChg=0;
  const rowHtml=p.map((pos,i)=>{
    const tk=tks[COINS[pos.sym]?COINS[pos.sym].sym:pos.sym];
    const price=tk?+tk.last:null;
    const day=tk?+tk.pct:0;
    const val=price!=null?price*pos.qty:null;
    const cost=pos.qty*pos.cost;
    const pnl=val!=null?val-cost:null;
    if(val!=null)total+=val;
    if(day&&val!=null){dayTot+=val*day/100}
    if(pnl!=null)lastChg+=pnl;
    const chgCls=pnl>=0?'b-green':'b-red';
    return'<tr>'
      +'<td><b>'+esc(pos.sym)+'</b></td>'
      +'<td>'+nfmt(pos.qty)+'</td>'
      +'<td>$'+pfmt(pos.cost)+'</td>'
      +'<td>'+(price!=null?'$'+pfmt(price):'—')+'</td>'
      +'<td>'+(price!=null?'<span class="'+(day>=0?'hl-g':'hl-r')+'">'+(day>=0?'+':'')+day.toFixed(2)+'%</span>':'—')+'</td>'
      +'<td>'+(val!=null?'$'+cfmt(val):'—')+'</td>'
      +'<td>'+(pnl!=null?'<span class="'+(pnl>=0?'hl-g':'hl-r')+'">'+(pnl>=0?'+':'')+'$'+cfmt(pnl)+'</span>':'—')+'</td>'
      +'<td><button class="sc-action-btn" style="font-size:10px;padding:2px 7px;background:var(--red);color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="removePosition('+i+')">X</button></td>'
      +'</tr>';
  }).join('');
  rows.innerHTML=rowHtml||'<tr><td colspan="8" class="fc-note">No positions — click + Add Position</td></tr>';
  $('pfTotal').textContent=total?'$'+cfmt(total):'—';
  $('pfPnl').textContent=lastChg?(lastChg>=0?'+':'')+'$'+cfmt(lastChg):'—';
  $('pfPnl').style.color=lastChg>=0?'var(--green)':'var(--red)';
  $('pfDay').textContent=(dayTot>=0?'+':'')+'$'+cfmt(dayTot);
  $('pfDay').style.color=dayTot>=0?'var(--green)':'var(--red)';
  $('pfCount').textContent=p.length;
  $('pfEmpty').style.display=p.length?'none':'block';
}
function removePosition(i){
  const p=loadPortfolio();p.splice(i,1);savePortfolio(p);renderPortfolio();showToast('Position removed');
}
function addPosition(sym,qty,cost){
  const s=(sym||'').trim().toUpperCase();
  qty=parseFloat(qty);cost=parseFloat(cost);
  if(!s||!(qty>0)||!(cost>0)){showToast('Enter symbol, quantity and avg cost');return}
  const p=loadPortfolio();
  const ex=p.find(x=>x.sym===s);
  if(ex){
    const totQ=ex.qty+qty;
    ex.cost=((ex.qty*ex.cost)+(qty*cost))/totQ;
    ex.qty=totQ;
  }else{p.push({sym:s,qty:qty,cost:cost,added:Date.now()})}
  savePortfolio(p);renderPortfolio();showToast(s+' added to portfolio');
  closeModal('pfModal');
}
$('pfAddBtn').addEventListener('click',()=>openModal('pfModal'));

const AL_KEY='lr_alerts_v1';
let notifOk=false;
function loadAlerts(){return storageGet(AL_KEY, [])}
function saveAlerts(a){storageSet(AL_KEY,a)}
function notifState(){return $('alPermState')}
function renderAlerts(){
  const list=$('alList');
  if(!list)return;
  const a=loadAlerts();
  list.innerHTML=a.length?a.map((al,i)=>{
    const dirTxt=al.dir==='above'?'ABOVE':'BELOW';
    const p=state.tickers&&state.tickers[al.sym]?+state.tickers[al.sym].last:null;
    return'<div class="al-item"><div style="flex:1"><b>'+esc(al.sym)+'</b> '+dirTxt+' <span class="al-tgt">$'+pfmt(al.price)+'</span>'+(p!=null?(' <span class="al-cur">· now $'+pfmt(p)+'</span>'):'')+'</div><button class="sc-action-btn" style="font-size:10px;padding:2px 7px;background:var(--red);color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="removeAlert('+i+')">X</button></div>';
  }).join(''):'<div class="fc-note">No alerts set.</div>';
  const ok='Notification' in window&&Notification.permission==='granted';
  notifOk=ok;
  const st=notifOk?'on':'off';
  notifState().textContent=st;
  notifState().style.color=notifOk?'var(--green)':'var(--dim)';
}
function notify(title,body){
  try{
    if(notifOk&&window.Notification&&Notification.permission==='granted'){
      new Notification(title,{body:body,tag:'lr-alert'});
    }
    showToast(title+' — '+body);
  }catch(e){}
}
function enableAlerts(){
  if(!('Notification' in window)){showToast('Desktop notifications not supported in this browser');return}
  Notification.requestPermission().then(function(p){
    if(p==='granted'){notifOk=true;renderAlerts();showToast('Desktop notifications enabled')}
    else{showToast('Notifications blocked by browser')}
  });
}
function addAlert(sym,dir,price){
  const s=(sym||'').trim().toUpperCase();
  price=parseFloat(price);
  if(!s||!(price>0)){showToast('Enter symbol and alert price');return}
  const a=loadAlerts();
  a.push({sym:s,dir:dir||'above',price:price,fired:false,created:Date.now()});
  saveAlerts(a);renderAlerts();showToast('Alert set for '+s+' '+dir+' $'+pfmt(price));
  closeModal('alModal');
}
function removeAlert(i){
  const a=loadAlerts();a.splice(i,1);saveAlerts(a);renderAlerts();showToast('Alert removed');
}
function checkAlerts(){
  const a=loadAlerts();
  if(!a.length)return;
  const tks=state.tickers||{};
  let changed=false;
  a.forEach(al=>{
    const tk=tks[al.sym];
    if(!tk)return;
    const p=+tk.last;
    const hit=al.dir==='above'?(p>=al.price):(p<=al.price);
    if(hit&&!al.fired){
      al.fired=true;
      notify(al.sym+' Alert',(al.dir==='above'?'Price crossed ABOVE':'Price crossed BELOW')+' $'+pfmt(al.price)+' — now $'+pfmt(p));
      changed=true;
    }
  });
  if(changed){saveAlerts(a);renderAlerts()}
}
$('alertBtn').addEventListener('click',()=>{renderAlerts();openModal('alModal')});

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
  connectStreams();
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
  if(typeof applySigAnaTheme==='function')applySigAnaTheme();
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
function mcApplyTheme(){
  mcPanels.forEach(function(p){
    if(p.chart){
      var th=chartTheme();
      p.chart.applyOptions({layout:{background:{type:'solid',color:th.bg},textColor:th.txt},grid:{vertLines:{color:th.grid},horzLines:{color:th.grid}},rightPriceScale:{borderColor:th.border},timeScale:{borderColor:th.border}});
      if(p.candleSeries)p.candleSeries.applyOptions({upColor:th.up,downColor:th.dn,wickUpColor:th.up,wickDownColor:th.dn});
      if(p.volSeries)p.volSeries.applyOptions({});
    }
  });
}
function applySigAnaTheme(){
  if(sigAnaChart){
    var th=chartTheme();
    sigAnaChart.applyOptions({layout:{background:{type:'solid',color:th.bg},textColor:th.txt},grid:{vertLines:{color:th.grid},horzLines:{color:th.grid}},rightPriceScale:{borderColor:th.border},timeScale:{borderColor:th.border}});
    if(sigAnaCandleSeries)sigAnaCandleSeries.applyOptions({upColor:th.up,downColor:th.dn,wickUpColor:th.up,wickDownColor:th.dn});
  }
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

// ===== MULTI-CHART WORKSPACE =====
const INTERVALS={'$':{val:'1m',label:'1 Min'},'$$':{val:'5m',label:'5 Min'},'$$$':{val:'15m',label:'15 Min'},'$$$$':{val:'1h',label:'1 Hour'},'$$$$$':{val:'4h',label:'4 Hour'},'$$$$$$':{val:'1d',label:'1 Day'}};
const MC_INTERVALS=['1m','5m','15m','1h','4h','1d'];
const MC_COINS=['BTCUSDT','ETHUSDT','SOLUSDT','DOGEUSDT','PEPEUSDT','WIFUSDT','TRUMPUSDT','XRPUSDT','SUIUSDT','BNBUSDT'];
let mcPanels=[];
let mcIdCounter=0;

function initMultiCharts(){
  mcPanels=[];
  mcIdCounter=0;
  $('mcGrid').innerHTML='';
  mcAdd('BTCUSDT','15m');
  mcAdd('ETHUSDT','1h');
  renderMCGrid();
  setInterval(mcRefreshAll,15000);
}

function mcAdd(sym,interval){
  const id=mcIdCounter++;
  mcPanels.push({id:id,sym:sym,interval:interval,chart:null,candleSeries:null,volSeries:null,ws:null,candles:[]});
  renderMCGrid(); // renderMCGrid -> mcInitChart(p) creates chart + loads data for each panel
}

function mcRemove(id){
  const idx=mcPanels.findIndex(p=>p.id===id);
  if(idx===-1)return;
  if(mcPanels[idx].ws){mcPanels[idx].ws._dead=true;try{mcPanels[idx].ws.close()}catch(e){}}
  if(mcPanels[idx].chart)try{mcPanels[idx].chart.remove()}catch(e){}
  mcPanels.splice(idx,1);
  renderMCGrid();
}

function renderMCGrid(){
  const grid=$('mcGrid');
  let html='';
  mcPanels.forEach(function(p){
    const meta=coinMeta(p.sym);
    html+='<div class="multi-chart-cell" data-mc-id="'+p.id+'">'
      +'<div class="mc-head">'
      +'<span class="mc-title">'+meta.icon+' '+baseOf(p.sym)+'/USDT</span>'
      +'<div class="mc-controls">'
      +'<select onchange="mcChangeInterval('+p.id+',this.value)">'+MC_INTERVALS.map(function(iv){return'<option value="'+iv+'"'+(iv===p.interval?' selected':'')+'>'+iv+'</option>'}).join('')+'</select>'
      +'<select onchange="mcChangeSymbol('+p.id+',this.value)">'+MC_COINS.map(function(s){return'<option value="'+s+'"'+(s===p.sym?' selected':'')+'>'+baseOf(s)+'</option>'}).join('')+'</select>'
      +'<button class="theme-btn" onclick="mcRemove('+p.id+')" style="width:24px;height:24px;font-size:10px;padding:0" title="Remove">X</button>'
      +'</div></div>'
      +'<div class="mc-body" id="mcBody'+p.id+'"><div class="mc-legend" id="mcLeg'+p.id+'">Loading...</div></div>'
      +'</div>';
  });
  if(mcPanels.length<6){
    html+='<div class="mc-add" onclick="mcAdd(\'BTCUSDT\',\'15m\')" title="Add chart">+ Add Chart</div>';
  }
  grid.innerHTML=html;
  mcPanels.forEach(function(p){
    mcInitChart(p);
  });
}

function mcInitChart(p){
  const el=document.getElementById('mcBody'+p.id);
  if(!el)return;
  const legEl=document.getElementById('mcLeg'+p.id);
  const w=el.clientWidth,h=el.clientHeight||260;
  const th=chartTheme();
  const c=LightweightCharts.createChart(el,{
    width:w,height:h,
    layout:{background:{type:'solid',color:th.bg},textColor:th.txt,fontSize:10,fontFamily:"'JetBrains Mono', monospace"},
    grid:{vertLines:{color:th.grid},horzLines:{color:th.grid}},
    rightPriceScale:{borderColor:th.border},
    timeScale:{borderColor:th.border,timeVisible:true,secondsVisible:false,rightOffset:4},
    crosshair:{mode:0,vertLine:{color:th.pline,labelBackgroundColor:th.pline},horzLine:{color:th.pline,labelBackgroundColor:th.pline}}
  });
  const cs=c.addCandlestickSeries({upColor:th.up,downColor:th.dn,borderVisible:false,wickUpColor:th.up,wickDownColor:th.dn});
  const vs=c.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:''});
  vs.priceScale().applyOptions({scaleMargins:{top:0.85,bottom:0}});
  c.subscribeCrosshairMove(function(param){
    if(!param.time||!param.seriesData||!legEl)return;
    const d=param.seriesData.get(cs);
    if(d){
      const up=d.close>=d.open;
      legEl.innerHTML='<span style="color:'+(up?'var(--green)':'var(--red)')+'">O:'+pfmt(d.open)+' H:'+pfmt(d.high)+' L:'+pfmt(d.low)+' C:'+pfmt(d.close)+'</span>';
    }
  });
  new ResizeObserver(function(){
    if(c&&el.clientWidth)c.applyOptions({width:el.clientWidth,height:el.clientHeight||260});
  }).observe(el);
  p.chart=c;p.candleSeries=cs;p.volSeries=vs;
  mcLoadData(p);
}

function mcLoadData(p){
  const sym=mdSym(p.sym),iv=mdTf(p.interval);
  jget('https://api.binance.com/api/v3/klines?symbol='+sym+'&interval='+iv+'&limit=120').then(function(data){
    const candles=data.map(mdFromK).filter(Boolean);
    p.candles=candles;
    mdCachePut(sym,iv,candles);
    if(p.candleSeries){
      p.candleSeries.setData(p.candles.map(mapCandle));
      p.volSeries.setData(p.candles.map(function(c){return{time:Math.floor(c.t/1000),value:c.v,color:c.c>=c.o?'rgba(0,230,118,.3)':'rgba(255,23,68,.3)'}}));
      p.chart.timeScale().fitContent();
    }
    mcConnectWS(p);
  }).catch(function(e){
    console.warn('mc load',e);
    const cached=mdCacheGet(sym,iv);
    if(cached&&cached.length&&p.candleSeries){
      p.candles=cached;
      p.candleSeries.setData(cached.map(mapCandle));
      p.volSeries.setData(cached.map(function(c){return{time:Math.floor(c.t/1000),value:c.v,color:c.c>=c.o?'rgba(0,230,118,.3)':'rgba(255,23,68,.3)'}}));
    }
    mcConnectWS(p);
  });
}

function mcConnectWS(p){
  if(p.ws&&p.ws._dead===false){p.ws._dead=true;try{p.ws.close()}catch(e){}}
  const s=mdSym(p.sym).toLowerCase();
  const iv=mdTf(p.interval);
  const url='wss://stream.binance.com:9443/ws/'+s+'@kline_'+iv;
  try{
    const ws=new WebSocket(url);
    ws._dead=false;
    p.ws=ws;
    ws._expectSym=p.sym;ws._expectIv=p.interval;
    ws.onopen=function(){mdHearbeat('ws')};
    ws.onmessage=function(ev){
      try{
        const d=JSON.parse(ev.data);
        const k=d.k;
        const c={t:k.t,o:+k.o,h:+k.h,l:+k.l,c:+k.c,v:+k.v};
        if(!mdVal.candle(c))return;
        mdHearbeat('ws');
        const arr=p.candles;
        if(arr.length&&arr[arr.length-1].t===c.t)arr[arr.length-1]=c;
        else if(arr.length&&c.t>arr[arr.length-1].t){arr.push(c);if(arr.length>200)arr.shift()}
        else return;
        if(p.candleSeries){
          p.candleSeries.update(mapCandle(c));
          p.volSeries.update({time:Math.floor(c.t/1000),value:c.v,color:c.c>=c.o?'rgba(0,230,118,.3)':'rgba(255,23,68,.3)'});
        }
      }catch(e){mdDebug.log('ws','mc handler',e)}
    };
    ws.onclose=function(){
      // only reconnect if the panel still exists and this socket is still current
      if(ws._dead)return;
      if(!mcPanels.some(function(x){return x===p&&x.ws===ws}))return;
      if(p.sym!==ws._expectSym||p.interval!==ws._expectIv)return;
      md.conn.ws.reconnects++;mdHealth.wsReconnects++;
      const exp=(p._retry=(p._retry||0)+1);
      const delay=Math.min(30000,1200*Math.pow(2,Math.min(exp,6)))+Math.floor(Math.random()*300);
      setTimeout(function(){if(!ws._dead&&mcPanels.indexOf(p)!==-1&&p.ws===ws)mcConnectWS(p)},delay);
    };
  }catch(e){mdDebug.log('ws','mc create',e)}
}

function mcChangeInterval(id,iv){
  const p=mcPanels.find(function(x){return x.id===id});
  if(!p)return;
  p.interval=iv;
  if(p.ws){p.ws._dead=true;try{p.ws.close()}catch(e){}}
  mcLoadData(p);
}

function mcChangeSymbol(id,sym){
  const p=mcPanels.find(function(x){return x.id===id});
  if(!p)return;
  p.sym=sym;
  p.candles=[];
  if(p.ws){p.ws._dead=true;try{p.ws.close()}catch(e){}}
  mcLoadData(p);
  renderMCGrid();
}

function mcRefreshAll(){
  mcPanels.forEach(function(p){
    if(p.candles.length>0){
      const sym=mdSym(p.sym),iv=mdTf(p.interval);
      jget('https://api.binance.com/api/v3/klines?symbol='+sym+'&interval='+iv+'&limit=5').then(function(data){
        if(data&&data.length){
          const c=mdFromK(data[data.length-1]);
          if(!c||!mdVal.candle(c))return;
          const arr=p.candles;
          if(arr.length&&arr[arr.length-1].t===c.t)arr[arr.length-1]=c;
          else if(arr.length&&c.t>arr[arr.length-1].t){arr.push(c);if(arr.length>200)arr.shift()}
          if(p.candleSeries){p.candleSeries.update(mapCandle(c));p.volSeries.update({time:Math.floor(c.t/1000),value:c.v,color:c.c>=c.o?'rgba(0,230,118,.3)':'rgba(255,23,68,.3)'})}
        }
      }).catch(function(){});
    }
  });
}

// ===== SIGNAL SCANNER =====
const SIGNAL_COINS=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','SUIUSDT','LINKUSDT'];
const TF_LIST=[{key:'1h',label:'1H',limit:100,weight:0.50},{key:'1d',label:'1D',limit:60,weight:0.50}];
let signalData=[];
let whaleFlowCache={};
let patternHistory={};
let modelWeights={rsi:25,macdCross:30,macdTrend:10,ema:12,bb:18,vol:5,diverge:20,whale:15,forecast:10,master:30};

function loadPatternHistory(){
try{var d=storageGet('lr-patternHist',undefined);if(d)patternHistory=d}catch(e){}
}
function savePatternHistory(){
  try{storageSet('lr-patternHist',patternHistory)}catch(e){}
}
function loadModelWeights(){
  try{var d=storageGet('lr-modelW',undefined);if(d)Object.keys(d).forEach(function(k){if(modelWeights[k]!==undefined)modelWeights[k]=d[k]})}catch(e){}
}
function saveModelWeights(){try{storageSet('lr-modelW',modelWeights)}catch(e){}}

function recordPatternOutcome(key,wrong){
  if(!patternHistory[key])patternHistory[key]={correct:0,total:0};
  patternHistory[key].total++;
  if(!wrong)patternHistory[key].correct++;
  if(patternHistory[key].total%10===0)adjustWeights();
  savePatternHistory();
}

function adjustWeights(){
  var totalPatterns=Object.keys(patternHistory).length;
  if(totalPatterns<5)return;
  Object.keys(patternHistory).forEach(function(k){
    var h=patternHistory[k];
    if(h.total<5)return;
    var hitRate=h.correct/h.total;
    // map outcome keys like "master_BUY" / "rsi_15m" back to a valid model-weight key
    var wKey=k.split('_')[0];
    if(modelWeights[wKey]===undefined)return;
    if(hitRate>0.6){modelWeights[wKey]=Math.min(45,(modelWeights[wKey]||1)*1.06)}
    else if(hitRate<0.42){modelWeights[wKey]=Math.max(5,(modelWeights[wKey]||1)*0.94)}
  });
  saveModelWeights();
}

function scoreTimeframe(candles){
  var closes=candles.map(function(c){return c.c});
  var vols=candles.map(function(c){return c.v});
  if(closes.length<30)return null;
  var a=aiComposite(candles,closes,vols);
  var fc=forecastFrom(closes);
  var last=closes[closes.length-1];
  var reasons=[];
  var score=0;
  if(a.rsi<30){reasons.push('RSI oversold ('+a.rsi.toFixed(0)+')');score+=modelWeights.rsi}
  else if(a.rsi>70){reasons.push('RSI overbought ('+a.rsi.toFixed(0)+')');score-=modelWeights.rsi}
  else if(a.rsi<45){reasons.push('RSI bearish ('+a.rsi.toFixed(0)+')');score+=Math.round(modelWeights.rsi*0.3)}
  else if(a.rsi>55){reasons.push('RSI bullish ('+a.rsi.toFixed(0)+')');score-=Math.round(modelWeights.rsi*0.3)}
  if(a.macd.hist>0&&closes[closes.length-2]<closes[closes.length-3]){reasons.push('MACD bullish cross');score+=modelWeights.macdCross}
  else if(a.macd.hist<0&&closes[closes.length-2]>closes[closes.length-3]){reasons.push('MACD bearish cross');score-=modelWeights.macdCross}
  else if(a.macd.hist>0){reasons.push('MACD bullish');score+=modelWeights.macdTrend}
  else{reasons.push('MACD bearish');score-=modelWeights.macdTrend}
  if(last>a.e20){reasons.push('Above EMA20');score+=modelWeights.ema}
  else{reasons.push('Below EMA20');score-=modelWeights.ema}
  if(a.bb.pctB<10){reasons.push('Lower BB touch');score+=modelWeights.bb}
  else if(a.bb.pctB>90){reasons.push('Upper BB stretch');score-=modelWeights.bb}
  if(a.vt==='RISING'){reasons.push('Volume rising');score+=modelWeights.vol}
  else if(a.vt==='FALLING'){reasons.push('Volume falling');score-=modelWeights.vol}
  var prev10=closes.slice(-20,-10);
  var last10=closes.slice(-10);
  if(prev10.length>=10&&last10.length>=10){
    var rsi1=calcRSI(prev10),rsi2=calcRSI(last10);
    if(rsi1>rsi2&&last>closes[closes.length-11]){reasons.push('Bearish RSI div');score-=modelWeights.diverge}
    else if(rsi1<rsi2&&last<closes[closes.length-11]){reasons.push('Bullish RSI div');score+=modelWeights.diverge}
  }
  var swingH=Math.max.apply(null,closes.slice(-20));
  var swingL=Math.min.apply(null,closes.slice(-20));
  if(last>swingH*0.995){reasons.push('Near resistance $'+pfmt(swingH));score-=5}
  if(last<swingL*1.005){reasons.push('Near support $'+pfmt(swingL));score+=5}
  score=Math.max(-100,Math.min(100,score));
  return{score:score,reasons:reasons.slice(0,4),ai:a,fc:fc,last:last};
}

function getWhaleFlow(sym){
  var cached=whaleFlowCache[sym];
  if(cached&&Date.now()-cached.ts<30000)return cached;
  return jget('https://api.binance.com/api/v3/trades?symbol='+sym+'&limit=500').then(function(trades){
    var buys=0,sells=0,buyUsd=0,sellUsd=0;
    trades.forEach(function(t){
      var usd=+t.price*+t.qty;
      if(usd<1000)return;
      if(t.isBuyerMaker){sells++;sellUsd+=usd}else{buys++;buyUsd+=usd}
    });
    var imbalance=(buyUsd-sellUsd)/(buyUsd+sellUsd+1);
    var result={buys:buys,sells:sells,buyUsd:buyUsd,sellUsd:sellUsd,imbalance:imbalance,ts:Date.now()};
    whaleFlowCache[sym]=result;
    return result;
  }).catch(function(){return{buys:0,sells:0,buyUsd:0,sellUsd:0,imbalance:0,ts:Date.now()}});
}

function forecastScore(fc){
  if(!fc||!fc.rows)return 0;
  var pred24=fc.rows[3];
  var pred1h=fc.rows[0];
  var bias=0;
  if(pred24.dp>1)bias+=5;else if(pred24.dp<-1)bias-=5;
  if(pred1h.dp>0.5)bias+=3;else if(pred1h.dp<-0.5)bias-=3;
  if(pred24.conf>55)bias*=1.2;
  return Math.round(Math.max(-modelWeights.forecast,Math.min(modelWeights.forecast,bias)));
}

function masterSignal(tfScores){
  var totalWeight=0;
  var weighted=0;
  var breakdown=[];
  tfScores.forEach(function(ts){
    if(!ts)return;
    var w=TF_LIST.find(function(f){return f.key===ts.tf}).weight;
    totalWeight+=w;
    weighted+=ts.score*w;
    breakdown.push({tf:ts.tf,score:ts.score,type:ts.score>15?'BUY':ts.score<-15?'SELL':'WAIT'});
  });
  if(totalWeight===0)return{score:0,type:'WAIT',breakdown:breakdown};
  var base=Math.round(weighted/totalWeight);
  return{score:base,type:base>15?'BUY':base<-15?'SELL':'WAIT',breakdown:breakdown};
}

// Cached kline fetch for the scanner: 1H/1D candles change slowly, so
// reuse the in-memory candle cache across the 2-minute scans instead of
// firing ~20 kline requests each cycle. TTL is generous but safe for these TF.
var scanCache={};
function scanKlineFetch(sym,tfKey){
  var key=sym+'|'+tfKey;
  var hit=scanCache[key];
  if(hit&&Date.now()-hit.ts<60000)return Promise.resolve(hit.candles);
  // also prefer the main chart's current candles for the active symbol
  if(md.series.symbol===sym&&mdTf(md.series.tf)===tfKey&&state.candles&&state.candles.length>2){
    scanCache[key]={ts:Date.now(),candles:state.candles.slice()};
    return Promise.resolve(scanCache[key].candles);
  }
  return jget('https://api.binance.com/api/v3/klines?symbol='+sym+'&interval='+tfKey+'&limit=60').then(function(data){
    var candles=data.map(function(k){return{t:k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}}).filter(mdVal.candle);
    if(candles.length)scanCache[key]={ts:Date.now(),candles:candles};
    return candles;
  });
}

function scanSignals(){
  var badge=$('sigCount');
  if(badge)badge.textContent='SCANNING...';
  if(badge)badge.style.background='rgba(41,98,255,.15)';
  var promises=SIGNAL_COINS.map(function(sym){
    var tfPromises=TF_LIST.map(function(tf){
      return scanKlineFetch(sym,tf.key).then(function(candles){
        return scoreTimeframe(candles);
      }).catch(function(){return null});
    });
    var whalePromise=getWhaleFlow(sym);
    return Promise.all(tfPromises.concat([whalePromise])).then(function(results){
      var tfScores=results.slice(0,TF_LIST.length);
      var whale=results[TF_LIST.length];
      var master=masterSignal(tfScores);
      var whaleText='';
      var whaleAdj=0;
      if(whale&&whale.imbalance){
        whaleAdj=Math.round(whale.imbalance*modelWeights.whale);
        if(whale.imbalance>0.15)whaleText='Whale accumulation (buy '+cfmt(whale.buyUsd)+' vs sell '+cfmt(whale.sellUsd)+')';
        else if(whale.imbalance<-0.15)whaleText='Whale distribution (sell '+cfmt(whale.sellUsd)+' vs buy '+cfmt(whale.buyUsd)+')';
        else whaleText='Whale flow balanced (buy '+cfmt(whale.buyUsd)+' / sell '+cfmt(whale.sellUsd)+')';
      }
      // blend master with whale flow and learning-adjusted master weight
      var blend=Math.max(-100,Math.min(100,Math.round(master.score*((modelWeights.master||30)/30)+whaleAdj)));
      var allReasons=[];
      tfScores.forEach(function(ts){if(ts&&ts.reasons.length)allReasons.push(ts.reasons[0])});
      var t=state.tickers[sym];
      var fcObj=null;
      var s1=tfScores[0]?tfScores[0].fc:null;
      if(s1&&s1.rows){fcObj={rows:s1.rows,pUp:1/(1+Math.exp(-blend/45))}}
      return{sym:sym,score:blend,master:master,tfScores:tfScores,whale:whale,whaleText:whaleText,t:t,fc:fcObj,reasons:allReasons.slice(0,4)};
    }).catch(function(){return null});
  });
  Promise.all(promises).then(function(results){
    signalData=results.filter(Boolean);
    signalData.sort(function(a,b){return Math.abs(b.score)-Math.abs(a.score)});
    renderSignals();
    recordSignalOutcomes();
  }).catch(function(e){
    console.warn('Signal scan failed:',e);
    if(badge)badge.textContent='SCAN FAILED';
    if(badge)badge.style.background='rgba(255,23,68,.15)';
    $('signalGrid').innerHTML='<div style="text-align:center;padding:40px;color:var(--dim)"><b style="color:var(--red);font-size:14px">Scanner Error</b><br><span style="font-size:12px;margin-top:6px;display:block">Could not reach Binance API. Retrying in 2 minutes.</span></div>';
  });
}

function recordSignalOutcomes(){
  if(!signalData.length)return;
  var prevSignals=storageGet('lr-lastSignals',{});
  var touched=0;
  signalData.forEach(function(s){
    var old=prevSignals[s.sym];
    var t=state.tickers[s.sym];
    if(!old||!t)return;
    var px=t.last;
    if(!(old.price>0)||!(px>0))return;
    var moved=((px-old.price)/old.price)*100;
    // require a meaningful move over the scan window (1H/4H horizon)
    if(Math.abs(moved)<0.3)return;
    if(old.type==='BUY'||old.type==='SELL'){
      var correct=(old.type==='BUY'&&moved>0)||(old.type==='SELL'&&moved<0);
      recordPatternOutcome('master_'+old.type,correct?0:1);
      touched++;
    }
  });
  if(touched){adjustWeights();saveModelWeights()}
  var current={};
  signalData.forEach(function(s){
    var px=(s.t&&s.t.last)?s.t.last:0;
    current[s.sym]={type:s.master.type,score:s.score,ts:Date.now(),price:px};
  });
  storageSet('lr-lastSignals',current);
}

function renderSignals(){
  $('sigCount').textContent=signalData.length+' COINS · '+TF_LIST.length+' TIMEFRAMES';
  var totalHits=0,totalPreds=0;
  Object.keys(patternHistory).forEach(function(k){totalHits+=patternHistory[k].correct;totalPreds+=patternHistory[k].total});
  var hitRate=totalPreds>10?Math.round(totalHits/totalPreds*100):null;
  $('signalGrid').innerHTML=signalData.map(function(s){
    var ms=s.master;
    var type=ms.type;
    var typeCls=type==='BUY'?'sig-buy':type==='SELL'?'sig-sell':'sig-wait';
    var badgeCls=type==='BUY'?'buy':type==='SELL'?'sell':'wait';
    var conf=Math.abs(s.score);
    var confColor=type==='BUY'?'var(--green)':type==='SELL'?'var(--red)':'var(--amber)';
    var t=s.t;
    var price=t?'$'+pfmt(t.last):'--';
    var chg=t?chgHtml(t.pct):'';
    var tfBadges=ms.breakdown.map(function(b){
      var cls=b.type==='BUY'?'tf-buy':b.type==='SELL'?'tf-sell':'tf-wait';
      return'<span class="sc-tf-badge '+cls+'">'+b.tf+': '+b.type+(b.score>0?'+':'')+b.score+'</span>';
    }).join('');
    var whaleClass=s.whaleText.indexOf('accumulation')!==-1?'whale-buy':s.whaleText.indexOf('distribution')!==-1?'whale-sell':'';
    var forecastHtml='';
    if(s.fc&&s.fc.rows){
      var r1h=s.fc.rows[0];
      var r24=s.fc.rows[3];
      var cGreen='var(--green)',cRed='var(--red)';
      var pct=(function(d){return(( d>0)?'+':'')+ (d?d.toFixed(2):'0.00')+'%'});
      forecastHtml='<div class="sc-forecast">'
        +'<div>1H <b style="color:'+(r1h.dp>=0?cGreen:cRed)+'">$'+pfmt(r1h.pred)+'</b> ('+pct(r1h.dp)+')</div>'
        +'<div>24H <b style="color:'+(r24.dp>=0?cGreen:cRed)+'">$'+pfmt(r24.pred)+'</b> ('+pct(r24.dp)+')'+(s.fc.pUp!=null?(' | P(up) '+Math.round(s.fc.pUp*100)+'%'):'')+'</div>'
        +'</div>';
    }
    var learnHtml=hitRate?'<div class="sc-learning">Model accuracy: '+hitRate+'% across '+totalPreds+' predictions</div>':'';
    return'<div class="signal-card '+typeCls+'">'
      +'<div class="sc-head"><span class="sc-coin">'+baseOf(s.sym)+'/USDT '+price+' '+chg+'</span><span class="sc-type '+badgeCls+'">'+type+'</span></div>'
      +'<div class="sc-tf-row">'+tfBadges+'</div>'
      +'<div class="sc-conf"><div class="sc-conf-bar"><div class="sc-conf-fill" style="width:'+Math.min(100,conf)+'%;background:'+confColor+'"></div></div></div>'
      +'<div class="sc-reasons">'+s.reasons.map(function(r){return'&bull; '+esc(r)}).join('<br>')+'</div>'
      +(s.whaleText?'<div class="sc-whale '+whaleClass+'">'+esc(s.whaleText)+'</div>':'')
      +forecastHtml
      +learnHtml
      +'<div class="sc-master"><span class="sc-master-label">Master</span><span class="sc-master-signal" style="color:'+(type==='BUY'?'var(--green)':type==='SELL'?'var(--red)':'var(--amber)')+'">'+type+' ('+(s.score>0?'+':'')+s.score+')</span></div>'
      +'<div class="sc-actions"><button class="sc-action-btn" onclick="setSymbol(\''+s.sym+'\');switchTab(\'radar\')">View Chart</button></div>'
      +'</div>';
  }).join('');
}

// ===== SIGNAL COIN ANALYSIS =====
let sigSearchTimer=null;
let sigAnaChart=null;
let sigAnaCandleSeries=null;

function switchSigMode(mode){
  document.querySelectorAll('.sig-mode-tab').forEach(function(t){t.classList.toggle('active',t.dataset.sigmode===mode)});
  $('sigAutoView').style.display=mode==='auto'?'':'none';
  $('sigSearchView').style.display=mode==='search'?'':'none';
  if(mode==='search')$('sigSearchBox').focus();
}

function onSigSearch(val){
  clearTimeout(sigSearchTimer);
  sigSearchTimer=setTimeout(function(){analyzeSigCoin(val)},400);
}

function resolveSigSym(input){
  var s=input.trim().toUpperCase();
  if(!s)return null;
  if(s.endsWith('USDT'))return s;
  var aliases={BTC:'BTCUSDT',ETH:'ETHUSDT',SOL:'SOLUSDT',BNB:'BNBUSDT',XRP:'XRPUSDT',DOGE:'DOGEUSDT',ADA:'ADAUSDT',AVAX:'AVAXUSDT',DOT:'DOTUSDT',LINK:'LINKUSDT',UNI:'UNIUSDT',TRUMP:'TRUMPUSDT',PEPE:'PEPEUSDT',WIF:'WIFUSDT',FLOKI:'FLOKIUSDT',SHIB:'SHIBUSDT',BONK:'BONKUSDT',SUI:'SUIUSDT',ARB:'ARBUSDT',OP:'OPUSDT',NEAR:'NEARUSDT',MATIC:'MATICUSDT',ATOM:'ATOMUSDT',LTC:'LTCUSDT',FIL:'FILUSDT',APT:'APTUSDT',NEIRO:'NEIROUSDT',TREMP:'TREMPUSDT'};
  if(aliases[s])return aliases[s];
  if(typeof COINS!=='undefined'){var found=Object.keys(COINS).find(function(k){return k===s});if(found)return COINS[found].sym}
  return s+'USDT';
}

function analyzeSigCoin(input){
  var sym=resolveSigSym(input);
  if(!sym||sym==='USDT')return;
  var el=$('sigAnalysisResult');
  el.innerHTML='<div style="text-align:center;padding:40px;color:var(--dim)">Analyzing '+baseOf(sym)+'...</div>';
  var tfs=['1h','4h','1d'];
  var tfLabels=['1H','4H','1D'];
  var tfPromises=tfs.map(function(tf){
    return jget('https://api.binance.com/api/v3/klines?symbol='+sym+'&interval='+tf+'&limit=120').then(function(data){
      var candles=data.map(function(k){return{t:k[0],o:+k[1],h:+k[2],l:+k[3],c:+k[4],v:+k[5]}});
      var closes=candles.map(function(c){return c.c});
      var vols=candles.map(function(c){return c.v});
      var a=aiComposite(candles,closes,vols);
      var fc=forecastFrom(closes);
      var sc=scoreTimeframe(candles);
      return{tf:tf,label:tfLabels[tfs.indexOf(tf)],candles:candles,closes:closes,a:a,fc:fc,sc:sc};
    }).catch(function(){return{tf:tf,label:tfLabels[tfs.indexOf(tf)],candles:[],closes:[],a:null,fc:null,sc:null}});
  });
  var newsPromise=jget('https://cryptocurrency.cv/api/news?coin='+baseOf(sym).toLowerCase()).catch(function(){return{articles:[]}});
  var whalePromise=getWhaleFlow(sym);
  Promise.all(tfPromises.concat([newsPromise,whalePromise])).then(function(results){
    var tfData=results.slice(0,3);
    var newsResult=results[3];
    var whale=results[4];
    var t=state.tickers[sym];
    var lastClose=tfData[0].closes.length?tfData[0].closes[tfData[0].closes.length-1]:(t?t.last:0);
    var masterScore=0,masterType='WAIT',tfHtml='',reasons=[];
    tfData.forEach(function(d,i){
      if(!d.sc){tfHtml+='<div class="sig-tf-card"><div class="stc-tf">'+d.label+'</div><div class="stc-signal" style="color:var(--dim)">N/A</div></div>';return}
      var sc=d.sc;
      var tp=sc.score>15?'BUY':sc.score<-15?'SELL':'WAIT';
      var tc=tp==='BUY'?'color:var(--green)':tp==='SELL'?'color:var(--red)':'color:var(--amber)';
      var weight=i===0?0.40:i===1?0.35:0.25;
      masterScore+=sc.score*weight;
      if(sc.reasons.length)reasons.push(sc.reasons[0]);
      tfHtml+='<div class="sig-tf-card">'
        +'<div class="stc-tf">'+d.label+'</div>'
        +'<div class="stc-signal" style="'+tc+'">'+tp+'</div>'
        +'<div class="stc-score">'+(sc.score>0?'+':'')+sc.score+'</div>'
        +'<div class="stc-reason">'+sc.reasons.slice(0,2).join(' · ')+'</div>'
        +'</div>';
    });
    masterScore=Math.round(masterScore);
    if(whale&&whale.imbalance){
      var ws=Math.round(whale.imbalance*15);
      masterScore+=ws;
      if(whale.imbalance>0.15)reasons.push('Whale accumulation');
      else if(whale.imbalance<-0.15)reasons.push('Whale distribution');
    }
    masterScore=Math.max(-100,Math.min(100,masterScore));
    masterType=masterScore>15?'LONG':masterScore<-15?'SHORT':'NO TRADE';
    var vc=masterType==='LONG'?'sv-bull':masterType==='SHORT'?'sv-bear':'sv-none';
    var chg=t?chgHtml(t.pct):'';
    var newsItems=(newsResult&&newsResult.articles)?newsResult.articles.slice(0,5):[];
    var newsHtml=newsItems.map(function(n){return'<div class="sig-news-item"><a class="snb" href="'+esc(n.link||n.url||'#')+'" target="_blank" rel="noopener" style="cursor:pointer">'+esc(n.title||'')+'</a><br><span style="color:var(--dim);font-size:11px">'+esc(n.source||'')+' · '+esc(n.timeAgo||n.pubDate||'')+'</span></div>'}).join('');
    var whaleHtml='';
    if(whale&&whale.buyUsd){
      whaleHtml='<div style="margin-top:14px;padding:10px;background:var(--card2);border:1px solid var(--border);border-radius:9px">'
        +'<div style="font-size:11px;font-weight:700;margin-bottom:6px">Whale Flow (Last 500 Trades)</div>'
        +'<div style="display:flex;gap:14px;font-family:var(--mono);font-size:12px">'
        +'<span style="color:var(--green)">Buy: $'+cfmt(whale.buyUsd)+'</span>'
        +'<span style="color:var(--red)">Sell: $'+cfmt(whale.sellUsd)+'</span>'
        +'<span style="color:var(--dim)">Imbalance: '+(whale.imbalance>0?'+':'')+(whale.imbalance*100).toFixed(1)+'%</span>'
        +'</div></div>';
    }
    var html='<div class="sig-analysis">'
      +'<div class="sig-ana-head"><span class="sig-ana-coin">'+baseOf(sym)+'/USDT</span><span class="sig-ana-price" style="color:'+(t&&t.pct>=0?'var(--green)':'var(--red)')+'">'+(t?'$'+pfmt(t.last):'--')+' '+chg+'</span></div>'
      +'<div class="sig-ana-chart" id="sigAnaChartWrap"></div>'
      +'<div class="sig-tf-grid">'+tfHtml+'</div>'
      +'<div class="sig-verdict '+vc+'"><div class="sv-label">MASTER VERDICT</div><div class="sv-type">'+masterType+' ('+(masterScore>0?'+':'')+masterScore+')</div><div class="sv-reason">'+reasons.slice(0,4).join(' · ')+'</div></div>'
      +whaleHtml
      +(newsHtml?'<div style="margin-top:14px"><div style="font-size:11px;font-weight:700;margin-bottom:6px">Related News</div><div class="sig-news-list">'+newsHtml+'</div></div>':'')
      +'<div class="disclaimer" style="margin-top:14px">Analysis from multi-indicator confluence across multiple timeframes. Not financial advice.</div>'
      +'</div>';
    el.innerHTML=html;
    setTimeout(function(){renderSigAnaChart(tfData[0].candles,sym)},100);
  }).catch(function(e){
    console.warn('Analysis failed:',e);
    el.innerHTML='<div style="text-align:center;padding:40px;color:var(--dim)"><b style="color:var(--red)">Analysis Failed</b><br><span style="font-size:12px;margin-top:6px;display:block">Could not load data for '+baseOf(sym)+'. Check the symbol and try again.</span></div>';
  });
}

function renderSigAnaChart(candles,sym){
  var el=$('sigAnaChartWrap');
  if(!el||!window.LightweightCharts||!candles.length)return;
  try{
    var th=chartTheme();
    var c=LightweightCharts.createChart(el,{width:el.clientWidth,height:300,layout:{background:{type:'solid',color:th.bg},textStyle:{color:th.txt}},grid:{vertLines:{color:th.grid},horzLines:{color:th.grid}},crosshair:{mode:0},rightPriceScale:{borderColor:th.border},timeScale:{timeVisible:true,secondsVisible:false}});
    var cs=c.addCandlestickSeries({upColor:th.up,downColor:th.dn,borderVisible:false,wickUpColor:th.up,wickDownColor:th.dn});
    cs.setData(candles.map(mapCandle));
    c.timeScale().fitContent();
    new ResizeObserver(function(){if(el.clientWidth)c.applyOptions({width:el.clientWidth})}).observe(el);
    sigAnaChart=c;sigAnaCandleSeries=cs;
  }catch(e){console.warn('sigAnaChart',e)}
}

// ===== MEME COIN UNIVERSE =====
const MEME_UNIVERSE=['PEPEUSDT','WIFUSDT','FLOKIUSDT','SHIBUSDT','BONKUSDT','DOGEUSDT','TRUMPUSDT','NEIROUSDT','BOMEUSDT','MEMEUSDT','ORDIUSDT','DOGSUSDT','HMSTRUSDT','ACTUSDT','TURBOUSDT','GALAUSDT','SANDUSDT','NOTUSDT','TONUSDT','1000SATSUSDT'];

function renderMemeUniverse(){
  const rows=MEME_UNIVERSE.map(function(sym){
    const t=state.tickers[sym];
    const base=sym.replace('USDT','');
    if(!t)return'';
    const sg=sigOf(t.pct);
    return'<tr data-sym="'+sym+'">'
      +'<td><div class="coin-cell"><div class="coin-ci" style="color:var(--pink);border-color:rgba(255,64,129,.3)">'+base.charAt(0)+'</div><div class="coin-nm"><div class="cn">'+esc(base)+'</div><div class="cs">'+base+'/USDT</div></div></div></td>'
      +'<td>$'+pfmt(t.last)+'</td>'
      +'<td>'+chgHtml(t.pct)+'</td>'
      +'<td class="vol-dim">'+cfmt(t.qvol)+'</td>'
      +'<td><span class="badge '+sg[1]+'">'+sg[0]+'</span></td>'
      +'<td><button class="sc-action-btn" onclick="setSymbol(\''+sym+'\');switchTab(\'radar\')" style="font-size:10px;padding:3px 8px">Chart</button></td>'
      +'</tr>';
  }).filter(Boolean).join('');
  $('memeBody').innerHTML=rows;
  $('memeCount').textContent=MEME_UNIVERSE.filter(function(s){return state.tickers[s]}).length+' MEME COINS';
}

// ===== CRYPTO BUBBLES =====
const BUB_MAJORS=['BTC','ETH','SOL','BNB','XRP','ADA','DOGE','AVAX','DOT','LINK','UNI','SUI'];
const BUB_MEMES=['DOGE','PEPE','WIF','FLOKI','SHIB','BONK','TRUMP'];
function bubFilterSet(){
  const f=state.bubFilter||'all';
  if(f==='major')return BUB_MAJORS;
  if(f==='meme')return BUB_MEMES;
  return null;
}
function renderBubbles(){
  const wrap=$('bubWrap');
  if(!wrap)return;
  const keys=bubFilterSet();
  const items=[];
  Object.keys(COINS).forEach(function(k){
    if(keys&&keys.indexOf(k)===-1)return;
    const t=state.tickers[COINS[k].sym];
    if(!t||!isFinite(t.last)||!(t.qvol>0))return;
    items.push({k:k,sym:COINS[k].sym,name:COINS[k].name,icon:COINS[k].icon,last:t.last,pct:t.pct,qvol:t.qvol});
  });
  items.sort(function(a,b){return b.qvol-a.qvol});
  const cnt=$('bubCount');
  if(!items.length){
    wrap.innerHTML='<div class="bub-empty">Loading live prices…</div>';
    if(cnt)cnt.textContent='—';
    return;
  }
  const maxQ=items[0].qvol;
  const minS=46,maxS=118;
  const up=items.filter(function(i){return i.pct>=0}).length;
  if(cnt)cnt.textContent=items.length+' COINS · '+up+' ▲';
  wrap.innerHTML=items.map(function(it,i){
    const size=Math.round(minS+(maxS-minS)*Math.sqrt(Math.max(0,it.qvol)/maxQ));
    const gain=it.pct>=0;
    const my=((i*37)%16)-8;
    const fdur=(4.5+((i*13)%28)/10).toFixed(1);
    const fdel=((i*97)%40)/10;
    const pctTxt=(it.pct>0?'+':'')+it.pct.toFixed(2)+'%';
    const fs=Math.max(9,Math.round(size*0.135));
    return'<div class="bub '+(gain?'b-g':'b-r')+'" data-sym="'+it.sym+'" title="'+esc(it.name)+' · 24h '+pctTxt+' · vol '+cfmt(it.qvol)+'" style="width:'+size+'px;height:'+size+'px;--my:'+my+'px;--fdur:'+fdur+'s;--fdel:'+fdel+'s">'
      +'<div class="bub-sym" style="font-size:'+fs+'px">'+it.icon+' '+esc(it.k)+'</div>'
      +'<div class="bub-pct">'+pctTxt+'</div>'
      +'</div>';
  }).join('');
}
function initBubbles(){
  renderBubbles();
  document.querySelectorAll('.bub-f').forEach(function(btn){
    btn.addEventListener('click',function(){
      state.bubFilter=btn.dataset.f;
      document.querySelectorAll('.bub-f').forEach(function(b){b.classList.toggle('on',b===btn)});
      renderBubbles();
    });
  });
  document.addEventListener('click',function(e){
    const b=e.target.closest('.bub');
    if(!b)return;
    setSymbol(b.dataset.sym);
    switchTab('radar');
  });
}

// ===== LIVE LIQUIDATION HEAT MAP =====
const hm={
  sym:null,
  hist:[],
  lastMark:null,
  lastOIN:null,
  sweepAt:0,
  rows:65,
  range:6,
  cap:110
};
function hmCurMark(){
  if(state.fr&&isFinite(+state.fr.markPrice))return +state.fr.markPrice;
  const t=state.tickers[state.symbol];
  if(t&&isFinite(+t.last))return +t.last;
  const c=state.candles[state.candles.length-1];
  return c?+c.c:null;
}
function hmBreadth(){
  let adv=0,dec=0,total=0;
  Object.keys(COINS).forEach(function(k){
    const t=state.tickers[COINS[k].sym];
    if(!t||!isFinite(t.pct))return;
    total++;
    if(t.pct>0.005)adv++;
    else if(t.pct<-0.005)dec++;
  });
  return total?{adv:adv,dec:dec,total:total,net:(adv-dec)/total}:null;
}
function hmMetrics(){
  const mark=hmCurMark();
  const oin=state.oi&&isFinite(+state.oi.openInterest)?(+state.oi.openInterest*mark):null;
  const atrPct=state._atr&&mark?(state._atr/mark*100):null;
  const br=hmBreadth();
  const oiF=oin?Math.max(0.5,Math.min(1.8,Math.log10(oin)/9)):0.85;
  const atrF=atrPct?Math.max(0.6,Math.min(1.5,atrPct/1.5)):0.9;
  const mom=hm.lastMark&&mark?((mark/hm.lastMark-1)*100):0;
  const momF=Math.max(-1,Math.min(1,mom*6));
  const bf=br?Math.max(-1,Math.min(1,br.net*3)):0;
  const stress=Math.round(Math.max(0,Math.min(100,35+((oiF-1)*38)+(atrF-1)*28+(Math.abs(bf))*30+(Math.abs(momF))*22)));
  const sign=stress>=55?'HIGH':stress>=35?'ELEVATED':'NORMAL';
  return{mark:mark,oin:oin,atrPct:atrPct,br:br,oiF:oiF,atrF:atrF,mom:mom,stress:stress,sign:sign};
}
function hmSweep(){
  const mark=hmCurMark();
  if(!isFinite(mark))return;
  if(hm.sym!==state.symbol){hm.sym=state.symbol;hm.hist=[];hm.lastMark=mark;hm.lastOIN=null;}
  const m=hmMetrics();
  const rows=hm.rows,range=hm.range;
  const sigma=Math.max(0.7,m.atrPct?m.atrPct*1.5:0.9);
  const pulse=0.12+0.1*Math.sin(Date.now()/2600);
  const momF=Math.max(-1,Math.min(1,m.mom*6));
  const bf=m.br?m.br.net:0;
  const gBoost=Math.max(-0.4,Math.min(0.7,0.42*(-momF)+0.30*(-bf)));
  const rBoost=Math.max(-0.4,Math.min(0.7,0.42*(momF)+0.30*(bf)));
  const lo=[],hi=[];
  for(let i=0;i<rows;i++){
    const pct=range-(i/(rows-1))*2*range;
    const dist=Math.abs(pct);
    const k=Math.exp(-dist/sigma);
    const jit=0.85+Math.random()*0.3;
    let lv=k*(m.oiF*(0.6+pulse))*jit*(1+gBoost);
    let hv=k*(m.oiF*(0.6+pulse))*jit*(1+rBoost);
    if(pct>=0)lv*=0.18;
    if(pct<0)hv*=0.18;
    lo.push(Math.max(0,Math.min(1,lv)));
    hi.push(Math.max(0,Math.min(1,hv)));
  }
  hm.hist.push({t:Date.now(),lo:lo,hi:hi,mark:mark});
  if(hm.hist.length>hm.cap)hm.hist.shift();
  hm.lastMark=mark;
  if(isFinite(m.oin||NaN))hm.lastOIN=m.oin;
}
function cssRGB(cs,prop){
  const s=cs.getPropertyValue(prop).trim();
  const parts=s.split(/\s+/).map(Number);
  if(parts.length>=3&&parts[0]>=0&&parts[1]>=0&&parts[2]>=0&&parts.every(isFinite))return parts.slice(0,3);
  return[0,230,118];
}
function hexRGB(hex){
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex).trim());
  if(!m)return[255,179,0];
  return[parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16)];
}
function hmFillRect(c2,x,y,wd,ht,rgb,a){
  if(a<=0.02)return;
  c2.fillStyle='rgba('+rgb[0]+','+rgb[1]+','+rgb[2]+','+Math.min(0.95,a).toFixed(3)+')';
  c2.fillRect(x,y,wd,ht);
}
function hmRender(){
  if(!hm.hist.length)return;
  const cv=$('hmCanvas');
  if(!cv)return;
  const dpr=window.devicePixelRatio||1;
  const w=cv.clientWidth||0;
  const th=cv.clientHeight||0;
  if(!w||!th)return;
  if(cv.width!==Math.round(w*dpr)||cv.height!==Math.round(th*dpr)){
    cv.width=Math.round(w*dpr);
    cv.height=Math.round(th*dpr);
  }
  const c2=cv.getContext('2d');
  c2.setTransform(dpr,0,0,dpr,0,0);
  c2.clearRect(0,0,w,th);
  const cs=getComputedStyle(document.documentElement);
  const g=cssRGB(cs,'--gRGB');
  const r=cssRGB(cs,'--rRGB');
  const amber=hexRGB(cs.getPropertyValue('--amber').trim()||'#FFB300');
  const n=hm.cap;
  const colW=w/n;
  const rows=hm.rows;
  const cellH=th/rows;
  const lastMark=hm.hist[hm.hist.length-1].mark;
  hm.hist.forEach(function(col,cx){
    const ageF=0.55+0.45*(cx/(n-1));
    const x=cx*colW;
    const shiftPx=lastMark?(((lastMark-col.mark)/lastMark)*100/(2*hm.range))*th:0;
    for(let i=0;i<rows;i++){
      const y=i*cellH+shiftPx;
      const lv=col.lo[i]*ageF;
      const hv=col.hi[i]*ageF;
      if(lv>0.02)hmFillRect(c2,x,y,colW+1.5,cellH+0.5,g,lv);
      if(hv>0.02)hmFillRect(c2,x,y,colW+1.5,cellH+0.5,r,hv);
    }
  });
  c2.strokeStyle='rgba(143,163,191,.13)';
  c2.lineWidth=1;
  for(let g2=-4;g2<=4;g2+=2){
    const gy=(1-(g2+hm.range)/(2*hm.range))*th;
    c2.beginPath();c2.moveTo(0,gy);c2.lineTo(w,gy);c2.stroke();
  }
  const markY=th/2;
  c2.strokeStyle='rgba(255,179,0,.85)';
  c2.setLineDash([4,4]);
  c2.beginPath();c2.moveTo(0,markY);c2.lineTo(w,markY);c2.stroke();
  c2.setLineDash([]);
  c2.font='600 10px Inter,system-ui,sans-serif';
  c2.fillStyle='rgba(255,179,0,.95)';
  const lbl='MARK $'+pfmt(lastMark);
  c2.fillText(lbl,w-c2.measureText(lbl).width-6,markY-5);
  const newest=hm.hist.length-1;
  c2.fillStyle='rgba(143,163,191,.25)';
  c2.fillRect(newest*colW,0,Math.max(2,colW*0.4),th);
}
function hmMetaTxt(){
  const m=hmMetrics();
  const oiEl=$('hmOI'),stEl=$('hmStress'),brEl=$('hmBreadth'),upEl=$('hmUpd'),symEl=$('liqHmSym');
  if(symEl)symEl.textContent=state.symbol;
  if(oiEl){
    let html='OI <b>'+(m.oin?cfmt(m.oin):'—')+'</b>';
    if(hm.lastOIN&&m.oin&&isFinite(hm.lastOIN)){
      const d=(m.oin/hm.lastOIN-1)*100;
      html+=' <span style="color:'+(d>=0?'var(--green)':'var(--red)')+'">'+(d>0?'+':'')+d.toFixed(1)+'%</span>';
    }
    oiEl.innerHTML=html;
  }
  if(stEl){
    const col=m.sign==='HIGH'?'var(--red)':m.sign==='ELEVATED'?'var(--amber)':'var(--green)';
    stEl.innerHTML='Stress <b style="color:'+col+'">'+m.stress+'% · '+m.sign+'</b>';
  }
  if(brEl){
    if(m.br){
      const netPct=m.br.net*100;
      const col=m.br.net>=0?'var(--green)':'var(--red)';
      const sign=m.br.net>=0?'+':'';
      brEl.innerHTML='Breadth <b>'+m.br.adv+'A</b> / <b>'+m.br.dec+'D</b> <span style="color:'+col+';font-weight:700">'+sign+netPct.toFixed(0)+'%</span>';
    }else{
      brEl.textContent='Breadth —';
    }
  }
  if(upEl)upEl.textContent='live · sweep every 4s · '+new Date().toLocaleTimeString();
}
function hmLoop(){
  try{
    const now=Date.now();
    if(state.symbol!==hm.sym){hm.hist=[];hm.sym=state.symbol;}
    if(now>=hm.sweepAt){
      hmSweep();
      hm.sweepAt=now+4000;
    }
    hmMetaTxt();
    hmRender();
  }catch(e){console.warn('heatmap',e)}
}
function initHeatMap(){
  const cv=$('hmCanvas');
  if(!cv)return;
  hm.sweepAt=0;
  hmLoop();
  setInterval(hmLoop,1000);
  if(window.ResizeObserver){
    new ResizeObserver(function(){if(hm.hist.length)hmRender()}).observe(cv.parentElement);
  }
}

// ===== ENHANCED AI CHAT PATTERNS =====
function detectPatterns(closes,vols){
  const patterns=[];
  if(closes.length<20)return patterns;
  const rsi=calcRSI(closes);
  const macd=calcMACD(closes);
  const bb=calcBB(closes);
  const e20=emaArr(closes,20);
  const last=closes[closes.length-1];
  if(rsi<30)patterns.push({type:'bullish',text:'RSI oversold at '+rsi.toFixed(1)+', potential bounce zone',strength:70});
  else if(rsi>70)patterns.push({type:'bearish',text:'RSI overbought at '+rsi.toFixed(1)+', pullback risk',strength:70});
  if(macd.hist>0&&closes[closes.length-2]<closes[closes.length-3])patterns.push({type:'bullish',text:'MACD bullish crossover detected',strength:80});
  if(macd.hist<0&&closes[closes.length-2]>closes[closes.length-3])patterns.push({type:'bearish',text:'MACD bearish crossover detected',strength:80});
  if(bb.pctB<5)patterns.push({type:'bullish',text:'Price touching lower Bollinger band (%B='+(bb.pctB).toFixed(0)+'%), mean reversion setup',strength:65});
  if(bb.pctB>95)patterns.push({type:'bearish',text:'Price at upper Bollinger band (%B='+(bb.pctB).toFixed(0)+'%), stretched',strength:65});
  const recent5=closes.slice(-5);
  const prior5=closes.slice(-10,-5);
  if(recent5[4]>recent5[0]&&prior5[4]<prior5[0])patterns.push({type:'bullish',text:'Higher high after lower low — trend reversal pattern',strength:75});
  if(recent5[4]<recent5[0]&&prior5[4]>prior5[0])patterns.push({type:'bearish',text:'Lower low after higher high — trend reversal pattern',strength:75});
  const volAvg=vols.slice(-20).reduce(function(a,b){return a+b},0)/20;
  const volNow=vols.slice(-3).reduce(function(a,b){return a+b},0)/3;
  if(volNow>volAvg*2&&last>closes[closes.length-2])patterns.push({type:'bullish',text:'Volume spike ('+((volNow/volAvg)*100).toFixed(0)+'% avg) with price up — strong buying',strength:85});
  if(volNow>volAvg*2&&last<closes[closes.length-2])patterns.push({type:'bearish',text:'Volume spike ('+((volNow/volAvg)*100).toFixed(0)+'% avg) with price down — strong selling',strength:85});
  const swingHigh=Math.max.apply(null,closes.slice(-20));
  const swingLow=Math.min.apply(null,closes.slice(-20));
  if(last>swingHigh*0.99&&last<swingHigh*1.01)patterns.push({type:'bullish',text:'Testing 20-bar resistance at $'+pfmt(swingHigh)+', breakout watch',strength:60});
  if(last<swingLow*1.01&&last>swingLow*0.99)patterns.push({type:'bearish',text:'Testing 20-bar support at $'+pfmt(swingLow)+', breakdown risk',strength:60});
  return patterns;
}

function generateSignalSummary(base,ai,fc){
  let s='';
  const patterns=detectPatterns(ai.fc?ai.fc.rows.map(function(r){return r.pred}):[ai.last],state.candles.map(function(c){return c.v}));
  if(patterns.length){
    s+='<b>PATTERN ALERTS:</b><br>';
    patterns.forEach(function(p){
      const icon=p.type==='bullish'?'[BULL]':'[BEAR]';
      const cls=p.type==='bullish'?'hl-g':'hl-r';
      s+='<span class="'+cls+'">'+icon+' '+p.text+'</span> (strength: '+p.strength+'%)<br>';
    });
    s+='<br>';
  }
  if(ai.score>30)s+='<span class="hl-g"><b>STRONG BUY signal</b></span> — Multiple indicators aligned bullish. Consider entry with stop below EMA20.';
  else if(ai.score>10)s+='<span class="hl-g">Mild bullish bias</span> — indicators lean positive but not strongly convictioned. Scale in, don\'t all-in.';
  else if(ai.score<-30)s+='<span class="hl-r"><b>STRONG SELL signal</b></span> — Multiple indicators aligned bearish. Consider reducing exposure or shorting with stop above EMA20.';
  else if(ai.score<-10)s+='<span class="hl-r">Mild bearish bias</span> — indicators lean negative. Reduce position size or wait for confirmation.';
  else s+='<span class="hl-a">NEUTRAL — No clear edge.</span> Wait for a setup rather than forcing a trade.';
  return s;
}

// ===== AUTO-SCAN TIMER =====
let autoScanInterval=null;
function startAutoScan(){
  loadPatternHistory();
  loadModelWeights();
  scanSignals();
  autoScanInterval=setInterval(scanSignals,120000);
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
  init()
}

// keep module-local copies accessible to console debugging
export { switchTab, setSymbol, initChart }
