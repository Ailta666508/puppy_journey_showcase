import { NextResponse } from "next/server";

import { requireBearerUser } from "@/lib/auth/requireBearerUser";
import { ensureProfileRow } from "@/lib/couple/ensureProfile";

export const maxDuration = 30;

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

  if (!profile.role) {
    return NextResponse.json({ ok: false, error: "请先选择身份（小鸡毛 / 小白）" }, { status: 400 });
  }

  if (profile.couple_id) {
    return NextResponse.json({ ok: false, error: "你已在情侣空间中" }, { status: 400 });
  }

  const role = profile.role as string;

  for (let attempt = 0; attempt < 16; attempt++) {
    const { data: codeRaw, error: rpcErr } = await supabase.rpc("generate_invite_code");
    if (rpcErr) {
      return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });
    }
    const inviteCode = typeof codeRaw === "string" ? codeRaw : String(codeRaw ?? "");
    if (inviteCode.length !== 6) continue;

    const row =
      role === "yellow_dog"
        ? { invite_code: inviteCode, yellow_dog_id: user.id, white_dog_id: null as string | null }
        : { invite_code: inviteCode, yellow_dog_id: null as string | null, white_dog_id: user.id };

    const { data: inserted, error: insErr } = await supabase
      .from("couples")
      .insert(row)
      .select("id, invite_code")
      .maybeSingle();

    if (insErr) {
      if (insErr.code === "23505") continue;
      return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
    }

    if (!inserted?.id) continue;

    const { error: upErr } = await supabase
      .from("profiles")
      .update({ couple_id: inserted.id, updated_at: new Date().toISOString() })
      .eq("id", user.id);

    if (upErr) {
      await supabase.from("couples").delete().eq("id", inserted.id);
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      invite_code: inserted.invite_code,
      couple_id: inserted.id,
    });
  }

  return NextResponse.json({ ok: false, error: "生成邀请码失败，请重试" }, { status: 500 });
}
