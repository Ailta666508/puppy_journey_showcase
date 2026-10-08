import { createHash } from "node:crypto";
import { requireBearerUser } from "@/lib/auth/requireBearerUser";
import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { apiError, boundedBody, DubbingHttpError, json, requestKey, sessionFor, uuid } from "@/lib/dubbing/api.server";
import { createDubbingStore, DUBBING_BUCKET, DubbingStoreError } from "@/lib/dubbing/store.server";
import { dubbingDigest } from "@/lib/dubbing/plan";

export const runtime = "nodejs";
export const maxDuration = 30;
const MAX_RECORDING_BYTES = 3 * 1024 * 1024;

// Full codec/stream/duration validation happens in the worker, never from MIME alone.
function audioContainer(bytes: Uint8Array, mime: string): string {
  const type = mime.split(";")[0].trim().toLowerCase();
  const head = Buffer.from(bytes.subarray(0, 16));
  if (type === "audio/webm" && head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "webm";
  if (["audio/mp4", "audio/x-m4a"].includes(type) && head.toString("ascii", 4, 8) === "ftyp") return "m4a";
  if (type === "audio/ogg" && head.toString("ascii", 0, 4) === "OggS") return "ogg";
  if (["audio/wav", "audio/x-wav"].includes(type) && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WAVE") return "wav";
  throw new DubbingHttpError(415, "请上传浏览器录制的 WebM、MP4、OGG 或 WAV 音频");
}

/** Metadata-only inventory permits removal after leaving a couple; never signs audio. */
export async function GET(request: Request) {
  try {
    const gate = await requireBearerUser(request); if (!gate.ok) return gate.response;
    const store = createDubbingStore(gate.auth.supabase);
    const takes = await store.takesByOwner(gate.auth.user.id);
    const renders = (await Promise.all([...new Set(takes.map((t) => t.session_id))].map((id) => store.rendersBySession(id)))).flat();
    return json({ ok: true, takes: takes.map((take) => ({ id: take.id, lineId: take.line_id, role: take.role,
      status: take.status, visibility: take.visibility, durationMs: take.result.durationMs, createdAt: take.created_at,
      affectedRenders: renders.filter((r) => r.manifest.lines.some((l) => l.source.kind === "take" && l.source.takeId === take.id)).length })) });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const gate = await requireBearerUser(request); if (!gate.ok) return gate.response;
    const removed = await createDubbingStore(gate.auth.supabase).revokeTake(uuid(new URL(request.url).searchParams.get("id")), gate.auth.user.id);
    if (!removed) throw new DubbingHttpError(404, "录音不存在或无权限");
    return json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(request); if (!gate.ok) return gate.response;
    const ctx = gate.ctx;
    if (process.env.DUBBING_ENABLED !== "true") throw new DubbingHttpError(503, "角色配音尚未启用");
    const type = request.headers.get("content-type") ?? "";
    if (!type.startsWith("multipart/form-data;")) throw new DubbingHttpError(415, "需要音频表单上传");
    const bytes = await boundedBody(request, MAX_RECORDING_BYTES + 16384);
    let form: FormData;
    try { form = await new Request(request.url, { method: "POST", headers: { "content-type": type }, body: Buffer.from(bytes) }).formData(); }
    catch { throw new DubbingHttpError(400, "录音表单无效"); }
    if ([...form.keys()].some((key) => !["sessionId", "lineId", "requestKey", "file"].includes(key)) || [...form.keys()].length !== 4) throw new DubbingHttpError(400, "录音表单字段无效");
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_RECORDING_BYTES) throw new DubbingHttpError(413, "录音文件为空或超过 3 MB");
    const sessionId = uuid(form.get("sessionId")), key = requestKey(form.get("requestKey"));
    const lineId = form.get("lineId");
    if (typeof lineId !== "string" || !/^line-\d+$/.test(lineId)) throw new DubbingHttpError(400, "台词编号无效");
    const { session, guide } = await sessionFor(ctx, sessionId);
    const line = guide.plan.lines.find((l) => l.lineId === lineId);
    if (!line || !line.dubbable || line.speakerKey !== ctx.role) throw new DubbingHttpError(404, "只能为自己的角色录音");
    const audio = new Uint8Array(await file.arrayBuffer());
    const extension = audioContainer(audio, file.type);
    const sha256 = createHash("sha256").update(audio).digest("hex");
    const digest = await dubbingDigest(JSON.stringify({ sessionId, lineId, sha256 }));
    const keyHash = await dubbingDigest(key);
    const path = `uploads/${guide.id}/${ctx.userId}/${keyHash}/${digest}.${extension}`;
    const store = createDubbingStore(ctx.supabase);
    const { data: replay, error: replayError } = await ctx.supabase.from("rehearsal_dubbing_requests").select("request_digest,resource_id").eq("actor_id", ctx.userId).eq("operation", `take:${session.id}`).eq("request_key", key).maybeSingle();
    if (replayError) throw new DubbingHttpError(503, "暂时无法确认录音请求，请重试");
    if (replay) {
      if (replay.request_digest !== digest) throw new DubbingHttpError(409, "此上传请求已用于不同录音，请创建新录音");
      const take = await store.getTake(replay.resource_id);
      if (!take || take.owner_id !== ctx.userId || take.session_id !== session.id) throw new DubbingHttpError(404, "录音不存在或无权限");
      return json({ ok: true, takeId: take.id, status: take.status }, 202);
    }
    // Bound storage abuse before upload; the transactional enqueue RPC checks again.
    const existing = await store.takesBySession(session.id);
    if (existing.filter((take) => take.owner_id === ctx.userId).length >= 60) throw new DubbingHttpError(429, "本次排练的录音数量已达上限");
    const { error } = await ctx.supabase.storage.from(DUBBING_BUCKET).upload(path, audio, { contentType: file.type.split(";")[0], upsert: false });
    if (error && !("statusCode" in error && String(error.statusCode) === "409")) throw new DubbingHttpError(503, "录音上传失败，请保留本地试听后重试");
    // An uncertain RPC response must not delete an object already referenced by a committed take.
    try {
      const take = await store.enqueueTake({ sessionId, actorId: ctx.userId, lineId, requestKey: key, requestDigest: digest, originalPath: path });
      return json({ ok: true, takeId: take.id, status: take.status }, 202);
    } catch (cause) {
      if (!error && cause instanceof DubbingStoreError && ["DUBBING_CONFLICT", "DUBBING_QUOTA_EXCEEDED", "DUBBING_NOT_FOUND", "DUBBING_GUIDE_NOT_READY", "DUBBING_UPLOAD_EXPIRED"].includes(cause.code)) {
        await ctx.supabase.storage.from(DUBBING_BUCKET).remove([path]);
      }
      throw cause;
    }
  } catch (error) { return apiError(error); }
}
