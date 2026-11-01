// Postgres persistence for the bot (schema in sql/002_bot.sql, sql/005_bot_learning.sql and sql/006_bot_journal.sql).
import type { Db } from '../db.ts'
import type { Model, Metrics } from './walkforward.ts'
import type { RiskState } from './risk.ts'
import { CAL_PRIOR, featureVector } from './learning.ts'
import type { Calib, Experience } from './learning.ts'

export interface ModelRow {
  id: number
  version: number
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
  /** The market order that opened the trade (null on rows from before it was stored). */
  entryOrderId: number | null
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
  /** Model probability before calibration (pWin is after). */
  pRaw?: number
  regime?: string
  costR?: number
  rrNet?: number
  /** Journal (006_bot_journal.sql): what was planned, before the fill. */
  journal?: TradeJournal
}

/** Journal fields recorded at entry, for real and shadow trades alike. */
export interface TradeJournal {
  interval?: string
  modelVersion?: number
  /** The model's summary at entry. */
  decision?: string
  /** Real trades only: the planned entry (decision bar close), stop and target, and the fill's slippage. */
  plannedEntry?: number
  plannedSl?: number
  plannedTp?: number
  slippageBps?: number | null
}

/** Journal fields recorded when a trade closes. */
export interface CloseJournal {
  maeR?: number | null
  mfeR?: number | null
  barsHeld?: number | null
}

export interface NewShadow {
  symbol: string
  modelId: number
  side: 1 | -1
  barTime: number
  entry: number
  sl: number
  tp: number
  atr: number
  horizon: number
  pRaw: number
  pCal: number
  evR: number
  costR: number
  rrNet: number
  regime: string
  rejectReason: string
  features: Record<string, number>
  journal?: TradeJournal
}

export interface OpenShadow {
  id: number
  side: 1 | -1
  barTime: number
  entry: number
  sl: number
  tp: number
  horizon: number
}

/** A closed trade the calibration has not learned from yet. */
export interface Unlearned {
  kind: 'real' | 'shadow'
  id: number
  side: 1 | -1
  pRaw: number
  regime: string | null
  features: unknown
  exit: string
  rGross: number
}

const ts = (ms: number) => new Date(ms).toISOString()

export class BotStore {
  private db: Db
  constructor(db: Db) {
    this.db = db
  }

  /** Store a model version (a challenger unless role says otherwise); returns its id and version. */
  async saveModel(
    symbol: string,
    interval: string,
    m: Model,
    metrics: Metrics | Record<string, unknown>,
    pass: boolean,
    reasons: string[],
    o: { role?: 'champion' | 'challenger'; holdout?: unknown } = {},
  ): Promise<{ id: number; version: number }> {
    const r = await this.db.query(
      `insert into bot_models (symbol, interval, trained_from, trained_to, cfg, metrics, gate_pass, gate_reasons, model, role, holdout, version)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               (select coalesce(max(version), 0) + 1 from bot_models where symbol = $1 and interval = $2))
       returning id, version`,
      [
        symbol,
        interval,
        ts(m.trainedFrom),
        ts(m.trainedTo),
        JSON.stringify(m.cfg),
        JSON.stringify(metrics),
        pass,
        reasons,
        JSON.stringify(m),
        o.role ?? 'challenger',
        o.holdout === undefined ? null : JSON.stringify(o.holdout),
      ],
    )
    return { id: Number(r.rows[0].id), version: Number(r.rows[0].version) }
  }

  /** Make a model the champion; the previous champion is retired. */
  async promote(symbol: string, interval: string, id: number): Promise<void> {
    await this.db.query(`update bot_models set role = 'retired' where symbol = $1 and interval = $2 and role = 'champion' and id <> $3`, [symbol, interval, id])
    await this.db.query(`update bot_models set role = 'champion', promoted_at = now() where id = $1`, [id])
  }

  /** The current champion (rows from before champion/challenger count as champions). */
  async latestModel(symbol: string, interval: string): Promise<ModelRow | null> {
    const r = await this.db.query(
      `select id, coalesce(version, 0) as version, extract(epoch from created_at) * 1000 as created, gate_pass, gate_reasons, metrics, model
       from bot_models where symbol = $1 and interval = $2 and role = 'champion' order by created_at desc, id desc limit 1`,
      [symbol, interval],
    )
    const x = r.rows[0]
    if (!x) return null
    const j = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v)
    return {
      id: Number(x.id),
      version: Number(x.version),
      createdAt: Number(x.created),
      gatePass: x.gate_pass,
      gateReasons: x.gate_reasons || [],
      metrics: j(x.metrics),
      model: j(x.model),
    }
  }

  async openTrade(symbol: string): Promise<OpenTrade | null> {
    const r = await this.db.query(
      `select id, symbol, side, extract(epoch from opened_at) * 1000 as opened, extract(epoch from bar_time) * 1000 as bar,
              entry, qty, sl, tp, risk_usd, tp_order_id, sl_algo_id, entry_order_id
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
      entryOrderId: x.entry_order_id == null ? null : Number(x.entry_order_id),
    }
  }

  async insertTrade(t: NewTrade): Promise<number> {
    const r = await this.db.query(
      `insert into bot_trades (symbol, model_id, mode, venue, side, status, opened_at, bar_time, entry, qty, sl, tp, atr,
                               risk_usd, p_win, ev_r, features, entry_order_id, p_raw, regime, cost_r, rr_net,
                               interval, model_version, decision, planned_entry, planned_sl, planned_tp, slippage_bps)
       values ($1, $2, $3, $4, $5, 'open', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
               $22, $23, $24, $25, $26, $27, $28) returning id`,
      [
        t.symbol,
        t.modelId,
        t.mode,
        t.venue,
        t.side,
        ts(t.openedAt),
        ts(t.barTime),
        t.entry,
        t.qty,
        t.sl,
        t.tp,
        t.atr,
        t.riskUsd,
        t.pWin,
        t.evR,
        JSON.stringify(t.features),
        t.entryOrderId,
        t.pRaw ?? null,
        t.regime ?? null,
        t.costR ?? null,
        t.rrNet ?? null,
        t.journal?.interval ?? null,
        t.journal?.modelVersion ?? null,
        t.journal?.decision?.slice(0, 2000) ?? null,
        t.journal?.plannedEntry ?? null,
        t.journal?.plannedSl ?? null,
        t.journal?.plannedTp ?? null,
        t.journal?.slippageBps ?? null,
      ],
    )
    return Number(r.rows[0].id)
  }

  async setLegs(id: number, tpOrderId: number | null, slAlgoId: number | null): Promise<void> {
    await this.db.query('update bot_trades set tp_order_id = $2, sl_algo_id = $3 where id = $1', [id, tpOrderId, slAlgoId])
  }

  async closeTrade(
    id: number,
    c: { closedAt: number; exit: number; reason: 'tp' | 'sl' | 'time' | 'manual' | 'error'; pnlUsd: number; feesUsd: number; r: number; status?: 'closed' | 'error'; notes?: string } & CloseJournal,
  ): Promise<void> {
    await this.db.query(
      `update bot_trades set status = $2, closed_at = $3, exit = $4, exit_reason = $5, pnl_usd = $6, fees_usd = $7,
              r_multiple = $8, notes = coalesce($9, notes), mae_r = $10, mfe_r = $11, bars_held = $12
       where id = $1`,
      [id, c.status ?? 'closed', ts(c.closedAt), c.exit, c.reason, c.pnlUsd, c.feesUsd, c.r, c.notes ?? null, c.maeR ?? null, c.mfeR ?? null, c.barsHeld ?? null],
    )
  }

  async getState<T>(key: string, fallback: T): Promise<T> {
    const r = await this.db.query('select value from bot_state where key = $1', [key])
    if (!r.rows[0]) return fallback
    const v = r.rows[0].value
    // jsonb comes back already decoded, so a stored string ("error") arrives as a
    // plain JS string. Only a driver that returns raw JSON text needs parsing.
    if (typeof v !== 'string') return v as T
    try {
      return JSON.parse(v) as T
    } catch {
      return v as T
    }
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

  // ---- setup rules ----

  /** Positions open (all symbols), real trades opened since `dayStart`, and this symbol's last stop-out. */
  async setupCounts(symbol: string, dayStart: number): Promise<{ openPositions: number; tradesToday: number; lastStopAt: number | null }> {
    const r = await this.db.query(
      `select (select count(*) from bot_trades where status = 'open') as open,
              (select count(*) from bot_trades where opened_at >= $2) as today,
              (select extract(epoch from max(closed_at)) * 1000 from bot_trades where symbol = $1 and exit_reason = 'sl') as last_stop`,
      [symbol, ts(dayStart)],
    )
    const x = r.rows[0]
    return { openPositions: Number(x.open), tradesToday: Number(x.today), lastStopAt: x.last_stop == null ? null : Math.round(Number(x.last_stop)) }
  }

  // ---- shadow trades ----

  async insertShadow(s: NewShadow): Promise<number> {
    const r = await this.db.query(
      `insert into bot_shadow_trades (symbol, model_id, side, status, bar_time, entry, sl, tp, atr, horizon, p_raw, p_cal, ev_r,
                                      cost_r, rr_net, regime, reject_reason, features, interval, model_version, decision)
       values ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) returning id`,
      [
        s.symbol,
        s.modelId,
        s.side,
        ts(s.barTime),
        s.entry,
        s.sl,
        s.tp,
        s.atr,
        s.horizon,
        s.pRaw,
        s.pCal,
        s.evR,
        s.costR,
        s.rrNet,
        s.regime,
        s.rejectReason.slice(0, 500),
        JSON.stringify(s.features),
        s.journal?.interval ?? null,
        s.journal?.modelVersion ?? null,
        s.journal?.decision?.slice(0, 2000) ?? null,
      ],
    )
    return Number(r.rows[0].id)
  }

  async openShadows(symbol: string): Promise<OpenShadow[]> {
    const r = await this.db.query(
      `select id, side, extract(epoch from bar_time) * 1000 as bar, entry, sl, tp, horizon
       from bot_shadow_trades where symbol = $1 and status = 'open' order by bar_time`,
      [symbol],
    )
    return r.rows.map((x) => ({
      id: Number(x.id),
      side: Number(x.side) > 0 ? 1 : -1,
      barTime: Math.round(Number(x.bar)),
      entry: Number(x.entry),
      sl: Number(x.sl),
      tp: Number(x.tp),
      horizon: Number(x.horizon),
    }))
  }

  async closeShadow(
    id: number,
    c: { status: 'closed' | 'expired'; closedAt?: number; exit?: number; reason?: 'tp' | 'sl' | 'time'; rGross?: number; rNet?: number } & CloseJournal,
  ): Promise<void> {
    // An expired shadow has no outcome: nothing to learn from it.
    await this.db.query(
      `update bot_shadow_trades set status = $2, closed_at = $3, exit = $4, exit_reason = $5, r_gross = $6, r_net = $7,
              learned = learned or $2 = 'expired', mae_r = $8, mfe_r = $9, bars_held = $10
       where id = $1 and status = 'open'`,
      [id, c.status, c.closedAt == null ? null : ts(c.closedAt), c.exit ?? null, c.reason ?? null, c.rGross ?? null, c.rNet ?? null, c.maeR ?? null, c.mfeR ?? null, c.barsHeld ?? null],
    )
  }

  // ---- learning ----

  async calibration(symbol: string, side: 1 | -1, regime: string): Promise<Calib> {
    const r = await this.db.query('select a, b, n, wins from bot_calibration where symbol = $1 and side = $2 and regime = $3', [symbol, side, regime])
    const x = r.rows[0]
    return x ? { a: Number(x.a), b: Number(x.b), n: Number(x.n), wins: Number(x.wins) } : { ...CAL_PRIOR }
  }

  async saveCalibration(symbol: string, side: 1 | -1, regime: string, c: Calib): Promise<void> {
    await this.db.query(
      `insert into bot_calibration (symbol, side, regime, a, b, n, wins, updated) values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (symbol, side, regime) do update set a = excluded.a, b = excluded.b, n = excluded.n, wins = excluded.wins, updated = now()`,
      [symbol, side, regime, c.a, c.b, c.n, c.wins],
    )
  }

  /** Closed real and shadow trades the calibration has not used yet, oldest first. */
  async unlearned(symbol: string, limit = 500): Promise<Unlearned[]> {
    const r = await this.db.query(
      `select * from (
         select 'real' as kind, id, side, coalesce(p_raw, p_win) as p, regime, features, exit_reason as exit,
                r_multiple + coalesce(fees_usd, 0) / nullif(risk_usd, 0) as r_gross, closed_at
         from bot_trades where symbol = $1 and status = 'closed' and not learned
         union all
         select 'shadow', id, side, p_raw, regime, features, exit_reason, r_gross, closed_at
         from bot_shadow_trades where symbol = $1 and status = 'closed' and not learned
       ) u order by closed_at limit $2`,
      [symbol, limit],
    )
    return r.rows.map((x) => ({
      kind: x.kind === 'shadow' ? 'shadow' : 'real',
      id: Number(x.id),
      side: Number(x.side) > 0 ? 1 : -1,
      pRaw: Number(x.p),
      regime: x.regime ?? null,
      features: x.features,
      exit: String(x.exit ?? ''),
      rGross: Number(x.r_gross ?? 0),
    }))
  }

  async markLearned(kind: 'real' | 'shadow', ids: number[]): Promise<void> {
    if (!ids.length) return
    await this.db.query(`update ${kind === 'real' ? 'bot_trades' : 'bot_shadow_trades'} set learned = true where id = any($1::bigint[])`, [ids])
  }

  /** Closed real and shadow trades made under this bracket, oldest first, as training / evaluation data. */
  async experience(symbol: string, bracket: unknown, limit = 5000): Promise<Experience[]> {
    const r = await this.db.query(
      `select * from (
         select t.features, t.side, extract(epoch from t.bar_time) * 1000 as bar, extract(epoch from t.closed_at) * 1000 as closed,
                t.r_multiple + coalesce(t.fees_usd, 0) / nullif(t.risk_usd, 0) as r_gross, t.r_multiple as r_net, t.entry,
                abs(t.entry - t.sl) as sl_dist
         from bot_trades t join bot_models m on m.id = t.model_id
         where t.symbol = $1 and t.status = 'closed' and t.exit_reason in ('tp', 'sl', 'time') and t.risk_usd > 0
           and m.cfg -> 'bracket' = $2::jsonb
         union all
         select s.features, s.side, extract(epoch from s.bar_time) * 1000, extract(epoch from s.closed_at) * 1000,
                s.r_gross, s.r_net, s.entry, abs(s.entry - s.sl)
         from bot_shadow_trades s join bot_models m on m.id = s.model_id
         where s.symbol = $1 and s.status = 'closed' and m.cfg -> 'bracket' = $2::jsonb
       ) e order by closed desc limit $3`,
      [symbol, JSON.stringify(bracket), limit],
    )
    const out: Experience[] = []
    for (const x of r.rows) {
      const v = featureVector(x.features)
      const e = {
        side: (Number(x.side) > 0 ? 1 : -1) as 1 | -1,
        rGross: Number(x.r_gross),
        rNet: Number(x.r_net),
        barTime: Number(x.bar),
        closedAt: Number(x.closed),
        entry: Number(x.entry),
        slDist: Number(x.sl_dist),
      }
      if (v && [e.rGross, e.rNet, e.barTime, e.closedAt, e.entry].every(isFinite) && e.slDist > 0) out.push({ x: v, ...e })
    }
    return out.reverse()
  }

  // ---- metrics ----

  /** Raw inputs for the performance figures since `since`. */
  async metricInputs(since: number): Promise<{
    real: Array<{ symbol: string; r: number }>
    shadow: Array<{ symbol: string; r: number }>
    calib: Array<{ p: number; y: number }>
    equity: number[]
    models: Array<{ symbol: string; interval: string; id: number; version: number; createdAt: number }>
  }> {
    const real = await this.db.query(
      `select symbol, r_multiple from bot_trades where status = 'closed' and r_multiple is not null and closed_at >= $1 order by closed_at`,
      [ts(since)],
    )
    const shadow = await this.db.query(`select symbol, r_net from bot_shadow_trades where status = 'closed' and closed_at >= $1 order by closed_at`, [ts(since)])
    // Calibrated probability at decision time vs the outcome (real trades since calibration existed, and shadows).
    const calib = await this.db.query(
      `select p_win as p, case when exit_reason = 'tp' then 1 when exit_reason = 'sl' then 0
                               when r_multiple + coalesce(fees_usd, 0) / nullif(risk_usd, 0) > 0 then 1 else 0 end as y
       from bot_trades where status = 'closed' and p_raw is not null and closed_at >= $1
       union all
       select p_cal, case when r_gross > 0 then 1 else 0 end from bot_shadow_trades where status = 'closed' and closed_at >= $1`,
      [ts(since)],
    )
    const equity = await this.db.query('select equity from bot_equity where t >= $1 order by t', [ts(since)])
    const models = await this.db.query(
      `select distinct on (symbol, interval) symbol, interval, id, coalesce(version, 0) as version, extract(epoch from created_at) * 1000 as created
       from bot_models where role = 'champion' order by symbol, interval, created_at desc, id desc`,
    )
    return {
      real: real.rows.map((x) => ({ symbol: x.symbol, r: Number(x.r_multiple) })),
      shadow: shadow.rows.map((x) => ({ symbol: x.symbol, r: Number(x.r_net) })),
      calib: calib.rows.map((x) => ({ p: Number(x.p), y: Number(x.y) })),
      equity: equity.rows.map((x) => Number(x.equity)),
      models: models.rows.map((x) => ({ symbol: x.symbol, interval: x.interval, id: Number(x.id), version: Number(x.version), createdAt: Math.round(Number(x.created)) })),
    }
  }

  /** Latest figures in bot_state 'metrics' (the site reads it), plus an hourly history row. */
  async saveMetrics(t: number, m: unknown): Promise<void> {
    await this.setState('metrics', m)
    await this.db.query('insert into bot_metrics (t, metrics) values ($1, $2) on conflict (t) do update set metrics = excluded.metrics', [
      ts(t - (t % 3_600_000)),
      JSON.stringify(m),
    ])
  }

  async event(level: 'info' | 'warn' | 'error', symbol: string | null, msg: string): Promise<void> {
    console.log(new Date().toISOString(), level.toUpperCase().padEnd(5), (symbol || '').padEnd(9), msg)
    await this.db.query('insert into bot_events (level, symbol, msg) values ($1, $2, $3)', [level, symbol, msg.slice(0, 2000)]).catch(() => {})
  }
}
