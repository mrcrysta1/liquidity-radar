-- Trading bot: model versions, every trade, equity, control switch, events.
-- Run once in the Supabase SQL editor after 001_whales.sql.

-- One row per trained model. Every trade points at the model that made it,
-- so results can be compared version by version.
create table if not exists bot_models (
  id            bigserial primary key,
  symbol        text        not null,
  interval      text        not null,
  created_at    timestamptz not null default now(),
  trained_from  timestamptz not null,
  trained_to    timestamptz not null,
  cfg           jsonb       not null,   -- bracket, costs, thresholds, network shape
  metrics       jsonb       not null,   -- walk-forward, out-of-sample only
  gate_pass     boolean     not null,
  gate_reasons  text[]      not null default '{}',
  model         jsonb       not null    -- weights + scalers: enough to reproduce every decision
);
create index if not exists bot_models_symbol on bot_models (symbol, created_at desc);

create table if not exists bot_trades (
  id              bigserial primary key,
  symbol          text        not null,
  model_id        bigint      references bot_models (id),
  mode            text        not null check (mode in ('gated', 'explore')),
  venue           text        not null,          -- exchange base URL (testnet or mainnet)
  side            smallint    not null check (side in (-1, 1)),
  status          text        not null check (status in ('open', 'closed', 'error')),
  opened_at       timestamptz not null,
  closed_at       timestamptz,
  bar_time        timestamptz not null,          -- the closed bar the decision was made on
  entry           double precision not null,     -- actual average fill
  exit            double precision,
  qty             double precision not null,
  sl              double precision not null,
  tp              double precision not null,
  atr             double precision not null,
  risk_usd        double precision not null,
  exit_reason     text check (exit_reason in ('tp', 'sl', 'time', 'manual', 'error')),
  pnl_usd         double precision,              -- realised, after fees
  fees_usd        double precision,
  r_multiple      double precision,              -- pnl_usd / risk_usd
  p_win           double precision not null,     -- model probability for the side taken
  ev_r            double precision not null,     -- model expected value, in R after costs
  features        jsonb       not null,          -- the exact inputs the model saw
  entry_order_id  bigint,
  tp_order_id     bigint,
  sl_algo_id      bigint,
  notes           text
);
create index if not exists bot_trades_symbol on bot_trades (symbol, opened_at desc);
create unique index if not exists bot_trades_one_open on bot_trades (symbol) where status = 'open';

create table if not exists bot_equity (
  t       timestamptz primary key,
  equity  double precision not null
);

-- Key/value control and risk state. {"enabled": false} under key 'control'
-- stops new entries (open positions keep their exchange-side stop and target).
create table if not exists bot_state (
  key      text primary key,
  value    jsonb not null,
  updated  timestamptz not null default now()
);
insert into bot_state (key, value) values ('control', '{"enabled": true}') on conflict do nothing;

create table if not exists bot_events (
  id      bigserial primary key,
  t       timestamptz not null default now(),
  symbol  text,
  level   text not null check (level in ('info', 'warn', 'error')),
  msg     text not null
);
create index if not exists bot_events_t on bot_events (t desc);

-- The Neural Net page reads with the public anon key. These are testnet
-- records; drop these policies if you would rather keep them private.
do $$
declare t text;
begin
  foreach t in array array['bot_models', 'bot_trades', 'bot_equity', 'bot_state', 'bot_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select to anon using (true)', t);
  end loop;
end $$;
