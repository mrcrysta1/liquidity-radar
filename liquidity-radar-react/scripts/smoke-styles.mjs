// Browser test for every chart style in chartStyle.ts CHART_STYLES.
//
// For each style, on the main chart (picked through the ChartStylePicker UI):
//   - no console/page errors;
//   - the plot canvas has real ink in it (sampled pixels, not just a mount);
//   - the OHLC legend follows the crosshair;
//   - 1h, 1D and 1m all load and draw;
//   - ~10s of the live stream on 1m draws without throwing;
//   - a far zoom-out still draws, without long main-thread stalls (measured
//     against Candles in the same run);
//   - switching back to Candles draws candles again.
// Then a 4-chart layout whose companions carry the styles, in dark and light.
// Market data comes from live public APIs.
//
//   npm run build && npm run smoke:styles
//   STYLE_SHOTS=<dir> also saves a screenshot of each style.
//   STYLE_IDS=renko,kagi   only these styles (for re-running a failure).
//   STYLE_PHASES=main,light,layout   only these passes (default: all).
//
// Server and Chrome discovery mirror scripts/smoke.mjs.
import http from 'node:http'
import { createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(__dirname, '..', 'dist')
const PORT = 8719
const ORIGIN = `http://127.0.0.1:${PORT}`
const SHOTS = process.env.STYLE_SHOTS || ''
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
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

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

// The styles under test come from CHART_STYLES itself, so a style added to
// chartStyle.ts is covered without touching this file. Each entry is one
// `{ ... }` literal with an id and the name the picker shows; `heavy` marks
// our own renderers and range bars (labelled in the log). Candles run first:
// they are the reference the zoom-out cost is measured against.
const STYLE_SRC = resolve(__dirname, '..', 'src', 'features', 'charts', 'chartStyle.ts')
function readStyles() {
  const src = readFileSync(STYLE_SRC, 'utf8')
  const m = src.match(/CHART_STYLES\b[^=]*=\s*\[([\s\S]*?)\n\]/)
  if (!m) throw new Error('CHART_STYLES not found in ' + STYLE_SRC)
  const out = []
  for (const e of m[1].matchAll(/\{[^{}]*\}/g)) {
    const id = /\bid:\s*(['"])([^'"]+)\1/.exec(e[0])
    const name = /\bname:\s*(['"])([^'"]+)\1/.exec(e[0])
    if (!id || !name) continue
    out.push({ id: id[2], name: name[2], heavy: /\b(custom|rangeBars):\s*true/.test(e[0]) })
  }
  if (!out.length) throw new Error('no styles parsed from ' + STYLE_SRC)
  return out
}
const ONLY = (process.env.STYLE_IDS || '').split(',').filter(Boolean)
const PHASES = (process.env.STYLE_PHASES || 'main,light,layout').split(',')
const STYLES = readStyles()
  .filter((s) => !ONLY.length || ONLY.includes(s.id))
  .sort((a, b) => (b.id === 'candle') - (a.id === 'candle'))
console.log('styles under test (' + STYLES.length + '): ' + STYLES.map((s) => s.id).join(', '))
/**
 * A far zoom-out pages in older history and redraws every bar. The longest
 * main-thread task it causes is compared with what plain Candles cost in the
 * same run (the machine's load moves both), with this as a floor: a style
 * fails when it costs over LONG_TASK_FACTOR times Candles' and over the floor.
 */
const LONG_TASK_LIMIT_MS = 250
const LONG_TASK_FACTOR = 3
let candleLongTask = 0

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
const WS_LIFECYCLE = [
  'Ping received after close',
  'WebSocket is closed before the connection is established',
]
const isWsLifecycle = (m) =>
  m.includes('WebSocket connection to') && WS_LIFECYCLE.some((p) => m.includes(p))

let stepErrors = []
const allErrors = []
let noiseCount = 0
function recordError(msg) {
  if (isWsLifecycle(msg) || isNoise(msg)) {
    noiseCount++
    return
  }
  stepErrors.push(msg)
  allErrors.push(msg)
}

/** Per style: { [column]: { ok, notes[] } } */
const table = {}
const COLUMNS = [
  'render',
  'legend',
  'tf 1m/1h/1D',
  'live 10s',
  'zoom-out',
  'back to Candles',
  'layout dark',
  'layout light',
  'light theme',
]
function mark(style, col, ok, note) {
  table[style] = table[style] || {}
  const cell = (table[style][col] = table[style][col] || { ok: true, notes: [] })
  if (!ok) cell.ok = false
  if (note && !ok) cell.notes.push(note)
}

let page
let browser

// ---------- page helpers ----------

/**
 * Ink in a chart's plot pane: pixels in a saturated (series) colour. Grid
 * lines and backgrounds are near-grey; long horizontal lines (the last-price
 * line) are discounted so a single line cannot pass for a series.
 */
function ink(rootSel) {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel)
    if (!root) return { err: 'no root ' + rootSel }
    let cv = null
    let area = 0
    root.querySelectorAll('canvas').forEach((c) => {
      const a = c.width * c.height
      if (a > area) {
        area = a
        cv = c
      }
    })
    if (!cv || !cv.width || !cv.height) return { err: 'no canvas' }
    const W = cv.width
    const H = cv.height
    let px
    try {
      px = cv.getContext('2d').getImageData(0, 0, W, H).data
    } catch (e) {
      return { err: String(e) }
    }
    const sat = new Uint8Array(W * H)
    const rowN = new Uint32Array(H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4
        const r = px[i]
        const g = px[i + 1]
        const b = px[i + 2]
        if (px[i + 3] > 0 && Math.max(r, g, b) - Math.min(r, g, b) >= 60) {
          sat[y * W + x] = 1
          rowN[y]++
        }
      }
    const cols = new Uint8Array(W)
    let rows = 0
    let n = 0
    for (let y = 0; y < H; y++) {
      if (rowN[y] > W * 0.6) continue // a horizontal line, not a series
      if (rowN[y]) rows++
      for (let x = 0; x < W; x++)
        if (sat[y * W + x]) {
          cols[x] = 1
          n++
        }
    }
    let c = 0
    for (let x = 0; x < W; x++) c += cols[x]
    return { w: W, h: H, px: n, colCov: +(c / W).toFixed(3), rowCov: +(rows / H).toFixed(3) }
  }, rootSel)
}
const inked = (k) => !k.err && k.px > 400 && k.colCov >= 0.25 && k.rowCov >= 0.12

function snap() {
  return page.evaluate(() => {
    let prefs = {}
    try {
      prefs = JSON.parse(localStorage.getItem('lr-chartPrefs')) || {}
    } catch (e) {
      /* unset */
    }
    return {
      style: prefs.style || 'candle',
      tf: document.querySelector('#tfSwitch .tf-btn.active')?.getAttribute('data-tf') || '',
      legend: (document.getElementById('legendOHLC')?.textContent || '').trim(),
      theme: document.documentElement.getAttribute('data-theme') || 'dark',
    }
  })
}

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
  await gotoCharts()
}

/** The name an option shows: the bold label without its "est" badge or hint. */
async function installOptName() {
  await page.evaluate(() => {
    window.__optName = (b) => {
      const bold = b.querySelector('.style-opt-text b')
      const node = bold ? bold.firstChild : null
      return ((node && node.textContent) || b.textContent || '').trim()
    }
  })
}

/** The picker must list exactly the styles chartStyle.ts declares. */
async function menuMatches() {
  await installOptName()
  await openMenu()
  const shown = await page.evaluate(() =>
    [...document.querySelectorAll('.style-menu .style-opt')].map((b) => window.__optName(b)),
  )
  await page.keyboard.press('Escape')
  await sleep(300)
  const want = STYLES.map((s) => s.name)
  const ok = shown.length === want.length && want.every((n, i) => shown[i] === n)
  if (!ok)
    console.log(
      '  picker shows: ' + JSON.stringify(shown) + '\n  CHART_STYLES: ' + JSON.stringify(want),
    )
  return ok
}

/** Open the picker; a click that lands while the app is still settling is retried. */
async function openMenu() {
  await page.waitForSelector('#radarChartCard .style-btn', { timeout: 8000 })
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => {
      if (!document.querySelector('.style-menu'))
        document.querySelector('#radarChartCard .style-btn')?.click()
    })
    const open = await page
      .waitForSelector('.style-menu .style-opt', { timeout: 2500 })
      .then(() => true)
      .catch(() => false)
    if (open) return
  }
  throw new Error('style menu did not open')
}

async function pickStyle(name) {
  await installOptName()
  await openMenu()
  await page.evaluate((name) => {
    const opts = [...document.querySelectorAll('.style-menu .style-opt')]
    const opt = opts.find((b) => window.__optName(b) === name)
    if (!opt) throw new Error('no style option ' + name)
    opt.click()
  }, name)
  await sleep(300)
  // Range bars keep the menu open for their size control: close it.
  await page.evaluate(() => {
    if (document.querySelector('.style-menu'))
      document.querySelector('#radarChartCard .style-btn')?.click()
  })
  await sleep(500)
}

async function pickTf(tf) {
  const has = await page.$('#tfSwitch .tf-btn[data-tf="' + tf + '"]')
  if (!has) throw new Error('no toolbar button for ' + tf)
  await has.click()
  // A new dataset: wait for the legend to settle on it.
  await waitFor(async () => (await snap()).tf === tf, 5000)
  await sleep(2500)
}

/** Plot rectangle of the main chart in page coordinates. */
async function plotRect(sel) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, sel)
}

/** Hover two bars; the legend must follow the crosshair to each. */
async function legendFollows() {
  const r = await plotRect('#chart')
  if (!r) return { ok: false, why: 'no #chart' }
  const read = async () => (await snap()).legend
  await page.mouse.move(r.x + r.w * 0.35, r.y + r.h * 0.5)
  await sleep(250)
  const a = await read()
  await page.mouse.move(r.x + r.w * 0.6, r.y + r.h * 0.45)
  await sleep(250)
  let b = await read()
  if (a === b) {
    // Few, wide bars (Point & figure): look for a second bar nearer the live edge.
    for (const fx of [0.8, 0.9, 0.95]) {
      await page.mouse.move(r.x + r.w * fx, r.y + r.h * 0.45)
      await sleep(250)
      b = await read()
      if (b !== a) break
    }
  }
  await page.mouse.move(2, 2)
  await sleep(200)
  const ohlc = (s) => /O\s*[\d.,]+/.test(s) && /H\s*[\d.,]+/.test(s) && /C\s*[\d.,]+/.test(s)
  return { ok: ohlc(a) && ohlc(b) && a !== b, a: a.slice(0, 80), b: b.slice(0, 80) }
}

async function zoomOutPerf() {
  const r = await plotRect('#chart')
  await page.evaluate(() => {
    window.__lt = []
    try {
      window.__ltObs = new PerformanceObserver((l) =>
        l.getEntries().forEach((e) => window.__lt.push(e.duration)),
      )
      window.__ltObs.observe({ type: 'longtask', buffered: false })
    } catch (e) {
      /* not supported */
    }
  })
  await page.mouse.move(r.x + r.w * 0.5, r.y + r.h * 0.5)
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel({ deltaY: 400 })
    await sleep(60)
  }
  await page.mouse.move(2, 2)
  await sleep(2500) // older history pages in while zoomed out
  const lt = await page.evaluate(() => {
    window.__ltObs?.disconnect()
    return window.__lt || []
  })
  return { maxLongTask: Math.round(Math.max(0, ...lt)), longTasks: lt.length }
}

async function shot(name) {
  if (!SHOTS) return
  const el = await page.$('#chartWrap')
  if (el) await el.screenshot({ path: join(SHOTS, name + '.png') })
}

function errs(style, col) {
  const e = stepErrors.slice()
  stepErrors = []
  mark(style, col, e.length === 0, e.length ? 'errors: ' + e.slice(0, 2).join(' | ') : '')
}

// ---------- scenarios ----------

async function mainChartPass({ id, name, heavy }) {
  stepErrors = []
  // Start each style from Candles on 1h.
  const cur = await snap()
  if (cur.tf !== '1h') await pickTf('1h')
  await pickStyle(name)
  await sleep(1200)
  let s = await snap()
  mark(id, 'render', s.style === id, 'style stored as ' + s.style)
  let k = await ink('#chart')
  mark(id, 'render', inked(k), 'blank plot on 1h ' + JSON.stringify(k))
  await shot('dark-' + id + '-1h')
  errs(id, 'render')

  const lg = await legendFollows()
  mark(id, 'legend', lg.ok, JSON.stringify(lg))
  errs(id, 'legend')

  for (const tf of ['1d', '1m']) {
    await pickTf(tf)
    k = await ink('#chart')
    mark(id, 'tf 1m/1h/1D', inked(k), 'blank on ' + tf + ' ' + JSON.stringify(k))
    const l2 = await legendFollows()
    mark(id, 'tf 1m/1h/1D', l2.ok, 'legend on ' + tf + ' ' + JSON.stringify(l2))
    await shot('dark-' + id + '-' + tf)
  }
  errs(id, 'tf 1m/1h/1D')

  // Live: stay on 1m for ~10s; ticks run updateChartLast on this style.
  const before = (await snap()).legend
  await sleep(10000)
  const after = (await snap()).legend
  k = await ink('#chart')
  mark(id, 'live 10s', inked(k), 'blank after live ' + JSON.stringify(k))
  if (before === after) console.log('    (' + id + ': legend did not move in 10s — quiet market?)')
  errs(id, 'live 10s')

  {
    const perf = await zoomOutPerf()
    k = await ink('#chart')
    mark(id, 'zoom-out', inked(k), 'blank zoomed out ' + JSON.stringify(k))
    if (id === 'candle') candleLongTask = perf.maxLongTask
    const limit = Math.max(LONG_TASK_LIMIT_MS, LONG_TASK_FACTOR * candleLongTask)
    mark(
      id,
      'zoom-out',
      perf.maxLongTask < limit,
      'long task ' +
        perf.maxLongTask +
        'ms (limit ' +
        limit +
        'ms, Candles ' +
        candleLongTask +
        'ms)',
    )
    console.log('    ' + id + (heavy ? ' (custom)' : '') + ' zoom-out: ' + JSON.stringify(perf))
    await shot('dark-' + id + '-zoomout')
    errs(id, 'zoom-out')
  }

  await pickTf('1h')
  await pickStyle('Candles')
  await sleep(800)
  s = await snap()
  k = await ink('#chart')
  mark(
    id,
    'back to Candles',
    s.style === 'candle' && inked(k),
    JSON.stringify({ style: s.style, k }),
  )
  errs(id, 'back to Candles')
}

/** Main chart, light theme: draws and follows the crosshair. */
async function lightPass({ id, name }) {
  stepErrors = []
  await pickStyle(name)
  await sleep(1200)
  const s = await snap()
  const k = await ink('#chart')
  mark(
    id,
    'light theme',
    s.theme === 'light' && s.style === id && inked(k),
    JSON.stringify({ theme: s.theme, style: s.style, k }),
  )
  const lg = await legendFollows()
  mark(id, 'light theme', lg.ok, 'legend ' + JSON.stringify(lg))
  await shot('light-' + id)
  errs(id, 'light theme')
}

/** 4 charts; companions 1..3 carry `ids`. Each must draw and follow the crosshair. */
async function layoutPass(ids, theme) {
  const col = 'layout ' + theme
  const syms = ['ETHUSDT', 'SOLUSDT', 'BNBUSDT']
  stepErrors = []
  const seed = {
    'lr-tf': '15m',
    'lr-chartPrefs': { style: 'candle' },
    'lr-chartLayout': {
      n: 4,
      active: 0,
      cells: [null, ...ids.map((style, i) => ({ sym: syms[i], tf: '1h', style }))],
    },
  }
  if (theme === 'light') seed['lr-theme'] = 'light'
  await freshLoad(seed)
  await sleep(2500)
  // Each load queues a dozen paced kline requests; give the companions time
  // to get theirs before judging them.
  await waitFor(
    () =>
      page.evaluate((n) => {
        const ls = [...document.querySelectorAll('#chartLayout .rc-legend')]
        return ls.length >= n && ls.every((l) => !/Loading/.test(l.textContent || ''))
      }, ids.length),
    20000,
    300,
  )
  await sleep(800)
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const pos = i + 1
    const sel = '#chartLayout > .rc-cell[style*="order: ' + pos + '"] .rc-body'
    const k = await ink(sel)
    mark(id, col, inked(k), 'companion blank ' + JSON.stringify(k))
    const r = await plotRect(sel)
    if (r) {
      await page.mouse.move(r.x + r.w * 0.4, r.y + r.h * 0.5)
      await sleep(300)
      const leg = await page.evaluate(
        (sel) =>
          (document.querySelector(sel)?.querySelector('.rc-legend')?.textContent || '').trim(),
        sel,
      )
      // The TradingView legend puts each label and value in its own span.
      const ok =
        /O\s*[\d.,]+\s*H\s*[\d.,]+\s*L\s*[\d.,]+\s*C\s*[\d.,]+/.test(leg) ||
        /^C\s*[\d.,]+$/.test(leg)
      mark(id, col, ok, 'companion legend "' + leg.slice(0, 60) + '"')
      await page.mouse.move(2, 2)
    } else mark(id, col, false, 'no companion ' + pos)
  }
  // A few seconds of live ticks into the companions.
  await sleep(5000)
  for (let i = 0; i < ids.length; i++) {
    const k = await ink('#chartLayout > .rc-cell[style*="order: ' + (i + 1) + '"] .rc-body')
    mark(ids[i], col, inked(k), 'companion blank after live ' + JSON.stringify(k))
  }
  if (SHOTS)
    await page.screenshot({ path: join(SHOTS, 'layout-' + theme + '-' + ids.join('-') + '.png') })
  const e = stepErrors.slice()
  stepErrors = []
  ids.forEach((id) =>
    mark(id, col, e.length === 0, e.length ? 'errors: ' + e.slice(0, 2).join(' | ') : ''),
  )
}

// ---------- run ----------

server.listen(PORT, async () => {
  let network = 'unknown'
  let fatal = null
  let menuOk = false
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      defaultViewport: { width: 1400, height: 1000, deviceScaleFactor: 1 },
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
    if (network !== 'online') throw new Error('network unavailable: ' + network)

    // Dark: the full pass on the main chart.
    await freshLoad({ 'lr-tf': '1h', 'lr-chartPrefs': { style: 'candle' } })
    menuOk = await menuMatches()
    console.log('picker lists CHART_STYLES: ' + (menuOk ? 'pass' : 'FAIL'))
    for (const s of PHASES.includes('main') ? STYLES : []) {
      console.log('\n[main/dark] ' + s.name)
      await mainChartPass(s)
    }

    // Light: each style draws on the main chart.
    if (PHASES.includes('light'))
      await freshLoad({ 'lr-tf': '1h', 'lr-chartPrefs': { style: 'candle' }, 'lr-theme': 'light' })
    for (const s of PHASES.includes('light') ? STYLES : []) {
      console.log('[main/light] ' + s.name)
      await lightPass(s)
    }

    // Companions, three styles at a time, in both themes.
    const ids = PHASES.includes('layout') ? STYLES.map((s) => s.id) : []
    for (const theme of ['dark', 'light'])
      for (let i = 0; i < ids.length; i += 3) {
        const group = ids.slice(i, i + 3)
        console.log('[layout/' + theme + '] ' + group.join(', '))
        await layoutPass(group, theme)
      }
  } catch (e) {
    fatal = String((e && e.stack) || e)
    console.log('FATAL: ' + fatal)
  } finally {
    if (browser) await browser.close()
  }

  console.log('\n--- chart styles (network: ' + network + ') ---')
  const short = ['render', 'legend', 'tf', 'live', 'zoom', 'candles', 'L-dark', 'L-light', 'light']
  console.log('style'.padEnd(12) + short.map((s) => s.padEnd(8)).join(''))
  const menuChecked = PHASES.includes('main') && !ONLY.length
  let ok = !fatal && (menuOk || !menuChecked)
  for (const { id } of STYLES) {
    const row = table[id] || {}
    const cells = COLUMNS.map((c) => (row[c] ? (row[c].ok ? 'pass' : 'FAIL') : '-'))
    const partial = ONLY.length > 0 || PHASES.length < 3
    if (cells.includes('FAIL') || (!partial && cells.every((c) => c === '-'))) ok = false
    console.log(id.padEnd(12) + cells.map((c) => c.padEnd(8)).join(''))
  }
  if (!menuOk && menuChecked) console.log('  FAIL picker menu does not list CHART_STYLES exactly')
  for (const { id } of STYLES)
    for (const c of COLUMNS) {
      const cell = table[id]?.[c]
      if (cell && !cell.ok)
        console.log('  FAIL ' + id + ' / ' + c + ': ' + cell.notes.join(' ; ').slice(0, 500))
    }
  console.log('--- app errors (' + allErrors.length + '), filtered noise: ' + noiseCount + ' ---')
  allErrors.slice(0, 20).forEach((e) => console.log('  ' + e))
  server.close()
  process.exit(ok ? 0 : 1)
})
