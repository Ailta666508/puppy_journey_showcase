-- 用户图片（成就头像等）公开桶；服务端用 service role 上传，匿名可通过 public URL 读取。
-- 若控制台已手动创建同名 bucket，本脚本可重复执行。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user_uploads',
  'user_uploads',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "user_uploads_select_public" on storage.objects;
create policy "user_uploads_select_public"
on storage.objects for select
to public
using (bucket_id = 'user_uploads');
