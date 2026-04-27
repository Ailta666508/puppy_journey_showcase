import { supabaseBearerHeaders } from "@/lib/supabase/apiSessionHeaders";

/** 成就相关 API 与情侣空间一致：携带当前会话 Bearer。 */
export async function achievementAuthHeaders(): Promise<HeadersInit> {
  return supabaseBearerHeaders();
}
