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
  if (!found) {
    throw new Error(
      'No Chrome/Chromium found. Set CHROME_PATH env var to your browser executable.',
    )
  }
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
  'ERR_ABORTED',
  'rss2json',
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

    // Assert the invariant, not a headcount: every section must be reachable
    // and every nav button must point at a section that exists. A raw count
    // breaks whenever navigation is rearranged, which tells you nothing.
    results.nav = await page.evaluate(() => {
      const targets = [...new Set([...document.querySelectorAll('.tab-btn')].map((b) => b.dataset.tab))].sort()
      const sections = [...document.querySelectorAll('.tab-section')].map((s) => s.id.replace(/^tab-/, '')).sort()
      return {
        buttons: document.querySelectorAll('.tab-btn').length,
        targets,
        sections,
        unreachable: sections.filter((s) => !targets.includes(s)),
        dangling: targets.filter((t) => !sections.includes(t)),
      }
    })
    results.sections = results.nav.sections.length

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

  const missing = (r) => r === undefined || r === null || r === '' || r === '—'
  const gates = [
    ['every section is reachable from nav', results.nav.unreachable.length === 0],
    ['no nav button points at a missing section', results.nav.dangling.length === 0],
    ['tab sections rendered', results.sections >= 9],
    [
      'streams live (status pill reads Live)',
      !missing(results['t+15s']) && /^Live$/i.test(results['t+15s'].status),
    ],
    ['live hero price present', !missing(results['t+15s']) && !missing(results['t+15s'].heroPrice)],
    ['ticker populated', !missing(results['t+15s']) && results['t+15s'].tickerCount >= 1],
    ['symbol selector populated', !missing(results['t+15s']) && results['t+15s'].symSelOpts >= 1],
    ['chart canvases mounted', !missing(results['t+15s']) && results['t+15s'].canvases >= 8],
    ['window globals exposed', Object.values(results.globals || {}).every((t) => t === 'function')],
    ['signal tab activates', results.signalsActive === 'tab-signals'],
    ['analysis tab activates', results.analysis?.active === 'tab-analysis'],
    ['no app-level js errors', jsErrors.length === 0],
  ]
  console.log('--- verdict ---')
  const failed = []
  for (const [name, ok] of gates) {
    console.log((ok ? 'PASS' : 'FAIL').padEnd(6) + name)
    if (!ok) failed.push(name)
  }
  server.close()
  process.exit(failed.length ? 1 : 0)
})
