-- Per-user app settings for signed-in users: indicators, theme, palette,
-- favourite coins, chart layout, alerts, paper-trading records, and so on.
-- One row per user; `data` maps each saved setting's key to its stored value.
-- Run once in the Supabase SQL editor (or with scripts/apply-sql.mjs).
--
-- Row-level security: a signed-in user can read and write only their own row.
-- The anon key alone can read nothing here.

create table if not exists user_settings (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table user_settings enable row level security;

drop policy if exists "own settings: read" on user_settings;
drop policy if exists "own settings: insert" on user_settings;
drop policy if exists "own settings: update" on user_settings;
drop policy if exists "own settings: delete" on user_settings;

create policy "own settings: read" on user_settings
  for select to authenticated using (auth.uid() = user_id);
create policy "own settings: insert" on user_settings
  for insert to authenticated with check (auth.uid() = user_id);
create policy "own settings: update" on user_settings
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own settings: delete" on user_settings
  for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on user_settings to authenticated;
revoke all on user_settings from anon;
