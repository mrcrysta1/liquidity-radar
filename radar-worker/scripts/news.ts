// npm run news — the news study's collection in one go, from a PC (the bot
// does the same hourly, a few reactions at a time): both calendars, the FRED
// backfill since 2019 when FRED_API_KEY is set (again with --refetch), and
// every pending market reaction. Needs DATABASE_URL (radar-worker/.env).
//
//   node scripts/news.ts [--refetch] [--max N]
import { existsSync } from 'node:fs'
import { connect } from '../src/db.ts'
import { BotStore } from '../src/bot/store.ts'
import { BACKFILL_FROM, backfillFred, collectCalendars, computeReactions, pendingReleases } from '../src/news/collect.ts'

if (existsSync('.env')) process.loadEnvFile('.env')
const args = process.argv.slice(2)
const max = Number(args[args.indexOf('--max') + 1]) || 5000
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
const db = connect(process.env.DATABASE_URL)
const store = new BotStore(db)
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
try {
  log('calendars', await collectCalendars(db))
  const key = process.env.FRED_API_KEY
  if (key) {
    const done = (await store.getState<{ done?: number } | null>('news:backfill', null))?.done
    if (!done || args.includes('--refetch')) {
      const res = await backfillFred(db, key)
      await store.setState('news:backfill', { done: Date.now(), from: BACKFILL_FROM, rows: res })
      log('FRED backfill', res)
    } else log('FRED backfill already done', new Date(done).toISOString())
  } else log('no FRED_API_KEY: past release dates not backfilled')
  let n = 0
  for (;;) {
    const batch = await pendingReleases(db, Date.now(), 20)
    if (!batch.length || n >= max) break
    for (const t of batch) {
      const k = await computeReactions(db, t)
      n++
      log('reaction', new Date(t).toISOString().slice(0, 16), k, 'rows')
    }
  }
  log('done:', n, 'release times')
} finally {
  await db.end()
}
