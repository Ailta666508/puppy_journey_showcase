import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { enqueueLessonVideo } from "@/lib/pipeline/service";
import type { LessonScript } from "@/lib/pipeline/types";
import { rehearsalJobOwnedByContext } from "@/lib/pipeline/rehearsalJobAccess";
import { isUuid } from "@/lib/userRole";

export const maxDuration = 60;

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
    const firstFrameRaw = typeof body.first_frame_image_url === "string" ? body.first_frame_image_url.trim() : "";
    const firstFrameImageUrl = firstFrameRaw || undefined;
    if (!isLessonScript(script)) {
      return NextResponse.json({ ok: false, error: "请提供合法 script 对象" }, { status: 400 });
    }

    const { supabase, coupleId, userId } = ctx;
    const { data: row, error: fetchErr } = await supabase
      .from("rehearsal_pipeline_jobs")
      .select("id, author_id, couple_id")
      .eq("id", pipelineJobId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!row || !rehearsalJobOwnedByContext(row, userId, coupleId)) {
      return NextResponse.json({ ok: false, error: "任务不存在或无权限" }, { status: 404 });
    }

    const { jobId: providerJobId } = await enqueueLessonVideo({
      script,
      firstFrameImageUrl,
    });

    await supabase
      .from("rehearsal_pipeline_jobs")
      .update({
        first_frame_image_url: firstFrameImageUrl ?? null,
        provider_task_id: providerJobId,
        status: "processing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", pipelineJobId);

    return NextResponse.json({ ok: true, jobId: pipelineJobId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
