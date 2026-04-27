/** Storage bucket for user-generated images（成就头像、旅行图等） */
export function getUserUploadsBucket(): string {
  return (
    process.env.SUPABASE_USER_UPLOADS_BUCKET?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_USER_UPLOADS_BUCKET?.trim() ||
    "user_uploads"
  );
}
