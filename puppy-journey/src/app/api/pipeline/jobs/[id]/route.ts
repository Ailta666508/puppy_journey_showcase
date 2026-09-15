import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { rehearsalJobOwnedByContext } from "@/lib/pipeline/rehearsalJobAccess";
import {
  rehearsalRunFromPersistence,
  rehearsalRunToPersistence,
} from "@/lib/pipeline/rehearsalRunPersistence";
import { failRehearsalStage } from "@/lib/pipeline/rehearsalRunState";
import {
  completeVideoRun,
  reconcileCompletedVideoRun,
} from "@/lib/pipeline/rehearsalVideoRun.server";
import { pollLessonVideoJob } from "@/lib/pipeline/service";
import type { RehearsalRunState } from "@/lib/pipeline/types";
import { isUuid } from "@/lib/userRole";

export const maxDuration = 30;

type RouteCtx = { params: Promise<{ id: string }> };

function runFromRow(row: Record<string, unknown>): RehearsalRunState {
  return rehearsalRunFromPersistence({
    id: String(row.id),
    couple_id: String(row.couple_id),
    author_id: String(row.author_id),
    run_state: row.run_state,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  });
}

export async function GET(req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const jobId = decodeURIComponent(id ?? "").trim();
    if (!jobId || !isUuid(jobId)) {
      return NextResponse.json(
        { ok: false, error: "缺少合法 pipeline job id" },
        { status: 400 },
      );
    }

    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId } = gate.ctx;

    const { data, error } = await supabase
      .from("rehearsal_pipeline_jobs")
      .select(
        "id, author_id, couple_id, status, run_state, video_url, thumbnail_url, provider_task_id, error_message, created_at, updated_at",
      )
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw error;
    if (!data || !rehearsalJobOwnedByContext(data, userId, coupleId)) {
      return NextResponse.json(
        { ok: false, error: "任务不存在或无权限" },
        { status: 404 },
      );
    }
    const row = data as unknown as Record<string, unknown>;
    let run = runFromRow(row);
    const videoUrl = typeof row.video_url === "string" ? row.video_url.trim() : "";
    const thumbnailUrl =
      typeof row.thumbnail_url === "string" ? row.thumbnail_url.trim() : "";

    if (videoUrl && row.status === "completed") {
      const reconciled = reconcileCompletedVideoRun(run, new Date().toISOString());
      if (reconciled !== run) {
        await supabase
          .from("rehearsal_pipeline_jobs")
          .update({ run_state: rehearsalRunToPersistence(reconciled).run_state })
          .eq("id", jobId)
          .eq("couple_id", coupleId);
        run = reconciled;
      }
      return NextResponse.json({
        ok: true,
        status: "completed",
        videoUrl,
        thumbnailUrl: thumbnailUrl || undefined,
        run,
      });
    }

    if (run.stages.video.status === "completed") {
      if (!videoUrl) throw new Error("已完成的视频阶段缺少播放地址");
      return NextResponse.json({
        ok: true,
        status: "completed",
        videoUrl,
        thumbnailUrl: thumbnailUrl || undefined,
        run,
      });
    }
    if (run.stages.video.status === "failed") {
      return NextResponse.json({
        ok: true,
        status: "failed",
        error: run.stages.video.error ?? row.error_message ?? "视频生成失败",
        run,
      });
    }
    if (run.stages.video.status !== "running") {
      return NextResponse.json({ ok: true, status: "queued", run });
    }

    const providerTaskId =
      typeof row.provider_task_id === "string" ? row.provider_task_id.trim() : "";
    if (!providerTaskId) {
      return NextResponse.json({ ok: true, status: "processing", run });
    }

    const result = await pollLessonVideoJob(providerTaskId);
    const now = new Date().toISOString();

    if (result.status === "completed" && result.videoUrl) {
      const completedRun = completeVideoRun(run, now);
      const { data: committed, error: updateErr } = await supabase
        .from("rehearsal_pipeline_jobs")
        .update({
          status: "completed",
          video_url: result.videoUrl,
          thumbnail_url: result.thumbnailUrl ?? null,
          error_message: null,
          run_state: rehearsalRunToPersistence(completedRun).run_state,
          updated_at: now,
        })
        .eq("id", jobId)
        .eq("couple_id", coupleId)
        .eq("updated_at", String(row.updated_at))
        .select("id")
        .maybeSingle();
      if (updateErr) throw updateErr;
      if (!committed) {
        return NextResponse.json(
          { ok: false, error: "视频状态已被其他请求更新，请重新查询" },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true, ...result, run: completedRun });
    }

    if (result.status === "failed") {
      const failedRun = failRehearsalStage(
        run,
        "video",
        result.error ?? "视频生成失败",
        now,
      );
      const { data: committed, error: updateErr } = await supabase
        .from("rehearsal_pipeline_jobs")
        .update({
          status: "failed",
          error_message: result.error ?? "视频生成失败",
          run_state: rehearsalRunToPersistence(failedRun).run_state,
          updated_at: now,
        })
        .eq("id", jobId)
        .eq("couple_id", coupleId)
        .eq("updated_at", String(row.updated_at))
        .select("id")
        .maybeSingle();
      if (updateErr) throw updateErr;
      if (!committed) {
        return NextResponse.json(
          { ok: false, error: "视频状态已被其他请求更新，请重新查询" },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: true, ...result, run: failedRun });
    }

    return NextResponse.json({ ok: true, ...result, run });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
