-- =============================================================================
-- 将「全局 user_id = white_dog / yellow_dog」的 achievement_tasks 挂到唯一一对情侣。
-- 仅当 public.couples 恰好 1 行时执行；多对情侣请自行按 couple 拆分迁移。
--
-- user_presence：新版会在首次进入成就页时按 (couple_id, profile_id) 自动建槽位。
-- 若库里仍有 couple_id IS NULL 的旧 presence 行，可在确认双方已加入房间后执行：
--   DELETE FROM public.user_presence
--   WHERE couple_id IS NULL AND user_id IN ('yellow_dog', 'white_dog');
-- =============================================================================

DO $$
DECLARE
  n int;
  cid uuid;
  yid uuid;
  wid uuid;
BEGIN
  SELECT count(*)::int INTO n FROM public.couples;
  IF n <> 1 THEN
    RAISE NOTICE 'achievements_couple_backfill: skipped (couples count = %, expected 1)', n;
    RETURN;
  END IF;

  SELECT id, yellow_dog_id, white_dog_id INTO cid, yid, wid FROM public.couples LIMIT 1;

  IF cid IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.achievement_tasks t
  SET
    couple_id = cid,
    assignee_id = CASE t.user_id::text
      WHEN 'yellow_dog' THEN yid
      WHEN 'white_dog' THEN wid
      ELSE t.assignee_id
    END
  WHERE t.couple_id IS NULL
    AND t.user_id::text IN ('yellow_dog', 'white_dog')
    AND (
      (t.user_id::text = 'yellow_dog' AND yid IS NOT NULL)
      OR (t.user_id::text = 'white_dog' AND wid IS NOT NULL)
    );
END $$;
