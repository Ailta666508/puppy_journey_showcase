import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { generateLessonScript } from "@/lib/pipeline/service";

export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId } = gate.ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const input = {
      userText: typeof body.user_text === "string" ? body.user_text : "",
      imageDescription: typeof body.image_description === "string" ? body.image_description : "",
      userImageDataUrl:
        typeof body.user_image_data_url === "string" ? body.user_image_data_url : "",
      contextAchievements:
        typeof body.context_achievements === "string" ? body.context_achievements : "",
      contextTravel: typeof body.context_travel === "string" ? body.context_travel : "",
      contextWishes: typeof body.context_wishes === "string" ? body.context_wishes : "",
    };

    const now = new Date().toISOString();
    const { data: jobRow, error: insErr } = await supabase
      .from("rehearsal_pipeline_jobs")
      .insert({
        couple_id: coupleId,
        author_id: userId,
        status: "processing",
        user_text: input.userText || null,
        image_description: input.imageDescription || null,
        user_image_url:
          typeof body.user_image_url === "string" ? body.user_image_url.trim() || null : null,
        context_achievements: input.contextAchievements || null,
        context_travel: input.contextTravel || null,
        context_wishes: input.contextWishes || null,
        updated_at: now,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;
    const pipelineJobId = jobRow.id as string;

    try {
      const script = await generateLessonScript(input);
      const { error: upErr } = await supabase
        .from("rehearsal_pipeline_jobs")
        .update({
          script_json: script as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pipelineJobId);
      if (upErr) throw upErr;
      return NextResponse.json({ ok: true, script, pipeline_job_id: pipelineJobId });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await supabase
        .from("rehearsal_pipeline_jobs")
        .update({
          status: "failed",
          error_message: message,
          updated_at: new Date().toISOString(),
        })
        .eq("id", pipelineJobId);
      throw e;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
