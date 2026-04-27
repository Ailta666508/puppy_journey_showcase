import { NextResponse } from "next/server";

import { requireAchievementContext } from "@/lib/achievements/achievementContext";
import { getErrorMessage } from "@/lib/getErrorMessage";
import { patchUserPresenceSlot } from "@/lib/achievements/patchUserPresence";
import { buildUserStatusPair, type PresenceRow } from "@/lib/db/achievementMaps";
import { ensureCouplePresenceSlots } from "@/lib/db/ensurePresence";

export async function POST(req: Request) {
  const gate = await requireAchievementContext(req);
  if (!gate.ok) return gate.response;
  const ctx = gate.ctx;

  try {
    const body = (await req.json()) as {
      role?: "me" | "partner";
      roles?: unknown;
    };

    const { supabase, coupleId, partnerProfileId } = ctx;

    const { data: coupleRow, error: cErr } = await supabase
      .from("couples")
      .select("yellow_dog_id, white_dog_id")
      .eq("id", coupleId)
      .maybeSingle();
    if (cErr) throw cErr;

    await ensureCouplePresenceSlots(
      supabase,
      coupleId,
      coupleRow?.yellow_dog_id as string | null,
      coupleRow?.white_dog_id as string | null,
    );

    const now = new Date().toISOString();

    async function clearUnreadSlot(slot: "me" | "partner") {
      if (slot === "partner" && !partnerProfileId) {
        throw new Error("对方尚未加入");
      }
      await patchUserPresenceSlot(supabase, coupleId, ctx, slot, {
        unread_whispers: 0,
        updated_at: now,
      });
    }

    if (Array.isArray(body.roles) && body.roles.length > 0) {
      const roles = body.roles.filter((r): r is "me" | "partner" => r === "me" || r === "partner");
      if (roles.length === 0) {
        return NextResponse.json({ ok: false, error: "roles 无效" }, { status: 400 });
      }
      if (roles.includes("me")) await clearUnreadSlot("me");
      if (roles.includes("partner")) await clearUnreadSlot("partner");
    } else if (body.role === "me" || body.role === "partner") {
      await clearUnreadSlot(body.role);
    } else {
      return NextResponse.json({ ok: false, error: "role 无效" }, { status: 400 });
    }

    const { data: allPresence, error: pErr } = await supabase
      .from("user_presence")
      .select("*")
      .eq("couple_id", coupleId);
    if (pErr) throw pErr;

    const presence = buildUserStatusPair(
      (allPresence ?? []) as PresenceRow[],
      ctx.userId,
      partnerProfileId,
      coupleRow?.yellow_dog_id as string | null,
      coupleRow?.white_dog_id as string | null,
    );
    return NextResponse.json({ ok: true, presence });
  } catch (e) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) }, { status: 400 });
  }
}
