import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { rehearsalJobOwnedByContext } from "@/lib/pipeline/rehearsalJobAccess";
import {
  rehearsalRunFromPersistence,
  rehearsalRunToPersistence,
} from "@/lib/pipeline/rehearsalRunPersistence";
import { failRehearsalStage } from "@/lib/pipeline/rehearsalRunState";
import {
  beginVideoStage,
  isStaleVideoSubmission,
  reconcileCompletedVideoRun,
  resumeStaleVideoSubmission,
} from "@/lib/pipeline/rehearsalVideoRun.server";
import { enqueueLessonVideo } from "@/lib/pipeline/service";
import type { LessonScript, RehearsalRunState } from "@/lib/pipeline/types";
import { isUuid } from "@/lib/userRole";

export const maxDuration = 60;

function isLessonScript(x: unknown): x is LessonScript {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.scene === "string" &&
    typeof o.theme === "string" &&
    Array.isArray(o.script) &&
    o.script.length > 0
  );
}

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

export async function POST(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId } = gate.ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const pipelineJobId =
      typeof body.pipeline_job_id === "string" ? body.pipeline_job_id.trim() : "";
    if (!pipelineJobId || !isUuid(pipelineJobId)) {
      return NextResponse.json(
        { ok: false, error: "缺少合法 pipeline_job_id" },
        { status: 400 },
      );
    }

    const { data, error: fetchErr } = await supabase
      .from("rehearsal_pipeline_jobs")
      .select(
        "id, author_id, couple_id, status, script_json, run_state, key_image_url, video_url, provider_task_id, created_at, updated_at",
      )
      .eq("id", pipelineJobId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!data || !rehearsalJobOwnedByContext(data, userId, coupleId)) {
      return NextResponse.json(
        { ok: false, error: "任务不存在或无权限" },
        { status: 404 },
      );
    }
    const row = data as unknown as Record<string, unknown>;

    const previousRun = runFromRow(row);
    const videoUrl = typeof row.video_url === "string" ? row.video_url.trim() : "";
    const providerTaskId =
      typeof row.provider_task_id === "string" ? row.provider_task_id.trim() : "";

    if (videoUrl && row.status === "completed") {
      const reconciledRun = reconcileCompletedVideoRun(
        previousRun,
        new Date().toISOString(),
      );
      if (reconciledRun !== previousRun) {
        await supabase
          .from("rehearsal_pipeline_jobs")
          .update({ run_state: rehearsalRunToPersistence(reconciledRun).run_state })
          .eq("id", pipelineJobId)
          .eq("couple_id", coupleId);
      }
      return NextResponse.json({
        ok: true,
        jobId: pipelineJobId,
        status: "completed",
        videoUrl,
        run: reconciledRun,
        replayed: true,
      });
    }

    if (previousRun.stages.video.status === "completed") {
      if (!videoUrl) throw new Error("已完成的视频阶段缺少播放地址");
      return NextResponse.json({
        ok: true,
        jobId: pipelineJobId,
        status: "completed",
        videoUrl,
        run: previousRun,
        replayed: true,
      });
    }

    const now = new Date().toISOString();
    if (
      previousRun.stages.video.status === "running" &&
      !isStaleVideoSubmission(previousRun, Boolean(providerTaskId), now)
    ) {
      return NextResponse.json(
        {
          ok: true,
          jobId: pipelineJobId,
          status: "processing",
          run: previousRun,
          replayed: true,
        },
        { status: 202 },
      );
    }

    const script = row.script_json;
    if (!isLessonScript(script)) {
      return NextResponse.json(
        { ok: false, error: "已保存的任务缺少合法剧本" },
        { status: 409 },
      );
    }
    const keyImageUrl =
      typeof row.key_image_url === "string" ? row.key_image_url.trim() : "";
    if (!keyImageUrl || previousRun.stages.image.status !== "completed") {
      return NextResponse.json(
        { ok: false, error: "视频生成前必须先完成关键帧阶段" },
        { status: 409 },
      );
    }

    let runningRun: RehearsalRunState;
    try {
      runningRun = isStaleVideoSubmission(previousRun, false, now)
        ? resumeStaleVideoSubmission(previousRun, now)
        : beginVideoStage(previousRun, now);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ ok: false, error: message }, { status: 409 });
    }

    const { data: claimed, error: claimErr } = await supabase
      .from("rehearsal_pipeline_jobs")
      .update({
        status: "processing",
        error_message: null,
        first_frame_image_url: keyImageUrl,
        provider_task_id: null,
        video_url: null,
        thumbnail_url: null,
        run_state: rehearsalRunToPersistence(runningRun).run_state,
        updated_at: now,
      })
      .eq("id", pipelineJobId)
      .eq("couple_id", coupleId)
      .eq("updated_at", String(row.updated_at))
      .select("id")
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) {
      return NextResponse.json(
        { ok: false, error: "视频阶段状态已更新，请刷新后重试" },
        { status: 409 },
      );
    }

    try {
      const { jobId: newProviderTaskId } = await enqueueLessonVideo({
        script,
        firstFrameImageUrl: keyImageUrl,
      });
      const submittedAt = new Date().toISOString();
      const { data: committed, error: updateErr } = await supabase
        .from("rehearsal_pipeline_jobs")
        .update({
          provider_task_id: newProviderTaskId,
          updated_at: submittedAt,
        })
        .eq("id", pipelineJobId)
        .eq("couple_id", coupleId)
        .eq("updated_at", now)
        .select("id")
        .maybeSingle();
      if (updateErr) throw updateErr;
      if (!committed) {
        throw new Error("视频任务已提交，但保存任务标识时发生并发更新");
      }

      return NextResponse.json(
        {
          ok: true,
          jobId: pipelineJobId,
          status: "processing",
          run: runningRun,
        },
        { status: 202 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date().toISOString();
      const failedRun = failRehearsalStage(
        runningRun,
        "video",
        message,
        failedAt,
      );
      await supabase
        .from("rehearsal_pipeline_jobs")
        .update({
          status: "failed",
          error_message: message,
          run_state: rehearsalRunToPersistence(failedRun).run_state,
          updated_at: failedAt,
        })
        .eq("id", pipelineJobId)
        .eq("couple_id", coupleId)
        .eq("updated_at", now);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
