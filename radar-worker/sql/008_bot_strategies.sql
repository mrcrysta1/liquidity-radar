-- Multi-strategy bot (BOT_STRATEGIES, src/bot/strategies.ts): which strategy
-- made each real and shadow trade, and shadow trades for rule strategies.
-- Run after 007_bot_trend.sql (the trading-bot workflow applies it on every
-- run). Safe to run again: columns are IF NOT EXISTS, constraints are dropped
-- and re-created, and dropping NOT NULL twice is a no-op.
--
-- strategy: 'f1', 'ml', ... Null on rows from before this file: a 'trend'
-- real trade is F1's, every other row the model's.
--
-- A rule strategy's shadow trade has no model (model_id, p_raw, p_cal, ev_r
-- null), no target (tp null) and no time limit (horizon null); sl is its
-- initial stop. It closes as 'sl', 'trail' or 'signal', resolved with the
-- strategy's own exit logic. Per-strategy health lives in bot_state
-- 'strategy:<id>' (no schema change).

alter table bot_trades        add column if not exists strategy text;
alter table bot_shadow_trades add column if not exists strategy text;

alter table bot_shadow_trades alter column tp      drop not null;
alter table bot_shadow_trades alter column horizon drop not null;
alter table bot_shadow_trades alter column p_raw   drop not null;
alter table bot_shadow_trades alter column p_cal   drop not null;
alter table bot_shadow_trades alter column ev_r    drop not null;

alter table bot_shadow_trades drop constraint if exists bot_shadow_trades_exit_reason_check;
alter table bot_shadow_trades add constraint bot_shadow_trades_exit_reason_check
  check (exit_reason in ('tp', 'sl', 'time', 'trail', 'signal'));

create index if not exists bot_shadow_strategy on bot_shadow_trades (strategy, closed_at) where status = 'closed';

-- Read access is unchanged: 002_bot.sql and 005_bot_learning.sql already let
-- the anon key select every column of bot_trades and bot_shadow_trades.
