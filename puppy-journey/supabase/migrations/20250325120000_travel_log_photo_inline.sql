-- 旅行日志：有序混合存储「Storage 引用」与「内联小图」，不依赖公网 URL 形态。
-- 在 Supabase SQL Editor 中执行一次即可。

alter table if exists public.travel_logs
  add column if not exists photo_items jsonb;

comment on column public.travel_logs.photo_items is
  '可选：有序照片项 JSON 数组。元素形如 {"t":"s","r":"sb:user_uploads:user/file.jpg"} 或 {"t":"i","m":"image/jpeg","d":"<base64>"}。若为空则仍使用 photo_urls。';
