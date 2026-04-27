-- 允许已登录用户在自己 UUID 目录下上传/更新/删除（与 travelUserUploadsStorage 路径 `${userId}/...` 一致）
-- 服务端在 service role 失败时可回退为「用户 JWT + 本策略」上传。

drop policy if exists "user_uploads_insert_authenticated_own_folder" on storage.objects;
create policy "user_uploads_insert_authenticated_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'user_uploads'
  and (storage.foldername(name))[1] = (auth.uid())::text
);

drop policy if exists "user_uploads_update_authenticated_own_folder" on storage.objects;
create policy "user_uploads_update_authenticated_own_folder"
on storage.objects for update to authenticated
using (
  bucket_id = 'user_uploads'
  and (storage.foldername(name))[1] = (auth.uid())::text
);

drop policy if exists "user_uploads_delete_authenticated_own_folder" on storage.objects;
create policy "user_uploads_delete_authenticated_own_folder"
on storage.objects for delete to authenticated
using (
  bucket_id = 'user_uploads'
  and (storage.foldername(name))[1] = (auth.uid())::text
);
