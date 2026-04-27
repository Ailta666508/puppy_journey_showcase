-- =============================================================================
-- couples: partner1/partner2 -> yellow_dog_id / white_dog_id
-- profiles: add role ('yellow_dog' | 'white_dog'), drop nickname
-- 可重复执行：已迁移过的库再次运行不会报错。
-- =============================================================================

-- 依赖旧迁移已建表；若表不存在请先执行 20250326120000_couples_profiles_and_couple_id.sql
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'public.profiles 不存在：请在 Supabase → SQL Editor 先执行 supabase/migrations/20250326120000_couples_profiles_and_couple_id.sql';
  END IF;
  IF to_regclass('public.couples') IS NULL THEN
    RAISE EXCEPTION 'public.couples 不存在：请在 Supabase → SQL Editor 先执行 supabase/migrations/20250326120000_couples_profiles_and_couple_id.sql';
  END IF;
END $$;

drop policy if exists "couples_select_member" on public.couples;

alter table public.couples
  add column if not exists yellow_dog_id uuid references public.profiles (id) on delete restrict,
  add column if not exists white_dog_id uuid references public.profiles (id) on delete restrict;

-- 仅从仍有 partner* 列的库回填并删除旧列（动态 SQL，避免二遍执行时报「列不存在」）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'couples'
      AND column_name = 'partner1_id'
  ) THEN
    EXECUTE
      'update public.couples set
         yellow_dog_id = coalesce(yellow_dog_id, partner1_id),
         white_dog_id = coalesce(white_dog_id, partner2_id)
       where partner1_id is not null';
    alter table public.couples drop constraint if exists couples_partners_distinct;
    alter table public.couples drop column if exists partner1_id;
    alter table public.couples drop column if exists partner2_id;
  END IF;
END $$;

drop index if exists couples_invite_code_key;

alter table public.couples drop constraint if exists couples_dogs_distinct;

alter table public.couples
  add constraint couples_dogs_distinct check (
    yellow_dog_id is null or white_dog_id is null or yellow_dog_id <> white_dog_id
  );

create unique index if not exists couples_invite_code_key on public.couples (invite_code);

comment on table public.couples is
  'Couple workspace: yellow_dog_id / white_dog_id map to profiles; invite_code for joining.';

comment on column public.couples.yellow_dog_id is 'Profile id for 小鸡毛 role; null until claimed.';
comment on column public.couples.white_dog_id is 'Profile id for 小白 role; null until claimed.';

-- ---- profiles: role, drop nickname --------------------------------------------
alter table public.profiles add column if not exists role text;

alter table public.profiles drop constraint if exists profiles_role_check;

alter table public.profiles
  add constraint profiles_role_check check (role is null or role in ('yellow_dog', 'white_dog'));

comment on column public.profiles.role is 'Onboarding: yellow_dog (小鸡毛) or white_dog (小白).';

alter table public.profiles drop column if exists nickname;

-- ---- Trigger: new用户只插 id（匿名用户无邮箱昵称） ----------------------------
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

-- ---- RLS --------------------------------------------------------------------
drop policy if exists "couples_select_member" on public.couples;

create policy "couples_select_member"
  on public.couples for select
  using (
    auth.uid() = yellow_dog_id or auth.uid() = white_dog_id
  );
