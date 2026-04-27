import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId } = gate.ctx;

    const { id } = await ctx.params;
    const body = (await req.json()) as { isCompleted?: boolean };
    if (body.isCompleted !== true) {
      return NextResponse.json({ ok: false, error: "仅支持完成心愿" }, { status: 400 });
    }
    const { error } = await supabase
      .from("wish_items")
      .update({
        is_completed: true,
        updated_at: new Date().toISOString(),
      })
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

export async function DELETE(req: Request, ctx: RouteCtx) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId } = gate.ctx;

    const { id } = await ctx.params;
    const { error } = await supabase
      .from("wish_items")
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
