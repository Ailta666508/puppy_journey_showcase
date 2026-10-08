import { NextResponse } from "next/server";

import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { DubbingPlanError } from "@/lib/dubbing/contracts";
import { createDubbingPlan } from "@/lib/dubbing/plan";
import { isUuid } from "@/lib/userRole";

export const dynamic = "force-dynamic";

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** A read-only plan always derives from the authorized saved script. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const gate = await requireCoupleWorkspaceContext(request);
    if (!gate.ok) return gate.response;
    const { id } = await context.params;
    if (!isUuid(id)) return reply({ ok: false, error: "任务编号无效" }, 400);
    const { ctx } = gate;
    const { data: row, error } = await ctx.supabase
      .from("rehearsal_pipeline_jobs")
      .select("id, couple_id, script_json")
      .eq("id", id)
      .eq("couple_id", ctx.coupleId)
      .maybeSingle();
    if (error) return reply({ ok: false, error: "暂时无法读取角色台词，请稍后重试" }, 503);
    // Legacy author-only jobs are intentionally not shared with a current partner.
    if (!row || row.couple_id !== ctx.coupleId) {
      return reply({ ok: false, error: "任务不存在或无权限" }, 404);
    }
    const plan = await createDubbingPlan(row.script_json);
    return reply({ ok: true, plan, myRole: ctx.role });
  } catch (error) {
    if (error instanceof DubbingPlanError) {
      return reply({
        ok: false, code: error.code, error: error.message,
        ...(error.lineId ? { lineId: error.lineId } : {}),
      }, 409);
    }
    // Provider, database and authentication errors must not expose connection details.
    return reply({ ok: false, error: "角色台词暂不可用，请稍后重试" }, 503);
  }
}
