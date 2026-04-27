import { NextResponse } from "next/server";

import { requireAchievementContext } from "@/lib/achievements/achievementContext";
import { getErrorMessage } from "@/lib/getErrorMessage";
import {
  buildUserStatusPair,
  type PresenceRow,
  taskRowToAchievementTask,
} from "@/lib/db/achievementMaps";
import { ACHIEVEMENT_TASKS_SELECT } from "@/lib/db/achievementTasksQuery";
import { ensureCouplePresenceSlots } from "@/lib/db/ensurePresence";

export async function GET(req: Request) {
  const gate = await requireAchievementContext(req);
  if (!gate.ok) return gate.response;

  const { supabase, coupleId, userId, role, partnerProfileId } = gate.ctx;

  try {
    const { data: coupleRow, error: coupleErr } = await supabase
      .from("couples")
      .select("yellow_dog_id, white_dog_id")
      .eq("id", coupleId)
      .maybeSingle();
    if (coupleErr) throw coupleErr;

    await ensureCouplePresenceSlots(
      supabase,
      coupleId,
      coupleRow?.yellow_dog_id as string | null,
      coupleRow?.white_dog_id as string | null,
    );

    const { data: taskRows, error: tErr } = await supabase
      .from("achievement_tasks")
      .select(ACHIEVEMENT_TASKS_SELECT)
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false });
    if (tErr) throw tErr;

    const { data: presRows, error: pErr } = await supabase
      .from("user_presence")
      .select("*")
      .eq("couple_id", coupleId);
    if (pErr) throw pErr;

    const ySlot = coupleRow?.yellow_dog_id as string | null;
    const wSlot = coupleRow?.white_dog_id as string | null;
    const tasks = (taskRows ?? []).map((row) =>
      taskRowToAchievementTask(
        row as unknown as Parameters<typeof taskRowToAchievementTask>[0],
        userId,
        partnerProfileId,
        ySlot,
        wSlot,
        role,
      ),
    );
    const presence = buildUserStatusPair((presRows ?? []) as PresenceRow[], userId, partnerProfileId, ySlot, wSlot);

    return NextResponse.json({
      ok: true,
      tasks,
      presence,
      viewerRole: role,
      myProfileId: userId,
      partnerProfileId,
      coupleId,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) }, { status: 500 });
  }
}
