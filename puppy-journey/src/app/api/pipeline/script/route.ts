import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import {
  rehearsalRunFromPersistence,
  rehearsalRunToPersistence,
} from "@/lib/pipeline/rehearsalRunPersistence";
import {
  createRunningScriptRun,
  normalizeRehearsalIdempotencyKey,
  rehearsalRequestFingerprint,
  type RehearsalScriptInput,
} from "@/lib/pipeline/rehearsalScriptRun.server";
import { completeRehearsalStage, failRehearsalStage } from "@/lib/pipeline/rehearsalRunState";
import { generateLessonScript } from "@/lib/pipeline/service";

export const maxDuration = 120;

function replayResponse(row: Record<string, unknown>, fingerprint: string) {
  if (row.request_fingerprint !== fingerprint) {
    return NextResponse.json(
      { ok: false, error: "idempotency_key 已用于不同的请求" },
      { status: 409 },
    );
  }
  const run = rehearsalRunFromPersistence({
    id: String(row.id),
    couple_id: String(row.couple_id),
    author_id: String(row.author_id),
    run_state: row.run_state,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  });
  const scriptStatus = run.stages.script.status;
  const failed = scriptStatus === "failed";
  return NextResponse.json(
    {
      ok: !failed,
      replayed: true,
      status: run.status,
      stage_status: scriptStatus,
      script: row.script_json ?? undefined,
      pipeline_job_id: row.id,
      run,
      error: failed ? run.stages.script.error ?? row.error_message ?? "failed" : undefined,
    },
    { status: failed ? 409 : scriptStatus === "completed" ? 200 : 202 },
  );
}

export async function POST(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId } = gate.ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const input: RehearsalScriptInput = {
      userText: typeof body.user_text === "string" ? body.user_text : "",
      imageDescription: typeof body.image_description === "string" ? body.image_description : "",
      userImageDataUrl:
        typeof body.user_image_data_url === "string" ? body.user_image_data_url : "",
      userImageUrl: typeof body.user_image_url === "string" ? body.user_image_url.trim() : "",
      contextAchievements:
        typeof body.context_achievements === "string" ? body.context_achievements : "",
      contextTravel: typeof body.context_travel === "string" ? body.context_travel : "",
      contextWishes: typeof body.context_wishes === "string" ? body.context_wishes : "",
    };

    let idempotencyKey: string | undefined;
    try {
      idempotencyKey = normalizeRehearsalIdempotencyKey(body.idempotency_key);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
    const requestFingerprint = rehearsalRequestFingerprint(input);

    const findExisting = async () => {
      if (!idempotencyKey) return null;
      const { data, error } = await supabase
        .from("rehearsal_pipeline_jobs")
        .select(
          "id, couple_id, author_id, status, script_json, run_state, request_fingerprint, error_message, created_at, updated_at",
        )
        .eq("couple_id", coupleId)
        .eq("author_id", userId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (error) throw error;
      return data as Record<string, unknown> | null;
    };
    const existing = await findExisting();
    if (existing) return replayResponse(existing, requestFingerprint);

    const now = new Date().toISOString();
    const runningRun = createRunningScriptRun({ coupleId, authorId: userId, now });
    const persisted = rehearsalRunToPersistence(runningRun);
    const { data: jobRow, error: insErr } = await supabase
      .from("rehearsal_pipeline_jobs")
      .insert({
        id: runningRun.id,
        couple_id: coupleId,
        author_id: userId,
        idempotency_key: idempotencyKey ?? null,
        request_fingerprint: requestFingerprint,
        run_state: persisted.run_state,
        status: "processing",
        user_text: input.userText || null,
        image_description: input.imageDescription || null,
        user_image_url: input.userImageUrl || null,
        context_achievements: input.contextAchievements || null,
        context_travel: input.contextTravel || null,
        context_wishes: input.contextWishes || null,
        updated_at: now,
      })
      .select("id")
      .single();
    if (insErr) {
      if (idempotencyKey && insErr.code === "23505") {
        const raced = await findExisting();
        if (raced) return replayResponse(raced, requestFingerprint);
      }
      throw insErr;
    }
    const pipelineJobId = jobRow.id as string;

    try {
      const script = await generateLessonScript(input);
      const completedAt = new Date().toISOString();
      const completedRun = completeRehearsalStage(runningRun, "script", completedAt);
      const { error: upErr } = await supabase
        .from("rehearsal_pipeline_jobs")
        .update({
          script_json: script as unknown as Record<string, unknown>,
          run_state: rehearsalRunToPersistence(completedRun).run_state,
          updated_at: completedAt,
        })
        .eq("id", pipelineJobId)
        .eq("couple_id", coupleId)
        .eq("author_id", userId);
      if (upErr) throw upErr;
      return NextResponse.json({
        ok: true,
        script,
        pipeline_job_id: pipelineJobId,
        run: completedRun,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const failedAt = new Date().toISOString();
      const failedRun = failRehearsalStage(runningRun, "script", message, failedAt);
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
        .eq("author_id", userId);
      throw e;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
