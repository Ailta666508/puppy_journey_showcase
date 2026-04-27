import { NextResponse } from "next/server";

import { requireBearerUser } from "@/lib/auth/requireBearerUser";
import { ensureProfileRow } from "@/lib/couple/ensureProfile";

export const maxDuration = 30;

function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export async function POST(request: Request) {
  const gate = await requireBearerUser(request);
  if (!gate.ok) return gate.response;

  const { user, supabase } = gate.auth;

  let body: { invite_code?: string };
  try {
    body = (await request.json()) as { invite_code?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "无效 JSON" }, { status: 400 });
  }

  const code = normalizeInviteCode(String(body.invite_code ?? ""));
  if (code.length !== 6) {
    return NextResponse.json({ ok: false, error: "请输入 6 位邀请码" }, { status: 400 });
  }

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

  const { data: couple, error: cErr } = await supabase
    .from("couples")
    .select("id, invite_code, yellow_dog_id, white_dog_id")
    .eq("invite_code", code)
    .maybeSingle();

  if (cErr) {
    return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
  }

  if (!couple) {
    return NextResponse.json({ ok: false, error: "找不到该邀请码，请核对后重试" }, { status: 404 });
  }

  if (couple.yellow_dog_id === user.id || couple.white_dog_id === user.id) {
    return NextResponse.json({ ok: false, error: "你已是该房间的成员" }, { status: 400 });
  }

  if (role === "yellow_dog") {
    if (couple.yellow_dog_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "这个房间已经有小鸡毛啦，你必须邀请小白！",
          code: "ROOM_YELLOW_TAKEN",
        },
        { status: 409 },
      );
    }
    const { error: upCErr } = await supabase
      .from("couples")
      .update({ yellow_dog_id: user.id })
      .eq("id", couple.id);
    if (upCErr) {
      return NextResponse.json({ ok: false, error: upCErr.message }, { status: 500 });
    }
  } else {
    if (couple.white_dog_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "这个房间已经有小白啦，你必须邀请小鸡毛！",
          code: "ROOM_WHITE_TAKEN",
        },
        { status: 409 },
      );
    }
    const { error: upCErr } = await supabase
      .from("couples")
      .update({ white_dog_id: user.id })
      .eq("id", couple.id);
    if (upCErr) {
      return NextResponse.json({ ok: false, error: upCErr.message }, { status: 500 });
    }
  }

  const { error: pErr } = await supabase
    .from("profiles")
    .update({ couple_id: couple.id, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (pErr) {
    return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });
  }

  const { data: fresh } = await supabase
    .from("couples")
    .select("yellow_dog_id, white_dog_id")
    .eq("id", couple.id)
    .maybeSingle();

  const complete = Boolean(fresh?.yellow_dog_id && fresh?.white_dog_id);

  return NextResponse.json({
    ok: true,
    couple_id: couple.id,
    complete,
  });
}
