// The server bot's trade journal, as one list of real and shadow trades.
//
// Pure functions only (tested in scripts/test-engines.mjs): rows come from
// bot_trades and bot_shadow_trades (radar-worker/sql/002, 005 and
// 006_bot_journal.sql) via serverBot.ts loadJournal. Rows written before the
// journal columns existed — or a database where 006 is not applied yet — just
// have nulls, so every journal field here is optional.

export type JournalKind = 'real' | 'shadow'

export interface JournalRow {
  /** Unique across both tables: 'r12' / 's34'. */
  key: string
  id: number
  kind: JournalKind
  symbol: string
  side: 1 | -1
  status: string
  /** Real: when the order filled. Shadow: close of the decision bar (its virtual entry). */
  openedAt: number
  closedAt: number | null
  entry: number
  plannedEntry: number | null
  sl: number
  tp: number
  exit: number | null
  exitReason: string | null
  /** Result in R after fees (real) or after estimated costs (shadow). */
  r: number | null
  pnlUsd: number | null
  feesUsd: number | null
  pWin: number | null
  pRaw: number | null
  evR: number | null
  regime: string | null
  rr: number | null
  costR: number | null
  maeR: number | null
  mfeR: number | null
  barsHeld: number | null
  slippageBps: number | null
  modelId: number | null
  modelVersion: number | null
  interval: string | null
  mode: string | null
  /** The strategy that made it ('f1', 'ml', ...; 008_bot_strategies.sql), null on older rows. */
  strategy: string | null
  /** The model's summary at entry. */
  decision: string | null
  /** Shadow: why it was not a real trade. Real: notes (errors). */
  reason: string | null
  features: Record<string, number> | null
}

type Raw = Record<string, unknown>

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
const time = (v: unknown): number | null => {
  if (v == null) return null
  const t = typeof v === 'number' ? v : Date.parse(String(v))
  return isFinite(t) ? t : null
}
const INTERVAL_MS: Record<string, number> = { '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 }

function feats(v: unknown): Record<string, number> | null {
  let o = v
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o)
    } catch {
      return null
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const out: Record<string, number> = {}
  for (const [k, x] of Object.entries(o as Raw)) {
    const n = num(x)
    if (n != null) out[k] = n
  }
  return Object.keys(out).length ? out : null
}

/** One bot_trades row (any subset of columns) → a journal row; null if unusable. */
export function realRow(x: Raw, versions: Map<number, number> = new Map()): JournalRow | null {
  const id = num(x.id)
  const openedAt = time(x.opened_at)
  if (id == null || openedAt == null || !x.symbol) return null
  const modelId = num(x.model_id)
  return {
    key: 'r' + id,
    id,
    kind: 'real',
    symbol: String(x.symbol),
    side: Number(x.side) < 0 ? -1 : 1,
    status: str(x.status) ?? 'open',
    openedAt,
    closedAt: time(x.closed_at),
    entry: num(x.entry) ?? NaN,
    plannedEntry: num(x.planned_entry),
    sl: num(x.sl) ?? NaN,
    tp: num(x.tp) ?? NaN,
    exit: num(x.exit),
    exitReason: str(x.exit_reason),
    r: num(x.r_multiple),
    pnlUsd: num(x.pnl_usd),
    feesUsd: num(x.fees_usd),
    pWin: num(x.p_win),
    pRaw: num(x.p_raw),
    evR: num(x.ev_r),
    regime: str(x.regime),
    rr: num(x.rr_net),
    costR: num(x.cost_r),
    maeR: num(x.mae_r),
    mfeR: num(x.mfe_r),
    barsHeld: num(x.bars_held),
    slippageBps: num(x.slippage_bps),
    modelId,
    modelVersion: num(x.model_version) ?? (modelId != null ? (versions.get(modelId) ?? null) : null),
    interval: str(x.interval),
    mode: str(x.mode),
    strategy: str(x.strategy),
    decision: str(x.decision),
    reason: str(x.notes),
    features: feats(x.features),
  }
}

/** One bot_shadow_trades row → a journal row; null if unusable. */
export function shadowRow(x: Raw, versions: Map<number, number> = new Map()): JournalRow | null {
  const id = num(x.id)
  const bar = time(x.bar_time)
  if (id == null || bar == null || !x.symbol) return null
  const modelId = num(x.model_id)
  const interval = str(x.interval)
  // Virtual entry at the decision bar's close; old rows without an interval fall back to when the row was written.
  const step = interval ? INTERVAL_MS[interval] : undefined
  const openedAt = step ? bar + step : (time(x.created_at) ?? bar)
  return {
    key: 's' + id,
    id,
    kind: 'shadow',
    symbol: String(x.symbol),
    side: Number(x.side) < 0 ? -1 : 1,
    status: str(x.status) ?? 'open',
    openedAt,
    closedAt: time(x.closed_at),
    entry: num(x.entry) ?? NaN,
    plannedEntry: num(x.entry),
    sl: num(x.sl) ?? NaN,
    tp: num(x.tp) ?? NaN,
    exit: num(x.exit),
    exitReason: str(x.exit_reason),
    r: num(x.r_net),
    pnlUsd: null,
    feesUsd: null,
    pWin: num(x.p_cal),
    pRaw: num(x.p_raw),
    evR: num(x.ev_r),
    regime: str(x.regime),
    rr: num(x.rr_net),
    costR: num(x.cost_r),
    maeR: num(x.mae_r),
    mfeR: num(x.mfe_r),
    barsHeld: num(x.bars_held),
    slippageBps: null,
    modelId,
    modelVersion: num(x.model_version) ?? (modelId != null ? (versions.get(modelId) ?? null) : null),
    interval,
    mode: 'shadow',
    strategy: str(x.strategy),
    decision: str(x.decision),
    reason: str(x.reject_reason),
    features: feats(x.features),
  }
}

/** Both tables as one journal, newest first. */
export function buildJournal(real: Raw[], shadow: Raw[], models: Raw[] = []): JournalRow[] {
  const versions = new Map<number, number>()
  for (const m of models) {
    const id = num(m.id)
    const v = num(m.version)
    if (id != null && v != null) versions.set(id, v)
  }
  const rows = [
    ...real.map((x) => realRow(x, versions)),
    ...shadow.map((x) => shadowRow(x, versions)),
  ].filter((x): x is JournalRow => !!x)
  return rows.sort((a, b) => b.openedAt - a.openedAt || (a.key < b.key ? 1 : -1))
}

export interface JournalFilter {
  symbol: string
  kind: 'all' | JournalKind
  outcome: 'all' | 'win' | 'loss' | 'open'
}
export const ALL: JournalFilter = { symbol: 'all', kind: 'all', outcome: 'all' }

/** A trade with a result (closed, R known). */
export const decided = (r: JournalRow) => r.r != null && r.status === 'closed'

export function filterJournal(rows: JournalRow[], f: JournalFilter): JournalRow[] {
  return rows.filter(
    (r) =>
      (f.symbol === 'all' || r.symbol === f.symbol) &&
      (f.kind === 'all' || r.kind === f.kind) &&
      (f.outcome === 'all' ||
        (f.outcome === 'open' ? r.status === 'open' : decided(r) && (f.outcome === 'win' ? r.r! > 0 : r.r! <= 0))),
  )
}

export interface JournalGroup {
  n: number
  wins: number
  winRate: number
  avgR: number
  totalR: number
}
export interface JournalStats extends JournalGroup {
  /** All rows, including open and expired ones. */
  count: number
  open: number
  bySymbol: Array<JournalGroup & { symbol: string }>
}

function group(rows: JournalRow[]): JournalGroup {
  const d = rows.filter(decided)
  const wins = d.filter((r) => r.r! > 0).length
  const totalR = d.reduce((a, r) => a + r.r!, 0)
  return { n: d.length, wins, winRate: d.length ? wins / d.length : 0, avgR: d.length ? totalR / d.length : 0, totalR }
}

/** Count, win rate, average and total R over the decided trades, overall and per market (most trades first). */
export function journalStats(rows: JournalRow[]): JournalStats {
  const syms = Array.from(new Set(rows.map((r) => r.symbol)))
  const bySymbol = syms
    .map((symbol) => ({ symbol, ...group(rows.filter((r) => r.symbol === symbol)) }))
    .sort((a, b) => b.n - a.n || a.symbol.localeCompare(b.symbol))
  return { ...group(rows), count: rows.length, open: rows.filter((r) => r.status === 'open').length, bySymbol }
}
