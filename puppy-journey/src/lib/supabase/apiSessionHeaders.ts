import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/** 浏览器调用自家 API 时携带当前 Supabase 会话（与成就 / 情侣空间一致）。 */
export async function supabaseBearerHeaders(): Promise<HeadersInit> {
  const client = getSupabaseBrowserClient();
  let { data } = await client.auth.getSession();
  let token = data.session?.access_token;
  if (!token) {
    const refreshed = await client.auth.refreshSession();
    token = refreshed.data.session?.access_token;
  }
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
