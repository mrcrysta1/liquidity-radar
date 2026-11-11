-- Experimental news strategy N1 (src/news/n1.ts): its paper record. One row
-- per tracked release and asset that N1 evaluated, traded or not, with the
-- reason, and the result once the 24-hour exit has passed. PAPER ONLY: no
-- order is ever placed from it. Run after 010; safe to run again (IF NOT
-- EXISTS). Readable with the anon key like the other bot tables.

create table if not exists news_signals (
  event_time   timestamptz not null,
  asset        text        not null,
  category     text        not null,
  mode         text        not null check (mode in ('continue', 'fade')),
  -- 1 long, -1 short, 0 evaluated and not traded (see reason).
  side         smallint    not null check (side in (-1, 0, 1)),
  reason       text        not null,
  z60          double precision,
  ret60_pct    double precision,
  -- Move from the decision (release + 60 min) to the exit (release + 24 h) in the trade's direction, %, before / after costs.
  gross_pct    double precision,
  net_pct      double precision,
  decided_at   timestamptz not null,
  evaluated    timestamptz not null default now(),
  primary key (event_time, asset)
);
create index if not exists news_signals_time on news_signals (event_time desc);

alter table news_signals enable row level security;
drop policy if exists "public read" on news_signals;
create policy "public read" on news_signals for select to anon using (true);
