// Apply one SQL file to the database in .env's DATABASE_URL.
//   node scripts/apply-sql.mjs sql/003_user_settings.sql
import { readFileSync } from 'node:fs'
import pg from 'pg'

const file = process.argv[2]
if (!file) throw new Error('usage: node scripts/apply-sql.mjs <file.sql>')
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
)
const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query(readFileSync(file, 'utf8'))
  console.log('applied', file)
} finally {
  await client.end()
}
