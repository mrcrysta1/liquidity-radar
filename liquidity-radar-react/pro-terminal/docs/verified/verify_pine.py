import re, sys
sys.path.insert(0,'/tmp')
exec(open('/tmp/verify.py').read().split('with sync_playwright() as p:')[0])  # reuse mocks
from playwright.sync_api import sync_playwright
PINE = '''//@version=5
indicator("Custom Squeeze + EMA of RSI", overlay=false)
len = input.int(14, "RSI Length", minval=1)
smooth = input.int(9, "EMA of RSI", minval=1)
src = input.source(close, "Source")
r = ta.rsi(src, len)
e = ta.ema(r, smooth)
col = r > e ? color.green : color.red
plot(r, "RSI", color=col, linewidth=2)
plot(e, "EMA", color=color.orange)
hline(70, "OB", color=color.gray)
hline(30, "OS", color=color.gray)
plotshape(ta.crossover(r, e) and r < 40, "Long", style=shape.triangleup, location=location.belowbar, color=color.green)
plotshape(ta.crossunder(r, e) and r > 60, "Short", style=shape.triangledown, location=location.abovebar, color=color.red)
'''
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1600,'height':900}, locale='en-US')
    errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)[:300]))
    pg.route(re.compile(r'https://(api\.binance\.com|api\.bybit\.com|www\.okx\.com|fapi\.binance\.com|fonts\.googleapis\.com)/.*'), route)
    pg.goto('http://127.0.0.1:5173'); pg.wait_for_timeout(3500)
    pg.evaluate("localStorage.clear()"); pg.reload(); pg.wait_for_timeout(3500)
    pg.click('text=Indicators (4)'); pg.wait_for_timeout(300)
    # search library: add Supertrend, Ichimoku, MACD, Bollinger from search
    for nm in ['Supertrend','Ichimoku','MACD','Bollinger Bands']:
        pg.fill('.menu input[placeholder^="Search"]', nm); pg.wait_for_timeout(150)
        pg.click('.search-list .menu-row:has-text("'+nm+'") button.on >> nth=0'); pg.wait_for_timeout(300)
    n_lib = pg.eval_on_selector_all('.search-list .menu-row','e=>e.length'); pg.fill('.menu input[placeholder^="Search"]',''); pg.wait_for_timeout(100)
    total = pg.eval_on_selector_all('.search-list .menu-row','e=>e.length'); print('search entries:', total)
    # Pine editor: paste custom script, compile, add
    pg.click('.menu-head >> text=Pine editor'); pg.fill('textarea.pine', PINE); pg.click('.menu-add >> text=Compile'); pg.wait_for_timeout(200)
    print('compile msg:', pg.inner_text('.menu-head span.muted'))
    pg.click('.menu-add >> text=Add to chart'); pg.wait_for_timeout(600)
    # syntax error feedback
    pg.fill('textarea.pine', PINE.replace('plot(r, "RSI", color=col, linewidth=2)','plot(r, "RSI", color=col, linewidth=2')); pg.click('.menu-add >> text=Compile'); pg.wait_for_timeout(200)
    print('error shown:', pg.inner_text('.menu .down'))
    # on-chart tab: change input of pine indicator
    pg.click('.menu-head >> text=On chart'); pg.wait_for_timeout(300)
    print('on-chart header:', pg.inner_text('.menu-head'))
    pg.click('.menu-head button:has-text("Close")'); pg.wait_for_timeout(1200)
    print('indicator count btn:', pg.inner_text('.chart-cell header button:has-text("Indicators")'))
    print('panes:', pg.evaluate("() => document.querySelectorAll('.chart-cell table tr').length"))
    pg.screenshot(path='/tmp/p1_pine_applied.png')
    # add 60 more indicators to prove no cap
    pg.click('.chart-cell header button:has-text("Indicators")'); pg.wait_for_timeout(200)
    for i in range(60):
        pg.fill('.menu input[placeholder^="Search"]', 'EMA Ribbon' if i%2 else 'Moving Average ('); pg.wait_for_timeout(60)
        pg.click('.search-list .menu-row button.on >> nth=0'); pg.wait_for_timeout(60)
    pg.click('.menu-head button:has-text("Close")'); pg.wait_for_timeout(2500)
    print('after bulk:', pg.inner_text('.chart-cell header button:has-text("Indicators")'))
    pg.screenshot(path='/tmp/p2_no_limit.png')
    print('PAGE ERRORS:', errs[:3])
    b.close()
