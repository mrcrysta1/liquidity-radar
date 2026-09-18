import re, json, time
exec(open('/tmp/verify.py').read().split('with sync_playwright() as p:')[0])
from playwright.sync_api import sync_playwright
from urllib.parse import urlparse, parse_qs, unquote
now=time.time()
def iso(off_h, h=8, m=30): 
    d=time.gmtime(now+off_h*3600); return time.strftime(f'%Y-%m-%dT{h:02d}:{m:02d}:00-04:00', d)
FF=[{"title":"Core CPI m/m","country":"USD","date":iso(-24,8,30),"impact":"High","forecast":"0.3%","previous":"0.2%","actual":"0.4%"},
    {"title":"CPI y/y","country":"USD","date":iso(-24,8,30),"impact":"High","forecast":"2.9%","previous":"2.7%","actual":"2.8%"},
    {"title":"Bank Holiday","country":"JPY","date":iso(0,0,0),"impact":"Holiday"},
    {"title":"German ZEW Economic Sentiment","country":"EUR","date":iso(0,5,0),"impact":"Medium","forecast":"39.5","previous":"34.7","actual":"41.2"},
    {"title":"Retail Sales m/m","country":"USD","date":iso(0,8,30),"impact":"High","forecast":"0.2%","previous":"0.5%"},
    {"title":"Crude Oil Inventories","country":"USD","date":iso(0,10,30),"impact":"Low","forecast":"-1.2M","previous":"3.9M"},
    {"title":"FOMC Statement","country":"USD","date":iso(24,14,0),"impact":"High"},
    {"title":"Federal Funds Rate","country":"USD","date":iso(24,14,0),"impact":"High","forecast":"3.75%","previous":"4.00%"},
    {"title":"FOMC Press Conference","country":"USD","date":iso(24,14,30),"impact":"High"},
    {"title":"Unemployment Claims","country":"USD","date":iso(48,8,30),"impact":"Medium","forecast":"229K","previous":"224K"},
    {"title":"BOE Official Bank Rate","country":"GBP","date":iso(48,7,0),"impact":"High","forecast":"4.00%","previous":"4.00%"},
    {"title":"Monetary Policy Statement","country":"JPY","date":iso(72,0,0),"impact":"High"}]
def rss(name, items):
    return '<?xml version="1.0"?><rss><channel><title>%s</title>%s</channel></rss>'%(name,''.join(f'<item><title>{t}</title><link>https://example.com/{i}</link><pubDate>{time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime(now-i*900))}</pubDate><description>{d}</description></item>' for i,(t,d) in enumerate(items)))
FEEDS={'coindesk':rss('CoinDesk',[('Bitcoin holds above $77K as ETF inflows resume','Spot ETFs recorded net inflows for a third day.'),('SEC delays decision on Solana ETF filings','The agency extended its review window.'),('Binance lists two new perpetual pairs','Trading opens Thursday.')]),
 'cointelegraph':rss('Cointelegraph',[('Ethereum L2 fees hit yearly low after upgrade','Average transaction cost fell below 1 cent.'),('Fed officials signal patience on rate cuts','Markets price a September hold.')]),
 'theblock':rss('The Block',[('Hyperliquid volume tops $10B in 24 hours','Perp DEX market share climbs.')]),
 'fed':rss('Fed',[('Federal Reserve issues FOMC statement','The Committee decided to maintain the target range.')]),
 'sec':rss('SEC',[('SEC charges crypto lending platform with unregistered offering','Complaint filed in SDNY.')])}
def route2(r):
    u=r.request.url
    if '/api/fetch' in u:
        target=unquote(parse_qs(urlparse(u).query)['url'][0])
        if 'faireconomy' in target: return r.fulfill(status=200, content_type='application/json', body=json.dumps(FF))
        for k,v in FEEDS.items():
            if k in target or (k=='fed' and 'federalreserve' in target) or (k=='sec' and 'sec.gov' in target): return r.fulfill(status=200, content_type='application/xml', body=v)
        return r.fulfill(status=502, body='no feed')
    return route(r)
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1600,'height':900}, locale='en-US')
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
    pg.route(re.compile(r'https://(api\.binance\.com|api\.bybit\.com|www\.okx\.com|fapi\.binance\.com|fonts\.googleapis\.com)/.*'), route)
    pg.route(re.compile(r'http://127\.0\.0\.1:5173/api/fetch.*'), route2)
    pg.goto('http://127.0.0.1:5173'); pg.wait_for_timeout(3500)
    pg.screenshot(path='/tmp/u1_terminal.png')
    pg.click('nav.rail button[title="News"]'); pg.wait_for_timeout(2500)
    pg.screenshot(path='/tmp/u2_news.png')
    pg.click('.news-head >> text=Economic calendar'); pg.wait_for_timeout(1200)
    print('ff rows:', pg.eval_on_selector_all('.ff-row','e=>e.length'), 'day headers:', pg.eval_on_selector_all('.ff-day','e=>e.length'))
    pg.screenshot(path='/tmp/u3_calendar.png')
    pg.click('nav.rail button[title="Terminal"]'); pg.wait_for_timeout(800)
    pg.click('.drawer .tabs >> text=News'); pg.wait_for_timeout(1500)
    pg.screenshot(path='/tmp/u4_terminal_news_drawer.png')
    pg.click('.right .tabs >> text=Futures'); pg.wait_for_timeout(500); pg.screenshot(path='/tmp/u5_futures_tab.png')
    pg.set_viewport_size({'width':390,'height':844}); pg.wait_for_timeout(1200); pg.screenshot(path='/tmp/u6_mobile.png')
    pg.click('nav.rail button[title="News"]'); pg.wait_for_timeout(800); pg.click('.news-head >> text=Economic calendar'); pg.wait_for_timeout(800); pg.screenshot(path='/tmp/u7_mobile_calendar.png')
    print('ERRORS:', errs[:3])
    b.close()
