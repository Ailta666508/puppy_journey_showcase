import { NextResponse } from "next/server";

import { requireBearerUser } from "@/lib/auth/requireBearerUser";
import { ensureProfileRow } from "@/lib/couple/ensureProfile";

export const maxDuration = 30;

/**
 * 退出当前情侣房间：清空本账号在 couples 中的槽位、profiles.couple_id / role；
 * 若房间内已无人则删除 couples 行（级联清理挂 couple_id 的数据）。
 */
export async function POST(request: Request) {
  const gate = await requireBearerUser(request);
  if (!gate.ok) return gate.response;

  const { user, supabase } = gate.auth;

  const ensured = await ensureProfileRow(supabase, user.id);
  if (!ensured.ok) {
    return NextResponse.json(
      { ok: false, error: ensured.error, hint: ensured.hint },
      { status: 500 },
    );
  }
  const profile = ensured.profile;
  const coupleId = profile.couple_id as string | null;

  if (!coupleId) {
    return NextResponse.json({ ok: true, left: false, message: "当前未绑定情侣空间" });
  }

  const { data: couple, error: cErr } = await supabase
    .from("couples")
    .select("id, yellow_dog_id, white_dog_id")
    .eq("id", coupleId)
    .maybeSingle();

  if (cErr || !couple) {
    await supabase
      .from("profiles")
      .update({ couple_id: null, role: null, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    return NextResponse.json({ ok: true, left: true, message: "房间已失效，已清除本地绑定" });
  }

  const y = couple.yellow_dog_id as string | null;
  const w = couple.white_dog_id as string | null;
  const isYellow = y === user.id;
  const isWhite = w === user.id;

  if (!isYellow && !isWhite) {
    await supabase
      .from("profiles")
      .update({ couple_id: null, role: null, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    return NextResponse.json({ ok: true, left: true, message: "已不在成员位上，已清除绑定" });
  }

  const partnerStill =
    (isYellow && w != null && w !== user.id) || (isWhite && y != null && y !== user.id);

  const now = new Date().toISOString();
  const { error: pErr } = await supabase
    .from("profiles")
    .update({ couple_id: null, role: null, updated_at: now })
    .eq("id", user.id);
  if (pErr) {
    return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
  }

  if (partnerStill) {
    const patch =
      isYellow
        ? { yellow_dog_id: null as string | null }
        : { white_dog_id: null as string | null };
    const { error: uErr } = await supabase.from("couples").update(patch).eq("id", coupleId);
    if (uErr) {
      return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
    }
  } else {
    const { error: dErr } = await supabase.from("couples").delete().eq("id", coupleId);
    if (dErr) {
      return NextResponse.json({ ok: false, error: dErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, left: true });
}
