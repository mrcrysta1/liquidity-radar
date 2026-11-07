// npm run mleval — the model calibration study (src/research/calib.ts) on the
// bot's closed trades, printed (the bot refreshes the same study daily into
// bot_state 'ml:eval'). Read-only. Needs DATABASE_URL (radar-worker/.env).
import { existsSync } from 'node:fs'
import { connect } from '../src/db.ts'
import { calibrationStudy, loadCalRows } from '../src/research/calib.ts'

if (existsSync('.env')) process.loadEnvFile('.env')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
const db = connect(process.env.DATABASE_URL)
try {
  const rows = await loadCalRows(db)
  const s = calibrationStudy(rows)
  const f = (v: number | null, d = 4) => (v == null ? 'n/a' : v.toFixed(d))
  console.log(`${s.n} outcomes, first ${s.warmup} replayed but not scored\n`)
  console.log('candidate'.padEnd(52), 'logloss  brier   ECE    AUC    long p/won     short p/won    gain vs live (95%)            taken  meanR')
  for (const c of s.candidates) {
    console.log(
      c.label.padEnd(52), f(c.all.logLoss), f(c.all.brier), f(c.all.ece, 3), f(c.all.auc, 3),
      `${f(c.long.meanP, 2)}/${f(c.long.winRate, 2)}`.padEnd(14), `${f(c.short.meanP, 2)}/${f(c.short.winRate, 2)}`.padEnd(14),
      `${f(c.vsLive.mean)} [${f(c.vsLive.lo)}, ${f(c.vsLive.hi)}]`.padEnd(29), String(c.taken.n).padStart(5), f(c.taken.meanR, 3),
    )
  }
  console.log('\n' + s.verdict)
} finally {
  await db.end()
}
