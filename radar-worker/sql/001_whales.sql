-- Whale history, written by radar-worker, read by the chart.
-- Run once in the Supabase SQL editor (or psql) for a new project.

-- One row per reconstructed taker order: consecutive Binance spot aggTrades
-- sharing a transaction time and side (see whaleMath.ts groupAggTrades).
create table if not exists whale_orders (
  symbol  text             not null,
  a0      bigint           not null,  -- first aggTrade id
  a1      bigint           not null,  -- last aggTrade id
  t       timestamptz      not null,  -- transaction time
  price   double precision not null,  -- volume-weighted average fill price
  usd     double precision not null,  -- notional, quote currency
  qty     double precision not null,  -- base quantity
  side    smallint         not null check (side in (-1, 1)),  -- 1 = market buy, -1 = market sell
  fills   integer          not null,
  primary key (symbol, a0)
);
create index if not exists whale_orders_symbol_t on whale_orders (symbol, t);

-- Stretches of the tape that have been scanned end to end. The chart uses
-- this to tell "no whales traded" apart from "not scanned".
create table if not exists whale_coverage (
  symbol text        not null,
  a0     bigint      not null,
  a1     bigint      not null,
  t0     timestamptz not null,
  t1     timestamptz not null,
  primary key (symbol, a0)
);

-- Per-symbol settings the worker fixes on first run, so every row in the
-- table was kept under the same rule.
create table if not exists whale_symbols (
  symbol   text primary key,
  floor    double precision not null,  -- smallest order stored, USD
  auto     double precision not null,  -- default display threshold, USD
  updated  timestamptz not null default now()
);

-- The browser reads with the public anon key: read-only, and only these tables.
alter table whale_orders   enable row level security;
alter table whale_coverage enable row level security;
alter table whale_symbols  enable row level security;
drop policy if exists "public read" on whale_orders;
drop policy if exists "public read" on whale_coverage;
drop policy if exists "public read" on whale_symbols;
create policy "public read" on whale_orders   for select to anon using (true);
create policy "public read" on whale_coverage for select to anon using (true);
create policy "public read" on whale_symbols  for select to anon using (true);
-- No insert/update/delete policies: only the worker, connecting with the
-- database password (which bypasses RLS), can write.
