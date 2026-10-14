from playwright.sync_api import sync_playwright
import json, time, math, re
from urllib.parse import urlparse, parse_qs
now_ms = int(time.time()*1000)
IV = {'1s':1,'1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'3d':259200,'1w':604800,'1M':2592000}
def price_at(sec, seed=0):
    return 77000 + seed*10 + math.sin(sec/9000)*800 + math.sin(sec/700)*120 + ((sec//60)%7-3)*8
def klines(q):
    iv=IV[q['interval'][0]]; limit=int(q.get('limit',['500'])[0]); end=int(q.get('endTime',[now_ms])[0]); sym=q['symbol'][0]; seed=sum(map(ord,sym))%50
    t_end=(end//1000)//iv*iv; rows=[]
    for i in range(limit):
        t=t_end-(limit-1-i)*iv; o=price_at(t,seed); c=price_at(t+iv,seed); h=max(o,c)+abs(math.sin(t))*30+5; l=min(o,c)-abs(math.cos(t))*30-5
        rows.append([t*1000,f"{o:.2f}",f"{h:.2f}",f"{l:.2f}",f"{c:.2f}",f"{40+(t//iv)%25}",t*1000+iv*1000-1,"0",10,"0","0","0"])
    return rows
SYMS=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','SUIUSDT','TRXUSDT','DOTUSDT','LTCUSDT','BCHUSDT','NEARUSDT','APTUSDT']
def route(r):
    u=r.request.url; p=urlparse(u); q=parse_qs(p.query)
    if 'fonts.googleapis' in u: return r.abort()
    if p.path=='/api/v3/klines': return r.fulfill(status=200, content_type='application/json', body=json.dumps(klines(q)))
    if p.path=='/api/v3/ticker/24hr' and 'symbol' in q: return r.fulfill(status=200, content_type='application/json', body=json.dumps({"lastPrice":"77282","priceChangePercent":"0.07","highPrice":"78000","lowPrice":"76000","volume":"1000","quoteVolume":"1470000000"}))
    if p.path=='/api/v3/ticker/24hr': return r.fulfill(status=200, content_type='application/json', body=json.dumps([{"symbol":s,"priceChangePercent":str(6 if s=='SOLUSDT' else 1.2)} for s in SYMS]))
    if p.path=='/api/v3/ticker/price': return r.fulfill(status=200, content_type='application/json', body=json.dumps([{"symbol":s,"price":"77282" if s=='BTCUSDT' else "100"} for s in SYMS]))
    if p.path=='/api/v3/depth': return r.fulfill(status=200, content_type='application/json', body=json.dumps({"lastUpdateId":1,"bids":[[f"{77282-i*0.1:.1f}","0.5"] for i in range(50)],"asks":[[f"{77283+i*0.1:.1f}","0.5"] for i in range(50)]}))
    if p.path=='/api/v3/exchangeInfo': return r.fulfill(status=200, content_type='application/json', body=json.dumps({"symbols":[{"symbol":s,"status":"TRADING","quoteAsset":"USDT"} for s in SYMS]}))
    return r.fulfill(status=500, body='mock: unhandled')
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1600,'height':900}, locale='en-US')
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)[:200]))
    pg.route(re.compile(r'https://(api\.binance\.com|api\.bybit\.com|www\.okx\.com|fapi\.binance\.com|fonts\.googleapis\.com)/.*'), route)
    pg.goto('http://127.0.0.1:5173'); pg.wait_for_timeout(3500)
    # 1) indicator on indicator + volume profile on chart 1
    pg.click('text=Indicators (4)'); pg.wait_for_timeout(300)
    pg.select_option('.menu-add select >> nth=0', 'vp'); pg.click('.menu-add button'); pg.wait_for_timeout(200)
    pg.select_option('.menu-add select >> nth=0', 'ema')
    opts=pg.eval_on_selector_all('.menu-add select >> nth=1 >> option', 'els=>els.map(o=>[o.value,o.textContent])')
    rsi_opt=[v for v,l in opts if 'RSI' in l][0]; pg.select_option('.menu-add select >> nth=1', rsi_opt); pg.click('.menu-add button'); pg.wait_for_timeout(200)
    pg.click('.menu-head button'); pg.wait_for_timeout(800)
    pg.screenshot(path='/tmp/v1_single_vp_indicator_on_indicator.png')
    # 2) custom timeframe 45m
    pg.fill('input[aria-label="Custom timeframe"]', '45m'); pg.press('input[aria-label="Custom timeframe"]', 'Enter'); pg.wait_for_timeout(2000)
    pg.screenshot(path='/tmp/v2_custom_tf_45m.png')
    # 3) range bars
    pg.select_option('.chart-cell select >> nth=0', 'range'); pg.wait_for_timeout(1500)
    pg.screenshot(path='/tmp/v3_range_bars.png')
    pg.select_option('.chart-cell select >> nth=0', 'candles')
    # 4) replay
    pg.click('.chart-cell >> text=Replay'); pg.wait_for_timeout(300); pg.click('.replay >> text=Play'); pg.wait_for_timeout(1500)
    pg.screenshot(path='/tmp/v4_bar_replay.png'); pg.click('.chart-cell >> text=Replay')
    # 5) 40K backfill: scroll left repeatedly
    pg.click('button[title="1 chart"]'); pg.wait_for_timeout(300)
    box=pg.query_selector('.chart-body').bounding_box(); cx=box['x']+box['width']/2; cy=box['y']+box['height']/2
    for i in range(45):
        pg.mouse.move(cx,cy); pg.mouse.down(); pg.mouse.move(cx+900,cy,steps=4); pg.mouse.up(); pg.wait_for_timeout(180)
    pg.wait_for_timeout(1500)
    bars_txt=pg.inner_text('.chart-cell header span[title="Loaded bars / maximum"]'); print('BARS:', bars_txt)
    pg.screenshot(path='/tmp/v5_history_backfill.png')
    # 6) alerts: create price, technical, watchlist; check limit logic via store
    pg.select_option('.alert-form select >> nth=0','price'); pg.fill('.alert-form input[type=number] >> nth=0','70000'); pg.click('text=Create alert'); pg.wait_for_timeout(200)
    pg.select_option('.alert-form select >> nth=0','technical'); pg.fill('.alert-form input[type=number] >> nth=0','30'); pg.click('text=Create alert'); pg.wait_for_timeout(200)
    pg.select_option('.alert-form select >> nth=0','watchlist'); pg.fill('.alert-form input[type=number] >> nth=0','5'); pg.click('text=Create alert'); pg.wait_for_timeout(200)
    # bulk-add via persisted store to prove the 1000/1000/15 caps
    res=pg.evaluate("""() => { const raw=JSON.parse(localStorage.getItem('liquidity-radar-alerts-v1')); const st=raw.state; const mk=(kind,i)=>({id:'bulk-'+kind+i,kind,name:kind+' '+i,enabled:true,createdAt:0,condition:kind==='watchlist'?'any_pct_24h_above':kind==='price'?'above':'rsi_above',value:1,once:false,triggerCount:0,symbol:'BTC-USDT',watchlistId:'default'});
      for(let i=0;i<997;i++) st.rules.push(mk('price',i)); for(let i=0;i<999;i++) st.rules.push(mk('technical',i)); for(let i=0;i<14;i++) st.rules.push(mk('watchlist',i)); localStorage.setItem('liquidity-radar-alerts-v1',JSON.stringify(raw)); return st.rules.length; }""")
    print('rules after bulk:', res)
    pg.reload(); pg.wait_for_timeout(3000)
    pg.select_option('.alert-form select >> nth=0','watchlist'); pg.fill('.alert-form input[type=number] >> nth=0','9'); pg.click('text=Create alert'); pg.wait_for_timeout(300)
    print('ALERT HEADER:', pg.inner_text('section[aria-label="Alerts"] header'))
    print('ALERT MSG:', pg.inner_text('.alert-form span.muted >> nth=-1'))
    pg.wait_for_timeout(1500)
    pg.screenshot(path='/tmp/v6_alerts_limits.png')
    # 7) 16 charts
    pg.click('button[title="16 charts"]'); pg.wait_for_timeout(5000)
    print('HDR:', pg.inner_text('section[aria-label="Charts"] > header'))
    print('cells:', pg.eval_on_selector_all('.chart-cell','e=>e.length'), 'canvases:', pg.eval_on_selector_all('.chart-cell canvas','e=>e.length'))
    pg.screenshot(path='/tmp/v7_16_charts.png')
    # 8) mobile
    pg.click('button[title="4 charts"]'); pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(2000); pg.screenshot(path='/tmp/v8_mobile.png', full_page=False)
    print('PAGE ERRORS:', errs[:5])
    b.close()
