import type { Session, SupabaseClient } from "@supabase/supabase-js";

/**
 * 无邮箱登录：本机自动匿名登录，便于写入 profiles / couples。
 * 需在 Supabase 控制台 → Authentication → Providers → Anonymous 开启。
 */
export async function ensureAnonymousSession(supabase: SupabaseClient): Promise<Session | null> {
  const {
    data: { session: existing },
  } = await supabase.auth.getSession();
  if (existing?.access_token) return existing;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.warn("[ensureAnonymousSession]", error.message);
    return null;
  }
  return data.session ?? null;
}
