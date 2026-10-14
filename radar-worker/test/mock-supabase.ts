// Dev stand-in for Supabase: the real collector (tape + DbSink + Binance) into
// an in-process Postgres, served through a minimal PostgREST-style API.
// Not used in production.   node test/mock-supabase.ts [port] [minutes]
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { autoThreshold } from '../../liquidity-radar-react/src/features/whales/whaleMath.ts'
import { DbSink, saveSettings } from '../src/db.ts'
import type { Db } from '../src/db.ts'
import { LiveTape, backfillChain } from '../src/tape.ts'
import { STREAM, aggTradesFrom, quoteVolume24h } from '../src/binance.ts'

const port = Number(process.argv[2]) || 4790
const minutes = Number(process.argv[3]) || 90
const pg = new PGlite()
await pg.exec('create role anon;')
await pg.exec(readFileSync(new URL('../sql/001_whales.sql', import.meta.url), 'utf8'))
const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
const db = { query: q, connect: async () => ({ query: q, release() {} }), end: async () => {} } as unknown as Db

for (const sym of ['BTCUSDT']) {
  const auto = autoThreshold(await quoteVolume24h(sym))
  await saveSettings(db, sym, auto / 2, auto)
  const sink = new DbSink(db, sym, auto / 2, [])
  const tape = new LiveTape(sink, (head) =>
    void backfillChain(sink, { fetchPage: (f, l) => aggTradesFrom(sym, f, l), pageSize: 1000, paceMs: 150, stopT: Date.now() - minutes * 60_000 }, head[0].a - 1, head)
      .then((r) => console.log('backfill done', r.pages, 'pages')),
  )
  const ws = new WebSocket(STREAM + sym.toLowerCase() + '@aggTrade')
  ws.onmessage = (ev) => { const d = JSON.parse(String(ev.data)); tape.push({ a: d.a, p: d.p, q: d.q, T: d.T, m: d.m }) }
  setInterval(() => void sink.persist(), 5000)
}

function where(u: URL): { sql: string; args: unknown[] } {
  const parts: string[] = []
  const args: unknown[] = []
  for (const [k, v] of u.searchParams) {
    const m = /^(eq|gte|lt)\.(.*)$/.exec(v)
    if (!m || !/^(symbol|t|usd)$/.test(k)) continue
    args.push(m[2])
    parts.push(`${k} ${m[1] === 'eq' ? '=' : m[1] === 'gte' ? '>=' : '<'} $${args.length}${k === 't' ? '::timestamptz' : k === 'usd' ? '::float8' : ''}`)
  }
  return { sql: parts.length ? ' where ' + parts.join(' and ') : '', args }
}

http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'apikey, authorization')
  if (req.method === 'OPTIONS') return res.end()
  const u = new URL(req.url || '/', 'http://x')
  const table = u.pathname.replace('/rest/v1/', '')
  if (!/^whale_(orders|coverage|symbols)$/.test(table)) { res.statusCode = 404; return res.end('[]') }
  const w = where(u)
  const order = table === 'whale_orders' ? ' order by t' : table === 'whale_coverage' ? ' order by a0' : ''
  const lim = ' limit ' + Math.min(1000, Number(u.searchParams.get('limit')) || 1000) + ' offset ' + (Number(u.searchParams.get('offset')) || 0)
  const r = await pg.query(`select * from ${table}${w.sql}${order}${lim}`, w.args as never)
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(r.rows.map((row: Record<string, unknown>) => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) o[k] = v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? Number(v) : v
    return o
  })))
}).listen(port, () => console.log('mock supabase on', port))
