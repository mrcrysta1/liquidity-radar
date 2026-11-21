// npm run restore-models -- (--file <backup.json> | --id <n>) [--apply [--state]]
//
// Without --apply (default): a dry run on a scratch in-memory database built
// from sql/: the backup is restored there and every market's networks and
// every calibration row are compared with the backup. Nothing is written to
// the bot's database.
//
// With --apply: restores into DATABASE_URL — each champion saved again as a
// new row and promoted (the current one retired, nothing deleted), and every
// calibration row written back; --state also rewrites the learning's
// bot_state keys. Stop the bot first (Actions → Trading bot → cancel), or it
// keeps learning on top. Needs the owner's go-ahead.
import { existsSync, readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { connect } from '../src/db.ts'
import type { Db } from '../src/db.ts'
import { compareWith, currentChampions, loadBackup, parseBackup, restoreBackup } from '../src/bot/backup.ts'

const arg = (k: string) => {
  const i = process.argv.indexOf(k)
  return i > 0 ? process.argv[i + 1] : undefined
}
const apply = process.argv.includes('--apply')
if (existsSync('.env')) process.loadEnvFile('.env')

async function scratch(): Promise<Db> {
  const pg = new PGlite()
  await pg.exec('create role anon;')
  for (const f of ['001_whales.sql', '002_bot.sql', '005_bot_learning.sql', '006_bot_journal.sql', '007_bot_trend.sql', '008_bot_strategies.sql', '012_bot_backups.sql'])
    await pg.exec(readFileSync(new URL('../sql/' + f, import.meta.url), 'utf8'))
  const q = (text: string, params?: unknown[]) => pg.query(text, params as never)
  return { query: q, connect: async () => ({ query: q, release() {} }), end: async () => pg.close() } as unknown as Db
}

const file = arg('--file')
const id = arg('--id')
if (!file && !id) throw new Error('usage: npm run restore-models -- (--file <backup.json> | --id <n>) [--apply [--state]]')
const live = id || apply ? connect(process.env.DATABASE_URL ?? '') : null
try {
  const b = file ? parseBackup(readFileSync(file, 'utf8')) : await loadBackup(live!, Number(id))
  console.log(`backup from ${new Date(b.takenAt).toISOString()} · ${currentChampions(b.champions).length} markets · ${b.calibration.length} calibration rows · digest ok`)
  const target = apply ? live! : await scratch()
  const r = await restoreBackup(target, b, { state: process.argv.includes('--state') })
  const diffs = await compareWith(target, b)
  console.log(`${apply ? 'RESTORED into the bot database' : 'dry run (scratch database)'}: ${r.models} champions, ${r.calibration} calibration rows, ${r.state} state keys`)
  console.log(diffs.length ? `MISMATCH: ${diffs.join('; ')}` : 'every network and calibration row matches the backup')
  if (diffs.length) process.exitCode = 1
  if (!apply) await target.end()
} finally {
  await live?.end()
}
