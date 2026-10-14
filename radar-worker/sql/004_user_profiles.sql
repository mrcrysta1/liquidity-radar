-- Profile details for signed-in users. Google sign-ins fill this from the
-- Google People API with the permissions the user granted on Google's
-- consent screen (name, email, photo, and — if allowed — phone, birthday,
-- gender, addresses, organisation / work, locale). Email sign-ups store their
-- name and email. Fields the user did not share, or never set on Google,
-- stay empty.
--
-- Row-level security: a user can read and update only their own profile.
-- The site owner sees every row in the Supabase dashboard (Table Editor).

create table if not exists user_profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  provider       text        not null default 'email',
  name           text,
  given_name     text,
  family_name    text,
  email          text,
  email_verified boolean,
  phones         jsonb       not null default '[]'::jsonb,  -- [{value, type}]
  photo_url      text,
  birthday       text,                                       -- YYYY-MM-DD, or --MM-DD without a year
  gender         text,
  addresses      jsonb       not null default '[]'::jsonb,  -- [{formatted, type, city, region, country, postalCode}]
  organizations  jsonb       not null default '[]'::jsonb,  -- [{name, title, department}]
  locale         text,
  scopes         text[]      not null default '{}',         -- Google permissions granted
  raw            jsonb,                                      -- the People API response as received
  updated_at     timestamptz not null default now()
);

alter table user_profiles enable row level security;

drop policy if exists "own profile: read" on user_profiles;
drop policy if exists "own profile: insert" on user_profiles;
drop policy if exists "own profile: update" on user_profiles;

create policy "own profile: read" on user_profiles
  for select to authenticated using (auth.uid() = user_id);
create policy "own profile: insert" on user_profiles
  for insert to authenticated with check (auth.uid() = user_id);
create policy "own profile: update" on user_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on user_profiles to authenticated;
revoke all on user_profiles from anon;
