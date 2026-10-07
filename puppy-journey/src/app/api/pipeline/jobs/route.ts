import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { rehearsalJobOwnedByContext } from "@/lib/pipeline/rehearsalJobAccess";
import { parseHistoryLimit } from "@/lib/pipeline/rehearsalHistoryLimit";
import {
  decodeRehearsalHistoryCursor,
  pageRehearsalHistoryRows,
  rehearsalHistoryCursorFilter,
} from "@/lib/pipeline/rehearsalHistoryCursor";

export const maxDuration = 30;

export async function GET(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId } = gate.ctx;
    const params = new URL(req.url).searchParams;
    const rawLimit = params.get("limit");
    let requestedLimit: number;
    try {
      requestedLimit = parseHistoryLimit(rawLimit);
    } catch {
      return NextResponse.json({ ok: false, error: "limit must be an integer between 1 and 50" }, { status: 400 });
    }
    let cursor;
    try {
      cursor = decodeRehearsalHistoryCursor(params.get("cursor"));
    } catch {
      return NextResponse.json({ ok: false, error: "invalid rehearsal history cursor" }, { status: 400 });
    }

    let query = supabase
      .from("rehearsal_pipeline_jobs")
      .select(
        "id, author_id, couple_id, status, user_text, script_json, run_state, key_image_url, video_url, thumbnail_url, provider_task_id, error_message, created_at, updated_at",
      )
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (cursor) query = query.or(rehearsalHistoryCursorFilter(cursor));
    const { data, error } = await query.limit(requestedLimit + 1);
    if (error) throw error;

    const page = pageRehearsalHistoryRows(data ?? [], requestedLimit);
    const runs = page.rows
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
        providerTaskId: row.provider_task_id,
        error: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

    return NextResponse.json({ ok: true, runs, nextCursor: page.nextCursor });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
