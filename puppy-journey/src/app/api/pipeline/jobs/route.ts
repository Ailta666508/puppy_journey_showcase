import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { rehearsalJobOwnedByContext } from "@/lib/pipeline/rehearsalJobAccess";

export const maxDuration = 30;

const HISTORY_LIMIT = 20;

export async function GET(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId } = gate.ctx;

    const { data, error } = await supabase
      .from("rehearsal_pipeline_jobs")
      .select(
        "id, author_id, couple_id, status, user_text, script_json, run_state, key_image_url, video_url, thumbnail_url, error_message, created_at, updated_at",
      )
      .eq("couple_id", coupleId)
      .order("updated_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw error;

    const runs = (data ?? [])
      .filter((row) => rehearsalJobOwnedByContext(row, userId, coupleId))
      .map((row) => ({
        id: row.id,
        authorId: row.author_id,
        status: row.status,
        userText: row.user_text,
        script: row.script_json,
        runState: row.run_state,
        keyImageUrl: row.key_image_url,
        videoUrl: row.video_url,
        thumbnailUrl: row.thumbnail_url,
        error: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

    return NextResponse.json({ ok: true, runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
