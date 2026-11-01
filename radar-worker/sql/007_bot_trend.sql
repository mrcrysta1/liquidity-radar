-- Trend strategy F1 (BOT_STRATEGY=trend, src/bot/strategy.ts): real trades
-- with a trailing stop and no take-profit, made by rules rather than the model.
-- Run after 006_bot_journal.sql (the trading-bot workflow applies it on every
-- run). Safe to run again: columns are IF NOT EXISTS, constraints are dropped
-- and re-created, and dropping NOT NULL twice is a no-op.
--
-- A trend trade has mode 'trend', no model (model_id, p_win, ev_r null), no
-- target (tp null) and sl = the CURRENT stop, raised as it trails. It closes as
-- 'sl' (initial stop hit), 'trail' (a raised stop hit) or 'signal' (rule exit).
-- The ML model keeps paper-trading beside it in bot_shadow_trades, unchanged.

alter table bot_trades alter column tp    drop not null;
alter table bot_trades alter column p_win drop not null;
alter table bot_trades alter column ev_r  drop not null;

alter table bot_trades drop constraint if exists bot_trades_mode_check;
alter table bot_trades add constraint bot_trades_mode_check check (mode in ('gated', 'explore', 'trend'));
alter table bot_trades drop constraint if exists bot_trades_exit_reason_check;
alter table bot_trades add constraint bot_trades_exit_reason_check
  check (exit_reason in ('tp', 'sl', 'time', 'manual', 'error', 'trail', 'signal'));

alter table bot_trades add column if not exists initial_sl double precision;  -- the stop at entry (1R); sl is the current one
alter table bot_trades add column if not exists trail_high double precision;  -- highest high since entry, over closed bars
alter table bot_trades add column if not exists trail_bar  timestamptz;       -- open time of the last closed bar the trail was updated on

-- Read access is unchanged: 002_bot.sql already lets the anon key select every column of bot_trades.
