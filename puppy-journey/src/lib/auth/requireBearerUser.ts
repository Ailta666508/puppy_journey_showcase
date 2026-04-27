import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

export type AuthedSupabase = {
  user: User;
  supabase: ReturnType<typeof createSupabaseServerClient>;
};

export type BearerAuthResult =
  | { ok: true; auth: AuthedSupabase }
  | { ok: false; response: NextResponse };

export async function requireBearerUser(request: Request): Promise<BearerAuthResult> {
  const h = request.headers.get("authorization");
  const token = h?.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 }),
    };
  }
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "登录已失效，请重新登录" }, { status: 401 }),
    };
  }
  return { ok: true, auth: { user: data.user, supabase } };
}
