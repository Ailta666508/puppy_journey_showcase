import { NextResponse } from "next/server";
import type { CoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { isUuid } from "@/lib/userRole";
import { assertDubbingMember, DubbingAccessError, type DubbingActor } from "./access";
import { createDubbingPlan } from "./plan";
import { DubbingPlanError } from "./contracts";
import { createDubbingStore, DUBBING_BUCKET, DubbingStoreError, type DbGuide } from "./store.server";
import type { RenderChoice } from "./renderPlan";

export class DubbingHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function json(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}
export function apiError(error: unknown) {
  if (error instanceof DubbingHttpError) return json({ ok: false, error: error.message }, error.status);
  if (error instanceof DubbingAccessError) return json({ ok: false, error: error.message }, 404);
  if (error instanceof DubbingPlanError) return json({ ok: false, error: error.message, code: error.code }, 409);
  if (error instanceof DubbingStoreError) {
    const unavailable = error.code === "DUBBING_STORE_UNAVAILABLE";
    return json({ ok: false, code: error.code, error: unavailable ? "配音服务暂不可用，请检查服务配置后重试" : "配音状态已改变或无权操作，请刷新后重试" }, unavailable ? 503 : error.code === "DUBBING_NOT_FOUND" ? 404 : 409);
  }
  return json({ ok: false, error: "配音操作未完成，请稍后重试" }, 503);
}
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !isUuid(value)) throw new DubbingHttpError(400, "无效的配音编号");
  return value;
}
export function requestKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new DubbingHttpError(400, "无效的请求标识");
  return value;
}
export { guideRequestDigest } from "./requestIdentity.server";
export async function boundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const advertised = request.headers.get("content-length");
  if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > maxBytes)) throw new DubbingHttpError(413, "上传内容过大");
  const reader = request.body?.getReader();
  if (!reader) throw new DubbingHttpError(400, "请求内容为空");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new DubbingHttpError(413, "上传内容过大"); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
export async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(new TextDecoder().decode(await boundedBody(request, 32_768)));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch (error) { if (error instanceof DubbingHttpError) throw error; throw new DubbingHttpError(400, "请求格式无效"); }
}
export function actorFrom(ctx: CoupleWorkspaceContext): DubbingActor {
  return { userId: ctx.userId, role: ctx.role, coupleId: ctx.coupleId, yellowDogId: ctx.coupleYellowDogId, whiteDogId: ctx.coupleWhiteDogId };
}
export async function pipelineFor(ctx: CoupleWorkspaceContext, id: string) {
  const { data, error } = await ctx.supabase.from("rehearsal_pipeline_jobs").select("id,couple_id,script_json,video_url,status").eq("id", id).eq("couple_id", ctx.coupleId).maybeSingle();
  if (error) throw new DubbingStoreError("DUBBING_STORE_UNAVAILABLE");
  if (!data || data.couple_id !== ctx.coupleId) throw new DubbingHttpError(404, "排练不存在或无权限");
  const plan = await createDubbingPlan(data.script_json);
  return { row: data, plan };
}
export async function guideFor(ctx: CoupleWorkspaceContext, id: string, pipelineId?: string): Promise<DbGuide> {
  const guide = await createDubbingStore(ctx.supabase).getGuide(id);
  if (!guide || guide.status === "revoked" || (pipelineId && guide.pipeline_job_id !== pipelineId)) throw new DubbingHttpError(404, "配音不存在或无权限");
  assertDubbingMember(guide.participants, actorFrom(ctx));
  // Re-read current profile/slot membership in the database immediately before media disclosure.
  const { error } = await ctx.supabase.rpc("dubbing_assert_scope", { p_guide_id: id, p_actor_id: ctx.userId });
  if (error) throw new DubbingHttpError(404, "配音不存在或无权限");
  return guide;
}
export async function sessionFor(ctx: CoupleWorkspaceContext, id: string, pipelineId?: string) {
  const session = await createDubbingStore(ctx.supabase).getSession(id);
  if (!session || session.status !== "active") throw new DubbingHttpError(404, "配音会话不存在或无权限");
  const guide = await guideFor(ctx, session.guide_id, pipelineId);
  if (guide.status !== "ready") throw new DubbingHttpError(409, "有声示范尚未完成");
  return { session, guide };
}
export function parseChoices(value: unknown): Record<string, RenderChoice> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DubbingHttpError(400, "请选择每句声音");
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 12) throw new DubbingHttpError(400, "配音选择数量无效");
  return Object.fromEntries(entries.map(([lineId, choice]) => {
    if (!/^line-\d+$/.test(lineId) || !choice || typeof choice !== "object") throw new DubbingHttpError(400, "配音选择无效");
    const candidate = choice as Record<string, unknown>;
    if (candidate.kind === "ai" && Object.keys(candidate).length === 1) return [lineId, { kind: "ai" }];
    if (candidate.kind === "take" && Object.keys(candidate).length === 2) return [lineId, { kind: "take", takeId: uuid(candidate.takeId) }];
    throw new DubbingHttpError(400, "配音选择无效");
  }));
}
export async function signedAsset(ctx: CoupleWorkspaceContext, path: string | undefined, download = false) {
  if (!path) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]*\.[A-Za-z0-9]+$/.test(path) || path.includes("..")) throw new DubbingHttpError(503, "媒体路径无效");
  const { data, error } = await ctx.supabase.storage.from(DUBBING_BUCKET).createSignedUrl(path, 60, download ? { download: "puppy-dubbing.mp4" } : undefined);
  if (error || !data?.signedUrl) throw new DubbingHttpError(503, "暂时无法读取配音媒体");
  return data.signedUrl;
}
