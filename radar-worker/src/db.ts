// Postgres side of the collector (Supabase or any Postgres; schema in sql/).
//
// Ordering matters for correctness after a crash: coverage is only ever
// written once every order inside it is safely stored. So a restart can trust
// the stored coverage completely — anything it claims is really in the table.
import { readFileSync } from 'node:fs'
import pg from 'pg'
import { mergeCoverage } from './tape.ts'
import type { Cov, TapeSink, WhaleOrder } from './tape.ts'

export type Db = pg.Pool

export function connect(url: string, caFile?: string): Db {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url)
  return new pg.Pool({
    connectionString: url,
    max: 4,
    // Supabase needs TLS. With its CA certificate (Database settings → SSL)
    // the server is verified; without one the link is still encrypted.
    ssl: local ? false : caFile ? { ca: readFileSync(caFile, 'utf8') } : { rejectUnauthorized: false },
  })
}

export async function loadSettings(db: Db, symbol: string): Promise<{ floor: number; auto: number } | null> {
  const r = await db.query('select floor, auto from whale_symbols where symbol = $1', [symbol])
  return r.rows[0] ? { floor: Number(r.rows[0].floor), auto: Number(r.rows[0].auto) } : null
}

export async function saveSettings(db: Db, symbol: string, floor: number, auto: number): Promise<void> {
  await db.query(
    `insert into whale_symbols (symbol, floor, auto) values ($1, $2, $3)
     on conflict (symbol) do update set floor = excluded.floor, auto = excluded.auto, updated = now()`,
    [symbol, floor, auto],
  )
}

export async function loadCoverage(db: Db, symbol: string): Promise<Cov[]> {
  const r = await db.query(
    'select a0, a1, extract(epoch from t0) * 1000 as t0, extract(epoch from t1) * 1000 as t1 from whale_coverage where symbol = $1 order by a0',
    [symbol],
  )
  return r.rows.map((x) => ({ a0: Number(x.a0), a1: Number(x.a1), t0: Math.round(Number(x.t0)), t1: Math.round(Number(x.t1)) }))
}

async function insertOrders(db: Db, symbol: string, list: WhaleOrder[]): Promise<void> {
  if (!list.length) return
  await db.query(
    `insert into whale_orders (symbol, a0, a1, t, price, usd, qty, side, fills)
     select $1, a0, a1, to_timestamp(t / 1000.0), price, usd, qty, side, fills
     from unnest($2::bigint[], $3::bigint[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::smallint[], $9::int[])
       as x(a0, a1, t, price, usd, qty, side, fills)
     on conflict (symbol, a0) do nothing`,
    [
      symbol,
      list.map((o) => o.a0),
      list.map((o) => o.a1),
      list.map((o) => o.t),
      list.map((o) => o.p),
      list.map((o) => o.usd),
      list.map((o) => o.q),
      list.map((o) => (o.side === 'buy' ? 1 : -1)),
      list.map((o) => o.n),
    ],
  )
}

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let err: unknown
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      err = e
      await new Promise((r) => setTimeout(r, 500 * 2 ** i))
    }
  }
  throw err
}

/**
 * The TapeSink for one symbol. Coverage lives in memory (claimed the moment a
 * range is read) and is written to the table every few seconds, but only up
 * to what the order writes have caught up with.
 */
export class DbSink implements TapeSink {
  floor: number
  private db: Db
  private symbol: string
  private cov: Cov[]
  private inflight = new Set<Promise<void>>()
  private failed = false
  private dirty = false
  onFatal: (e: unknown) => void = () => {}

  constructor(db: Db, symbol: string, floor: number, cov: Cov[]) {
    this.db = db
    this.symbol = symbol
    this.floor = floor
    this.cov = cov
  }

  covered(): Cov[] {
    return this.cov
  }

  save(orders: WhaleOrder[], c: Cov): Promise<void> {
    // Claimed synchronously — see TapeSink.
    this.cov = mergeCoverage(this.cov, c)
    this.dirty = true
    const p = withRetry(() => insertOrders(this.db, this.symbol, orders)).catch((e) => {
      this.failed = true
      this.onFatal(e)
    })
    this.inflight.add(p)
    void p.finally(() => this.inflight.delete(p))
    return p
  }

  /** Write coverage — after every order write started before now has landed. */
  async persist(): Promise<void> {
    if (!this.dirty) return
    const snapshot = this.cov.map((c) => ({ ...c }))
    this.dirty = false
    await Promise.all([...this.inflight])
    // A range whose orders could not be written must not be claimed.
    if (this.failed) return
    const client = await this.db.connect()
    try {
      await client.query('begin')
      await client.query('delete from whale_coverage where symbol = $1', [this.symbol])
      await client.query(
        `insert into whale_coverage (symbol, a0, a1, t0, t1)
         select $1, a0, a1, to_timestamp(t0 / 1000.0), to_timestamp(t1 / 1000.0)
         from unnest($2::bigint[], $3::bigint[], $4::float8[], $5::float8[]) as x(a0, a1, t0, t1)`,
        [this.symbol, snapshot.map((c) => c.a0), snapshot.map((c) => c.a1), snapshot.map((c) => c.t0), snapshot.map((c) => c.t1)],
      )
      // Doubles as a heartbeat: the chart can tell a live collector from a stopped one.
      await client.query('update whale_symbols set updated = now() where symbol = $1', [this.symbol])
      await client.query('commit')
    } catch (e) {
      await client.query('rollback').catch(() => {})
      this.dirty = true
      throw e
    } finally {
      client.release()
    }
  }
}
