-- Bot privacy: what the public anon key (shipped in the browser bundle as
-- VITE_WHALE_DB_KEY) may read from the bot tables.
-- Run after 008_bot_strategies.sql (the trading-bot workflow applies it on
-- every run, after 005-008). Safe to run again: policies are dropped and
-- re-created, grants and revokes are idempotent.
--
-- 002_bot.sql and 005_bot_learning.sql gave anon `select ... using (true)` on
-- every bot table. That exposed, besides the public dashboard data:
--   bot_state 'account'   Binance account snapshot (balances, positions,
--                         open orders, fills) — now served only by the
--                         website's /api/bot-account (service-role key)
--   bot_state 'c6:model'  C6 model trees
--   bot_state 'risk', 'lastHalt', 'learn:*', 'lastBar:*', 'closing:*',
--             'selftest:*', 'alerts:*'  internal loop / risk state
--   bot_models.model      weights + scalers;  bot_models.cfg  model config
--   bot_calibration       the online calibration coefficients
--
-- After this file anon reads:
--   bot_state       only keys 'control', 'heartbeat', 'metrics', 'strategy:*',
--                   'plan:*', 'wf:*' (an allow-list: a new key is private until
--                   added here)
--   bot_models      every column except model and cfg (column privileges;
--                   `select=*` by anon now fails, name the columns)
--   bot_calibration nothing
--   bot_trades, bot_shadow_trades, bot_equity, bot_events, bot_metrics:
--                   unchanged (public dashboards, trade journal)
-- The bot connects as the table owner (DATABASE_URL) and the website's server
-- endpoint as service_role: RLS and these grants do not apply to either.
--
-- NOTE: re-running 002_bot.sql re-creates "public read" (using true) on
-- bot_state; run this file again afterwards.
--
-- ROLLBACK (restores the 002/005 behaviour exactly):
--   drop policy if exists "public read: public keys" on bot_state;
--   drop policy if exists "public read" on bot_state;
--   create policy "public read" on bot_state for select to anon using (true);
--   grant select on bot_models to anon, authenticated;
--   grant select on bot_calibration to anon, authenticated;

-- bot_state: an allow-list of keys instead of every row.
alter table bot_state enable row level security;
drop policy if exists "public read" on bot_state;
drop policy if exists "public read: public keys" on bot_state;
create policy "public read: public keys" on bot_state for select to anon using (
  key in ('control', 'heartbeat', 'metrics')
  or key like 'strategy:%'
  or key like 'plan:%'
  or key like 'wf:%'
);

-- bot_models: metadata columns only (the model registry and journal versions
-- on the website use id, symbol, interval, version, role, created_at,
-- promoted_at, gate_pass, holdout). Not model (weights) or cfg.
-- bot_calibration: no anon access (the website does not read it).
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke select on bot_models from %I', r);
      execute format('revoke select on bot_calibration from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select (id, symbol, interval, created_at, trained_from, trained_to, metrics, gate_pass, gate_reasons,
                  version, role, holdout, promoted_at)
      on bot_models to anon;
  end if;
end $$;
