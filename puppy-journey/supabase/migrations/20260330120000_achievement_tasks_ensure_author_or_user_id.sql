-- 幂等：保证 achievement_tasks.author_id 存在（完整 couples 外键与 bond_settings 等见 20260330200000）。

alter table public.achievement_tasks
  add column if not exists author_id uuid references public.profiles (id) on delete set null;

create index if not exists achievement_tasks_author_id_idx
  on public.achievement_tasks (author_id)
  where author_id is not null;

comment on column public.achievement_tasks.author_id is
  '创建该 achievement 的 profiles.id；与 assignee_id（任务归属）区分。';
