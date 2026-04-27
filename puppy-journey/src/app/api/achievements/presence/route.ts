import { NextResponse } from "next/server";

import { requireAchievementContext } from "@/lib/achievements/achievementContext";
import { getErrorMessage } from "@/lib/getErrorMessage";
import {
  fetchPresenceRowForSlot,
  patchUserPresenceSlot,
} from "@/lib/achievements/patchUserPresence";
import { buildUserStatusPair, type PresenceRow } from "@/lib/db/achievementMaps";
import { ensureCouplePresenceSlots } from "@/lib/db/ensurePresence";

export async function POST(req: Request) {
  const gate = await requireAchievementContext(req);
  if (!gate.ok) return gate.response;
  const ctx = gate.ctx;

  try {
    const body = (await req.json()) as {
      role?: "me" | "partner";
      statusText?: string;
      statusIcon?: string | null;
      whisper?: string;
      /** 写入本槽「专注中」；false 表示退出专注（如保存我的状态） */
      isFocusing?: boolean;
    };

    if (body.role !== "me" && body.role !== "partner") {
      return NextResponse.json({ ok: false, error: "role 无效" }, { status: 400 });
    }

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

    const slot: "me" | "partner" = body.role;
    if (slot === "partner" && !partnerProfileId) {
      return NextResponse.json({ ok: false, error: "对方尚未加入，无法编辑其状态" }, { status: 400 });
    }

    const before = await fetchPresenceRowForSlot(supabase, coupleId, ctx, slot);
    const statusText = (body.statusText ?? "").trim();
    const nextStatus: Record<string, unknown> = {
      status_text: statusText || String(before?.status_text ?? ""),
      updated_at: new Date().toISOString(),
    };
    if (body.statusIcon !== undefined) nextStatus.status_icon = body.statusIcon || null;
    if (body.isFocusing !== undefined) nextStatus.is_focusing = body.isFocusing;

    await patchUserPresenceSlot(supabase, coupleId, ctx, slot, nextStatus);

    if (body.whisper?.trim()) {
      if (!partnerProfileId) {
        return NextResponse.json({ ok: false, error: "对方尚未加入，无法发送悄悄话" }, { status: 400 });
      }
      const text = body.whisper.trim();
      const beforePartner = await fetchPresenceRowForSlot(supabase, coupleId, ctx, "partner");
      const unread = (Number(beforePartner?.unread_whispers) || 0) + 1;
      await patchUserPresenceSlot(supabase, coupleId, ctx, "partner", {
        unread_whispers: unread,
        last_whisper_received: text,
        updated_at: new Date().toISOString(),
      });
    }

    const { data: allPresence, error: allErr } = await supabase
      .from("user_presence")
      .select("*")
      .eq("couple_id", coupleId);
    if (allErr) throw allErr;

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
