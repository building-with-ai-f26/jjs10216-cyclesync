-- CycleSync live database (Supabase / Postgres). Build 3.
--
-- How to use: paste this whole file into Supabase → SQL Editor → Run.
-- It is safe to run more than once. It contains no keys.
--
-- The lock, in plain words:
--   * Only the app's server may touch these tables. It connects with the
--     SECRET key, which uses the `service_role` database role.
--   * The PUBLISHABLE key (role `anon`) and signed-in users (role
--     `authenticated`) get no access at all: no grants, plus Row Level
--     Security with no policies. Either lock alone would stop them; we use both.
--   * "Automatically expose new tables" is OFF in this project, so nothing is
--     reachable through the API unless a GRANT below says so.

-- ============================================================
-- 1. Tables
-- ============================================================

-- One row per friend tester. We store a SHA-256 hash of the invite code,
-- never the code itself. `label` is a nickname like "tester-3", not a real name.
create table if not exists public.invites (
  id          uuid primary key default gen_random_uuid(),
  code_hash   text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  label       text not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz            -- set this to revoke a forwarded link
);

-- Onboarding answers for one anonymous browser ID, tied to the invite that created it.
create table if not exists public.profiles (
  user_id     uuid primary key,
  invite_id   uuid not null references public.invites (id) on delete cascade,
  data        jsonb not null,        -- the onboarding answers, same shape as the local JSON file
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One row per check-in: answers, cycle day/phase, safety result or
-- recommendation, model, tokens and cost (all inside `data`), plus her response.
create table if not exists public.checkins (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (user_id) on delete cascade,
  invite_id     uuid not null references public.invites (id) on delete cascade,
  checkin_date  date not null,
  source        text not null,       -- ai / mock / mock-fallback / fallback / safety
  data          jsonb not null,
  response      text check (response in ('do_this', 'original_plan', 'something_else', 'rest')),
  responded_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- One row each time an invite is allowed an AI check-in. Used only by the rate limit.
create table if not exists public.ai_calls (
  id          uuid primary key default gen_random_uuid(),
  invite_id   uuid not null references public.invites (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create index if not exists profiles_invite_idx     on public.profiles (invite_id);
create index if not exists checkins_user_idx       on public.checkins (user_id, created_at);
create index if not exists ai_calls_invite_idx     on public.ai_calls (invite_id, created_at);
create index if not exists ai_calls_created_idx    on public.ai_calls (created_at);

-- ============================================================
-- 2. Row Level Security on every table, with NO policies.
--    No policy = anon and authenticated can't see or change any row.
--    (service_role skips RLS by design; that's the server.)
-- ============================================================

alter table public.invites  enable row level security;
alter table public.profiles enable row level security;
alter table public.checkins enable row level security;
alter table public.ai_calls enable row level security;

-- ============================================================
-- 3. Table access: server only.
-- ============================================================

revoke all on table public.invites, public.profiles, public.checkins, public.ai_calls
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.invites, public.profiles, public.checkins, public.ai_calls
  to service_role;

-- ============================================================
-- 4. Rate limit: take_ai_slot(invite_id)
--
-- Called by the server BEFORE each AI check-in. In one transaction it:
--   1. waits its turn (a lock, so 30 calls at once are handled one by one),
--   2. checks the invite exists and isn't revoked,
--   3. counts recent AI calls,
--   4. records a new call only if every limit allows it.
-- Returns 'ok', or why not: 'invalid_invite', 'per_10_min', 'per_day', 'global_day'.
-- Limits (Plan.md B3-5): 5 per 10 minutes and 20 per day per invite; 300 per day overall.
-- ============================================================

create or replace function public.take_ai_slot(p_invite_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  recent_count int;
  day_count    int;
  global_count int;
begin
  -- One AI check-in decision at a time, app-wide. Fine at friend-tester scale.
  perform pg_advisory_xact_lock(hashtext('cyclesync.take_ai_slot'));

  if not exists (
    select 1 from public.invites where id = p_invite_id and revoked_at is null
  ) then
    return 'invalid_invite';
  end if;

  select count(*) into recent_count from public.ai_calls
    where invite_id = p_invite_id and created_at > now() - interval '10 minutes';
  if recent_count >= 5 then return 'per_10_min'; end if;

  select count(*) into day_count from public.ai_calls
    where invite_id = p_invite_id and created_at > now() - interval '24 hours';
  if day_count >= 20 then return 'per_day'; end if;

  select count(*) into global_count from public.ai_calls
    where created_at > now() - interval '24 hours';
  if global_count >= 300 then return 'global_day'; end if;

  insert into public.ai_calls (invite_id) values (p_invite_id);
  return 'ok';
end;
$$;

-- Postgres lets EVERYONE run a new function unless told otherwise. Server only.
revoke execute on function public.take_ai_slot(uuid) from public, anon, authenticated;
grant  execute on function public.take_ai_slot(uuid) to service_role;

-- ============================================================
-- 4b. Rate limit on every route that saves data: take_write_slot(invite_id, route)
--
-- Added Nov 19 and run on its own in the SQL Editor (safe to run again).
-- Called by the server BEFORE each save (onboarding, check-in, response,
-- period). Same steps as take_ai_slot: lock, check the invite, count, record.
-- Returns 'ok', or why not: 'invalid_invite', 'writes_10_min', 'writes_day'.
-- Limits: 30 saves per 10 minutes and 100 per day per invite.
-- Same rules as takeWriteSlot() in lib/db-local.js.
-- ============================================================

create table if not exists public.write_calls (
  id         uuid primary key default gen_random_uuid(),
  invite_id  uuid not null references public.invites (id) on delete cascade,
  route      text not null check (route in ('onboarding','checkin','response','period')),
  created_at timestamptz not null default now()
);
create index if not exists write_calls_invite_idx on public.write_calls (invite_id, created_at);
alter table public.write_calls enable row level security;
revoke all on table public.write_calls from public, anon, authenticated;
grant select, insert, delete on table public.write_calls to service_role;

create or replace function public.take_write_slot(p_invite_id uuid, p_route text)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtext('cyclesync.take_write_slot'));
  if not exists (select 1 from public.invites where id = p_invite_id and revoked_at is null) then
    return 'invalid_invite';
  end if;
  if (select count(*) from public.write_calls where invite_id = p_invite_id
        and created_at > now() - interval '10 minutes') >= 30 then return 'writes_10_min'; end if;
  if (select count(*) from public.write_calls where invite_id = p_invite_id
        and created_at > now() - interval '24 hours') >= 100 then return 'writes_day'; end if;
  insert into public.write_calls (invite_id, route) values (p_invite_id, p_route);
  return 'ok';
end; $$;
revoke execute on function public.take_write_slot(uuid, text) from public, anon, authenticated;
grant  execute on function public.take_write_slot(uuid, text) to service_role;

-- ============================================================
-- 5. Quick self-check: run these lines on their own after the script.
--    Every row should show rls_enabled = true, and the second query
--    should return NO rows (no access for anon or authenticated).
-- ============================================================
--
-- select relname as table_name, relrowsecurity as rls_enabled
--   from pg_class
--  where relnamespace = 'public'::regnamespace and relkind = 'r'
--  order by relname;
--
-- select table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--  where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC');

-- ============================================================
-- 6. End of semester (by Dec 31, 2026): delete all tester data.
--    NOT run by this script. Copy and run it on its own when the time comes.
-- ============================================================
--
-- truncate public.write_calls, public.ai_calls, public.checkins, public.profiles, public.invites;
