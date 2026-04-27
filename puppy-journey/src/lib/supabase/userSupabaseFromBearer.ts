import { createClient } from "@supabase/supabase-js";

/** 用当前请求的 Bearer 创建「用户身份」Supabase 客户端（走 RLS，用于 Storage 等） */
export function createSupabaseUserClientFromBearer(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  const t = accessToken.trim();
  if (!t) throw new Error("缺少 access token");
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${t}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
