import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import {
  beginImageStage,
  completeImageStage,
} from "@/lib/pipeline/rehearsalImageRun.server";
import { generateLessonKeyVisual } from "@/lib/pipeline/service";
import type { LessonScript, RehearsalRunState } from "@/lib/pipeline/types";
import { rehearsalJobOwnedByContext } from "@/lib/pipeline/rehearsalJobAccess";
import {
  rehearsalRunFromPersistence,
  rehearsalRunToPersistence,
} from "@/lib/pipeline/rehearsalRunPersistence";
import { failRehearsalStage } from "@/lib/pipeline/rehearsalRunState";
import { isUuid } from "@/lib/userRole";

export const maxDuration = 120;

function isLessonScript(x: unknown): x is LessonScript {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return typeof o.scene === "string" && typeof o.theme === "string" && Array.isArray(o.script);
}

export async function POST(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const ctx = gate.ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const pipelineJobId = typeof body.pipeline_job_id === "string" ? body.pipeline_job_id.trim() : "";
    if (!pipelineJobId || !isUuid(pipelineJobId)) {
      return NextResponse.json({ ok: false, error: "缺少合法 pipeline_job_id" }, { status: 400 });
    }

    const script = body.script;
    if (!isLessonScript(script)) {
      return NextResponse.json({ ok: false, error: "请提供合法 script 对象" }, { status: 400 });
    }

    const { supabase, coupleId, userId } = ctx;
    const { data: row, error: fetchErr } = await supabase
      .from("rehearsal_pipeline_jobs")
      .select(
        "id, author_id, couple_id, run_state, key_image_url, created_at, updated_at",
      )
      .eq("id", pipelineJobId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!row || !rehearsalJobOwnedByContext(row, userId, coupleId)) {
      return NextResponse.json({ ok: false, error: "任务不存在或无权限" }, { status: 404 });
    }

    const previousRun = rehearsalRunFromPersistence({
      id: String(row.id),
      couple_id: String(row.couple_id),
      author_id: String(row.author_id),
      run_state: row.run_state,
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    });
    const existingImageUrl =
      typeof row.key_image_url === "string" ? row.key_image_url.trim() : "";
    if (previousRun.stages.image.status === "completed") {
      if (!existingImageUrl) {
        throw new Error("已完成的图片阶段缺少关键帧地址");
      }
      return NextResponse.json({
        ok: true,
        imageUrl: existingImageUrl,
        run: previousRun,
        replayed: true,
      });
    }

    const startedAt = new Date().toISOString();
    let runningRun: RehearsalRunState;
    try {
      runningRun = beginImageStage(previousRun, startedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ ok: false, error: message }, { status: 409 });
    }
    const { data: claimed, error: claimErr } = await supabase
      .from("rehearsal_pipeline_jobs")
      .update({
        status: "processing",
        error_message: null,
        run_state: rehearsalRunToPersistence(runningRun).run_state,
        updated_at: startedAt,
      })
      .eq("id", pipelineJobId)
      .eq("couple_id", coupleId)
      .eq("updated_at", String(row.updated_at))
      .select("id")
      .maybeSingle();
    if (claimErr) throw claimErr;
    if (!claimed) {
      return NextResponse.json(
        { ok: false, error: "图片阶段状态已更新，请刷新后重试" },
        { status: 409 },
      );
    }

    try {
      const { imageUrl } = await generateLessonKeyVisual(script);
      const completedAt = new Date().toISOString();
      const completedRun = completeImageStage(runningRun, completedAt);
      const { data: committed, error: updateErr } = await supabase
        .from("rehearsal_pipeline_jobs")
        .update({
          key_image_url: imageUrl,
          run_state: rehearsalRunToPersistence(completedRun).run_state,
          updated_at: completedAt,
        })
        .eq("id", pipelineJobId)
        .eq("couple_id", coupleId)
        .eq("updated_at", startedAt)
        .select("id")
        .maybeSingle();
      if (updateErr) throw updateErr;
      if (!committed) {
        throw new Error("图片阶段状态已被其他请求更新");
      }

      return NextResponse.json({ ok: true, imageUrl, run: completedRun });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedAt = new Date().toISOString();
      const failedRun = failRehearsalStage(
        runningRun,
        "image",
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
        .eq("updated_at", startedAt);
      throw error;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
