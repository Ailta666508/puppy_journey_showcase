import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DubbingParticipants } from "./access";
import type { DubbingPlan, DubbingTimeline } from "./contracts";
import type { DubbingRenderManifest } from "./renderPlan";
import { buildDubbingTimeline, digestDubbingTimeline, dubbingTimelineToVtt } from "./timeline";
import { composeDubbingVideo, normalizeRecording, probeMedia } from "./media.server";
import { downloadSourceVideo } from "./sourceDownload.server";
import { DubbingTtsError, synthesizeGuideLine } from "./tts.server";
import { createDubbingStore } from "./store.server";
import { guideRequestDigest } from "./requestIdentity.server";

export const DUBBING_BUCKET = "rehearsal-dubbing";
type Json = Record<string, unknown>;
export type DubbingWorkerJob = {
  id: string; kind: "guide" | "validate_take" | "render" | "purge";
  target_id: string; guide_id: string; lease_token: string | null; result: Json;
};
export type WorkerGuide = {
  id: string; pipeline_job_id: string; participants: DubbingParticipants;
  plan: DubbingPlan; status: string; result: Json;
};
export type WorkerTake = {
  id: string; guide_id: string; session_id: string; line_id: string;
  owner_id: string; role: string; status: string; visibility: string; result: Json;
};
export type WorkerRender = {
  id: string; guide_id: string; session_id: string; status: string;
  manifest: DubbingRenderManifest; result: Json;
};

/** Methods must enforce token/lease checks in the database, not read-then-write in JavaScript. */
export type DubbingWorkerStore = {
  getGuide(id: string): Promise<WorkerGuide | null>;
  getTake(id: string): Promise<WorkerTake | null>;
  getRender(id: string): Promise<WorkerRender | null>;
  claimJob(workerId: string, leaseSeconds?: number): Promise<DubbingWorkerJob | null>;
  renewJob(id: string, token: string, leaseSeconds?: number): Promise<unknown>;
  checkpointJob(id: string, token: string, result: Json): Promise<unknown>;
  finishJob(id: string, token: string, status: "completed" | "failed" | "awaiting_confirmation", result: Json, errorCode?: string): Promise<unknown>;
};
export type DubbingWorkerStorage = {
  download(path: string, destination: string, signal?: AbortSignal): Promise<void>;
  upload(path: string, source: string, contentType: string, signal?: AbortSignal): Promise<void>;
  remove(paths: string[]): Promise<void>;
};
type GuideAudio = { lineId: string; path: string; sha256: string; durationMs: number; synthetic: boolean };
export type DubbingWorkerDependencies = {
  store: DubbingWorkerStore;
  storage: DubbingWorkerStorage;
  currentParticipants(coupleId: string): Promise<DubbingParticipants | null>;
  sourceUrl?(pipelineJobId: string): Promise<string | null>;
  media?: {
    probe: typeof probeMedia; normalize: typeof normalizeRecording; compose: typeof composeDubbingVideo;
    downloadSource: typeof downloadSourceVideo; tts: typeof synthesizeGuideLine;
  };
};
const defaultMedia = { probe: probeMedia, normalize: normalizeRecording, compose: composeDubbingVideo, downloadSource: downloadSourceVideo, tts: synthesizeGuideLine };

class WorkerError extends Error {
  constructor(readonly code: string) { super(code); }
}
function string(value: unknown): string { return typeof value === "string" ? value : ""; }
function digest(bytes: Buffer) { return createHash("sha256").update(bytes).digest("hex"); }
function safePath(path: string) {
  if (!path || path.length > 512 || !/^[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(path) || path.startsWith("/")) throw new WorkerError("INVALID_STORAGE_PATH");
  return path;
}
function errorCode(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? string(error.code) : "";
  return /^[A-Z][A-Z0-9_]{2,70}$/.test(code) ? code : "DUBBING_PROCESSING_FAILED";
}

async function assertCurrentGuide(guide: WorkerGuide, deps: DubbingWorkerDependencies) {
  if (guide.status === "revoked" || guide.status === "cancelled") throw new WorkerError("DUBBING_REVOKED");
  const current = await deps.currentParticipants(guide.participants.coupleId);
  if (!current || current.coupleId !== guide.participants.coupleId ||
    current.yellowDogId !== guide.participants.yellowDogId || current.whiteDogId !== guide.participants.whiteDogId) {
    throw new WorkerError("DUBBING_MEMBERSHIP_CHANGED");
  }
}

async function localAsset(storage: DubbingWorkerStorage, path: string, target: string, hash: string | undefined, signal: AbortSignal) {
  await storage.download(safePath(path), target, signal);
  if (hash && digest(await readFile(target)) !== hash) throw new WorkerError("DUBBING_ASSET_HASH_MISMATCH");
  return target;
}

/** One claimed task. Every checkpoint and publication remains fenced by its database lease. */
export async function executeDubbingJob(job: DubbingWorkerJob, deps: DubbingWorkerDependencies, signal: AbortSignal) {
  if (!job.lease_token) throw new WorkerError("DUBBING_LEASE_MISSING");
  const token = job.lease_token;
  const media = deps.media || defaultMedia;
  const directory = await mkdtemp(join(tmpdir(), "puppy-dubbing-"));
  const unpublished = new Set<string>();
  let databaseOutcomeUnknown = false;
  const upload = async (path: string, local: string, contentType: string) => {
    await deps.storage.upload(path, local, contentType, signal);
    unpublished.add(path);
  };
  const retainReferences = (result: Json) => {
    for (const field of ["sourcePath", "path", "videoPath", "subtitlePath"]) {
      if (typeof result[field] === "string") unpublished.delete(result[field] as string);
    }
    if (Array.isArray(result.guideAudio)) for (const clip of result.guideAudio as GuideAudio[]) unpublished.delete(clip.path);
  };
  const checkpoint = async (result: Json) => {
    signal.throwIfAborted();
    let accepted;
    try { accepted = await deps.store.checkpointJob(job.id, token, result); }
    catch (error) { databaseOutcomeUnknown = true; throw error; }
    if (accepted === false) throw new WorkerError("DUBBING_LEASE_LOST");
    retainReferences(result);
  };
  const finish = async (status: "completed" | "awaiting_confirmation", result: Json) => {
    signal.throwIfAborted();
    let accepted;
    try { accepted = await deps.store.finishJob(job.id, token, status, result); }
    catch (error) { databaseOutcomeUnknown = true; throw error; }
    if (accepted === false) throw new WorkerError("DUBBING_PUBLICATION_REJECTED");
    retainReferences(result);
  };
  try {
    if (job.kind === "purge") {
      const paths = job.result.paths;
      if (!Array.isArray(paths) || !paths.every((path) => typeof path === "string")) throw new WorkerError("DUBBING_PURGE_PATHS_MISSING");
      await deps.storage.remove(paths.map((path) => safePath(path)));
      await finish("completed", { purgedPaths: paths, purgedAt: new Date().toISOString() });
      return;
    }
    const guide = await deps.store.getGuide(job.guide_id);
    if (!guide) throw new WorkerError("DUBBING_GUIDE_NOT_FOUND");
    await assertCurrentGuide(guide, deps);
    const result: Json = { ...guide.result };
    if (job.kind === "guide") {
      if (result.requestDigest !== await guideRequestDigest(guide.pipeline_job_id, guide.plan.scriptDigest)) {
        throw new WorkerError("DUBBING_TTS_CONFIG_CHANGED");
      }
      const source = join(directory, "source.mp4");
      if (result.sourcePath && result.sourceSha256) {
        await localAsset(deps.storage, string(result.sourcePath), source, string(result.sourceSha256), signal);
      } else {
        // Resolve from the saved authorized job, never a URL supplied by a browser request.
        const sourceUrl = string(result.sourceUrl) || await deps.sourceUrl?.(guide.pipeline_job_id);
        if (!sourceUrl) throw new WorkerError("DUBBING_SOURCE_UNAVAILABLE");
        const downloaded = await media.downloadSource({ url: sourceUrl, destinationPath: source, signal });
        const info = await media.probe(source, { signal });
        if (!info.durationSec || info.durationSec > 30 || info.videoStreams !== 1) throw new WorkerError("DUBBING_SOURCE_INVALID");
        const path = `guides/${guide.id}/source-${randomUUID()}.mp4`;
        await upload(path, source, "video/mp4");
        result.sourcePath = path; result.sourceSha256 = downloaded.sha256;
        result.sourceDurationMs = Math.ceil(info.durationSec * 1000);
        await checkpoint(result);
      }
      const clips: GuideAudio[] = Array.isArray(result.guideAudio) ? [...result.guideAudio as GuideAudio[]] : [];
      const localClips = new Map<string, string>();
      for (const line of guide.plan.lines) {
        signal.throwIfAborted();
        const cached = clips.find((clip) => clip.lineId === line.lineId);
        const local = join(directory, `line-${line.ordinal}.wav`);
        if (cached) {
          await localAsset(deps.storage, cached.path, local, cached.sha256, signal);
          localClips.set(line.lineId, local);
          continue;
        }
        // A previous worker might have delivered the paid request before losing its lease.
        if (result.ttsPendingLine) throw new WorkerError("TTS_DELIVERY_UNKNOWN");
        result.ttsPendingLine = line.lineId;
        result.ttsRequestId = randomUUID();
        await checkpoint(result);
        let speech: Awaited<ReturnType<typeof synthesizeGuideLine>>;
        try {
          speech = await media.tts({ text: line.text, voicePreset: line.voicePreset, locale: guide.plan.locale,
            requestId: string(result.ttsRequestId), outputPath: local, signal });
        } catch (error) {
          if (error instanceof DubbingTtsError && error.outcome !== "unknown") {
            result.ttsPendingLine = null;
            await checkpoint(result);
          }
          throw error;
        }
        const info = await media.probe(local, { signal });
        if (!info.durationSec || info.audioStreams !== 1 || info.videoStreams) throw new WorkerError("DUBBING_GUIDE_AUDIO_INVALID");
        const path = `guides/${guide.id}/line-${randomUUID()}.wav`;
        await upload(path, local, "audio/wav");
        clips.push({ lineId: line.lineId, path, sha256: speech.sha256, durationMs: Math.ceil(info.durationSec * 1000), synthetic: speech.synthetic });
        result.guideAudio = clips;
        result.ttsPendingLine = null;
        result.synthetic = clips.some((clip) => clip.synthetic);
        result.completedLines = clips.length;
        await checkpoint(result);
        localClips.set(line.lineId, local);
      }
      const timeline = buildDubbingTimeline(guide.plan, clips, Number(result.sourceDurationMs));
      result.timeline = timeline; result.timelineDigest = await digestDubbingTimeline(timeline);
      await checkpoint(result);
      if (timeline.status === "overflow") throw new WorkerError("DUBBING_TIMELINE_OVERFLOW");
      if (timeline.status === "needs_confirmation" && result.durationConfirmed !== true) {
        await finish("awaiting_confirmation", result);
        return;
      }
      const videoPath = `guides/${guide.id}/guide-${randomUUID()}.mp4`;
      const subtitlePath = `guides/${guide.id}/captions-${randomUUID()}.vtt`;
      const composed = join(directory, "guide.mp4");
      const output = await media.compose({ videoPath: source, outputPath: composed, durationSec: timeline.durationMs / 1000,
        segments: timeline.lines.map((line) => ({ path: localClips.get(line.lineId)!, startSec: line.startMs / 1000, endSec: line.endMs / 1000 })), signal });
      const captions = join(directory, "captions.vtt");
      await writeFile(captions, dubbingTimelineToVtt(timeline), { mode: 0o600 });
      await upload(videoPath, composed, "video/mp4");
      await upload(subtitlePath, captions, "text/vtt");
      await assertCurrentGuide(guide, deps);
      await finish("completed", { ...result, videoPath, subtitlePath, videoSha256: output.sha256, status: "ready" });
      return;
    }
    if (job.kind === "validate_take") {
      const take = await deps.store.getTake(job.target_id);
      if (!take || take.guide_id !== guide.id || take.status === "revoked" || take.visibility === "revoked") throw new WorkerError("DUBBING_TAKE_REVOKED");
      const timeline = result.timeline as DubbingTimeline | undefined;
      const line = timeline?.lines.find((entry) => entry.lineId === take.line_id);
      if (!line?.dubbable || line.speakerKey !== take.role ||
        take.owner_id !== (take.role === "yellow_dog" ? guide.participants.yellowDogId : guide.participants.whiteDogId)) throw new WorkerError("DUBBING_TAKE_ROLE_INVALID");
      const input = await localAsset(deps.storage, string(take.result.originalPath), join(directory, "original.audio"), undefined, signal);
      const local = join(directory, "normalized.wav");
      const normalized = await media.normalize({ inputPath: input, outputPath: local, windowDurationSec: line.windowMs / 1000,
        trimStartSec: typeof take.result.trimStartMs === "number" ? take.result.trimStartMs / 1000 : undefined,
        trimEndSec: typeof take.result.trimEndMs === "number" ? take.result.trimEndMs / 1000 : undefined, signal });
      const path = `takes/${take.id}/normalized-${randomUUID()}.wav`;
      await upload(path, local, "audio/wav");
      await assertCurrentGuide(guide, deps);
      await finish("completed", { ...take.result, path, sha256: normalized.sha256, durationMs: Math.ceil(normalized.durationSec * 1000), originalDurationMs: Math.ceil(normalized.originalDurationSec * 1000), sizeBytes: normalized.sizeBytes, status: normalized.status });
      return;
    }
    const render = await deps.store.getRender(job.target_id);
    if (!render || render.guide_id !== guide.id || render.status === "revoked" || render.status === "cancelled") throw new WorkerError("DUBBING_RENDER_REVOKED");
    const manifest = render.manifest;
    const timeline = result.timeline as DubbingTimeline;
    if (!timeline || manifest.planDigest !== guide.plan.scriptDigest || manifest.timelineDigest !== result.timelineDigest || manifest.sourceVideoSha256 !== result.sourceSha256) {
      throw new WorkerError("DUBBING_MANIFEST_CHANGED");
    }
    const source = await localAsset(deps.storage, string(result.sourcePath), join(directory, "source.mp4"), manifest.sourceVideoSha256, signal);
    const clips = result.guideAudio as GuideAudio[];
    const segments = [];
    for (const [index, line] of manifest.lines.entries()) {
      let path: string;
      if (line.source.kind === "take") {
        const take = await deps.store.getTake(line.source.takeId);
        if (!take || take.status !== "ready" || take.visibility === "revoked" || take.owner_id !== line.source.ownerId ||
          take.session_id !== render.session_id || take.line_id !== line.lineId || take.result.sha256 !== line.source.sha256 ||
          (manifest.mode === "duet" && take.visibility !== "shared")) throw new WorkerError("DUBBING_TAKE_REVOKED");
        path = string(take.result.path);
      } else {
        const clip = clips.find((item) => item.lineId === line.lineId && item.sha256 === line.source.sha256);
        if (!clip) throw new WorkerError("DUBBING_GUIDE_AUDIO_CHANGED");
        path = clip.path;
      }
      const local = await localAsset(deps.storage, path, join(directory, `render-${index}.wav`), line.source.sha256, signal);
      segments.push({ path: local, startSec: line.startMs / 1000, endSec: line.endMs / 1000 });
    }
    const composed = join(directory, "render.mp4");
    const output = await media.compose({ videoPath: source, outputPath: composed, durationSec: timeline.durationMs / 1000, segments, signal });
    const videoPath = `renders/${render.id}/video-${randomUUID()}.mp4`;
    await upload(videoPath, composed, "video/mp4");
    await assertCurrentGuide(guide, deps);
    await finish("completed", { videoPath, videoSha256: output.sha256, subtitlePath: result.subtitlePath, durationMs: timeline.durationMs, synthetic: result.synthetic === true });
  } finally {
    // Delete only this attempt's known-unpublished objects. A lost RPC response might have
    // committed references, so uncertain outcomes belong to a later reference-aware sweep.
    if (!databaseOutcomeUnknown && unpublished.size) await deps.storage.remove([...unpublished]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

/** Returns false when no work is queued. A caller can sleep, then call again. */
export async function runDubbingWorkerOnce(deps: DubbingWorkerDependencies, workerId: string, shutdown?: AbortSignal) {
  if (shutdown?.aborted) return false;
  const job = await deps.store.claimJob(workerId, 90);
  if (!job) return false;
  if (!job.lease_token) throw new WorkerError("DUBBING_LEASE_MISSING");
  const controller = new AbortController();
  const abort = () => controller.abort();
  shutdown?.addEventListener("abort", abort, { once: true });
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing || controller.signal.aborted) return;
    renewing = true;
    try { if (await deps.store.renewJob(job.id, job.lease_token!, 90) === false) controller.abort(); }
    catch { controller.abort(); }
    finally { renewing = false; }
  }, 20_000);
  const deadline = setTimeout(abort, 10 * 60_000);
  try {
    await executeDubbingJob(job, deps, controller.signal);
  } catch (error) {
    if (!controller.signal.aborted) {
      // An expired/cancelled lease cannot overwrite a later attempt; the SQL function rejects it.
      await deps.store.finishJob(job.id, job.lease_token, "failed", {}, errorCode(error)).catch(() => undefined);
    }
  } finally {
    clearInterval(heartbeat); clearTimeout(deadline);
    shutdown?.removeEventListener("abort", abort);
  }
  return true;
}

/** The bucket is private. Paths are internal identifiers; these methods never produce public URLs. */
export function createDubbingWorkerStorage(client: SupabaseClient): DubbingWorkerStorage {
  const bucket = client.storage.from(DUBBING_BUCKET);
  return {
    async download(path, destination, signal) {
      signal?.throwIfAborted();
      const { data, error } = await bucket.createSignedUrl(safePath(path), 60);
      if (error || !data) throw new WorkerError("DUBBING_ASSET_DOWNLOAD_FAILED");
      const boundedSignal = AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])]);
      const response = await fetch(data.signedUrl, { redirect: "error", signal: boundedSignal });
      if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 64 * 1024 * 1024) {
        await response.body?.cancel();
        throw new WorkerError("DUBBING_ASSET_DOWNLOAD_FAILED");
      }
      const file = await open(destination, "wx", 0o600);
      const reader = response.body.getReader();
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 64 * 1024 * 1024) throw new WorkerError("DUBBING_ASSET_TOO_LARGE");
          let offset = 0;
          while (offset < value.byteLength) {
            const { bytesWritten } = await file.write(value, offset, value.byteLength - offset);
            if (!bytesWritten) throw new WorkerError("DUBBING_ASSET_DOWNLOAD_FAILED");
            offset += bytesWritten;
          }
        }
        if (!size) throw new WorkerError("DUBBING_ASSET_DOWNLOAD_FAILED");
      } catch (failure) {
        await reader.cancel().catch(() => undefined);
        await rm(destination, { force: true });
        throw failure;
      } finally {
        reader.releaseLock();
        await file.close();
      }
    },
    async upload(path, source, contentType, signal) {
      signal?.throwIfAborted();
      const bytes = await readFile(source);
      if (bytes.length > 64 * 1024 * 1024) throw new WorkerError("DUBBING_ASSET_TOO_LARGE");
      const { error } = await bucket.upload(safePath(path), bytes, { contentType, upsert: false, cacheControl: "0" });
      if (error) throw new WorkerError("DUBBING_ASSET_UPLOAD_FAILED");
      signal?.throwIfAborted();
    },
    async remove(paths) {
      if (!paths.length) return;
      const { error } = await bucket.remove(paths.map(safePath));
      if (error) throw new WorkerError("DUBBING_ASSET_REMOVAL_FAILED");
    },
  };
}

export function createDubbingWorkerDependencies(client: SupabaseClient): DubbingWorkerDependencies {
  return {
    store: createDubbingStore(client),
    storage: createDubbingWorkerStorage(client),
    async currentParticipants(coupleId) {
      const { data: couple, error } = await client.from("couples").select("yellow_dog_id,white_dog_id").eq("id", coupleId).maybeSingle();
      if (error) throw new WorkerError("DUBBING_STORE_UNAVAILABLE");
      if (!couple) return null;
      const ids = [couple.yellow_dog_id, couple.white_dog_id].filter((value): value is string => typeof value === "string");
      if (!ids.length) return null;
      const { data: profiles, error: profileError } = await client.from("profiles").select("id,couple_id,role").in("id", ids);
      if (profileError) throw new WorkerError("DUBBING_STORE_UNAVAILABLE");
      if (!profiles || profiles.length !== ids.length || profiles.some((profile) => profile.couple_id !== coupleId ||
        profile.role !== (profile.id === couple.yellow_dog_id ? "yellow_dog" : "white_dog"))) return null;
      return { coupleId, yellowDogId: couple.yellow_dog_id ?? null, whiteDogId: couple.white_dog_id ?? null };
    },
  };
}
