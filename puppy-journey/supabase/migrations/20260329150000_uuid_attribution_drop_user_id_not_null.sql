-- 新业务写入仅依赖 couple_id + author_id / assignee_id / profile_id；legacy user_id 槽位字符串改为可空，便于不再写入。

alter table public.achievement_tasks
  add column if not exists author_id uuid references public.profiles (id) on delete set null;

create index if not exists achievement_tasks_author_id_idx
  on public.achievement_tasks (author_id)
  where author_id is not null;

comment on column public.achievement_tasks.author_id is '创建该成就记录的 profiles.id；与 assignee_id（任务归属）区分。';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'achievement_tasks'
      and column_name = 'user_id'
      and is_nullable = 'NO'
  ) then
    alter table public.achievement_tasks alter column user_id drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'travel_logs'
      and column_name = 'user_id'
      and is_nullable = 'NO'
  ) then
    alter table public.travel_logs alter column user_id drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'wish_items'
      and column_name = 'user_id'
      and is_nullable = 'NO'
  ) then
    alter table public.wish_items alter column user_id drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rehearsal_pipeline_jobs'
      and column_name = 'user_id'
      and is_nullable = 'NO'
  ) then
    alter table public.rehearsal_pipeline_jobs alter column user_id drop not null;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_presence'
      and column_name = 'user_id'
      and is_nullable = 'NO'
  ) then
    alter table public.user_presence alter column user_id drop not null;
  end if;
end $$;
