-- bond_settings：允许仅按 couple_id 写入一行（不再依赖 legacy user_id 槽位字符串）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'bond_settings'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.bond_settings ALTER COLUMN user_id DROP NOT NULL;
  END IF;
END $$;
