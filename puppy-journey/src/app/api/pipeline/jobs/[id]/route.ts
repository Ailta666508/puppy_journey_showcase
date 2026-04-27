import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { pollLessonVideoJob } from "@/lib/pipeline/service";
import { rehearsalJobOwnedByContext } from "@/lib/pipeline/rehearsalJobAccess";
import { isUuid } from "@/lib/userRole";

export const maxDuration = 30;

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const jobId = decodeURIComponent(id ?? "").trim();
    if (!jobId) {
      return NextResponse.json({ ok: false, error: "缺少 job id" }, { status: 400 });
    }

    if (!isUuid(jobId)) {
      const result = await pollLessonVideoJob(jobId);
      return NextResponse.json({ ok: true, ...result });
    }

    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId } = gate.ctx;

    const { data: row, error } = await supabase
      .from("rehearsal_pipeline_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw error;
    if (!row || !rehearsalJobOwnedByContext(row, userId, coupleId)) {
      return NextResponse.json({ ok: false, error: "任务不存在" }, { status: 404 });
    }

    if (row.status === "completed" && row.video_url) {
      return NextResponse.json({
        ok: true,
        status: "completed",
        videoUrl: row.video_url,
        thumbnailUrl: row.thumbnail_url ?? undefined,
        error: row.error_message ?? undefined,
        providerTaskId: row.provider_task_id ?? undefined,
      });
    }
    if (row.status === "failed") {
      return NextResponse.json({
        ok: true,
        status: "failed",
        error: row.error_message ?? "failed",
        providerTaskId: row.provider_task_id ?? undefined,
      });
    }

    const providerId = row.provider_task_id;
    if (!providerId || typeof providerId !== "string") {
      return NextResponse.json({
        ok: true,
        status: "processing",
        error: undefined,
        providerTaskId: undefined,
      });
    }

    const result = await pollLessonVideoJob(providerId);
    const now = new Date().toISOString();

    if (result.status === "completed" && result.videoUrl) {
      await supabase
        .from("rehearsal_pipeline_jobs")
        .update({
          status: "completed",
          video_url: result.videoUrl,
          thumbnail_url: result.thumbnailUrl ?? null,
          error_message: null,
          updated_at: now,
        })
        .eq("id", jobId);
    } else if (result.status === "failed") {
      await supabase
        .from("rehearsal_pipeline_jobs")
        .update({
          status: "failed",
          error_message: result.error ?? "failed",
          updated_at: now,
        })
        .eq("id", jobId);
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
