-- Trading bot journal: what each real and shadow trade planned, how it went
-- while open, and why it was taken, so every trade can be reviewed later.
-- Run after 005_bot_learning.sql (the trading-bot workflow applies it on every
-- run). Safe to run again: everything is IF NOT EXISTS. Rows from before this
-- file keep nulls in the new columns.
--
-- Columns that already exist and are reused: entry (fill), sl, tp, exit,
-- exit_reason, pnl_usd, fees_usd, r_multiple, p_win (calibrated), p_raw, ev_r,
-- regime, cost_r, rr_net, model_id, features; shadows also r_gross, r_net,
-- p_cal and reject_reason.

-- Real trades.
alter table bot_trades add column if not exists interval       text;              -- candle size the decision was made on
alter table bot_trades add column if not exists model_version  integer;           -- bot_models.version of model_id
alter table bot_trades add column if not exists planned_entry  double precision;  -- close of the decision bar
alter table bot_trades add column if not exists planned_sl     double precision;  -- stop / target as planned from it
alter table bot_trades add column if not exists planned_tp     double precision;
alter table bot_trades add column if not exists slippage_bps   double precision;  -- fill vs planned entry; positive = worse for the trade
alter table bot_trades add column if not exists mae_r          double precision;  -- max adverse excursion while open, in R (<= 0)
alter table bot_trades add column if not exists mfe_r          double precision;  -- max favourable excursion while open, in R (>= 0)
alter table bot_trades add column if not exists bars_held      integer;           -- candles the trade was open in
alter table bot_trades add column if not exists decision       text;              -- the model's summary at entry (both sides, EV, R:R, cost)

-- Shadow trades (the planned entry is the entry: no fill, no slippage).
alter table bot_shadow_trades add column if not exists interval      text;
alter table bot_shadow_trades add column if not exists model_version integer;
alter table bot_shadow_trades add column if not exists mae_r         double precision;
alter table bot_shadow_trades add column if not exists mfe_r         double precision;
alter table bot_shadow_trades add column if not exists bars_held     integer;
alter table bot_shadow_trades add column if not exists decision      text;

-- Read access is unchanged: 002_bot.sql and 005_bot_learning.sql already let
-- the anon key select every column of bot_trades and bot_shadow_trades.
