import { NextResponse } from "next/server";

import { requireBearerUser } from "@/lib/auth/requireBearerUser";
import { ensureProfileRow } from "@/lib/couple/ensureProfile";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { type UserRole } from "@/lib/userRole";

export type CoupleWorkspaceContext = {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  userId: string;
  coupleId: string;
  /** 以 couples.yellow_dog_id / white_dog_id 为准，与 profiles.role 不一致时会写回 profiles */
  role: UserRole;
  /** 伴侣 profiles.id；写入 assignee、悄悄话等时使用，勿再传 yellow_dog / white_dog 文本 */
  partnerProfileId: string | null;
  coupleYellowDogId: string | null;
  coupleWhiteDogId: string | null;
};

export type CoupleWorkspaceContextResult =
  | { ok: true; ctx: CoupleWorkspaceContext }
  | { ok: false; response: NextResponse };

function slotRoleForProfile(coupleYellow: string | null, coupleWhite: string | null, userId: string): UserRole | null {
  if (coupleYellow === userId) return "yellow_dog";
  if (coupleWhite === userId) return "white_dog";
  return null;
}

/**
 * 已登录且已绑定情侣空间；成员身份以 couples 两槽为准（与 profiles.role 对齐）。
 * 旅行 / 心愿 / 羁绊 / 排练流水线等按 couple_id + author_id 隔离时应使用此上下文。
 */
export async function requireCoupleWorkspaceContext(request: Request): Promise<CoupleWorkspaceContextResult> {
  const gate = await requireBearerUser(request);
  if (!gate.ok) return { ok: false, response: gate.response };

  const { user, supabase } = gate.auth;
  const ensured = await ensureProfileRow(supabase, user.id);
  if (!ensured.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: ensured.error, hint: ensured.hint },
        { status: 500 },
      ),
    };
  }

  const profile = ensured.profile;
  const coupleId = profile.couple_id as string | null;
  if (!coupleId) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "请先加入情侣空间后再使用此功能" }, { status: 403 }),
    };
  }

  const { data: couple, error: cErr } = await supabase
    .from("couples")
    .select("yellow_dog_id, white_dog_id")
    .eq("id", coupleId)
    .maybeSingle();

  if (cErr || !couple) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "读取情侣空间失败" }, { status: 500 }),
    };
  }

  const yid = couple.yellow_dog_id as string | null;
  const wid = couple.white_dog_id as string | null;

  const slotRole = slotRoleForProfile(yid, wid, user.id);
  if (!slotRole) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "当前账号不在该情侣房间成员位上，请重新加入或联系对方刷新邀请",
        },
        { status: 403 },
      ),
    };
  }

  if (profile.role !== slotRole) {
    await supabase.from("profiles").update({ role: slotRole, updated_at: new Date().toISOString() }).eq("id", user.id);
  }

  const partnerProfileId = user.id === yid ? wid : yid;

  return {
    ok: true,
    ctx: {
      supabase,
      userId: user.id,
      coupleId,
      role: slotRole,
      partnerProfileId,
      coupleYellowDogId: yid,
      coupleWhiteDogId: wid,
    },
  };
}
