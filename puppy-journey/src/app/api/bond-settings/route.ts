import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";

export async function GET(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId } = gate.ctx;

    const { data: row, error } = await supabase
      .from("bond_settings")
      .select("*")
      .eq("couple_id", coupleId)
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      return NextResponse.json({
        ok: true,
        bondTargetNextMeeting: 100,
        bondTargetEndSeparation: 100,
      });
    }
    return NextResponse.json({
      ok: true,
      bondTargetNextMeeting: row.bond_target_next_meeting,
      bondTargetEndSeparation: row.bond_target_end_separation,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(req);
    if (!gate.ok) return gate.response;
    const { supabase, coupleId, userId } = gate.ctx;

    const body = (await req.json()) as {
      bondTargetNextMeeting?: number;
      bondTargetEndSeparation?: number;
    };
    const nextMeeting = Math.max(1, Math.min(999_999, Math.floor(Number(body.bondTargetNextMeeting) || 1)));
    const endSep = Math.max(1, Math.min(999_999, Math.floor(Number(body.bondTargetEndSeparation) || 1)));
    const now = new Date().toISOString();

    const { data: existing, error: selErr } = await supabase
      .from("bond_settings")
      .select("id")
      .eq("couple_id", coupleId)
      .maybeSingle();
    if (selErr) throw selErr;

    if (existing?.id) {
      const { error } = await supabase
        .from("bond_settings")
        .update({
          bond_target_next_meeting: nextMeeting,
          bond_target_end_separation: endSep,
          updated_at: now,
          author_id: userId,
        })
        .eq("couple_id", coupleId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("bond_settings").insert({
        couple_id: coupleId,
        bond_target_next_meeting: nextMeeting,
        bond_target_end_separation: endSep,
        updated_at: now,
        author_id: userId,
      });
      if (error) throw error;
    }

    return NextResponse.json({
      ok: true,
      bondTargetNextMeeting: nextMeeting,
      bondTargetEndSeparation: endSep,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
