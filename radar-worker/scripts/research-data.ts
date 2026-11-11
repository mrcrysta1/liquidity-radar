// Shared by the research scripts (audit.ts, study.ts): the markets, the
// cached public Binance klines and funding, and every strategy's historical
// trades replayed with the bot's own code.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Bar } from '../src/bot/features.ts'
import { costR, indicators, outcomeAt } from '../src/bot/features.ts'
import { closedBars, fundingRates, INTERVAL_MS } from '../src/bot/data.ts'
import type { Funding } from '../src/bot/data.ts'
import { ruleBacktest } from '../src/bot/strategies.ts'
import type { RuleStrategy } from '../src/bot/strategies.ts'
import { c6Verdict, fitC6, fundingR } from '../src/bot/c6.ts'
import type { C6Row } from '../src/bot/c6.ts'
import { DEFAULT_WF, walkForward } from '../src/bot/walkforward.ts'
import { regimeAt } from '../src/research/audit.ts'
import type { AuditTrade } from '../src/research/audit.ts'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CACHE = resolve(ROOT, '.scratch/audit')
export const args = new Set(process.argv.slice(2))
if (existsSync(resolve(ROOT, '.env'))) process.loadEnvFile(resolve(ROOT, '.env'))
export const STEP = INTERVAL_MS['4h']
export const SYMBOLS = 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,AAVEUSDT,ADAUSDT,ARBUSDT,AVAXUSDT,BCHUSDT,DOTUSDT,ETCUSDT,INJUSDT,NEARUSDT,UNIUSDT,APTUSDT,ATOMUSDT,DOGEUSDT,FILUSDT,LINKUSDT,LTCUSDT,OPUSDT,SUIUSDT,TRXUSDT,XRPUSDT'.split(',')
/** The bot's model bracket and EV bar (.github/workflows/trading-bot.yml). */
export const ML_WF = { ...DEFAULT_WF, bracket: { slAtr: 1.5, tpAtr: 2.25, horizon: 12 }, minEvR: 0.1 }
export const MODERATE = { taker: 0.0005, maker: 0.0002, slip: 0.0002, tpMaker: true }

export async function cached<T>(name: string, get: () => Promise<T>): Promise<T> {
  const p = resolve(CACHE, name + '.json')
  if (!args.has('--refresh') && existsSync(p) && Date.now() - statSync(p).mtimeMs < 86_400_000) return JSON.parse(readFileSync(p, 'utf8')) as T
  const v = await get()
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(p, JSON.stringify(v))
  return v
}

export const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

export async function load() {
  const bars: Record<string, Bar[]> = {}
  const fund: Record<string, Funding[]> = {}
  for (const s of SYMBOLS) {
    bars[s] = await cached(`bars-${s}-4h`, () => closedBars(s, '4h', 40_000))
    fund[s] = await cached(`funding-${s}`, () => fundingRates(s, Date.UTC(2019, 0, 1)).catch(() => []))
    log(s, bars[s].length, 'bars from', new Date(bars[s][0]?.t ?? 0).toISOString().slice(0, 10), '·', fund[s].length, 'funding rows')
  }
  return { bars, fund }
}

export function sortFund(f: Funding[]) {
  return [...f].sort((a, b) => a.t - b.t)
}

/** A rule strategy on one market, as audit trades. */
export function ruleTrades(id: string, s: RuleStrategy, sym: string, b: Bar[], btc: Bar[], fund: Funding[], reg: Map<number, string>): AuditTrade[] {
  return ruleBacktest(s, b, { BTCUSDT: btc }).map((x) => {
    const t = b[x.i + 1].t
    const tExit = x.why === 'signal' ? (b[x.exitBar + 1]?.t ?? b[x.exitBar].t + STEP) : b[x.exitBar].t + STEP
    return { strategy: id, symbol: sym, side: x.side, t, tExit, entry: x.entry, exit: x.exit, dist: x.dist, r: x.r, exitWhy: x.why, fundLongR: fundingR(fund, t, tExit, x.entry, x.dist), regime: regimeAt(reg, t, STEP) }
  })
}

/**
 * C6's verdict on each F1 trade (key symbol:entry time), each half-year by a
 * GBDT trained only on trades closed before it (as the bot retrains every
 * 182 days). F1 trades in a half-year without a model have no verdict.
 */
export function c6Verdicts(f1: AuditTrade[], rows: C6Row[]): Map<string, boolean> {
  const byKey = new Map(rows.map((r) => [r.sym + ':' + r.tEntry, r]))
  const out = new Map<string, boolean>()
  for (let y = 2020; y <= 2026; y++) {
    for (const h of [0, 6]) {
      const from = Date.UTC(y, h, 1)
      const to = Date.UTC(y, h + 6, 1)
      const m = fitC6(rows, from)
      if (!m) continue
      for (const t of f1) {
        if (t.t < from || t.t >= to) continue
        const row = byKey.get(t.symbol + ':' + t.t)
        if (row) out.set(t.symbol + ':' + t.t, c6Verdict(m, row.x).take)
      }
    }
  }
  return out
}

/** C6: F1's trades the walk-forward model takes. */
export function c6Trades(f1: AuditTrade[], rows: C6Row[]): AuditTrade[] {
  const v = c6Verdicts(f1, rows)
  return f1.filter((t) => v.get(t.symbol + ':' + t.t) === true).map((t) => ({ ...t, strategy: 'c6' }))
}

/** The model's walk-forward on one market (every fold trained on the past only), as audit trades. */
export function mlTrades(sym: string, b: Bar[], fund: Funding[], reg: Map<number, string>): AuditTrade[] {
  const ind = indicators(b)
  const out: AuditTrade[] = []
  for (const w of walkForward(b, ML_WF).trades) {
    const o = outcomeAt(b, ind, w.i, w.side, ML_WF.bracket)
    if (!o) continue
    const entry = b[w.i].c
    const dist = ML_WF.bracket.slAtr * ind.atr[w.i]
    const t = b[w.i].t + STEP
    const tExit = b[o.end].t + STEP
    // Gross R from the recorded net: the walk-forward charged the bot's own (moderate) costs.
    const r = w.r + costR(entry, dist, MODERATE, o.exit)
    out.push({ strategy: 'ml', symbol: sym, side: w.side, t, tExit, entry, exit: entry + w.side * r * dist, dist, r, exitWhy: o.exit, fundLongR: fundingR(fund, t, tExit, entry, dist), regime: regimeAt(reg, t, STEP) })
  }
  return out
}
