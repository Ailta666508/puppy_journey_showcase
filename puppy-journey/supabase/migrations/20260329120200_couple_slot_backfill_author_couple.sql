-- =============================================================================
-- 将仍用 user_id = 'yellow_dog' / 'white_dog' 的旧行，回填 couple_id + author_id（UUID），
-- 与 couples.yellow_dog_id / white_dog_id 对齐。每对情侣独立一份数据。
-- 执行前请确保 couples 与 profiles.couple_id 已正确绑定。
-- =============================================================================

DO $$
DECLARE
  r RECORD;
  cid uuid;
  yid uuid;
  wid uuid;
BEGIN
  FOR r IN SELECT id, yellow_dog_id, white_dog_id FROM public.couples
  LOOP
    cid := r.id;
    yid := r.yellow_dog_id;
    wid := r.white_dog_id;

    IF yid IS NOT NULL THEN
      UPDATE public.travel_logs t
      SET
        couple_id = cid,
        author_id = yid
      WHERE t.couple_id IS NULL
        AND t.user_id::text = 'yellow_dog'
        AND t.author_id IS NULL
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = yid AND p.couple_id = cid);

      UPDATE public.wish_items w
      SET
        couple_id = cid,
        author_id = yid
      WHERE w.couple_id IS NULL
        AND w.user_id::text = 'yellow_dog'
        AND w.author_id IS NULL
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = yid AND p.couple_id = cid);

      UPDATE public.rehearsal_pipeline_jobs j
      SET
        couple_id = cid,
        author_id = yid
      WHERE j.couple_id IS NULL
        AND j.user_id::text = 'yellow_dog'
        AND j.author_id IS NULL
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = yid AND p.couple_id = cid);
    END IF;

    IF wid IS NOT NULL THEN
      UPDATE public.travel_logs t
      SET
        couple_id = cid,
        author_id = wid
      WHERE t.couple_id IS NULL
        AND t.user_id::text = 'white_dog'
        AND t.author_id IS NULL
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = wid AND p.couple_id = cid);

      UPDATE public.wish_items w
      SET
        couple_id = cid,
        author_id = wid
      WHERE w.couple_id IS NULL
        AND w.user_id::text = 'white_dog'
        AND w.author_id IS NULL
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = wid AND p.couple_id = cid);

      UPDATE public.rehearsal_pipeline_jobs j
      SET
        couple_id = cid,
        author_id = wid
      WHERE j.couple_id IS NULL
        AND j.user_id::text = 'white_dog'
        AND j.author_id IS NULL
        AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = wid AND p.couple_id = cid);
    END IF;

  END LOOP;
END $$;

-- 可选：清理未挂 couple 的全局槽位 presence（进入成就页会按 profile 重建）
-- DELETE FROM public.user_presence WHERE couple_id IS NULL AND user_id IN ('yellow_dog', 'white_dog');
