// Bot watchdog (.github/workflows/bot-watchdog.yml): the bot cannot report its
// own silence, so this reads its heartbeat (bot_state 'heartbeat', written every
// tick) and posts to BOT_ALERT_WEBHOOK when it is older than WATCHDOG_STALE_MIN
// (default 30). Read-only on the database; it never starts or cancels a bot run.
// No webhook set: nothing to do.
//   node scripts/watchdog.mjs
import pg from 'pg'

const hook = (process.env.BOT_ALERT_WEBHOOK || '').trim()
if (!/^https?:\/\//.test(hook)) {
  console.log('BOT_ALERT_WEBHOOK not set: watchdog disabled')
  process.exit(0)
}
const url = process.env.DATABASE_URL
const staleMin = Number(process.env.WATCHDOG_STALE_MIN) > 0 ? Number(process.env.WATCHDOG_STALE_MIN) : 30

async function post(text) {
  const r = await fetch(hook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // Discord reads content, Slack-style webhooks read text.
    body: JSON.stringify({ content: text, text }),
    signal: AbortSignal.timeout(5000),
  })
  console.log('alert sent: HTTP', r.status)
}

let msg = null
if (!url) msg = '[Trading bot watchdog] DATABASE_URL is not set: cannot check the heartbeat'
else {
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  try {
    await client.connect()
    const r = await client.query(`select value, updated from bot_state where key = 'heartbeat'`)
    const v = r.rows[0]?.value
    const t = Number(typeof v === 'string' ? JSON.parse(v).t : v?.t) || (r.rows[0] ? Date.parse(r.rows[0].updated) : NaN)
    const age = (Date.now() - t) / 60_000
    if (!Number.isFinite(age)) msg = '[Trading bot watchdog] no heartbeat recorded'
    else if (age > staleMin)
      msg = `[Trading bot watchdog] heartbeat is ${Math.round(age)} min old (last ${new Date(t).toISOString()}): the bot is not running. Check Actions → Trading bot.`
    else console.log(`heartbeat ${age.toFixed(1)} min old: ok`)
  } catch (e) {
    msg = `[Trading bot watchdog] cannot read the heartbeat: ${e.message}`
  } finally {
    await client.end().catch(() => {})
  }
}
if (msg) {
  console.log(msg)
  await post(msg).catch((e) => console.log('alert failed:', e.message))
}
