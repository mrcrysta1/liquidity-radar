import http from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import { dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(__dirname, '..', 'dist')
const PORT = 8717
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
}
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'

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
const results = {}
const jsErrors = []
const allLogs = []

// external-resource noise is expected (CORS/rate-limit on third-party feeds,
// calendar 429 → known fallback) — do not fail the gate on it
const EXTERNAL_NOISE = [
  'faireconomy.media',
  'xoomar',
  'Failed to load resource',
  'net::ERR_FAILED',
  'Access to fetch at',
  'ERR_CERT',
  'net::ERR_CONNECTION',
]
const isNoise = (m) => EXTERNAL_NOISE.some((p) => m.includes(p))

server.listen(PORT, async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1400, height: 1000 },
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  })
  try {
    const page = await browser.newPage()
    page.on('pageerror', (e) => jsErrors.push('pageerror: ' + e.message))
    page.on('console', (m) => {
      if (m.type() === 'error' && !isNoise(m.text()))
        jsErrors.push('console: ' + m.text().slice(0, 300))
      if ((m.type() === 'error' || m.type() === 'warning') && !isNoise(m.text()))
        allLogs.push(`console.${m.type()}: ` + m.text().slice(0, 300))
    })
    page.on('requestfailed', (r) => {
      const why = (r.failure() || {}).errorText || ''
      if (!isNoise(r.url() + ' ' + why) && !isNoise(why))
        jsErrors.push('requestfailed: ' + r.url().slice(0, 120) + ' ' + why)
    })

    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })

    const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel)

    results.tabButtons = await count('.tab-btn')
    results.sections = await count('.tab-section')

    const sample = async (label) =>
      page
        .evaluate(() => {
          const $ = (id) => document.getElementById(id)
          const t = (id) => (($(id) || {}).textContent || '').trim()
          return {
            status: t('statusTxt'),
            heroPrice: t('heroPrice').slice(0, 16),
            tickerCount: document.querySelectorAll('#tickerTrack > *').length,
            symSelOpts: ($('symSelect') || { options: [] }).options.length,
            canvases: document.querySelectorAll('canvas').length,
          }
        })
        .then((s) => {
          results[label] = s
        })

    await sample('t+5s')
    await sleep(10000)
    await sample('t+15s')

    results.globals = await page.evaluate(() => ({
      selectPalette: typeof window.selectPalette,
      switchTab: typeof window.switchTab,
      switchSigMode: typeof window.switchSigMode,
      closeModal: typeof window.closeModal,
      dollar: typeof window.$,
    }))

    await page.evaluate(() => document.querySelector('.tab-btn[data-tab="signals"]').click())
    await sleep(1200)
    results.signalsActive = await page.evaluate(
      () => document.querySelector('.tab-section.active')?.id,
    )

    await page.evaluate(() => document.querySelector('.tab-btn[data-tab="analysis"]').click())
    await sleep(2500)
    results.analysis = await page.evaluate(() => ({
      active: document.querySelector('.tab-section.active')?.id,
      fxRows: document.querySelectorAll('#forexList .fx-row, #forexList .fx').length,
    }))
  } catch (e) {
    results.fatal = String(e && e.message)
  } finally {
    await browser.close()
  }

  console.log('--- smoke results ---')
  for (const k of Object.keys(results)) console.log(k.padEnd(16), JSON.stringify(results[k]))
  console.log('--- js errors (' + jsErrors.length + ') ---')
  jsErrors.slice(0, 15).forEach((e) => console.log('  ' + e))
  if (jsErrors.length) {
    console.log('--- recent logs ---')
    allLogs.slice(-8).forEach((l) => console.log('  ' + l))
  }
  server.close()
  process.exit(jsErrors.length ? 1 : 0)
})
