import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";

type RouteCtx = { params: Promise<{ id: string }> };

export async function DELETE(req: Request, ctx: RouteCtx) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId } = gate.ctx;

    const { id } = await ctx.params;
    const { error } = await supabase
      .from("travel_logs")
      .delete()
      .eq("id", id)
      .eq("couple_id", coupleId)
      .eq("author_id", userId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
