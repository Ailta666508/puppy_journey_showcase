import { requireCoupleWorkspaceContext } from "@/lib/couple/coupleWorkspaceContext";
import { requireBearerUser } from "@/lib/auth/requireBearerUser";
import { actorFrom, apiError, bodyJson, DubbingHttpError, guideFor, guideRequestDigest, json, parseChoices, pipelineFor, requestKey, sessionFor, signedAsset, uuid } from "@/lib/dubbing/api.server";
import { canReadDubbingTake } from "@/lib/dubbing/access";
import { createDubbingStore, type DbSession } from "@/lib/dubbing/store.server";
import { buildDubbingRenderManifest, type RenderTake } from "@/lib/dubbing/renderPlan";
import { dubbingDigest } from "@/lib/dubbing/plan";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const gate = await requireCoupleWorkspaceContext(request);
    if (!gate.ok) return gate.response;
    const ctx = gate.ctx, actor = actorFrom(ctx), store = createDubbingStore(ctx.supabase);
    const pipelineId = uuid(new URL(request.url).searchParams.get("pipelineJobId"));
    const { plan } = await pipelineFor(ctx, pipelineId);
    const mode = process.env.DUBBING_TTS_MODE;
    const capabilities = { enabled: process.env.DUBBING_ENABLED === "true", ttsMode: mode === "mock" || mode === "doubao" ? mode : "disabled" };
    const base = { ok: true, capabilities, userId: ctx.userId, myRole: ctx.role, plan, guide: null, session: null, takes: [], mySubmission: null, partnerProgress: { ready: 0, total: 0 }, renders: [] };
    if (!capabilities.enabled) return json(base);
    const candidates = await store.guidesByPipeline(pipelineId);
    const currentDigest = await guideRequestDigest(pipelineId, plan.scriptDigest);
    const authorized = candidates.filter((g) => g.status !== "revoked" && g.error_code !== "GUIDE_EXPIRED" && g.plan.scriptDigest === plan.scriptDigest && g.participants.coupleId === actor.coupleId && g.participants.yellowDogId === actor.yellowDogId && g.participants.whiteDogId === actor.whiteDogId);
    // Voice configuration applies to new work; an already completed guide keeps its
    // immutable audio and recordings when the operator changes provider settings.
    const candidate = authorized.find((g) => g.result.requestDigest === currentDigest)
      ?? authorized.find((g) => g.status === "ready");
    if (!candidate) return json(base);
    const guide = await guideFor(ctx, candidate.id, pipelineId);
    const { data, error } = await ctx.supabase.from("rehearsal_dubbing_sessions").select("*").eq("guide_id", guide.id).maybeSingle();
    if (error) throw new Error("Session read failed");
    const session = data as DbSession | null;
    const ready = guide.status === "ready";
    const publicGuide = {
      id: guide.id, status: guide.status, errorCode: guide.error_code,
      createdBy: guide.created_by, synthetic: guide.result.synthetic === true,
      timeline: guide.result.timeline, timelineDigest: guide.result.timelineDigest,
      durationConfirmed: guide.result.durationConfirmed === true,
      videoUrl: ready ? await signedAsset(ctx, guide.result.videoPath) : undefined,
      subtitleUrl: ready ? await signedAsset(ctx, guide.result.subtitlePath) : undefined,
      lineAudioUrls: ready ? Object.fromEntries(await Promise.all((guide.result.guideAudio ?? []).map(async (clip) => [clip.lineId, await signedAsset(ctx, clip.path)]))) : {},
    };
    if (!session || session.status !== "active") {
      await guideFor(ctx, guide.id, pipelineId);
      return json({ ...base, plan: guide.plan, guide: publicGuide });
    }
    const [takes, submissions, renders] = await Promise.all([store.takesBySession(session.id), store.submissionsBySession(session.id), store.rendersBySession(session.id)]);
    const own = submissions.find((s) => s.owner_id === ctx.userId);
    const visibleTakes = takes.filter((take) => canReadDubbingTake({ ownerId: take.owner_id, role: take.role, visibility: take.visibility }, guide.participants, actor));
    // Private partner takes never leave the server, even as identifiers or filenames.
    const takeViews = await Promise.all(visibleTakes.map(async (take) => ({
      id: take.id, lineId: take.line_id, ownerId: take.owner_id, role: take.role,
      status: take.status, visibility: take.visibility, durationMs: take.result.durationMs,
      errorCode: take.error_code,
      audioUrl: ["ready", "needs_trim"].includes(take.status) ? await signedAsset(ctx, take.result.path) : undefined,
    })));
    const renderViews = await Promise.all(renders.filter((r) => r.manifest.mode === "duet" || r.created_by === ctx.userId).map(async (render) => ({
      id: render.id, status: render.status, mode: render.manifest.mode, manifest: render.manifest,
      manifestDigest: render.digest, requiredConsentIds: render.manifest.requiredConsentIds,
      consentedBy: render.consents.filter((c) => c.digest === render.digest).map((c) => c.userId),
      errorCode: render.error_code,
      videoUrl: render.status === "completed" ? await signedAsset(ctx, render.result.videoPath) : undefined,
      downloadUrl: render.status === "completed" ? await signedAsset(ctx, render.result.videoPath, true) : undefined,
      subtitleUrl: render.status === "completed" ? await signedAsset(ctx, render.result.subtitlePath) : undefined,
    })));
    await guideFor(ctx, guide.id, pipelineId);
    const [latestTakes, latestRenders] = await Promise.all([store.takesBySession(session.id), store.rendersBySession(session.id)]);
    // Do not disclose newly signed URLs from a snapshot revoked while signing was in flight.
    if (JSON.stringify(takes) !== JSON.stringify(latestTakes) || JSON.stringify(renders) !== JSON.stringify(latestRenders)) throw new DubbingHttpError(409, "配音素材已改变，请刷新后重试");
    return json({ ...base, plan: guide.plan, guide: publicGuide, session: { id: session.id }, takes: takeViews,
      mySubmission: own ? { revision: own.revision, choices: own.choices, shared: own.shared } : null,
      partnerProgress: { ready: new Set(takes.filter((t) => t.owner_id !== ctx.userId && t.status === "ready").map((t) => t.line_id)).size,
        total: guide.plan.lines.filter((l) => l.dubbable && l.speakerKey !== ctx.role).length }, renders: renderViews });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await bodyJson(request);
    // Ownership-only revocation remains available after leaving a relationship.
    if (body.action === "revoke_take") {
      const gate = await requireBearerUser(request); if (!gate.ok) return gate.response;
      const removed = await createDubbingStore(gate.auth.supabase).revokeTake(uuid(body.takeId), gate.auth.user.id);
      if (!removed) throw new DubbingHttpError(404, "录音不存在或无权限");
      return json({ ok: true });
    }
    const gate = await requireCoupleWorkspaceContext(request); if (!gate.ok) return gate.response;
    const ctx = gate.ctx, store = createDubbingStore(ctx.supabase);
    if (process.env.DUBBING_ENABLED !== "true") throw new DubbingHttpError(503, "角色配音尚未启用；请先配置私有存储与媒体工作进程");
    const pipelineId = uuid(body.pipelineJobId);
    if (body.action === "prepare") {
      if (!["mock", "doubao"].includes(process.env.DUBBING_TTS_MODE ?? "")) throw new DubbingHttpError(503, "语音服务尚未配置；本地测试可显式启用 mock 模式");
      const { row, plan } = await pipelineFor(ctx, pipelineId);
      if (row.status !== "completed" || typeof row.video_url !== "string" || !row.video_url) throw new DubbingHttpError(409, "请先完成原视频");
      const key = requestKey(body.requestKey);
      const requestDigest = await guideRequestDigest(pipelineId, plan.scriptDigest);
      const guide = await store.createGuide({ pipelineJobId: pipelineId, actorId: ctx.userId, requestKey: key, requestDigest, plan });
      return json({ ok: true, guideId: guide.id }, 202);
    }
    if (body.action === "session" || body.action === "confirm_duration") {
      const guide = await guideFor(ctx, uuid(body.guideId), pipelineId);
      if (body.action === "session") return json({ ok: true, sessionId: (await store.createSession(guide.id, ctx.userId)).id });
      if (typeof body.timelineDigest !== "string" || !/^[a-f0-9]{64}$/.test(body.timelineDigest)) throw new DubbingHttpError(400, "时间线版本无效");
      await store.confirmDuration(guide.id, ctx.userId, body.timelineDigest);
      return json({ ok: true }, 202);
    }
    if (body.action === "submit" || body.action === "render") {
      const { session, guide } = await sessionFor(ctx, uuid(body.sessionId), pipelineId);
      if (body.action === "submit") {
        if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) throw new DubbingHttpError(400, "提交版本无效");
        if (body.share !== true && body.share !== false) throw new DubbingHttpError(400, "请明确选择是否向伴侣提交录音");
        if (body.share === true && body.shareConsent !== true) throw new DubbingHttpError(400, "请确认向伴侣分享本次录音");
        await store.submit({ sessionId: session.id, actorId: ctx.userId, expectedRevision: Number(body.expectedRevision), choices: parseChoices(body.choices), share: body.share });
        return json({ ok: true });
      }
      if (body.mode !== "solo" && body.mode !== "duet") throw new DubbingHttpError(400, "合成方式无效");
      if (!guide.result.timeline || !guide.result.sourceSha256) throw new DubbingHttpError(409, "示范尚未准备完成");
      const [dbTakes, dbSubmissions] = await Promise.all([store.takesBySession(session.id), store.submissionsBySession(session.id)]);
      const takes: RenderTake[] = dbTakes.filter((t) => t.status === "ready" && t.visibility !== "revoked").map((t) => ({
        id: t.id, sessionId: t.session_id, planDigest: guide.plan.scriptDigest, lineId: t.line_id,
        ownerId: t.owner_id, role: t.role, sha256: t.result.sha256 ?? "", durationMs: t.result.durationMs ?? 0,
        status: "ready", visibility: t.visibility as "private" | "shared",
      }));
      const manifest = await buildDubbingRenderManifest({ sessionId: session.id, participants: guide.participants, actor: actorFrom(ctx), mode: body.mode,
        timeline: guide.result.timeline, durationConfirmed: guide.result.durationConfirmed === true,
        sourceVideoSha256: guide.result.sourceSha256, guideAudioSha256: Object.fromEntries((guide.result.guideAudio ?? []).map((clip) => [clip.lineId, clip.sha256])), takes,
        submissions: dbSubmissions.map((s) => ({ ownerId: s.owner_id, role: s.role, revision: s.revision, choices: s.choices })),
      }).catch(() => { throw new DubbingHttpError(409, "请先保存有效录音选择；双人合成还需要双方提交共享录音"); });
      const render = await store.createRender(session.id, ctx.userId, manifest);
      return json({ ok: true, renderId: render.id }, 201);
    }
    if (body.action === "consent" || body.action === "cancel_render") {
      const render = await store.getRender(uuid(body.renderId));
      if (!render) throw new DubbingHttpError(404, "成片不存在或无权限");
      await guideFor(ctx, render.guide_id, pipelineId);
      if (body.action === "consent") {
        if (body.accepted !== true) throw new DubbingHttpError(400, "请先确认本次声音使用清单");
        if (typeof body.manifestDigest !== "string") throw new DubbingHttpError(400, "合成版本无效");
        await store.consent(render.id, ctx.userId, body.manifestDigest);
      } else {
        await store.cancelRender(render.id, ctx.userId);
      }
      return json({ ok: true }, 202);
    }
    if (body.action === "trim") {
      const take = await store.getTake(uuid(body.takeId));
      if (!take || take.owner_id !== ctx.userId) throw new DubbingHttpError(404, "录音不存在或无权限");
      await guideFor(ctx, take.guide_id, pipelineId);
      if (!Number.isSafeInteger(body.trimStartMs) || !Number.isSafeInteger(body.trimEndMs) || Number(body.trimStartMs) < 0 || Number(body.trimEndMs) <= Number(body.trimStartMs) || Number(body.trimEndMs) > 10000) throw new DubbingHttpError(400, "裁剪范围无效");
      const key = requestKey(body.requestKey);
      const requestDigest = await dubbingDigest(JSON.stringify({ takeId: take.id, startMs: body.trimStartMs, endMs: body.trimEndMs }));
      await store.trimTake({ takeId: take.id, actorId: ctx.userId, startMs: Number(body.trimStartMs), endMs: Number(body.trimEndMs), requestKey: key, requestDigest });
      return json({ ok: true }, 202);
    }
    if (body.action === "retry") {
      if (!["guide", "validate_take", "render"].includes(String(body.kind))) throw new DubbingHttpError(400, "任务类型无效");
      const id = uuid(body.targetId);
      const target = body.kind === "guide" ? await store.getGuide(id) : body.kind === "render" ? await store.getRender(id) : await store.getTake(id);
      if (!target) throw new DubbingHttpError(404, "任务不存在或无权限");
      await guideFor(ctx, "guide_id" in target ? target.guide_id : target.id, pipelineId);
      await store.retryJob(body.kind as "guide" | "validate_take" | "render", id, ctx.userId);
      return json({ ok: true }, 202);
    }
    throw new DubbingHttpError(400, "不支持的配音操作");
  } catch (error) { return apiError(error); }
}
