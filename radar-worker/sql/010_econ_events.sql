-- Economic events and the market's reaction to them (src/news/, research plan
-- P4). Run after 009; safe to run again (IF NOT EXISTS). Readable with the
-- anon key like the other bot tables.
--
-- econ_events: one row per indicator per release and source, de-duplicated on
-- `key` (source | country | title | minute). Forward rows come from the Forex
-- Factory weekly calendar (forecast, previous; actual when it has it) and the
-- agency calendar the website already uses (actual, revised previous); past
-- release dates from FRED and FOMC meetings from the Fed's calendar (no historical consensus forecasts exist
-- for free, so past rows have no forecast and no surprise). Values are kept as
-- published (text) and parsed (numeric) when they are numbers.
--
-- econ_reactions: per release time (not per row: several indicators share one
-- release) and asset, the log return from the last close before the release
-- to +15 min / 1 h / 4 h / 24 h, and that return in units of the asset's
-- typical move over the same horizon in the 30 days before (z). Market
-- reaction only: it says nothing about why the market moved.

create table if not exists econ_events (
  id             bigserial primary key,
  key            text        not null unique,
  source         text        not null,
  category       text        not null,
  title          text        not null,
  country        text        not null,
  impact         text,
  event_time     timestamptz not null,
  period         text,
  unit           text,
  previous       text,
  forecast       text,
  actual         text,
  previous_num   double precision,
  forecast_num   double precision,
  actual_num     double precision,
  -- The previous value as revised in a later source (e.g. the agency's), when it differs.
  revised_previous_num double precision,
  surprise       double precision,
  -- FOMC: 'hike' | 'cut' | 'hold' and the new upper target, from the target series.
  decision       text,
  first_seen     timestamptz not null default now(),
  updated        timestamptz not null default now()
);
-- Sources: 'ff' (Forex Factory), 'agency' (agency calendar), 'fred' (FRED release dates), 'fed' (the Fed's FOMC calendar).
alter table econ_events drop constraint if exists econ_events_source_check;
alter table econ_events add constraint econ_events_source_check check (source in ('ff', 'agency', 'fred', 'fed'));
create index if not exists econ_events_time on econ_events (event_time);
create index if not exists econ_events_cat on econ_events (category, event_time);

create table if not exists econ_reactions (
  event_time   timestamptz not null,
  asset        text        not null,
  horizon_min  integer     not null,
  ret_pct      double precision not null,
  -- Return ÷ the standard deviation of same-horizon returns over the prior 30 days.
  z            double precision,
  -- High-low range over the horizon, % of the base price.
  range_pct    double precision,
  base_price   double precision not null,
  computed     timestamptz not null default now(),
  primary key (event_time, asset, horizon_min)
);

do $$
declare t text;
begin
  foreach t in array array['econ_events', 'econ_reactions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format('create policy "public read" on %I for select to anon using (true)', t);
  end loop;
end $$;
