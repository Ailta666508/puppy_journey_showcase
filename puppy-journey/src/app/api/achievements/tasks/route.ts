import { NextResponse } from "next/server";

import { requireAchievementContext } from "@/lib/achievements/achievementContext";
import { taskRowToAchievementTask } from "@/lib/db/achievementMaps";
import { ACHIEVEMENT_TASKS_SELECT } from "@/lib/db/achievementTasksQuery";
import { normalizeAchievementTitle } from "@/lib/db/achievementRowNormalize";
import { getErrorMessage } from "@/lib/getErrorMessage";
import type { AchievementTask, TaskOwner } from "@/components/achievements/types";

const ALLOWED_SCORES = new Set([5, 10, 20]);

export async function POST(req: Request) {
  const gate = await requireAchievementContext(req);
  if (!gate.ok) return gate.response;
  const ctx = gate.ctx;

  try {
    const body = (await req.json()) as {
      title?: unknown;
      owner?: TaskOwner;
      score?: number;
    };
    const title = normalizeAchievementTitle(body.title);
    if (!title) {
      return NextResponse.json({ ok: false, error: "缺少标题" }, { status: 400 });
    }
    const owner: TaskOwner = body.owner === "partner" ? "partner" : "me";
    const assigneeId =
      owner === "partner" ? ctx.partnerProfileId ?? undefined : ctx.userId;
    if (owner === "partner" && !assigneeId) {
      return NextResponse.json({ ok: false, error: "对方尚未加入房间，无法为 TA 创建成就" }, { status: 400 });
    }
    const rawScore = Number(body.score);
    const score = ALLOWED_SCORES.has(rawScore) ? rawScore : 5;

    const { supabase, coupleId, userId, role, partnerProfileId, coupleYellowDogId, coupleWhiteDogId } = ctx;
    const { data: row, error } = await supabase
      .from("achievement_tasks")
      .insert({
        couple_id: coupleId,
        assignee_id: assigneeId,
        author_id: userId,
        title,
        score,
        blind_box: {
          is_attached: false,
          is_opened: false,
          voucher: null,
          voice_url: null,
        },
      })
      .select(ACHIEVEMENT_TASKS_SELECT)
      .single();
    if (error) throw error;

    const task = taskRowToAchievementTask(
      row as unknown as Parameters<typeof taskRowToAchievementTask>[0],
      userId,
      partnerProfileId,
      coupleYellowDogId,
      coupleWhiteDogId,
      role,
    );
    return NextResponse.json({ ok: true, task });
  } catch (e) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const gate = await requireAchievementContext(req);
  if (!gate.ok) return gate.response;
  const { supabase, coupleId } = gate.ctx;

  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    const id = body.id?.trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少 id" }, { status: 400 });
    }
    const { error } = await supabase.from("achievement_tasks").delete().eq("id", id).eq("couple_id", coupleId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const gate = await requireAchievementContext(req);
  if (!gate.ok) return gate.response;
  const ctx = gate.ctx;

  try {
    const body = (await req.json()) as {
      id?: string;
      blindBox?: AchievementTask["blindBox"];
    };
    const id = body.id?.trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "缺少 id" }, { status: 400 });
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.blindBox !== undefined) patch.blind_box = body.blindBox;
    if (Object.keys(patch).length <= 1) {
      return NextResponse.json({ ok: false, error: "无可更新字段" }, { status: 400 });
    }

    const { supabase, coupleId, userId, role, partnerProfileId, coupleYellowDogId, coupleWhiteDogId } = ctx;
    const { data: row, error } = await supabase
      .from("achievement_tasks")
      .update(patch)
      .eq("id", id)
      .eq("couple_id", coupleId)
      .select(ACHIEVEMENT_TASKS_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      return NextResponse.json({ ok: false, error: "任务不存在" }, { status: 404 });
    }
    const updated = taskRowToAchievementTask(
      row as unknown as Parameters<typeof taskRowToAchievementTask>[0],
      userId,
      partnerProfileId,
      coupleYellowDogId,
      coupleWhiteDogId,
      role,
    );
    return NextResponse.json({ ok: true, task: updated });
  } catch (e) {
    return NextResponse.json({ ok: false, error: getErrorMessage(e) }, { status: 400 });
  }
}
