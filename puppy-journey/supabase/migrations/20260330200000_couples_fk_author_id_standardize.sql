-- =============================================================================
-- 1) couples：确保 yellow_dog_id、white_dog_id 均引用 public.profiles(id)
--    （修复线上仅一侧有 FK 或约束名不一致导致的关系缺失）
-- 2) 业务表：统一「写入归因」用 author_id（profiles.id），不再依赖 user_id 槽位
--    执行后可在 Supabase SQL 中运行：NOTIFY pgrst, 'reload schema';
-- =============================================================================

-- ---- couples 外键（仅当不存在指向 profiles 的 FK 时添加）----
DO $couples_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'couples'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (white_dog_id)%'
  ) THEN
    ALTER TABLE public.couples
      ADD CONSTRAINT couples_white_dog_id_fkey
      FOREIGN KEY (white_dog_id) REFERENCES public.profiles (id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'couples'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) LIKE '%FOREIGN KEY (yellow_dog_id)%'
  ) THEN
    ALTER TABLE public.couples
      ADD CONSTRAINT couples_yellow_dog_id_fkey
      FOREIGN KEY (yellow_dog_id) REFERENCES public.profiles (id) ON DELETE RESTRICT;
  END IF;
END
$couples_fk$;

-- ---- achievement_tasks：创建者 = author_id（与 assignee_id 任务归属分离）----
ALTER TABLE public.achievement_tasks
  ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS achievement_tasks_author_id_idx
  ON public.achievement_tasks (author_id)
  WHERE author_id IS NOT NULL;

COMMENT ON COLUMN public.achievement_tasks.author_id IS '创建该成就的 profiles.id；新写入一律填本列，勿再依赖 user_id。';

DO $backfill_auth$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'achievement_tasks'
      AND column_name = 'user_id'
  ) THEN
    UPDATE public.achievement_tasks t
    SET author_id = (trim(t.user_id::text))::uuid
    WHERE t.author_id IS NULL
      AND t.user_id IS NOT NULL
      AND trim(t.user_id::text)
        ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  END IF;
END
$backfill_auth$;

-- ---- travel_logs / wish_items / rehearsal：确保 author_id 存在（旧迁移可能未在部分环境执行）----
ALTER TABLE public.travel_logs
  ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.wish_items
  ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.rehearsal_pipeline_jobs
  ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

-- ---- bond_settings：最后保存羁绊目标的成员（按 couple 一行，读取仍双方一致）----
ALTER TABLE public.bond_settings
  ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.bond_settings.author_id IS '最近一次写入该行设置的 profiles.id；可选。';
