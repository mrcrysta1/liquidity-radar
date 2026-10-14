// radar-worker: collects every whale order on Binance spot, around the clock,
// into Postgres, so the chart can draw whale bubbles across its whole history.
//
//   cp .env.example .env   # fill in DATABASE_URL
//   npm start
//
// Per symbol: one aggTrade websocket (LiveTape) plus backfill chains reading
// REST pages downward until BACKFILL_DAYS is covered. Restart-safe: it resumes
// from what the database already holds.
import { existsSync } from 'node:fs'
import { autoThreshold } from '../../liquidity-radar-react/src/features/whales/whaleMath.ts'
import { STREAM, aggTradesFrom, quoteVolume24h } from './binance.ts'
import { DbSink, connect, loadCoverage, loadSettings, saveSettings } from './db.ts'
import { LiveTape, backfillChain } from './tape.ts'
import type { Agg } from './tape.ts'

if (existsSync('.env')) process.loadEnvFile('.env')

const env = process.env
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — copy .env.example to .env and fill it in.')
  process.exit(1)
}
const SYMBOLS = (env.SYMBOLS || 'BTCUSDT,PAXGUSDT')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)
const BACKFILL_DAYS = Number(env.BACKFILL_DAYS) || 14
const PACE_MS = Number(env.PACE_MS) || 350
const PERSIST_MS = 10_000
/** No trade at all for this long means the socket is dead, even if it looks open. */
const SILENCE_MS = 10 * 60_000

const db = connect(env.DATABASE_URL, env.DATABASE_CA_FILE)
let stopping = false
const sinks: DbSink[] = []
const tapes = new Map<string, LiveTape>()

const log = (sym: string, msg: string) => console.log(new Date().toISOString(), sym.padEnd(9), msg)

async function runSymbol(sym: string): Promise<void> {
  let settings = await loadSettings(db, sym)
  if (!settings) {
    // Fixed once per symbol, so every stored row was kept under the same floor.
    const auto = autoThreshold(await quoteVolume24h(sym))
    settings = { auto, floor: auto / 2 }
    await saveSettings(db, sym, settings.floor, settings.auto)
  }
  const cov = await loadCoverage(db, sym)
  const sink = new DbSink(db, sym, settings.floor, cov)
  sink.onFatal = (e) => {
    console.error(sym, 'database write failed repeatedly — exiting so the supervisor restarts cleanly', e)
    void shutdown(1)
  }
  sinks.push(sink)
  log(sym, `floor $${settings.floor.toLocaleString()} · ${cov.length} coverage range(s) on record`)

  const startChain = (head: Agg[]) => {
    const stopT = Date.now() - BACKFILL_DAYS * 86_400_000
    const t0 = Date.now()
    log(sym, `backfill from id ${head[0].a - 1} down to ${new Date(stopT).toISOString()}`)
    backfillChain(
      sink,
      {
        fetchPage: (from, limit) => aggTradesFrom(sym, from, limit),
        pageSize: 1000,
        paceMs: PACE_MS,
        stopT,
        cancelled: () => stopping,
      },
      head[0].a - 1,
      head,
    )
      .then(({ pages }) => {
        const oldest = Math.min(...sink.covered().map((c) => c.t0))
        log(sym, `backfill done: ${pages} pages in ${Math.round((Date.now() - t0) / 1000)}s, covered from ${new Date(oldest).toISOString()}`)
      })
      .catch((e) => log(sym, 'backfill stopped: ' + (e as Error).message))
  }

  let backoff = 1000
  const open = () => {
    if (stopping) return
    const tape = new LiveTape(sink, startChain)
    tapes.set(sym, tape)
    const ws = new WebSocket(STREAM + sym.toLowerCase() + '@aggTrade')
    let last = Date.now()
    const watchdog = setInterval(() => {
      if (Date.now() - last > SILENCE_MS) {
        log(sym, 'stream silent — reconnecting')
        ws.close()
      }
    }, 60_000)
    ws.onopen = () => {
      backoff = 1000
      log(sym, 'stream open')
    }
    ws.onmessage = (ev) => {
      last = Date.now()
      try {
        const d = JSON.parse(String(ev.data))
        tape.push({ a: d.a, p: d.p, q: d.q, T: d.T, m: d.m })
      } catch {
        /* malformed frame */
      }
    }
    ws.onerror = () => {}
    ws.onclose = () => {
      clearInterval(watchdog)
      tape.flush(true)
      if (stopping) return
      log(sym, `stream closed — reconnecting in ${backoff / 1000}s`)
      setTimeout(open, backoff)
      backoff = Math.min(60_000, backoff * 2)
    }
  }
  open()
}

async function persistAll(): Promise<void> {
  await Promise.all(sinks.map((s) => s.persist().catch((e) => console.error('coverage write failed', e))))
}

let persistTimer: ReturnType<typeof setInterval> | null = null
async function shutdown(code: number): Promise<void> {
  if (stopping) return
  stopping = true
  console.log('shutting down…')
  if (persistTimer) clearInterval(persistTimer)
  tapes.forEach((t) => t.flush(true))
  await Promise.all([...tapes.values()].map((t) => t.idle()))
  await persistAll()
  await db.end().catch(() => {})
  process.exit(code)
}
process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))

for (const s of SYMBOLS) {
  await runSymbol(s).catch((e) => {
    console.error(s, 'failed to start', e)
    process.exit(1)
  })
}
persistTimer = setInterval(() => void persistAll(), PERSIST_MS)
