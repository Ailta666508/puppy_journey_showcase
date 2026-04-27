import { createClient } from "@supabase/supabase-js";

/**
 * 服务端专用（API Route）：使用 service role，仅在服务器环境引用。
 * 业务 API 使用 Bearer JWT + couple_id / author_id（见 requireCoupleWorkspaceContext）。
 */
export function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
