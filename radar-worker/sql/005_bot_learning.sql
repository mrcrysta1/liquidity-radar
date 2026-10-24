-- Trading bot learning: champion/challenger model versions, shadow trades,
-- online win-probability calibration, and performance metrics for the site.
-- Run once in the Supabase SQL editor after 002_bot.sql (or with
-- scripts/apply-sql.mjs). Safe to run again: everything is IF NOT EXISTS.

-- Model versions. Rows from before this file count as champions.
alter table bot_models add column if not exists version     integer;
alter table bot_models add column if not exists role        text not null default 'champion';
alter table bot_models add column if not exists holdout     jsonb;          -- challenger vs champion on the held-out slice
alter table bot_models add column if not exists promoted_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bot_models_role_check') then
    alter table bot_models add constraint bot_models_role_check check (role in ('champion', 'challenger', 'retired'));
  end if;
end $$;
create index if not exists bot_models_role on bot_models (symbol, interval, role, created_at desc);

-- Real trades: what the learning needs to know about each one.
alter table bot_trades add column if not exists p_raw   double precision;  -- model probability before calibration (p_win is after)
alter table bot_trades add column if not exists regime  text;              -- e.g. 'up-hi': trend × volatility tercile
alter table bot_trades add column if not exists cost_r  double precision;  -- estimated round-trip cost in R (stop-exit case)
alter table bot_trades add column if not exists rr_net  double precision;  -- reward:risk after estimated costs
alter table bot_trades add column if not exists learned boolean not null default false; -- calibration has used it
create index if not exists bot_trades_unlearned on bot_trades (symbol, closed_at) where not learned;

-- Shadow trades: setups rejected only by the model's EV / gate verdict, traded
-- virtually on market bars (no orders) so the model learns from them too.
create table if not exists bot_shadow_trades (
  id           bigserial primary key,
  symbol       text        not null,
  model_id     bigint      references bot_models (id),
  side         smallint    not null check (side in (-1, 1)),
  status       text        not null check (status in ('open', 'closed', 'expired')),
  created_at   timestamptz not null default now(),
  bar_time     timestamptz not null,          -- the closed bar the decision was made on
  closed_at    timestamptz,                   -- close of the bar that decided it
  entry        double precision not null,     -- that bar's close
  exit         double precision,
  sl           double precision not null,
  tp           double precision not null,
  atr          double precision not null,
  horizon      integer     not null,          -- bars until the time exit
  exit_reason  text check (exit_reason in ('tp', 'sl', 'time')),
  r_gross      double precision,              -- R before costs
  r_net        double precision,              -- R after estimated fees + slippage
  p_raw        double precision not null,
  p_cal        double precision not null,
  ev_r         double precision not null,
  cost_r       double precision,
  rr_net       double precision,
  regime       text,
  reject_reason text,
  features     jsonb       not null,
  learned      boolean     not null default false
);
create index if not exists bot_shadow_symbol on bot_shadow_trades (symbol, bar_time desc);
create index if not exists bot_shadow_open on bot_shadow_trades (symbol) where status = 'open';
create index if not exists bot_shadow_unlearned on bot_shadow_trades (symbol, closed_at) where not learned;

-- Online calibration, p' = sigmoid(a + b * logit(p)), per symbol, side and
-- regime. Updated on every closed real or shadow trade; independent of the
-- model version, so it survives retrains.
create table if not exists bot_calibration (
  symbol   text     not null,
  side     smallint not null check (side in (-1, 1)),
  regime   text     not null,
  a        double precision not null default 0,
  b        double precision not null default 1,
  n        integer  not null default 0,
  wins     integer  not null default 0,
  updated  timestamptz not null default now(),
  primary key (symbol, side, regime)
);

-- Hourly performance snapshots (the latest is also in bot_state 'metrics').
create table if not exists bot_metrics (
  t        timestamptz primary key,
  metrics  jsonb not null
);

-- Same access as 002_bot.sql: the Neural Net page reads with the anon key.
do $$
declare t text;
begin
  foreach t in array array['bot_shadow_trades', 'bot_calibration', 'bot_metrics'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select to anon using (true)', t);
  end loop;
end $$;
