-- Market context (src/context/collect.ts): one row per 4h bar with BTC's
-- regime and direction on 15m / 1h / 4h, gold's 4h direction, and the whole
-- snapshot (correlations with BTC, gold, dollar index, yields). The latest
-- snapshot is also in bot_state 'context:latest'. Run after 008; safe to run
-- again (IF NOT EXISTS). Readable with the anon key like the other bot tables.
--
-- bar_time is the close of the 4h bar the snapshot belongs to; a later
-- snapshot in the same bar replaces it, so the row holds the bar's last view.

create table if not exists market_context (
  bar_time     timestamptz primary key,
  regime       text        not null check (regime in ('strong-bull', 'weak-bull', 'sideways', 'weak-bear', 'strong-bear', 'high-volatility', 'uncertain')),
  btc_dir_4h   text,
  btc_dir_1h   text,
  btc_dir_15m  text,
  gold_dir_4h  text,
  snapshot     jsonb       not null,
  updated      timestamptz not null default now()
);

alter table market_context enable row level security;
drop policy if exists "public read" on market_context;
create policy "public read" on market_context for select to anon using (true);
