// The model calibration study (radar-worker/src/research/calib.ts, bot_state
// 'ml:eval', refreshed daily by the bot): the live per-market calibration
// against pooled alternatives, replayed in time order without look-ahead.
// Pure (tested in scripts/test-engines.mjs).

export interface MlScore {
  n: number
  logLoss: number | null
  brier: number | null
  ece: number | null
  auc: number | null
  meanP: number | null
  winRate: number | null
}

export interface MlCandidate {
  id: string
  label: string
  all: MlScore
  long: MlScore
  short: MlScore
  vsLive: { mean: number | null; lo: number | null; hi: number | null }
  taken: { n: number; meanR: number | null }
}

export interface MlEval {
  t: number
  n: number
  warmup: number
  better: string | null
  verdict: string
  candidates: MlCandidate[]
}

type Raw = Record<string, unknown>
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {})

function sc(v: unknown): MlScore {
  const x = obj(v)
  return { n: num(x.n) ?? 0, logLoss: num(x.logLoss), brier: num(x.brier), ece: num(x.ece), auc: num(x.auc), meanP: num(x.meanP), winRate: num(x.winRate) }
}

export function normalizeMlEval(value: unknown): MlEval | null {
  const v = obj(typeof value === 'string' ? safeParse(value) : value)
  if (!Array.isArray(v.candidates) || typeof v.verdict !== 'string') return null
  const candidates: MlCandidate[] = []
  for (const c of v.candidates) {
    const x = obj(c)
    if (typeof x.id !== 'string') continue
    const d = obj(x.vsLive)
    const tk = obj(x.taken)
    candidates.push({
      id: x.id,
      label: typeof x.label === 'string' ? x.label : x.id,
      all: sc(x.all),
      long: sc(x.long),
      short: sc(x.short),
      vsLive: { mean: num(d.mean), lo: num(d.lo), hi: num(d.hi) },
      taken: { n: num(tk.n) ?? 0, meanR: num(tk.meanR) },
    })
  }
  return { t: num(v.t) ?? 0, n: num(v.n) ?? 0, warmup: num(v.warmup) ?? 0, better: typeof v.better === 'string' ? v.better : null, verdict: v.verdict, candidates }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
