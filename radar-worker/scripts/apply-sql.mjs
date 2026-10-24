// Apply one SQL file to the database in DATABASE_URL (the environment first,
// then .env — CI has no .env, only the secret).
//   node scripts/apply-sql.mjs sql/003_user_settings.sql
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'

const file = process.argv[2]
if (!file) throw new Error('usage: node scripts/apply-sql.mjs <file.sql>')
const envFile = new URL('../.env', import.meta.url)
const env = existsSync(envFile)
  ? Object.fromEntries(
      readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    )
  : {}
const url = process.env.DATABASE_URL || env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(readFileSync(file, 'utf8'))
  console.log('applied', file)
} finally {
  await client.end()
}
