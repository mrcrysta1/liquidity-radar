// Model backup: a snapshot of everything the model side has learned, so it can
// be put back exactly. Tested in test/model-backup.test.ts; run with
// `npm run backup-models` (scripts/backup-models.ts) and checked or restored
// with `npm run restore-models` (scripts/restore-models.ts).
//
//   champions    every bot_models row the bot trades from (role 'champion'),
//                whole: the two networks per market (long, short) with their
//                scalers and payoff stats, cfg, metrics, gate verdict.
//   calibration  every bot_calibration row (the online probability
//                correction per market × side × regime). These rows are
//                overwritten in place by every closed trade, so this snapshot
//                is the only way back to today's values.
//   state        bot_state keys the learning reads: learn:*, wf:*, ml:*,
//                strategy:*, c6:* (C6's GBDT is in 'c6:model').
//   records      counts and last ids of the append-only tables (trades,
//                paper trades, model history): nothing there is ever deleted,
//                so they are referenced, not copied.
//
// Restoring never edits a stored model row: each backed-up champion is saved
// again as a new row (its own version) and promoted, so the history keeps
// both what was replaced and the restore itself.
import { createHash } from 'node:crypto'
import type { Db } from '../db.ts'

export const BACKUP_VERSION = 1

/** bot_state keys a backup keeps. */
export const BACKUP_STATE_KEYS = ['learn:%', 'wf:%', 'ml:%', 'strategy:%', 'c6:%']

export interface ModelRowCopy {
  id: number
  symbol: string
  interval: string
  version: number | null
  created_at: string
  trained_from: string
  trained_to: string
  promoted_at: string | null
  cfg: unknown
  metrics: unknown
  gate_pass: boolean
  gate_reasons: string[]
  model: unknown
  holdout: unknown
}

export interface CalibrationRow {
  symbol: string
  side: 1 | -1
  regime: string
  a: number
  b: number
  n: number
  wins: number
  updated: string
}

export interface ModelBackup {
  v: number
  takenAt: number
  champions: ModelRowCopy[]
  calibration: CalibrationRow[]
  state: Array<{ key: string; value: unknown }>
  records: Record<string, { count: number; maxId: number | null }>
  /** sha256 of the champions' and the calibration's content: what a restore must reproduce. */
  digest: string
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v))
const json = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v)

/** Stable JSON (sorted keys) so the same content always gives the same digest. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

/** What must survive a restore: each market's networks and every correction, not row ids or times. */
export function contentDigest(champions: Array<Pick<ModelRowCopy, 'symbol' | 'interval' | 'model'>>, calibration: CalibrationRow[]): string {
  const m = [...champions].sort((x, y) => (x.symbol + x.interval).localeCompare(y.symbol + y.interval)).map((c) => [c.symbol, c.interval, c.model])
  const c = [...calibration]
    .sort((x, y) => (x.symbol + x.side + x.regime).localeCompare(y.symbol + y.side + y.regime))
    .map((r) => [r.symbol, r.side, r.regime, r.a, r.b, r.n, r.wins])
  return createHash('sha256').update(stable({ m, c })).digest('hex')
}

async function champions(db: Db): Promise<ModelRowCopy[]> {
  const r = await db.query(
    `select id, symbol, interval, version, created_at, trained_from, trained_to, promoted_at, cfg, metrics, gate_pass, gate_reasons, model, holdout
     from bot_models where role = 'champion' order by symbol, interval, created_at desc, id desc`,
  )
  // The bot reads the newest champion per market (store.latestModel); older rows still marked champion come along too.
  return r.rows.map((x) => ({
    id: Number(x.id),
    symbol: x.symbol,
    interval: x.interval,
    version: x.version == null ? null : Number(x.version),
    created_at: iso(x.created_at),
    trained_from: iso(x.trained_from),
    trained_to: iso(x.trained_to),
    promoted_at: x.promoted_at == null ? null : iso(x.promoted_at),
    cfg: json(x.cfg),
    metrics: json(x.metrics),
    gate_pass: x.gate_pass,
    gate_reasons: x.gate_reasons ?? [],
    model: json(x.model),
    holdout: x.holdout == null ? null : json(x.holdout),
  }))
}

async function calibration(db: Db): Promise<CalibrationRow[]> {
  const r = await db.query('select symbol, side, regime, a, b, n, wins, updated from bot_calibration order by symbol, side, regime')
  return r.rows.map((x) => ({ symbol: x.symbol, side: Number(x.side) as 1 | -1, regime: x.regime, a: Number(x.a), b: Number(x.b), n: Number(x.n), wins: Number(x.wins), updated: iso(x.updated) }))
}

/** Read a snapshot of the model side (read-only). */
export async function takeBackup(db: Db, now = Date.now()): Promise<ModelBackup> {
  const ch = await champions(db)
  const cal = await calibration(db)
  const st = await db.query(`select key, value from bot_state where key like any($1::text[]) order by key`, [BACKUP_STATE_KEYS])
  const records: ModelBackup['records'] = {}
  for (const t of ['bot_trades', 'bot_shadow_trades', 'bot_models']) {
    const r = await db.query(`select count(*) as n, max(id) as m from ${t}`)
    records[t] = { count: Number(r.rows[0].n), maxId: r.rows[0].m == null ? null : Number(r.rows[0].m) }
  }
  return {
    v: BACKUP_VERSION,
    takenAt: now,
    champions: ch,
    calibration: cal,
    state: st.rows.map((x) => ({ key: x.key, value: json(x.value) })),
    records,
    digest: contentDigest(ch, cal),
  }
}

/** Store a snapshot in bot_backups (sql/012); returns its id. */
export async function saveBackup(db: Db, b: ModelBackup, label: string): Promise<number> {
  const r = await db.query(
    `insert into bot_backups (kind, label, taken_at, digest, payload) values ('models', $1, $2, $3, $4) returning id`,
    [label, new Date(b.takenAt).toISOString(), b.digest, JSON.stringify(b)],
  )
  return Number(r.rows[0].id)
}

export async function loadBackup(db: Db, id: number): Promise<ModelBackup> {
  const r = await db.query(`select payload from bot_backups where id = $1 and kind = 'models'`, [id])
  if (!r.rows[0]) throw new Error(`no model backup #${id}`)
  return parseBackup(r.rows[0].payload)
}

export function parseBackup(raw: unknown): ModelBackup {
  const b = json(raw) as ModelBackup
  if (!b || b.v !== BACKUP_VERSION || !Array.isArray(b.champions) || !Array.isArray(b.calibration)) throw new Error('not a model backup (v1)')
  const d = contentDigest(b.champions, b.calibration)
  if (d !== b.digest) throw new Error(`backup is damaged: digest ${d.slice(0, 12)} ≠ stored ${String(b.digest).slice(0, 12)}`)
  return b
}

/** The newest champion per market, as the bot picks it. */
export function currentChampions(rows: ModelRowCopy[]): ModelRowCopy[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const k = r.symbol + '|' + r.interval
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export interface RestoreResult {
  models: number
  calibration: number
  state: number
}

/**
 * Put a backup into a database: each market's champion saved again as a new
 * row and promoted (the replaced one is retired, never deleted), every
 * calibration row written back, the state keys rewritten. Run it on a scratch
 * database to check a backup, or on the bot's database to roll back (bot stopped).
 */
export async function restoreBackup(db: Db, b: ModelBackup, o: { state?: boolean } = {}): Promise<RestoreResult> {
  const out: RestoreResult = { models: 0, calibration: 0, state: 0 }
  for (const m of currentChampions(b.champions)) {
    const r = await db.query(
      `insert into bot_models (symbol, interval, trained_from, trained_to, cfg, metrics, gate_pass, gate_reasons, model, role, holdout, version)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'challenger', $10,
               (select coalesce(max(version), 0) + 1 from bot_models where symbol = $1 and interval = $2))
       returning id`,
      [m.symbol, m.interval, m.trained_from, m.trained_to, JSON.stringify(m.cfg), JSON.stringify(m.metrics), m.gate_pass, m.gate_reasons,
        JSON.stringify(m.model), JSON.stringify({ restoredFrom: m.id, backupTakenAt: b.takenAt })],
    )
    const id = Number(r.rows[0].id)
    await db.query(`update bot_models set role = 'retired' where symbol = $1 and interval = $2 and role = 'champion' and id <> $3`, [m.symbol, m.interval, id])
    await db.query(`update bot_models set role = 'champion', promoted_at = now() where id = $1`, [id])
    out.models++
  }
  for (const c of b.calibration) {
    await db.query(
      `insert into bot_calibration (symbol, side, regime, a, b, n, wins, updated) values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (symbol, side, regime) do update set a = excluded.a, b = excluded.b, n = excluded.n, wins = excluded.wins, updated = now()`,
      [c.symbol, c.side, c.regime, c.a, c.b, c.n, c.wins],
    )
    out.calibration++
  }
  if (o.state) {
    for (const s of b.state) {
      await db.query(
        `insert into bot_state (key, value, updated) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated = now()`,
        [s.key, JSON.stringify(s.value)],
      )
      out.state++
    }
  }
  return out
}

/** Does this database hold exactly the backup's networks and corrections? Empty list = yes. */
export async function compareWith(db: Db, b: ModelBackup): Promise<string[]> {
  const now = await takeBackup(db)
  const diffs: string[] = []
  const want = currentChampions(b.champions)
  const have = new Map(currentChampions(now.champions).map((r) => [r.symbol + '|' + r.interval, r]))
  for (const m of want) {
    const h = have.get(m.symbol + '|' + m.interval)
    if (!h) diffs.push(`${m.symbol} ${m.interval}: no champion`)
    else if (stable(h.model) !== stable(m.model)) diffs.push(`${m.symbol} ${m.interval}: networks differ (champion #${h.id} vs backup #${m.id})`)
  }
  const cal = new Map(now.calibration.map((c) => [`${c.symbol}|${c.side}|${c.regime}`, c]))
  for (const c of b.calibration) {
    const h = cal.get(`${c.symbol}|${c.side}|${c.regime}`)
    if (!h || h.a !== c.a || h.b !== c.b || h.n !== c.n || h.wins !== c.wins) diffs.push(`calibration ${c.symbol} ${c.side > 0 ? 'long' : 'short'} ${c.regime} differs`)
  }
  return diffs
}
