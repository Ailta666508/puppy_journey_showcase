import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DubbingPlan, DubbingTimeline } from "./contracts";
import { buildDubbingTimeline } from "./timeline";
import { buildDubbingRenderManifest } from "./renderPlan";
import { guideRequestDigest } from "./requestIdentity.server";
import { DubbingTtsError, synthesizeGuideLine } from "./tts.server";
import { composeDubbingVideo, normalizeRecording, probeMedia } from "./media.server";
import { executeDubbingJob, runDubbingWorkerOnce, type DubbingWorkerDependencies, type DubbingWorkerJob, type WorkerGuide, type WorkerTake, type WorkerRender } from "./worker.server";

const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const source = Buffer.from("synthetic video fixture");
const audio = Buffer.from("synthetic audio fixture");
const output = Buffer.from("synthetic composed video");
const participants = { coupleId: "couple-1", yellowDogId: "yellow-user", whiteDogId: "white-user" };
const plan: DubbingPlan = {
  planVersion: 1, locale: "es-ES", scriptDigest: "a".repeat(64), lines: [
    { lineId: "1", ordinal: 0, speakerKey: "yellow_dog", dubbable: true, voicePreset: "yellow_dog", text: "Hola." },
    { lineId: "2", ordinal: 1, speakerKey: "white_dog", dubbable: true, voicePreset: "white_dog", text: "Hola, amigo." },
  ],
};
const job: DubbingWorkerJob = { id: "job-1", guide_id: "guide-1", target_id: "guide-1", kind: "guide", lease_token: "token-1", result: {} };

async function setup(sourceDuration = 8) {
  const guide: WorkerGuide = { id: "guide-1", pipeline_job_id: "pipeline-1", participants, plan, status: "running", result: { sourceUrl: "https://media.example.com/source.mp4", requestDigest: await guideRequestDigest("pipeline-1", plan.scriptDigest) } };
  const saved = new Map<string, Buffer>();
  const store = {
    getGuide: vi.fn(async () => structuredClone(guide)),
    getTake: vi.fn<(...args: [string]) => Promise<WorkerTake | null>>(async () => null),
    getRender: vi.fn<(...args: [string]) => Promise<WorkerRender | null>>(async () => null),
    claimJob: vi.fn(async () => structuredClone(job)), renewJob: vi.fn(async () => true),
    checkpointJob: vi.fn(async (_id: string, _token: string, result: Record<string, unknown>) => { guide.result = structuredClone({ ...guide.result, ...result }); return true; }),
    finishJob: vi.fn<(_id: string, _token: string, _status: string, _result: Record<string, unknown>, _errorCode?: string) => Promise<boolean>>(async () => true),
  };
  const storage = {
    download: vi.fn(async (path: string, target: string) => { const bytes = saved.get(path); if (!bytes) throw new Error("missing test asset"); await writeFile(target, bytes); }),
    upload: vi.fn(async (path: string, local: string) => { saved.set(path, await readFile(local)); }),
    remove: vi.fn<(_paths: string[]) => Promise<void>>(async () => undefined),
  };
  const media: NonNullable<DubbingWorkerDependencies["media"]> = {
    downloadSource: vi.fn(async ({ destinationPath }) => { await writeFile(destinationPath, source); return { bytes: source.length, sha256: hash(source) }; }),
    probe: vi.fn(async (path) => ({ durationSec: path.endsWith("source.mp4") ? sourceDuration : 1, audioStreams: path.endsWith("source.mp4") ? 0 : 1, videoStreams: path.endsWith("source.mp4") ? 1 : 0, sizeBytes: 100 })),
    tts: vi.fn<NonNullable<DubbingWorkerDependencies["media"]>["tts"]>(async (input) => { await writeFile(input.outputPath, audio); return { provider: "mock", requestId: input.requestId, bytes: audio.length, durationSec: 1, sha256: hash(audio), synthetic: true, contentType: "audio/wav", usageCharacters: undefined, logId: undefined }; }),
    compose: vi.fn(async ({ outputPath, durationSec }) => { await writeFile(outputPath, output); return { durationSec, audioStreams: 1, videoStreams: 1, sizeBytes: output.length, sha256: hash(output) }; }),
    normalize: vi.fn<NonNullable<DubbingWorkerDependencies["media"]>["normalize"]>(async ({ outputPath }) => { await writeFile(outputPath, audio); return { status: "ready", durationSec: 1, originalDurationSec: 1, sizeBytes: audio.length, sha256: hash(audio) }; }),
  };
  const deps: DubbingWorkerDependencies = { store, storage, media, currentParticipants: vi.fn(async () => participants) };
  return { guide, saved, deps, store, storage, media };
}

afterEach(() => vi.unstubAllEnvs());

describe("durable dubbing media jobs", () => {
  it("archives source before TTS and publishes an independently composed guide", async () => {
    const state = await setup();
    await executeDubbingJob(job, state.deps, new AbortController().signal);
    expect(state.media.tts).toHaveBeenCalledTimes(2);
    expect(state.store.checkpointJob.mock.calls[0][2]).toMatchObject({ sourceSha256: hash(source), sourceDurationMs: 8000 });
    expect(state.store.finishJob).toHaveBeenCalledWith("job-1", "token-1", "completed", expect.objectContaining({ synthetic: true, status: "ready", videoSha256: hash(output) }));
    expect(state.saved.size).toBe(5);
  });

  it("refuses queued work after voice configuration changes without importing media or billing TTS", async () => {
    vi.stubEnv("DUBBING_TTS_MODE", "doubao");
    vi.stubEnv("DUBBING_VOICE_YELLOW_DOG", "configured-voice-one");
    const state = await setup();
    vi.stubEnv("DUBBING_VOICE_YELLOW_DOG", "configured-voice-two");
    await expect(executeDubbingJob(job, state.deps, new AbortController().signal)).rejects.toMatchObject({ code: "DUBBING_TTS_CONFIG_CHANGED" });
    expect(state.media.downloadSource).not.toHaveBeenCalled();
    expect(state.media.tts).not.toHaveBeenCalled();
  });

  it("does not invalidate a queued voice plan when only its provider credential rotates", async () => {
    const state = await setup();
    vi.stubEnv("DOUBAO_TTS_API_KEY", "synthetic-rotated-test-value");
    await executeDubbingJob(job, state.deps, new AbortController().signal);
    expect(state.media.tts).toHaveBeenCalledTimes(2);
  });

  it("makes no paid call when source import fails", async () => {
    const state = await setup();
    vi.mocked(state.media.downloadSource).mockRejectedValue(new Error("unavailable"));
    await expect(executeDubbingJob(job, state.deps, new AbortController().signal)).rejects.toThrow();
    expect(state.media.tts).not.toHaveBeenCalled();
  });

  it("pauses for duration consent, then resumes using the same archived speech", async () => {
    const state = await setup(3.5);
    await executeDubbingJob(job, state.deps, new AbortController().signal);
    expect(state.store.finishJob).toHaveBeenLastCalledWith("job-1", "token-1", "awaiting_confirmation", expect.objectContaining({ timeline: expect.objectContaining({ extensionMs: 950 }) }));
    expect(state.media.compose).not.toHaveBeenCalled();
    state.guide.result.durationConfirmed = true;
    await executeDubbingJob(job, state.deps, new AbortController().signal);
    expect(state.media.downloadSource).toHaveBeenCalledTimes(1);
    expect(state.media.tts).toHaveBeenCalledTimes(2);
    expect(state.media.compose).toHaveBeenCalledTimes(1);
    expect(state.store.finishJob).toHaveBeenLastCalledWith("job-1", "token-1", "completed", expect.objectContaining({ durationConfirmed: true }));
  });

  it("does not resend a possibly delivered TTS request after worker restart", async () => {
    const state = await setup();
    state.guide.result.ttsPendingLine = "1";
    await expect(executeDubbingJob(job, state.deps, new AbortController().signal)).rejects.toMatchObject({ code: "TTS_DELIVERY_UNKNOWN" });
    expect(state.media.tts).not.toHaveBeenCalled();
  });

  it("retains pending delivery on ambiguous network failure", async () => {
    const state = await setup();
    vi.mocked(state.media.tts).mockRejectedValue(new DubbingTtsError("TTS_DELIVERY_UNKNOWN", "unknown"));
    await expect(executeDubbingJob(job, state.deps, new AbortController().signal)).rejects.toMatchObject({ outcome: "unknown" });
    expect(state.guide.result.ttsPendingLine).toBe("1");
    expect(state.media.tts).toHaveBeenCalledTimes(1);
  });

  it("clears the pending marker when configuration prevented delivery", async () => {
    const state = await setup();
    vi.mocked(state.media.tts).mockRejectedValue(new DubbingTtsError("TTS_DISABLED", "not_sent"));
    await expect(executeDubbingJob(job, state.deps, new AbortController().signal)).rejects.toMatchObject({ outcome: "not_sent" });
    expect(state.guide.result.ttsPendingLine).toBeNull();
  });

  it("refuses work when a participant slot changed", async () => {
    const state = await setup();
    state.deps.currentParticipants = vi.fn(async () => ({ ...participants, whiteDogId: "someone-else" }));
    await expect(executeDubbingJob(job, state.deps, new AbortController().signal)).rejects.toMatchObject({ code: "DUBBING_MEMBERSHIP_CHANGED" });
    expect(state.media.downloadSource).not.toHaveBeenCalled();
  });

  it("does not deliver TTS after a failed lease checkpoint", async () => {
    const state = await setup();
    state.store.checkpointJob.mockResolvedValueOnce(false);
    await expect(executeDubbingJob(job, state.deps, new AbortController().signal)).rejects.toMatchObject({ code: "DUBBING_LEASE_LOST" });
    expect(state.media.tts).not.toHaveBeenCalled();
  });

  it("removes only this attempt's unpublished output after a fenced publication rejection", async () => {
    const state = await setup(); state.store.finishJob.mockResolvedValueOnce(false);
    await expect(executeDubbingJob(job, state.deps, new AbortController().signal)).rejects.toMatchObject({ code: "DUBBING_PUBLICATION_REJECTED" });
    expect(state.storage.remove).toHaveBeenCalledWith(expect.arrayContaining([
      expect.stringMatching(/^guides\/guide-1\/guide-.*\.mp4$/), expect.stringMatching(/^guides\/guide-1\/captions-.*\.vtt$/),
    ]));
    const removed = state.storage.remove.mock.calls[0][0] as string[];
    expect(removed).toHaveLength(2);
    expect(removed).not.toContain(state.guide.result.sourcePath);
  });

  it("does not delete output when a lost publication response may have committed its references", async () => {
    const state = await setup(); state.store.finishJob.mockRejectedValueOnce(new Error("database response lost"));
    await expect(executeDubbingJob(job, state.deps, new AbortController().signal)).rejects.toThrow("database response lost");
    expect(state.storage.remove).not.toHaveBeenCalled();
  });

  it("detects a cached source mismatch before generating speech", async () => {
    const state = await setup();
    state.guide.result = { ...state.guide.result, sourcePath: "guides/guide-1/source.mp4", sourceSha256: "f".repeat(64), sourceDurationMs: 8000 };
    state.saved.set("guides/guide-1/source.mp4", source);
    await expect(executeDubbingJob(job, state.deps, new AbortController().signal)).rejects.toMatchObject({ code: "DUBBING_ASSET_HASH_MISMATCH" });
    expect(state.media.tts).not.toHaveBeenCalled();
  });

  it("validates only the speaker owner's take and preserves needs_trim status", async () => {
    const state = await setup();
    state.guide.result.timeline = buildDubbingTimeline(plan, [{ lineId: "1", durationMs: 1000 }, { lineId: "2", durationMs: 1000 }], 8000);
    const path = "takes/take-1/original.webm"; state.saved.set(path, audio);
    state.store.getTake.mockResolvedValue({ id: "take-1", guide_id: "guide-1", session_id: "session-1", line_id: "1", owner_id: "yellow-user", role: "yellow_dog", status: "validating", visibility: "private", result: { originalPath: path } });
    vi.mocked(state.media.normalize).mockImplementation(async ({ outputPath }) => { await writeFile(outputPath, audio); return { status: "needs_trim", durationSec: 2.5, originalDurationSec: 2.5, sizeBytes: audio.length, sha256: hash(audio) }; });
    await executeDubbingJob({ ...job, kind: "validate_take", target_id: "take-1" }, state.deps, new AbortController().signal);
    expect(state.store.finishJob).toHaveBeenCalledWith("job-1", "token-1", "completed", expect.objectContaining({ status: "needs_trim", durationMs: 2500 }));
    expect(state.media.tts).not.toHaveBeenCalled();
  });

  it("purges only queued paths even after relationship access was revoked", async () => {
    const state = await setup(); state.deps.currentParticipants = vi.fn(async () => null);
    await executeDubbingJob({ ...job, kind: "purge", result: { paths: ["takes/take-1/original.webm"] } }, state.deps, new AbortController().signal);
    expect(state.storage.remove).toHaveBeenCalledWith(["takes/take-1/original.webm"]);
    expect(state.deps.currentParticipants).not.toHaveBeenCalled();
  });

  it("records safe failures and never logs provider payloads", async () => {
    const state = await setup(); vi.mocked(state.media.tts).mockRejectedValue(new DubbingTtsError("TTS_DELIVERY_UNKNOWN", "unknown"));
    expect(await runDubbingWorkerOnce(state.deps, "worker-test")).toBe(true);
    expect(state.store.finishJob).toHaveBeenCalledWith("job-1", "token-1", "failed", {}, "TTS_DELIVERY_UNKNOWN");
  });

  it("renders a solo take from the exact manifest without repeating TTS", async () => {
    const state = await setup();
    await executeDubbingJob(job, state.deps, new AbortController().signal);
    const take: WorkerTake = { id: "take-1", guide_id: "guide-1", session_id: "session-1", line_id: "1", owner_id: "yellow-user", role: "yellow_dog", status: "ready", visibility: "private", result: { path: "takes/take-1/normalized.wav", sha256: hash(audio), durationMs: 1000 } };
    state.saved.set("takes/take-1/normalized.wav", audio);
    state.store.getTake.mockResolvedValue(take);
    const manifest = await buildDubbingRenderManifest({ sessionId: "session-1", participants, actor: { ...participants, userId: "yellow-user", role: "yellow_dog" }, mode: "solo",
      timeline: state.guide.result.timeline as DubbingTimeline, durationConfirmed: false, sourceVideoSha256: hash(source),
      guideAudioSha256: { "1": hash(audio), "2": hash(audio) }, submissions: [{ ownerId: "yellow-user", role: "yellow_dog", revision: 1, choices: { "1": { kind: "take", takeId: "take-1" } } }],
      takes: [{ id: "take-1", sessionId: "session-1", planDigest: plan.scriptDigest, lineId: "1", ownerId: "yellow-user", role: "yellow_dog", sha256: hash(audio), durationMs: 1000, status: "ready", visibility: "private" }],
    });
    state.store.getRender.mockResolvedValue({ id: "render-1", guide_id: "guide-1", session_id: "session-1", status: "running", manifest, result: {} });
    await executeDubbingJob({ ...job, kind: "render", target_id: "render-1" }, state.deps, new AbortController().signal);
    expect(state.media.tts).toHaveBeenCalledTimes(2);
    expect(state.media.compose).toHaveBeenCalledTimes(2);
    expect(state.store.finishJob).toHaveBeenLastCalledWith("job-1", "token-1", "completed", expect.objectContaining({ videoPath: expect.stringMatching(/^renders\/render-1\//) }));
    state.store.getTake.mockResolvedValue({ ...take, status: "revoked", visibility: "revoked" });
    await expect(executeDubbingJob({ ...job, kind: "render", target_id: "render-1" }, state.deps, new AbortController().signal)).rejects.toMatchObject({ code: "DUBBING_TAKE_REVOKED" });
    expect(state.media.compose).toHaveBeenCalledTimes(2);
  });
});

describe.runIf(process.env.DUBBING_MEDIA_SMOKE === "1")("synthetic full media flow with real FFmpeg", () => {
  it("creates a guide, validates browser audio, and renders the selected role with a silent gap", async () => {
    vi.stubEnv("DUBBING_TTS_MODE", "mock");
    const directory = await mkdtemp(join(tmpdir(), "dubbing-full-smoke-"));
    const run = promisify(execFile);
    const ffmpeg = process.env.DUBBING_FFMPEG_PATH || "ffmpeg";
    try {
      const sourcePath = join(directory, "source.mp4");
      await run(ffmpeg, ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=30",
        "-f", "lavfi", "-i", "sine=frequency=1700:sample_rate=48000", "-t", "8", "-c:v", "libx264", "-c:a", "aac", sourcePath]);
      const sourceBytes = await readFile(sourcePath);
      const state = await setup();
      const realMedia: NonNullable<DubbingWorkerDependencies["media"]> = {
        probe: probeMedia, normalize: normalizeRecording, compose: composeDubbingVideo, tts: vi.fn(synthesizeGuideLine),
        downloadSource: vi.fn(async ({ destinationPath }) => { await writeFile(destinationPath, sourceBytes); return { bytes: sourceBytes.length, sha256: hash(sourceBytes) }; }),
      };
      state.deps.media = realMedia;
      await executeDubbingJob(job, state.deps, new AbortController().signal);
      state.guide.result = state.store.finishJob.mock.calls.at(-1)![3];
      expect(state.guide.result.synthetic).toBe(true);
      const guideVideo = state.saved.get(String(state.guide.result.videoPath))!;
      expect(guideVideo.length).toBeGreaterThan(1000);

      const recording = join(directory, "recording.webm");
      await run(ffmpeg, ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000", "-t", "1", recording]);
      const originalPath = "uploads/guide-1/yellow-user/recording.webm";
      state.saved.set(originalPath, await readFile(recording));
      const take: WorkerTake = { id: "take-1", guide_id: "guide-1", session_id: "session-1", line_id: "1", owner_id: "yellow-user", role: "yellow_dog", status: "validating", visibility: "private", result: { originalPath } };
      state.store.getTake.mockResolvedValue(take);
      await executeDubbingJob({ ...job, target_id: "take-1", kind: "validate_take" }, state.deps, new AbortController().signal);
      take.result = state.store.finishJob.mock.calls.at(-1)![3]; take.status = "ready";
      expect(take.result.status).toBe("ready");
      const guideAudio = state.guide.result.guideAudio as { lineId: string; sha256: string }[];
      const manifest = await buildDubbingRenderManifest({ sessionId: "session-1", participants, actor: { ...participants, userId: "yellow-user", role: "yellow_dog" }, mode: "solo",
        timeline: state.guide.result.timeline as DubbingTimeline, durationConfirmed: false, sourceVideoSha256: String(state.guide.result.sourceSha256),
        guideAudioSha256: Object.fromEntries(guideAudio.map((line) => [line.lineId, line.sha256])),
        submissions: [{ ownerId: "yellow-user", role: "yellow_dog", revision: 1, choices: { "1": { kind: "take", takeId: "take-1" } } }],
        takes: [{ id: "take-1", sessionId: "session-1", planDigest: plan.scriptDigest, lineId: "1", ownerId: "yellow-user", role: "yellow_dog", sha256: String(take.result.sha256), durationMs: Number(take.result.durationMs), status: "ready", visibility: "private" }],
      });
      state.store.getRender.mockResolvedValue({ id: "render-1", guide_id: "guide-1", session_id: "session-1", status: "running", manifest, result: {} });
      await executeDubbingJob({ ...job, kind: "render", target_id: "render-1" }, state.deps, new AbortController().signal);
      const renderResult = state.store.finishJob.mock.calls.at(-1)![3];
      const rendered = join(directory, "rendered.mp4");
      await writeFile(rendered, state.saved.get(String(renderResult.videoPath))!);
      expect(await probeMedia(rendered)).toMatchObject({ videoCodec: "h264", audioCodec: "aac", audioStreams: 1, videoStreams: 1, durationSec: 8 });
      expect(realMedia.tts).toHaveBeenCalledTimes(2);
      const gapPath = join(directory, "gap.pcm");
      await run(ffmpeg, ["-v", "error", "-i", rendered, "-ss", "1.5", "-t", "0.5", "-ac", "1", "-ar", "48000", "-f", "s16le", gapPath]);
      const gap = await readFile(gapPath);
      let peak = 0; for (let i = 0; i < gap.length; i += 2) peak = Math.max(peak, Math.abs(gap.readInt16LE(i)));
      expect(peak).toBeLessThan(50);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 30_000);
});
