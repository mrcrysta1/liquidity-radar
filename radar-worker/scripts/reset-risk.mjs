// Lift a halt on the testnet bot: the drawdown kill switch never clears by
// itself, and a daily-loss halt only at the next UTC day. The current equity
// becomes the new peak and day start, so the limits measure from here on.
// The running bot picks it up on its next tick (15 s).
//   npm run reset-risk
import { existsSync, readFileSync } from 'node:fs'
import pg from 'pg'

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
  const risk = (await client.query("select value from bot_state where key = 'risk'")).rows[0]?.value
  if (!risk) throw new Error('no risk state yet — the bot has not run')
  const last = (await client.query('select equity from bot_equity order by t desc limit 1')).rows[0]
  const equity = Number(last?.equity)
  if (!(equity > 0)) throw new Error('no equity recorded yet')
  console.log('before:', risk.halted ? 'HALTED — ' + risk.haltReason : 'not halted', `· peak $${risk.peakEquity}`)
  const next = { ...risk, halted: false, haltReason: '', peakEquity: equity, dayStartEquity: equity }
  await client.query("update bot_state set value = $1, updated = now() where key = 'risk'", [JSON.stringify(next)])
  await client.query("update bot_state set value = '\"\"'::jsonb, updated = now() where key = 'lastHalt'")
  const msg = `risk limits reset manually — new peak $${equity.toFixed(2)}`
  await client.query("insert into bot_events (level, symbol, msg) values ('warn', null, $1)", [msg])
  console.log('after: ', msg)
} finally {
  await client.end()
}
