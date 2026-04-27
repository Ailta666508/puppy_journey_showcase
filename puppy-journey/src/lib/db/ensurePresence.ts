import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLE_INFO, type UserRole } from "@/lib/userRole";

const DEFAULTS: Record<UserRole, { status_text: string; avatar: string }> = {
  white_dog: { status_text: "今天也要加油呀", avatar: ROLE_INFO.white_dog.avatarSrc },
  yellow_dog: { status_text: "等你一起散步", avatar: ROLE_INFO.yellow_dog.avatarSrc },
};

type PresenceRow = {
  id: string;
  profile_id: string | null;
  last_whisper_received: string | null;
  unread_whispers: number | null;
  status_text: string | null;
  avatar: string | null;
  status_icon: string | null;
  is_focusing?: boolean | null;
  updated_at?: string | null;
};

function rowUpdatedAtMs(row: PresenceRow): number {
  const raw = row.updated_at;
  if (raw == null || String(raw).trim() === "") return 0;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

/**
 * 同一 couple 下同一 profile_id 若有多行（异常重复），合并进一条后删除多余行。
 */
async function dedupeCouplePresenceRows(supabase: SupabaseClient, coupleId: string): Promise<void> {
  const { data: rows, error } = await supabase
    .from("user_presence")
    .select("id, profile_id, last_whisper_received, unread_whispers, status_text, avatar, status_icon, is_focusing, updated_at")
    .eq("couple_id", coupleId);
  if (error || !rows?.length) return;

  const typed = rows as PresenceRow[];
  const byPid = new Map<string, PresenceRow[]>();
  for (const r of typed) {
    const pid = (r.profile_id ?? "").trim();
    if (!pid) continue;
    const list = byPid.get(pid) ?? [];
    list.push(r);
    byPid.set(pid, list);
  }

  for (const [, list] of byPid) {
    if (list.length <= 1) continue;
    // 以 updated_at 最新的行为准合并，避免按 id 字母序误把旧行当 keeper 写丢 is_focusing / 专注文案
    const sorted = [...list].sort((a, b) => {
      const dt = rowUpdatedAtMs(b) - rowUpdatedAtMs(a);
      if (dt !== 0) return dt;
      return b.id.localeCompare(a.id);
    });
    const keeper = sorted[0]!;
    let lastWhisper = (keeper.last_whisper_received ?? "").trim();
    let unread = Number(keeper.unread_whispers) || 0;
    let statusText = (keeper.status_text ?? "").trim();
    let avatar = (keeper.avatar ?? "").trim();
    let statusIcon = keeper.status_icon;
    let focusing = keeper.is_focusing === true;

    for (const dup of sorted.slice(1)) {
      const lw = (dup.last_whisper_received ?? "").trim();
      if (!lastWhisper && lw) lastWhisper = lw;
      unread = Math.max(unread, Number(dup.unread_whispers) || 0);
      const st = (dup.status_text ?? "").trim();
      if (!statusText && st) statusText = st;
      const av = (dup.avatar ?? "").trim();
      if (!avatar && av) avatar = av;
      if (statusIcon == null && dup.status_icon != null) statusIcon = dup.status_icon;
      if (dup.is_focusing === true) focusing = true;
    }

    if (focusing && statusText !== "专注中") {
      statusText = "专注中";
    }

    const now = new Date().toISOString();
    const { error: upErr } = await supabase
      .from("user_presence")
      .update({
        last_whisper_received: lastWhisper || null,
        unread_whispers: unread,
        status_text: statusText || keeper.status_text,
        avatar: avatar || keeper.avatar,
        status_icon: statusIcon,
        is_focusing: focusing,
        updated_at: now,
      })
      .eq("id", keeper.id);
    if (upErr) continue;

    for (const dup of sorted.slice(1)) {
      await supabase.from("user_presence").delete().eq("id", dup.id);
    }
  }
}

/**
 * 为当前情侣空间确保两条 user_presence（仅 couple_id + profile_id）。
 */
export async function ensureCouplePresenceSlots(
  supabase: SupabaseClient,
  coupleId: string,
  yellowProfileId: string | null,
  whiteProfileId: string | null,
) {
  const slots: { profileId: string; role: UserRole }[] = [];
  if (yellowProfileId) slots.push({ profileId: yellowProfileId, role: "yellow_dog" });
  if (whiteProfileId) slots.push({ profileId: whiteProfileId, role: "white_dog" });

  for (const { profileId, role } of slots) {
    const { data } = await supabase
      .from("user_presence")
      .select("id")
      .eq("couple_id", coupleId)
      .eq("profile_id", profileId)
      .maybeSingle();
    if (data) continue;
    const d = DEFAULTS[role];
    await supabase.from("user_presence").insert({
      couple_id: coupleId,
      profile_id: profileId,
      status_text: d.status_text,
      avatar: d.avatar,
      status_icon: null,
      unread_whispers: 0,
      last_whisper_received: null,
      is_focusing: false,
    });
  }

  await dedupeCouplePresenceRows(supabase, coupleId);
}
