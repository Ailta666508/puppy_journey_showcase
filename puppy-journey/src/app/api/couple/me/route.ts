import { NextResponse } from "next/server";

import { requireBearerUser } from "@/lib/auth/requireBearerUser";
import { ensureProfileRow } from "@/lib/couple/ensureProfile";

export const maxDuration = 30;

export async function GET(request: Request) {
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

  type CoupleRow = {
    id: string;
    invite_code: string;
    yellow_dog_id: string | null;
    white_dog_id: string | null;
  };

  let couple: CoupleRow | null = null;
  if (profile.couple_id) {
    const { data: c, error: cErr } = await supabase
      .from("couples")
      .select("id, invite_code, yellow_dog_id, white_dog_id")
      .eq("id", profile.couple_id)
      .maybeSingle();
    if (cErr) {
      return NextResponse.json({ ok: false, error: "读取情侣空间失败" }, { status: 500 });
    }
    couple = c as CoupleRow | null;
  }

  const complete = Boolean(couple?.yellow_dog_id && couple?.white_dog_id);

  let partnerProfileId: string | null = null;
  let resolvedRole = profile.role as string | null;
  if (couple) {
    const y = couple.yellow_dog_id;
    const w = couple.white_dog_id;
    if (user.id === y) {
      partnerProfileId = w;
      resolvedRole = "yellow_dog";
    } else if (user.id === w) {
      partnerProfileId = y;
      resolvedRole = "white_dog";
    }
  }

  return NextResponse.json({
    ok: true,
    partnerProfileId,
    profile: {
      id: profile.id,
      role: resolvedRole,
      couple_id: profile.couple_id as string | null,
      avatar_url: profile.avatar_url as string | null,
    },
    couple: couple
      ? {
          id: couple.id,
          invite_code: couple.invite_code,
          yellow_dog_id: couple.yellow_dog_id,
          white_dog_id: couple.white_dog_id,
          complete,
        }
      : null,
  });
}
