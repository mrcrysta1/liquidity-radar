-- Snapshots of what the bot has learned (src/bot/backup.ts): every champion
-- model (both networks per market), every online calibration row and the
-- learning's bot_state keys, as one JSON payload per backup. Written by
-- `npm run backup-models`, read by `npm run restore-models`. Never written by
-- the bot itself. Safe to run again (IF NOT EXISTS). Row level security on
-- and no policy: the anon key cannot read it (the website does not need it).

create table if not exists bot_backups (
  id        bigserial   primary key,
  kind      text        not null check (kind in ('models')),
  label     text        not null,
  taken_at  timestamptz not null,
  digest    text        not null,
  payload   jsonb       not null,
  created   timestamptz not null default now()
);
create index if not exists bot_backups_kind on bot_backups (kind, taken_at desc);

alter table bot_backups enable row level security;
