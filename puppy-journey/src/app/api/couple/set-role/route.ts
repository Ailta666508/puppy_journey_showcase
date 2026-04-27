import { NextResponse } from "next/server";

import { requireBearerUser } from "@/lib/auth/requireBearerUser";
import { ensureProfileRow } from "@/lib/couple/ensureProfile";

export const maxDuration = 30;

export async function POST(request: Request) {
  const gate = await requireBearerUser(request);
  if (!gate.ok) return gate.response;

  const { user, supabase } = gate.auth;
  let body: { role?: string };
  try {
    body = (await request.json()) as { role?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "无效 JSON" }, { status: 400 });
  }

  const role = body.role === "yellow_dog" || body.role === "white_dog" ? body.role : null;
  if (!role) {
    return NextResponse.json({ ok: false, error: "role 须为 yellow_dog 或 white_dog" }, { status: 400 });
  }

  const ensured = await ensureProfileRow(supabase, user.id);
  if (!ensured.ok) {
    return NextResponse.json(
      { ok: false, error: ensured.error, hint: ensured.hint },
      { status: 500 },
    );
  }
  const profile = ensured.profile;

  if (profile.couple_id) {
    return NextResponse.json({ ok: false, error: "已加入情侣空间，无法更改身份" }, { status: 400 });
  }

  if (profile.role && profile.role !== role) {
    return NextResponse.json({ ok: false, error: "身份已选择，无法更改" }, { status: 400 });
  }

  if (profile.role === role) {
    return NextResponse.json({ ok: true, role });
  }

  const { error: uErr } = await supabase
    .from("profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (uErr) {
    return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, role });
}
