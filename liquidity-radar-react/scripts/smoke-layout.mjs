// Browser scenario test for the multi-chart layout's active chart.
//
// One toolbar drives the active chart: clicking a layout cell makes the main
// chart take over that cell's coin, timeframe, style and indicators and move
// into its grid position. This drives the built app (dist/) in headless
// Chrome through the scenarios below and asserts on the DOM and on what is
// persisted in localStorage. Market data comes from live public APIs.
//
//   npm run build && npm run smoke:layout
//
// Server and Chrome discovery mirror scripts/smoke.mjs.
import http from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(__dirname, '..', 'dist')
const PORT = 8718
const ORIGIN = `http://127.0.0.1:${PORT}`
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
}
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
          ]
  const found = candidates.find((p) => existsSync(p))
  if (!found)
    throw new Error('No Chrome/Chromium found. Set CHROME_PATH env var to your browser executable.')
  return found
}
const CHROME = findChrome()
if (!existsSync(DIST)) throw new Error('dist/ not found — run `npm run build` first')

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0])
  const file = resolve(DIST, pathname === '/' ? 'index.html' : pathname.slice(1))
  if (!file.startsWith(DIST + '\\') && !file.startsWith(DIST + '/')) {
    res.writeHead(403)
    res.end()
    return
  }
  if (!existsSync(file)) {
    res.writeHead(404)
    res.end('nf')
    return
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
  createReadStream(file).pipe(res)
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Third-party feed noise (CORS, rate limits, blocked hosts) is not an app bug.
const EXTERNAL_NOISE = [
  'faireconomy.media',
  'xoomar',
  'Failed to load resource',
  'net::ERR_FAILED',
  'Access to fetch at',
  'ERR_CERT',
  'net::ERR_CONNECTION',
  'ERR_ABORTED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_INTERNET_DISCONNECTED',
  'rss2json',
]
const isNoise = (m) => EXTERNAL_NOISE.some((p) => m.includes(p))
// Chrome logs a console error when a socket the app is tearing down (coin or
// interval switch) gets a server ping after close, or is closed while still
// connecting. Browser-level socket lifecycle: counted and reported, not failed.
const WS_LIFECYCLE = [
  'Ping received after close',
  'WebSocket is closed before the connection is established',
]
const isWsLifecycle = (m) =>
  m.includes('WebSocket connection to') && WS_LIFECYCLE.some((p) => m.includes(p))
const wsLifecycle = []

// Errors seen since the current scenario started, and over the whole run.
let scenarioErrors = []
const allErrors = []
const noise = []
function recordError(msg) {
  if (isWsLifecycle(msg)) {
    wsLifecycle.push(msg)
    return
  }
  if (isNoise(msg)) {
    noise.push(msg)
    return
  }
  scenarioErrors.push(msg)
  allErrors.push(msg)
}

// Seeded companions with distinct coins, intervals and styles, so a takeover
// is visible on every axis.
const SEED_CELLS = [
  null,
  { sym: 'ETHUSDT', tf: '1h', style: 'candle' },
  { sym: 'SOLUSDT', tf: '4h', style: 'line' },
  { sym: 'BNBUSDT', tf: '5m', style: 'bar' },
]

const results = []
let page
let browser

/** Run one scenario: checks are [name, ok, detail]; any throw fails it. */
async function scenario(id, name, fn) {
  scenarioErrors = []
  const checks = []
  const check = (label, ok, detail) => checks.push({ label, ok: !!ok, detail })
  let fatal = null
  try {
    await fn(check)
  } catch (e) {
    fatal = String((e && e.stack) || e)
      .split('\n')
      .slice(0, 3)
      .join(' | ')
  }
  await sleep(300)
  const errs = scenarioErrors.slice()
  check('no console/page errors', errs.length === 0, errs.slice(0, 5))
  const ok = !fatal && checks.every((c) => c.ok)
  results.push({ id, name, ok, checks, fatal, errors: errs })
  console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${id}. ${name}`)
  if (fatal) console.log('    FATAL: ' + fatal)
  for (const c of checks)
    console.log(
      `    ${c.ok ? 'ok  ' : 'FAIL'} ${c.label}` +
        (c.ok || c.detail === undefined ? '' : '  -> ' + JSON.stringify(c.detail).slice(0, 400)),
    )
}

// ---------- page helpers ----------

/** Everything the assertions look at, in one read. */
function snap() {
  return page.evaluate(() => {
    const ls = (k) => {
      try {
        return JSON.parse(localStorage.getItem(k))
      } catch (e) {
        return localStorage.getItem(k)
      }
    }
    const wrap = document.getElementById('chartWrap')
    const cells = [...document.querySelectorAll('#chartLayout > .rc-cell')].map((el) => {
      const r = el.getBoundingClientRect()
      return {
        pos: Number(el.style.order),
        title: (el.querySelector('.rc-title')?.textContent || '').trim(),
        meta: (el.querySelector('.rc-meta')?.textContent || '').trim(),
        hasSelect: !!el.querySelector('select'),
        w: Math.round(r.width),
        h: Math.round(r.height),
      }
    })
    cells.sort((a, b) => a.pos - b.pos)
    const card = document.getElementById('radarChartCard')
    const coinLabel = (
      card?.querySelector('.chart-toolbar .coin-picker .cp-trigger .cp-id b')?.textContent || ''
    ).trim()
    return {
      tab: document.querySelector('.tab-section.active')?.id || '',
      cardHost: card?.parentElement?.id || '',
      wrapOrder: wrap ? wrap.style.order : null,
      wrapActive: !!wrap?.classList.contains('is-active'),
      multi: !!document.getElementById('chartLayout')?.classList.contains('multi'),
      cells,
      sym: document.getElementById('symSelect')?.value || '',
      coinLabel,
      chartTitle: (document.getElementById('chartTitle')?.textContent || '').trim(),
      tfBtn: document.querySelector('#tfSwitch .tf-btn.active')?.getAttribute('data-tf') || '',
      lsTf: localStorage.getItem('lr-tf'),
      style: (ls('lr-chartPrefs') || {}).style || 'candle',
      layout: ls('lr-chartLayout'),
      mainInd: ls('lr-chartIndicators'),
      panelInd: ls('lr-panelIndicators-v1'),
      fs: document.documentElement.classList.contains('radar-fs'),
      legend: (document.getElementById('legendOHLC')?.textContent || '').trim().slice(0, 120),
    }
  })
}

const baseOf = (sym) => String(sym).replace(/USDT$/, '')
const cellAt = (s, pos) => s.cells.find((c) => c.pos === pos)
/** Title like "◆ SOL/USDT" -> "SOLUSDT". */
const symOfTitle = (t) => {
  const m = /([A-Z0-9]+)\/USDT/.exec(t || '')
  return m ? m[1] + 'USDT' : ''
}
const indCount = (v) => (Array.isArray(v) ? v.length : 0)

async function waitFor(fn, timeout = 8000, step = 150) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < timeout) {
    last = await fn()
    if (last) return last
    await sleep(step)
  }
  return last
}

async function gotoCharts() {
  await page.evaluate(() => {
    const b = document.querySelector('.tab-btn[data-tab="multichart"]')
    if (b) b.click()
  })
  await waitFor(() =>
    page.evaluate(
      () => document.getElementById('radarChartCard')?.parentElement?.id === 'chartHostCharts',
    ),
  )
  await sleep(400)
}

async function setLayoutN(n) {
  await page.click('#radarChartCard .layout-btn')
  await page.waitForSelector('.layout-menu .layout-opt', { timeout: 4000 })
  await page.evaluate((n) => {
    const opt = [...document.querySelectorAll('.layout-menu .layout-opt')].find(
      (b) => (b.querySelector('.layout-opt-n')?.textContent || '').trim() === String(n),
    )
    if (!opt) throw new Error('no layout option ' + n)
    opt.click()
  }, n)
  await sleep(200)
  // Close the menu if it is still up.
  await page.evaluate(() => {
    if (document.querySelector('.layout-menu'))
      document.querySelector('#radarChartCard .layout-btn')?.click()
  })
  await waitFor(async () => (await snap()).cells.length === n - 1, 5000)
  await sleep(300)
}

/** A real mouse click on the companion cell at grid position `pos`. */
async function clickCell(pos, { settle = 600 } = {}) {
  const handles = await page.$$('#chartLayout > .rc-cell')
  for (const h of handles) {
    const order = await h.evaluate((el) => el.style.order)
    if (Number(order) === pos) {
      // Click the header, not the canvas, so chart gestures cannot eat it.
      const head = await h.$('.rc-head')
      await (head || h).click()
      if (settle) await sleep(settle)
      return true
    }
  }
  throw new Error('no companion at position ' + pos)
}

async function pickStyle(name) {
  await page.evaluate(() => {
    const b = document.querySelector('#radarChartCard .style-btn')
    if (!b) throw new Error('no style button')
    b.click()
  })
  await page.waitForSelector('.style-menu .style-opt', { timeout: 4000 })
  await page.evaluate((name) => {
    const opt = [...document.querySelectorAll('.style-menu .style-opt')].find((b) =>
      (b.querySelector('.style-opt-text')?.textContent || b.textContent || '')
        .trim()
        .startsWith(name),
    )
    if (!opt) throw new Error('no style option ' + name)
    opt.click()
  }, name)
  await sleep(300)
  await page.evaluate(() => {
    if (document.querySelector('.style-menu'))
      document.querySelector('#radarChartCard .style-btn')?.click()
  })
  await sleep(200)
}

async function pickCoin(query, sym) {
  await page.click('#radarChartCard .chart-toolbar .coin-picker .cp-trigger')
  await page.waitForSelector('.cp-menu .cp-search', { timeout: 4000 })
  await page.type('.cp-menu .cp-search', query)
  const found = await waitFor(
    () =>
      page.evaluate((sym) => {
        const want = sym.replace(/USDT$/, '')
        const row = [...document.querySelectorAll('.cp-menu .cp-row')].find((r) => {
          const b = r.querySelector('.cp-id b')
          return b && b.textContent.replace(/\s+/g, '') === want + '/USDT'
        })
        if (!row) return false
        row.click()
        return true
      }, sym),
    8000,
  )
  if (!found) throw new Error('coin row not found for ' + sym)
  await sleep(500)
}

async function freshLoad(seed) {
  await page.evaluate((seed) => {
    localStorage.clear()
    for (const [k, v] of Object.entries(seed))
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
  }, seed)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitFor(() =>
    page.evaluate(
      () => !!document.getElementById('chartWrap') && !!document.querySelector('.tab-btn'),
    ),
  )
  await sleep(2500)
}

// ---------- run ----------

server.listen(PORT, async () => {
  let network = 'unknown'
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      defaultViewport: { width: 1400, height: 1000 },
      args: ['--no-sandbox', '--disable-gpu'],
    })
    page = await browser.newPage()
    page.on('pageerror', (e) => recordError('pageerror: ' + e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') recordError('console: ' + m.text().slice(0, 300))
    })

    await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' })
    network = await page
      .evaluate(() =>
        fetch('https://api.binance.com/api/v3/ping')
          .then((r) => (r.ok ? 'online' : 'http ' + r.status))
          .catch((e) => 'offline: ' + e.message),
      )
      .catch((e) => 'probe failed: ' + e.message)
    console.log('network (api.binance.com):', network)

    await freshLoad({
      'lr-tf': '15m',
      'lr-chartPrefs': { style: 'candle' },
      'lr-chartLayout': { n: 1, active: 0, cells: SEED_CELLS },
    })
    await gotoCharts()

    // 1 -------------------------------------------------------------------
    await scenario(1, 'Switch to a 4-chart layout', async (check) => {
      const before = await snap()
      check('starts on the Charts tab', before.tab === 'tab-multichart', before.tab)
      await setLayoutN(4)
      const s = await snap()
      check('3 companion cells + main = 4', s.cells.length === 3, s.cells.length)
      check(
        'positions 1..3 are companions',
        s.cells.map((c) => c.pos).join() === '1,2,3',
        s.cells.map((c) => c.pos),
      )
      check('main chart at order 0', s.wrapOrder === '0', s.wrapOrder)
      check('main chart has is-active', s.wrapActive)
      check('grid is multi', s.multi)
      check(
        'every companion has a title',
        s.cells.every((c) => /\/USDT/.test(c.title)),
        s.cells.map((c) => c.title),
      )
      check(
        'every companion has an interval label',
        s.cells.every((c) => c.meta),
        s.cells.map((c) => c.meta),
      )
      check(
        'companions have no own selects',
        s.cells.every((c) => !c.hasSelect),
      )
      check(
        'seeded companions restored (ETH/SOL/BNB)',
        s.cells.map((c) => symOfTitle(c.title)).join() === 'ETHUSDT,SOLUSDT,BNBUSDT',
        s.cells.map((c) => c.title),
      )
      check('persisted n=4 active=0', s.layout?.n === 4 && s.layout?.active === 0, s.layout)
      check('still on Charts tab', s.tab === 'tab-multichart', s.tab)
    })

    // 2 -------------------------------------------------------------------
    let ctx2 = {}
    await scenario(2, 'Click companion at position 2 makes it active', async (check) => {
      const before = await snap()
      const target = cellAt(before, 2)
      const wantSym = symOfTitle(target.title)
      ctx2 = { prevSym: before.sym, prevTf: before.lsTf, wantSym }
      await clickCell(2, { settle: 1500 })
      const s = await snap()
      check('main chart order becomes 2', s.wrapOrder === '2', s.wrapOrder)
      check('main chart keeps is-active', s.wrapActive)
      check('main symbol = cell 2 coin (' + wantSym + ')', s.sym === wantSym, s.sym)
      check(
        'CoinPicker label shows cell coin',
        s.coinLabel.replace(/\s+/g, '').startsWith(baseOf(wantSym)),
        s.coinLabel,
      )
      check('timeframe = cell 2 interval (4h)', s.lsTf === '4h' && s.tfBtn === '4h', {
        lsTf: s.lsTf,
        tfBtn: s.tfBtn,
      })
      check(
        'chart title reflects 4h',
        /4/.test(s.chartTitle) && /h/i.test(s.chartTitle),
        s.chartTitle,
      )
      check('style = cell 2 style (line)', s.style === 'line', s.style)
      const c0 = cellAt(s, 0)
      check(
        'old main is a companion at position 0',
        !!c0 && symOfTitle(c0.title) === ctx2.prevSym,
        c0,
      )
      check('companion 0 shows old interval', !!c0 && c0.meta === ctx2.prevTf, {
        meta: c0?.meta,
        prevTf: ctx2.prevTf,
      })
      check(
        'companions now at 0,1,3',
        s.cells.map((c) => c.pos).join() === '0,1,3',
        s.cells.map((c) => c.pos),
      )
      check('stays on Charts tab', s.tab === 'tab-multichart', s.tab)
      check('persisted active=2', s.layout?.active === 2, s.layout)
      check(
        'persisted cells[2] = active config',
        s.layout?.cells?.[2]?.sym === wantSym && s.layout?.cells?.[2]?.tf === '4h',
        s.layout?.cells?.[2],
      )
      check(
        'persisted cells[0] = old main',
        s.layout?.cells?.[0]?.sym === ctx2.prevSym && s.layout?.cells?.[0]?.tf === ctx2.prevTf,
        s.layout?.cells?.[0],
      )
    })

    // 3 -------------------------------------------------------------------
    await scenario(3, 'Toolbar timeframe + coin drive only the active chart', async (check) => {
      const before = await snap()
      const compBefore = JSON.stringify(before.cells.map((c) => [c.pos, c.title, c.meta]))
      await page.click('#tfSwitch .tf-btn[data-tf="1h"]')
      await sleep(800)
      let s = await snap()
      check('timeframe changed to 1h', s.lsTf === '1h' && s.tfBtn === '1h', {
        lsTf: s.lsTf,
        tfBtn: s.tfBtn,
      })
      check('main still at order 2', s.wrapOrder === '2', s.wrapOrder)
      check(
        'companions untouched by tf change',
        JSON.stringify(s.cells.map((c) => [c.pos, c.title, c.meta])) === compBefore,
        s.cells,
      )
      await pickCoin('ADA', 'ADAUSDT')
      s = await snap()
      check('main symbol changed to ADAUSDT', s.sym === 'ADAUSDT', s.sym)
      check('CoinPicker label ADA', s.coinLabel.replace(/\s+/g, '').startsWith('ADA'), s.coinLabel)
      check('tab after toolbar coin pick is still Charts', s.tab === 'tab-multichart', s.tab)
      if (s.tab !== 'tab-multichart') await gotoCharts()
      s = await snap()
      check('main still at order 2 after coin pick', s.wrapOrder === '2', s.wrapOrder)
      check(
        'companions untouched by coin change',
        JSON.stringify(s.cells.map((c) => [c.pos, c.title, c.meta])) === compBefore,
        s.cells,
      )
    })

    // 4 -------------------------------------------------------------------
    await scenario(4, 'Indicator follows its cell when the active chart moves', async (check) => {
      // Normalise: Charts tab, cell 2 active.
      let s = await snap()
      if (s.tab !== 'tab-multichart') await gotoCharts()
      const mainBefore = indCount(s.mainInd)
      await page.evaluate(() => {
        const b = document.querySelector('#radarChartCard .ind-open')
        if (!b) throw new Error('no indicator button')
        b.click()
      })
      await page.waitForSelector('.ind-menu .ind-add', { timeout: 5000 })
      const added = await page.evaluate(() => {
        const b = document.querySelector('.ind-menu .ind-add')
        const name = (b.querySelector('.ind-add-name')?.textContent || '').trim()
        b.click()
        return name
      })
      await sleep(400)
      await page.evaluate(() => {
        if (document.querySelector('.ind-menu'))
          document.querySelector('#radarChartCard .ind-open')?.click()
      })
      await sleep(300)
      s = await snap()
      check(
        'indicator "' + added + '" added to main',
        indCount(s.mainInd) === mainBefore + 1,
        s.mainInd,
      )
      const added1 = indCount(s.mainInd)
      check('main at order 2 while adding', s.wrapOrder === '2', s.wrapOrder)

      await clickCell(0, { settle: 1500 })
      s = await snap()
      check('main moved to order 0', s.wrapOrder === '0', s.wrapOrder)
      check('main chart no longer has the indicator', indCount(s.mainInd) === 0, s.mainInd)
      check('lr-panelIndicators-v1.c2 holds it', indCount(s.panelInd?.c2) === added1, s.panelInd)
      check('no stray c0 slot', indCount(s.panelInd?.c0) === 0, s.panelInd)
      check('stays on Charts tab', s.tab === 'tab-multichart', s.tab)

      // And back: the set returns to the main chart.
      await clickCell(2, { settle: 1500 })
      s = await snap()
      check('back on cell 2: main has it again', indCount(s.mainInd) === added1, s.mainInd)
      check('back on cell 2: c2 slot empty', indCount(s.panelInd?.c2) === 0, s.panelInd)
      check('cell 2 kept ADA 1h', s.sym === 'ADAUSDT' && s.lsTf === '1h', {
        sym: s.sym,
        tf: s.lsTf,
      })
      await clickCell(0, { settle: 1200 })
    })

    // 5 -------------------------------------------------------------------
    await scenario(5, 'Chart style follows its cell', async (check) => {
      let s = await snap()
      check('precondition: main at 0', s.wrapOrder === '0', s.wrapOrder)
      const styleCell2 = s.layout?.cells?.[2]?.style
      await pickStyle('Area')
      s = await snap()
      check('active chart style = area', s.style === 'area', s.style)
      await clickCell(2, { settle: 1200 })
      s = await snap()
      check('cell 2 active: style is its own (' + styleCell2 + ')', s.style === styleCell2, s.style)
      check(
        'persisted cells[0].style = area',
        s.layout?.cells?.[0]?.style === 'area',
        s.layout?.cells?.[0],
      )
      await clickCell(0, { settle: 1200 })
      s = await snap()
      check('back on cell 0: style = area', s.style === 'area', s.style)
      check(
        'cells[2].style unchanged',
        s.layout?.cells?.[2]?.style === styleCell2,
        s.layout?.cells?.[2],
      )
    })

    // 6 -------------------------------------------------------------------
    await scenario(6, 'Shrink to 2 charts while position 3 is active', async (check) => {
      await clickCell(3, { settle: 1200 })
      let s = await snap()
      check('precondition: main at order 3', s.wrapOrder === '3', s.wrapOrder)
      const cell0Sym = symOfTitle(cellAt(s, 0)?.title)
      await setLayoutN(2)
      await sleep(1200)
      s = await snap()
      check(
        '1 companion cell (2 charts)',
        s.cells.length === 1,
        s.cells.map((c) => c.pos),
      )
      check('main order is 0 or 1', s.wrapOrder === '0' || s.wrapOrder === '1', s.wrapOrder)
      check(
        'companion takes the other position',
        s.cells.length === 1 && String(s.cells[0].pos) !== s.wrapOrder && s.cells[0].pos < 2,
        s.cells,
      )
      check('persisted n=2, active<2', s.layout?.n === 2 && s.layout?.active < 2, s.layout)
      if (s.wrapOrder === '0')
        check('main shows former cell 0 coin', s.sym === cell0Sym, { sym: s.sym, cell0Sym })
      check(
        'persisted cells[active].sym = main symbol',
        s.layout?.cells?.[s.layout?.active]?.sym === s.sym,
        { cells: s.layout?.cells?.slice(0, 4), sym: s.sym },
      )
      check('main is-active still set', s.wrapActive)
      check('no orphan cells in DOM', (await page.$$('#chartLayout > .rc-cell')).length === 1)
    })

    // 7 -------------------------------------------------------------------
    await scenario(7, 'Reload restores layout; legacy {n,panels} loads', async (check) => {
      await setLayoutN(4)
      await sleep(800)
      await clickCell(2, { settle: 1500 })
      const before = await snap()
      const beforeComp = before.cells.map((c) => [c.pos, symOfTitle(c.title), c.meta])
      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitFor(() => page.evaluate(() => !!document.getElementById('chartWrap')))
      await sleep(3000)
      await gotoCharts()
      await sleep(1500)
      const s = await snap()
      check('layout n=4 restored', s.layout?.n === 4 && s.cells.length === 3, {
        n: s.layout?.n,
        cells: s.cells.length,
      })
      check(
        'active position 2 restored',
        s.wrapOrder === '2' && s.layout?.active === 2,
        s.wrapOrder,
      )
      check(
        'companion configs restored',
        JSON.stringify(s.cells.map((c) => [c.pos, symOfTitle(c.title), c.meta])) ===
          JSON.stringify(beforeComp),
        { before: beforeComp, after: s.cells.map((c) => [c.pos, symOfTitle(c.title), c.meta]) },
      )
      check('active chart coin restored (' + before.sym + ')', s.sym === before.sym, {
        before: before.sym,
        after: s.sym,
      })
      check('active chart interval restored', s.lsTf === before.lsTf, {
        before: before.lsTf,
        after: s.lsTf,
      })
      check('active chart style restored', s.style === before.style, {
        before: before.style,
        after: s.style,
      })
      check(
        'persisted cells[2] still the active config after boot',
        s.layout?.cells?.[2]?.sym === before.sym,
        s.layout?.cells?.[2],
      )
      // Round trip: leave cell 2 and come back; it should still be its coin.
      await clickCell(0, { settle: 1200 })
      await clickCell(2, { settle: 1200 })
      const rt = await snap()
      check(
        'cell 2 keeps its coin across reload + round trip (' + before.sym + ')',
        rt.sym === before.sym,
        {
          after: rt.sym,
          cells2: rt.layout?.cells?.[2],
        },
      )

      // Legacy shape.
      await freshLoad({
        'lr-tf': '15m',
        'lr-chartLayout': {
          n: 4,
          panels: [
            { sym: 'ETHUSDT', tf: '1h' },
            { sym: 'XRPUSDT', tf: '4h' },
            { sym: 'DOGEUSDT', tf: '5m' },
          ],
        },
      })
      await gotoCharts()
      await sleep(1000)
      const l = await snap()
      check('legacy: 3 companions', l.cells.length === 3, l.cells.length)
      check('legacy: main at 0 and active', l.wrapOrder === '0' && l.wrapActive, l.wrapOrder)
      check(
        'legacy: companions ETH 1h / XRP 4h / DOGE 5m',
        JSON.stringify(l.cells.map((c) => [c.pos, symOfTitle(c.title), c.meta])) ===
          JSON.stringify([
            [1, 'ETHUSDT', '1h'],
            [2, 'XRPUSDT', '4h'],
            [3, 'DOGEUSDT', '5m'],
          ]),
        l.cells.map((c) => [c.pos, c.title, c.meta]),
      )
    })

    // 8 -------------------------------------------------------------------
    await scenario(8, 'Rapid clicks between cells settle consistently', async (check) => {
      let s = await snap()
      const allSyms = [s.sym, ...s.cells.map((c) => symOfTitle(c.title))].sort().join()
      const seq = [1, 2, 3, 0, 2, 1, 3]
      let lastWant = ''
      for (const pos of seq) {
        const cur = await snap()
        const c = cellAt(cur, pos)
        if (!c) continue // already the main chart
        lastWant = symOfTitle(c.title)
        await clickCell(pos, { settle: 40 })
      }
      const lastPos = seq[seq.length - 1]
      const clickedAt = Date.now()
      // Off the chart: a hovered bar pins the legend to that bar.
      await page.mouse.move(2, 2)
      await sleep(1500)
      s = await snap()
      check('main at last clicked position', s.wrapOrder === String(lastPos), s.wrapOrder)
      check('main shows last clicked coin (' + lastWant + ')', s.sym === lastWant, s.sym)
      check(
        'CoinPicker label matches',
        s.coinLabel.replace(/\s+/g, '').startsWith(baseOf(lastWant)),
        s.coinLabel,
      )
      const nowSyms = [s.sym, ...s.cells.map((c) => symOfTitle(c.title))].sort().join()
      check('no coin lost or duplicated', nowSyms === allSyms, { before: allSyms, after: nowSyms })
      check('3 companions', s.cells.length === 3, s.cells.length)
      check(
        'persisted layout consistent with DOM',
        s.layout?.active === lastPos &&
          s.layout?.cells?.[lastPos]?.sym === s.sym &&
          s.cells.every((c) => s.layout?.cells?.[c.pos]?.sym === symOfTitle(c.title)),
        s.layout,
      )
      // Stale-response guard: the main chart's candles (its legend shows the
      // last one) must belong to the coin it claims to show.
      const price = await page.evaluate(async (sym) => {
        try {
          const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=' + sym)
          return Number((await r.json()).price)
        } catch (e) {
          return null
        }
      }, s.sym)
      if (!price) {
        console.log('    (skipped candle sanity: no ticker price for ' + s.sym + ')')
        return
      }
      const closeOf = (legend) => {
        const m = /C\s*([\d,]+\.?\d*)/.exec(legend)
        return m ? Number(m[1].replace(/,/g, '')) : null
      }
      const samples = []
      let okAt = null
      while (Date.now() - clickedAt < 20000) {
        const close = closeOf((await snap()).legend)
        samples.push([Date.now() - clickedAt, close])
        if (close && Math.abs(close - price) / price < 0.1) {
          okAt = Date.now() - clickedAt
          break
        }
        await sleep(250)
      }
      console.log(
        '    candle sanity: ' +
          s.sym +
          ' ticker=' +
          price +
          ' first legend close=' +
          samples[0]?.[1] +
          ' matched after ' +
          okAt +
          'ms',
      )
      check('main chart candles end up belonging to ' + s.sym + ' (within 20s)', okAt !== null, {
        price,
        last: samples.slice(-1),
      })
      check(
        'main chart candles match the coin within 5s of the last click',
        okAt !== null && okAt <= 5000,
        {
          msAfterLastClick: okAt,
          firstLegendClose: samples[0]?.[1],
          price,
        },
      )
    })

    // 9 -------------------------------------------------------------------
    await scenario(9, 'Keyboard: Tab to a companion and press Enter', async (check) => {
      await page.focus('#radarChartCard .layout-btn')
      let found = null
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab')
        found = await page.evaluate(() => {
          const a = document.activeElement
          return a && a.classList.contains('rc-cell')
            ? { pos: Number(a.style.order), title: a.querySelector('.rc-title')?.textContent || '' }
            : null
        })
        if (found) break
      }
      check('a companion is reachable by Tab', !!found, found)
      if (!found) return
      const want = symOfTitle(found.title)
      await page.keyboard.press('Enter')
      await sleep(1500)
      const s = await snap()
      check(
        'Enter activates it (order ' + found.pos + ')',
        s.wrapOrder === String(found.pos),
        s.wrapOrder,
      )
      check('main symbol = ' + want, s.sym === want, s.sym)
      check('stays on Charts tab', s.tab === 'tab-multichart', s.tab)
      // Space too.
      await page.focus('#radarChartCard .layout-btn')
      let f2 = null
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab')
        f2 = await page.evaluate(() => {
          const a = document.activeElement
          return a && a.classList.contains('rc-cell') ? Number(a.style.order) : null
        })
        if (f2 !== null) break
      }
      if (f2 !== null) {
        await page.keyboard.press('Space')
        await sleep(1200)
        const s2 = await snap()
        check('Space activates too', s2.wrapOrder === String(f2), { want: f2, got: s2.wrapOrder })
      }
    })

    // 10 ------------------------------------------------------------------
    await scenario(10, 'Full screen and mobile viewport', async (check) => {
      await page.evaluate(() => document.activeElement?.blur())
      await page.keyboard.press('f')
      await sleep(800)
      let s = await snap()
      check('F enters full screen (html.radar-fs)', s.fs, s.fs)
      check(
        'cells visible in full screen',
        s.cells.length === 3 && s.cells.every((c) => c.w > 40 && c.h > 40),
        s.cells,
      )
      const target = s.cells.find((c) => String(c.pos) !== s.wrapOrder)
      const want = symOfTitle(target.title)
      await clickCell(target.pos, { settle: 1500 })
      s = await snap()
      check(
        'click activates a cell in full screen',
        s.wrapOrder === String(target.pos) && s.sym === want,
        {
          order: s.wrapOrder,
          sym: s.sym,
          want,
        },
      )
      check('still full screen after activation', s.fs)
      await page.click('#fsBtn')
      await sleep(800)
      s = await snap()
      check('#fsBtn exits full screen', !s.fs)

      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
      await sleep(1500)
      await gotoCharts()
      s = await snap()
      check(
        'mobile: 3 companions laid out',
        s.cells.length === 3 && s.cells.every((c) => c.w > 20 && c.h > 20),
        s.cells,
      )
      const noHScroll = await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      )
      check('mobile: no horizontal page scroll', noHScroll)
      const t2 = s.cells.find((c) => String(c.pos) !== s.wrapOrder)
      const want2 = symOfTitle(t2.title)
      // Tap, as a phone would.
      const handles = await page.$$('#chartLayout > .rc-cell')
      for (const h of handles) {
        if (Number(await h.evaluate((el) => el.style.order)) === t2.pos) {
          const head = await h.$('.rc-head')
          await (head || h).tap()
          break
        }
      }
      await sleep(1500)
      s = await snap()
      check('mobile: tap activates a cell', s.wrapOrder === String(t2.pos) && s.sym === want2, {
        order: s.wrapOrder,
        sym: s.sym,
        want: want2,
      })
      check('mobile: stays on Charts tab', s.tab === 'tab-multichart', s.tab)
    })

    // 11 ------------------------------------------------------------------
    await scenario(11, 'Crosshair sync: hovering one cell moves the others', async (check) => {
      await page.setViewport({ width: 1400, height: 1000, isMobile: false, hasTouch: false })
      // A known layout: main BTC 15m beside
      // ETH 1h, SOL 4h and BNB 5m (~40h of bars). Hovering near the right edge
      // keeps the hovered time inside every cell; a time before a cell's first
      // bar leaves that cell on its live bar.
      await freshLoad({
        'lr-tf': '15m',
        'lr-chartPrefs': { style: 'candle' },
        'lr-chartLayout': { n: 4, active: 0, cells: SEED_CELLS },
      })
      await gotoCharts()
      const legends = () =>
        page.evaluate(() =>
          [...document.querySelectorAll('#chartLayout > .rc-cell')]
            .sort((a, b) => Number(a.style.order) - Number(b.style.order))
            .map((el) => (el.querySelector('.rc-legend')?.textContent || '').trim()),
        )
      const loaded = await waitFor(async () => {
        const l = await legends()
        return l.length === 3 && l.every((t) => /O.*H.*L.*C/.test(t)) ? l : null
      }, 15000)
      check('3 companion legends show OHLC', !!loaded, await legends())
      if (!loaded) return
      const mainLoaded = await waitFor(async () => /O.*H.*L.*C/.test((await snap()).legend), 15000)
      check('main legend shows OHLC', !!mainLoaded, (await snap()).legend)
      await sleep(1000)
      // Park the mouse off the charts, then read the live legends.
      await page.mouse.move(5, 5)
      await sleep(400)
      const live = await legends()
      const box = await page.evaluate(() => {
        const r = document.getElementById('chart').getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      })
      // Hover, nudging the mouse a pixel at a time until `until` holds (the
      // chart may still be settling its first fit), up to ~3s.
      const hoverAt = async (fx, until = () => true) => {
        const x = box.x + box.w * fx
        const y = box.y + box.h * 0.4
        await page.mouse.move(x, y, { steps: 4 })
        let l = []
        for (let k = 0; k < 8; k++) {
          await sleep(350)
          l = await legends()
          if (until(l)) break
          await page.mouse.move(x + (k % 2 ? 0 : 1), y)
        }
        return l
      }
      const synced = (l) => l.every((t, i) => /O.*H.*L.*C/.test(t) && t !== live[i])
      const a = await hoverAt(0.72, synced)
      check(
        'hovering the main chart switches every companion legend to a past bar',
        synced(a),
        { live, hovered: a },
      )
      const b = await hoverAt(0.6, (l) => l.some((t, i) => t !== a[i]))
      check(
        'a different hovered time shows a different bar',
        b.some((t, i) => t !== a[i]),
        { first: a, second: b },
      )
      await page.mouse.move(5, 5)
      await sleep(500)
      const back = await legends()
      check(
        'leaving the chart hands companions back to the live bar',
        back.every((t, i) => t !== a[i] || t === live[i]),
        { hovered: a, after: back },
      )
      // Hover a companion: the main chart's legend follows.
      const mainLive = (await snap()).legend
      const cell = await page.evaluate(() => {
        const el = document.querySelector('#chartLayout > .rc-cell .rc-body')
        const r = el.getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height }
      })
      await page.mouse.move(cell.x + cell.w * 0.35, cell.y + cell.h * 0.5, { steps: 4 })
      await sleep(400)
      const mainHovered = (await snap()).legend
      check('hovering a companion moves the main legend off the live bar', mainHovered !== mainLive, {
        mainLive,
        mainHovered,
      })
      await page.mouse.move(5, 5)
      await sleep(400)
      // Switched off from the layout menu: hovering leaves the others alone.
      await page.click('#radarChartCard .layout-btn')
      await page.waitForSelector('.layout-menu .layout-sync input', { timeout: 4000 })
      await page.click('.layout-menu .layout-sync input')
      await sleep(200)
      const stored = await page.evaluate(() => localStorage.getItem('lr-crosshairSync'))
      check('toggle persists off', stored === 'false', stored)
      await page.evaluate(() => document.querySelector('#radarChartCard .layout-btn')?.click())
      await sleep(200)
      const liveOff = await legends()
      const off = await hoverAt(0.72)
      check(
        'sync off: companion legends stay live',
        off.every((t, i) => t === liveOff[i] || !a.includes(t)),
        { liveOff, hovered: off },
      )
      await page.mouse.move(5, 5)
      // Back on, for whoever runs next.
      await page.click('#radarChartCard .layout-btn')
      await page.waitForSelector('.layout-menu .layout-sync input', { timeout: 4000 })
      await page.click('.layout-menu .layout-sync input')
      await page.evaluate(() => document.querySelector('#radarChartCard .layout-btn')?.click())
    })
  } catch (e) {
    console.log('FATAL harness error: ' + ((e && e.stack) || e))
    results.push({ id: '-', name: 'harness', ok: false, checks: [], fatal: String(e), errors: [] })
  } finally {
    if (browser) await browser.close()
  }

  console.log('\n--- summary (network: ' + network + ') ---')
  for (const r of results) console.log((r.ok ? 'PASS' : 'FAIL').padEnd(6) + r.id + '. ' + r.name)
  console.log('--- app errors (' + allErrors.length + ') ---')
  allErrors.slice(0, 20).forEach((e) => console.log('  ' + e))
  console.log('--- websocket teardown messages (not failed on): ' + wsLifecycle.length + ' ---')
  wsLifecycle.slice(0, 5).forEach((e) => console.log('  ' + e))
  console.log('--- filtered external noise: ' + noise.length + ' ---')
  server.close()
  process.exit(results.every((r) => r.ok) ? 0 : 1)
})
