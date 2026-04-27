import type { SupabaseClient } from "@supabase/supabase-js";

import type { AchievementContext } from "@/lib/achievements/achievementContext";

/** 按 profile_id 读取本情侣空间内某一成员的状态行 */
export async function fetchPresenceRowForSlot(
  supabase: SupabaseClient,
  coupleId: string,
  ctx: AchievementContext,
  slot: "me" | "partner",
): Promise<Record<string, unknown> | null> {
  const profileId = slot === "me" ? ctx.userId : ctx.partnerProfileId;
  if (slot === "partner" && !profileId) return null;

  const { data: byPid } = await supabase
    .from("user_presence")
    .select("*")
    .eq("couple_id", coupleId)
    .eq("profile_id", profileId as string)
    .maybeSingle();
  return byPid ? (byPid as Record<string, unknown>) : null;
}

/**
 * 更新本情侣空间下某一成员的状态槽（仅 profile_id，与 user_id 槽位字符串无关）。
 */
export async function patchUserPresenceSlot(
  supabase: SupabaseClient,
  coupleId: string,
  ctx: AchievementContext,
  slot: "me" | "partner",
  patch: Record<string, unknown>,
): Promise<void> {
  const profileId = slot === "me" ? ctx.userId : ctx.partnerProfileId;

  if (slot === "partner" && !profileId) {
    throw new Error("对方尚未加入");
  }

  const { data: updated, error: e1 } = await supabase
    .from("user_presence")
    .update(patch)
    .eq("couple_id", coupleId)
    .eq("profile_id", profileId as string)
    .select("id");
  if (e1) throw e1;
  if (updated && updated.length > 0) return;

  throw new Error("未找到该成员的状态记录，请刷新页面或重新进入情侣空间");
}
