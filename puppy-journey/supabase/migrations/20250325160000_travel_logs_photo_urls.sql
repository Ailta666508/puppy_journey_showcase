-- 确保旅行日志有 photo_urls（JSON 数组，存公开图链或 Data URL）；旧表可能缺列导致写入被静默忽略
alter table if exists public.travel_logs
  add column if not exists photo_urls jsonb default '[]'::jsonb;

comment on column public.travel_logs.photo_urls is '照片 URL / Data URL 等的 JSON 数组';
