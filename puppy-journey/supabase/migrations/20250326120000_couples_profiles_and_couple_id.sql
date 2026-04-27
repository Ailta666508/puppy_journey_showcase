-- =============================================================================
-- Couples + Profiles + couple-scoped business tables
-- Run in Supabase SQL Editor or `supabase db push` / migration pipeline.
-- Service role (your current API client) bypasses RLS; policies matter for
-- direct browser Supabase access with the anon/authenticated key.
-- =============================================================================

-- ---- 0) Extensions -----------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---- 1) Invite code generator (6 chars, URL-safe-ish alphabet) ------------
create or replace function public.generate_invite_code()
returns text
language plpgsql
as $$
declare
  chars  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- drop 0,O,I,1
  result text := '';
  i      int;
begin
  for i in 1..6 loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return result;
end;
$$;

comment on function public.generate_invite_code() is
  'Returns a 6-character invite code; retry on unique violation for couples.invite_code.';

-- ---- 2) profiles (1:1 with auth.users) --------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role is null or role in ('yellow_dog', 'white_dog'))
);

comment on table public.profiles is 'App user profile; id matches auth.users.id.';
comment on column public.profiles.role is 'Onboarding: yellow_dog (小鸡毛) or white_dog (小白).';

-- couple_id added after couples table exists (see §4)

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Backfill profiles for accounts created before this migration / trigger.
insert into public.profiles (id)
select u.id
from auth.users u
on conflict (id) do nothing;

-- ---- 3) couples -------------------------------------------------------------
create table if not exists public.couples (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null,
  yellow_dog_id uuid references public.profiles (id) on delete restrict,
  white_dog_id uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint couples_invite_len check (char_length(invite_code) = 6),
  constraint couples_at_least_one_dog check (yellow_dog_id is not null or white_dog_id is not null),
  constraint couples_dogs_distinct check (
    yellow_dog_id is null or white_dog_id is null or yellow_dog_id <> white_dog_id
  )
);

create unique index if not exists couples_invite_code_key on public.couples (invite_code);

comment on table public.couples is
  'Couple workspace: yellow_dog_id / white_dog_id map to profiles; invite_code for joining.';
comment on column public.couples.yellow_dog_id is 'Profile id for 小鸡毛 role; null until claimed.';
comment on column public.couples.white_dog_id is 'Profile id for 小白 role; null until claimed.';

-- ---- 4) profiles.couple_id (after couples) ---------------------------------
alter table public.profiles
  add column if not exists couple_id uuid references public.couples (id) on delete set null;

create index if not exists profiles_couple_id_idx on public.profiles (couple_id);

comment on column public.profiles.couple_id is 'Filled when bound; null during onboarding.';

-- ---- 5) Business tables: couple scope + attribution ------------------------
-- Shared lists (both partners see the same rows): filter by couple_id.
-- author_id / assignee_id = profiles.id (who created the row or who owns the task/slot).

alter table public.travel_logs
  add column if not exists couple_id uuid references public.couples (id) on delete cascade,
  add column if not exists author_id uuid references public.profiles (id) on delete set null;

create index if not exists travel_logs_couple_id_idx on public.travel_logs (couple_id);

comment on column public.travel_logs.couple_id is 'Couple workspace; replaces legacy user_id for shared data.';
comment on column public.travel_logs.author_id is 'Profile id of the member who created the log.';

alter table public.wish_items
  add column if not exists couple_id uuid references public.couples (id) on delete cascade,
  add column if not exists author_id uuid references public.profiles (id) on delete set null;

create index if not exists wish_items_couple_id_idx on public.wish_items (couple_id);

alter table public.bond_settings
  add column if not exists couple_id uuid references public.couples (id) on delete cascade;

create unique index if not exists bond_settings_one_per_couple
  on public.bond_settings (couple_id)
  where couple_id is not null;

comment on table public.bond_settings is
  'Prefer one row per couple (couple_id). Legacy user_id rows can coexist until backfilled.';

alter table public.rehearsal_pipeline_jobs
  add column if not exists couple_id uuid references public.couples (id) on delete cascade,
  add column if not exists author_id uuid references public.profiles (id) on delete set null;

create index if not exists rehearsal_pipeline_jobs_couple_id_idx
  on public.rehearsal_pipeline_jobs (couple_id);

-- Per-member state: couple_id + which profile this row belongs to.
alter table public.user_presence
  add column if not exists couple_id uuid references public.couples (id) on delete cascade,
  add column if not exists profile_id uuid references public.profiles (id) on delete cascade;

create unique index if not exists user_presence_couple_profile_uidx
  on public.user_presence (couple_id, profile_id)
  where couple_id is not null and profile_id is not null;

comment on column public.user_presence.profile_id is 'Auth profile for this slot; legacy user_id may remain during migration.';

alter table public.achievement_tasks
  add column if not exists couple_id uuid references public.couples (id) on delete cascade,
  add column if not exists assignee_id uuid references public.profiles (id) on delete cascade;

create index if not exists achievement_tasks_couple_id_idx on public.achievement_tasks (couple_id);

comment on column public.achievement_tasks.assignee_id is 'Owner of the task within the couple; legacy user_id may remain during migration.';

-- ---- 6) Optional: backfill demo couple for legacy white_dog / yellow_dog -----
-- Uncomment and run ONLY if you still have string user_id rows and want a single
-- shared couple_id for them. You must create two real auth users + profiles first
-- and substitute their UUIDs below, OR skip this block and backfill in app code.
--
-- with c as (
--   insert into public.couples (invite_code, yellow_dog_id, white_dog_id)
--   values (
--     public.generate_invite_code(),
--     '<profile-uuid-yellow>'::uuid,
--     '<profile-uuid-white>'::uuid
--   )
--   returning id
-- )
-- update public.travel_logs set couple_id = (select id from c) where user_id in ('white_dog', 'yellow_dog');

-- ---- 7) Row Level Security (client-facing Supabase) -------------------------
alter table public.profiles enable row level security;
alter table public.couples enable row level security;
alter table public.travel_logs enable row level security;
alter table public.wish_items enable row level security;
alter table public.bond_settings enable row level security;
alter table public.user_presence enable row level security;
alter table public.achievement_tasks enable row level security;
alter table public.rehearsal_pipeline_jobs enable row level security;

-- profiles
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- couples: both members can read
drop policy if exists "couples_select_member" on public.couples;
create policy "couples_select_member"
  on public.couples for select
  using (
    auth.uid() = yellow_dog_id or auth.uid() = white_dog_id
  );

-- travel_logs
drop policy if exists "travel_logs_select_couple" on public.travel_logs;
create policy "travel_logs_select_couple"
  on public.travel_logs for select
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = travel_logs.couple_id
    )
  );

drop policy if exists "travel_logs_insert_couple" on public.travel_logs;
create policy "travel_logs_insert_couple"
  on public.travel_logs for insert
  with check (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = travel_logs.couple_id
    )
    and (author_id is null or author_id = auth.uid())
  );

drop policy if exists "travel_logs_update_couple" on public.travel_logs;
create policy "travel_logs_update_couple"
  on public.travel_logs for update
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = travel_logs.couple_id
    )
  )
  with check (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = travel_logs.couple_id
    )
  );

drop policy if exists "travel_logs_delete_couple" on public.travel_logs;
create policy "travel_logs_delete_couple"
  on public.travel_logs for delete
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = travel_logs.couple_id
    )
  );

-- wish_items (same pattern)
drop policy if exists "wish_items_select_couple" on public.wish_items;
create policy "wish_items_select_couple"
  on public.wish_items for select
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = wish_items.couple_id
    )
  );

drop policy if exists "wish_items_mutate_couple" on public.wish_items;
create policy "wish_items_mutate_couple"
  on public.wish_items for insert
  with check (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = wish_items.couple_id
    )
  );

drop policy if exists "wish_items_update_couple" on public.wish_items;
create policy "wish_items_update_couple"
  on public.wish_items for update
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = wish_items.couple_id
    )
  )
  with check (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = wish_items.couple_id
    )
  );

drop policy if exists "wish_items_delete_couple" on public.wish_items;
create policy "wish_items_delete_couple"
  on public.wish_items for delete
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = wish_items.couple_id
    )
  );

-- bond_settings (one row per couple)
drop policy if exists "bond_settings_select_couple" on public.bond_settings;
create policy "bond_settings_select_couple"
  on public.bond_settings for select
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = bond_settings.couple_id
    )
  );

drop policy if exists "bond_settings_upsert_couple" on public.bond_settings;
create policy "bond_settings_upsert_couple"
  on public.bond_settings for insert
  with check (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = bond_settings.couple_id
    )
  );

drop policy if exists "bond_settings_update_couple" on public.bond_settings;
create policy "bond_settings_update_couple"
  on public.bond_settings for update
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = bond_settings.couple_id
    )
  )
  with check (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = bond_settings.couple_id
    )
  );

-- user_presence (couple + profile)
drop policy if exists "user_presence_select_couple" on public.user_presence;
create policy "user_presence_select_couple"
  on public.user_presence for select
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = user_presence.couple_id
    )
  );

drop policy if exists "user_presence_mutate_own_slot" on public.user_presence;
create policy "user_presence_mutate_own_slot"
  on public.user_presence for all
  using (
    couple_id is not null
    and profile_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = user_presence.couple_id
    )
  )
  with check (
    couple_id is not null
    and profile_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = user_presence.couple_id
    )
  );

-- achievement_tasks
drop policy if exists "achievement_tasks_select_couple" on public.achievement_tasks;
create policy "achievement_tasks_select_couple"
  on public.achievement_tasks for select
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = achievement_tasks.couple_id
    )
  );

drop policy if exists "achievement_tasks_mutate_couple" on public.achievement_tasks;
create policy "achievement_tasks_mutate_couple"
  on public.achievement_tasks for insert
  with check (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = achievement_tasks.couple_id
    )
  );

drop policy if exists "achievement_tasks_update_couple" on public.achievement_tasks;
create policy "achievement_tasks_update_couple"
  on public.achievement_tasks for update
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = achievement_tasks.couple_id
    )
  )
  with check (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = achievement_tasks.couple_id
    )
  );

drop policy if exists "achievement_tasks_delete_couple" on public.achievement_tasks;
create policy "achievement_tasks_delete_couple"
  on public.achievement_tasks for delete
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = achievement_tasks.couple_id
    )
  );

-- rehearsal_pipeline_jobs
drop policy if exists "pipeline_jobs_select_couple" on public.rehearsal_pipeline_jobs;
create policy "pipeline_jobs_select_couple"
  on public.rehearsal_pipeline_jobs for select
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = rehearsal_pipeline_jobs.couple_id
    )
  );

drop policy if exists "pipeline_jobs_mutate_couple" on public.rehearsal_pipeline_jobs;
create policy "pipeline_jobs_mutate_couple"
  on public.rehearsal_pipeline_jobs for insert
  with check (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = rehearsal_pipeline_jobs.couple_id
    )
  );

drop policy if exists "pipeline_jobs_update_couple" on public.rehearsal_pipeline_jobs;
create policy "pipeline_jobs_update_couple"
  on public.rehearsal_pipeline_jobs for update
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = rehearsal_pipeline_jobs.couple_id
    )
  )
  with check (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = rehearsal_pipeline_jobs.couple_id
    )
  );

drop policy if exists "pipeline_jobs_delete_couple" on public.rehearsal_pipeline_jobs;
create policy "pipeline_jobs_delete_couple"
  on public.rehearsal_pipeline_jobs for delete
  using (
    couple_id is not null
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.couple_id = rehearsal_pipeline_jobs.couple_id
    )
  );

-- =============================================================================
-- Next app-layer steps (not SQL):
-- 1) On first visit with couple_id null: POST create-room (profiles.role set first)
--    inserts couples row with yellow_dog_id or white_dog_id = auth.uid() + invite_code.
-- 2) Join: match invite_code, fill the other dog slot, update profiles.couple_id.
-- 3) APIs: resolve couple_id from session user profile; query .eq('couple_id', ...).
-- =============================================================================
