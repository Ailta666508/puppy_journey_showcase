import type { SupabaseClient } from "@supabase/supabase-js";

const PROFILE_SELECT = "id, role, couple_id, avatar_url";

export type EnsuredProfile = {
  id: string;
  role: string | null;
  couple_id: string | null;
  avatar_url: string | null;
};

/**
 * 读取当前用户的 profiles 行；若不存在则插入仅含 id 的一行（与 handle_new_user 一致）。
 * 若仍失败，hint 中带 Postgres/Supabase 原文（常见：未跑迁移缺少 role / couples 新列）。
 */
export async function ensureProfileRow(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true; profile: EnsuredProfile } | { ok: false; error: string; hint: string }> {
  const first = await supabase.from("profiles").select(PROFILE_SELECT).eq("id", userId).maybeSingle();

  if (first.error) {
    return { ok: false, error: "读取资料失败", hint: first.error.message };
  }

  if (first.data) {
    return { ok: true, profile: first.data as EnsuredProfile };
  }

  const ins = await supabase.from("profiles").insert({ id: userId });
  if (ins.error) {
    return { ok: false, error: "创建资料失败", hint: ins.error.message };
  }

  const second = await supabase.from("profiles").select(PROFILE_SELECT).eq("id", userId).maybeSingle();
  if (second.error) {
    return { ok: false, error: "读取资料失败", hint: second.error.message };
  }
  if (!second.data) {
    return {
      ok: false,
      error: "读取资料失败",
      hint: "profiles 中仍无当前用户行，请检查数据库触发器 on_auth_user_created 与 RLS。",
    };
  }

  return { ok: true, profile: second.data as EnsuredProfile };
}
