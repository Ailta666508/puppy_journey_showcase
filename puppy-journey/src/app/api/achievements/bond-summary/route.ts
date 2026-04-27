import { NextResponse } from "next/server";

import { requireAchievementContext } from "@/lib/achievements/achievementContext";
import { getErrorMessage } from "@/lib/getErrorMessage";

/**
 * GET 当前情侣空间内成就任务 score 总和，供主页双进度条分子。
 */
export async function GET(req: Request) {
  const gate = await requireAchievementContext(req);
  if (!gate.ok) return gate.response;

  try {
    const { supabase, coupleId } = gate.ctx;
    const { data: rows, error } = await supabase
      .from("achievement_tasks")
      .select("score")
      .eq("couple_id", coupleId);
    if (error) throw error;
    let achievementScoreSum = 0;
    for (const r of rows ?? []) {
      const raw = r.score;
      const s = typeof raw === "number" && Number.isFinite(raw) ? raw : Number(raw);
      achievementScoreSum += Number.isFinite(s) ? s : 5;
    }
    return NextResponse.json({ ok: true, achievementScoreSum });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: getErrorMessage(e), achievementScoreSum: 0 },
      { status: 500 },
    );
  }
}
