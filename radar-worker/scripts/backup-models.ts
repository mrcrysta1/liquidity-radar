// npm run backup-models [-- --label "text"] — snapshot every champion model,
// every calibration row and the learning's bot_state keys (src/bot/backup.ts)
// into bot_backups and into a local file (radar-worker/backups/, not in git).
// Then reads the stored copy back and checks it against the database.
// Read-only for the bot's own tables. Needs DATABASE_URL (radar-worker/.env).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { connect } from '../src/db.ts'
import { compareWith, currentChampions, loadBackup, saveBackup, takeBackup } from '../src/bot/backup.ts'

if (existsSync('.env')) process.loadEnvFile('.env')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
const i = process.argv.indexOf('--label')
const label = i > 0 ? process.argv[i + 1] : 'manual'
const db = connect(process.env.DATABASE_URL)
try {
  await db.query(readFileSync(new URL('../sql/012_bot_backups.sql', import.meta.url), 'utf8'))
  const b = await takeBackup(db)
  const id = await saveBackup(db, b, label)
  mkdirSync('backups', { recursive: true })
  const file = `backups/models-${new Date(b.takenAt).toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify(b))
  const cur = currentChampions(b.champions)
  const nets = cur.reduce((n, m) => n + ((m.model as { long?: unknown; short?: unknown })?.long ? 1 : 0) + ((m.model as { short?: unknown })?.short ? 1 : 0), 0)
  console.log(`backup #${id} (${label}) · ${file}`)
  console.log(`  ${cur.length} markets (${cur.map((m) => m.symbol + ' ' + m.interval).join(', ')})`)
  console.log(`  ${nets} networks · ${b.champions.length} champion rows · ${b.calibration.length} calibration rows · ${b.state.length} state keys`)
  console.log(`  records: ${Object.entries(b.records).map(([t, r]) => `${t} ${r.count} (last #${r.maxId})`).join(' · ')}`)
  console.log(`  digest ${b.digest}`)
  // The stored copy must parse, match its digest and match the database it came from.
  const back = await loadBackup(db, id)
  const diffs = await compareWith(db, back)
  console.log(diffs.length ? `  CHANGED SINCE (the bot kept learning): ${diffs.slice(0, 5).join('; ')}${diffs.length > 5 ? ` … ${diffs.length} in all` : ''}` : '  stored copy verified against the database')
} finally {
  await db.end()
}
