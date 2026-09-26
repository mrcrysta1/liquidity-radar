// Postgres persistence for the bot (schema in sql/002_bot.sql).
import type { Db } from '../db.ts'
import type { Model, Metrics } from './walkforward.ts'
import type { RiskState } from './risk.ts'

export interface ModelRow {
  id: number
  createdAt: number
  gatePass: boolean
  gateReasons: string[]
  metrics: Metrics
  model: Model
}

export interface OpenTrade {
  id: number
  symbol: string
  side: 1 | -1
  openedAt: number
  barTime: number
  entry: number
  qty: number
  sl: number
  tp: number
  riskUsd: number
  tpOrderId: number | null
  slAlgoId: number | null
}

export interface NewTrade {
  symbol: string
  modelId: number
  mode: 'gated' | 'explore'
  venue: string
  side: 1 | -1
  openedAt: number
  barTime: number
  entry: number
  qty: number
  sl: number
  tp: number
  atr: number
  riskUsd: number
  pWin: number
  evR: number
  features: Record<string, number>
  entryOrderId: number
}

const ts = (ms: number) => new Date(ms).toISOString()

export class BotStore {
  private db: Db
  constructor(db: Db) {
    this.db = db
  }

  async saveModel(symbol: string, interval: string, m: Model, metrics: Metrics, pass: boolean, reasons: string[]): Promise<number> {
    const r = await this.db.query(
      `insert into bot_models (symbol, interval, trained_from, trained_to, cfg, metrics, gate_pass, gate_reasons, model)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [symbol, interval, ts(m.trainedFrom), ts(m.trainedTo), JSON.stringify(m.cfg), JSON.stringify(metrics), pass, reasons, JSON.stringify(m)],
    )
    return Number(r.rows[0].id)
  }

  async latestModel(symbol: string, interval: string): Promise<ModelRow | null> {
    const r = await this.db.query(
      `select id, extract(epoch from created_at) * 1000 as created, gate_pass, gate_reasons, metrics, model
       from bot_models where symbol = $1 and interval = $2 order by created_at desc limit 1`,
      [symbol, interval],
    )
    const x = r.rows[0]
    if (!x) return null
    const j = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
    return { id: Number(x.id), createdAt: Number(x.created), gatePass: x.gate_pass, gateReasons: x.gate_reasons || [], metrics: j(x.metrics), model: j(x.model) }
  }

  async openTrade(symbol: string): Promise<OpenTrade | null> {
    const r = await this.db.query(
      `select id, symbol, side, extract(epoch from opened_at) * 1000 as opened, extract(epoch from bar_time) * 1000 as bar,
              entry, qty, sl, tp, risk_usd, tp_order_id, sl_algo_id
       from bot_trades where symbol = $1 and status = 'open' limit 1`,
      [symbol],
    )
    const x = r.rows[0]
    if (!x) return null
    return {
      id: Number(x.id),
      symbol: x.symbol,
      side: Number(x.side) > 0 ? 1 : -1,
      openedAt: Math.round(Number(x.opened)),
      barTime: Math.round(Number(x.bar)),
      entry: Number(x.entry),
      qty: Number(x.qty),
      sl: Number(x.sl),
      tp: Number(x.tp),
      riskUsd: Number(x.risk_usd),
      tpOrderId: x.tp_order_id == null ? null : Number(x.tp_order_id),
      slAlgoId: x.sl_algo_id == null ? null : Number(x.sl_algo_id),
    }
  }

  async insertTrade(t: NewTrade): Promise<number> {
    const r = await this.db.query(
      `insert into bot_trades (symbol, model_id, mode, venue, side, status, opened_at, bar_time, entry, qty, sl, tp, atr,
                               risk_usd, p_win, ev_r, features, entry_order_id)
       values ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id`,
      [t.symbol, t.modelId, t.mode, t.venue, t.side, ts(t.openedAt), ts(t.barTime), t.entry, t.qty, t.sl, t.tp, t.atr, t.riskUsd, t.pWin, t.evR, JSON.stringify(t.features), t.entryOrderId],
    )
    return Number(r.rows[0].id)
  }

  async setLegs(id: number, tpOrderId: number | null, slAlgoId: number | null): Promise<void> {
    await this.db.query('update bot_trades set tp_order_id = $2, sl_algo_id = $3 where id = $1', [id, tpOrderId, slAlgoId])
  }

  async closeTrade(
    id: number,
    c: { closedAt: number; exit: number; reason: 'tp' | 'sl' | 'time' | 'manual' | 'error'; pnlUsd: number; feesUsd: number; r: number; status?: 'closed' | 'error'; notes?: string },
  ): Promise<void> {
    await this.db.query(
      `update bot_trades set status = $2, closed_at = $3, exit = $4, exit_reason = $5, pnl_usd = $6, fees_usd = $7,
              r_multiple = $8, notes = coalesce($9, notes)
       where id = $1`,
      [id, c.status ?? 'closed', ts(c.closedAt), c.exit, c.reason, c.pnlUsd, c.feesUsd, c.r, c.notes ?? null],
    )
  }

  async getState<T>(key: string, fallback: T): Promise<T> {
    const r = await this.db.query('select value from bot_state where key = $1', [key])
    if (!r.rows[0]) return fallback
    const v = r.rows[0].value
    return (typeof v === 'string' ? JSON.parse(v) : v) as T
  }

  async setState(key: string, value: unknown): Promise<void> {
    await this.db.query(
      `insert into bot_state (key, value, updated) values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated = now()`,
      [key, JSON.stringify(value)],
    )
  }

  async risk(): Promise<RiskState> {
    return this.getState<RiskState>('risk', { day: '', dayStartEquity: 0, peakEquity: 0, halted: false, haltReason: '' })
  }

  async equity(t: number, equity: number): Promise<void> {
    await this.db.query('insert into bot_equity (t, equity) values ($1, $2) on conflict (t) do nothing', [ts(t), equity])
  }

  async event(level: 'info' | 'warn' | 'error', symbol: string | null, msg: string): Promise<void> {
    console.log(new Date().toISOString(), level.toUpperCase().padEnd(5), (symbol || '').padEnd(9), msg)
    await this.db.query('insert into bot_events (level, symbol, msg) values ($1, $2, $3)', [level, symbol, msg.slice(0, 2000)]).catch(() => {})
  }
}
