import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { DubbingPlan, DubbingTimeline } from "../src/lib/dubbing/contracts";
import { buildDubbingRenderManifest } from "../src/lib/dubbing/renderPlan";
import { composeDubbingVideo, normalizeRecording, probeMedia } from "../src/lib/dubbing/media.server";
import { guideRequestDigest } from "../src/lib/dubbing/requestIdentity.server";
import { synthesizeGuideLine } from "../src/lib/dubbing/tts.server";
import { dubbingTimelineToVtt } from "../src/lib/dubbing/timeline";
import { executeDubbingJob, type DubbingWorkerDependencies, type DubbingWorkerJob, type WorkerGuide, type WorkerTake, type WorkerRender } from "../src/lib/dubbing/worker.server";

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const run = promisify(execFile);

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length && (arguments_.length !== 2 || arguments_[0] !== "--output" || !arguments_[1])) {
    throw new Error("Usage: dubbing-demo.ts [--output DIRECTORY]");
  }
  const outputDirectory = resolve(arguments_[1] || ".local/dubbing-demo");
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  // Refuse accidental replacement of an existing demo. No network, database, or paid speech is used.
  await writeFile(join(outputDirectory, "SYNTHETIC-DEMO.txt"), "Synthetic media pipeline demonstration. All guide voices and the recording fixture are tones, not speech or real user recordings.\n", { flag: "wx", mode: 0o600 });
  const ffmpeg = process.env.DUBBING_FFMPEG_PATH || "ffmpeg";
  const sourcePath = join(outputDirectory, "source.mp4");
  await run(ffmpeg, ["-hide_banner", "-v", "error", "-nostdin", "-n", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=1700:sample_rate=48000", "-t", "8", "-c:v", "libx264", "-threads", "2", "-c:a", "aac", "-movflags", "+faststart", sourcePath], { timeout: 60_000 });
  const recordingPath = join(outputDirectory, "recording-fixture.webm");
  await run(ffmpeg, ["-hide_banner", "-v", "error", "-nostdin", "-n", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000", "-t", "1", recordingPath], { timeout: 15_000 });
  const sourceBytes = await readFile(sourcePath);
  const participants = { coupleId: randomUUID(), yellowDogId: randomUUID(), whiteDogId: randomUUID() };
  const plan: DubbingPlan = {
    planVersion: 1, locale: "es-ES", scriptDigest: hash(Buffer.from("synthetic-dubbing-demo-v1")),
    lines: [
      { lineId: "line-1", ordinal: 0, speakerKey: "yellow_dog", dubbable: true, voicePreset: "yellow_dog", text: "Hola, ¿vamos a pasear?", translation: "你好，我们去散步吗？" },
      { lineId: "line-2", ordinal: 1, speakerKey: "white_dog", dubbable: true, voicePreset: "white_dog", text: "Sí, vamos juntos.", translation: "好，一起去吧。" },
    ],
  };
  const guide: WorkerGuide = { id: randomUUID(), pipeline_job_id: randomUUID(), participants, plan, status: "running", result: { sourceUrl: "https://synthetic.invalid/source.mp4" } };
  const assets = new Map<string, Buffer>();
  const takes = new Map<string, WorkerTake>();
  const renders = new Map<string, WorkerRender>();
  let active: DubbingWorkerJob;
  const validLease = (id: string, token: string) => active.id === id && active.lease_token === token;
  const deps: DubbingWorkerDependencies = {
    currentParticipants: async () => participants,
    store: {
      getGuide: async (id) => id === guide.id ? structuredClone(guide) : null,
      getTake: async (id) => structuredClone(takes.get(id) || null),
      getRender: async (id) => structuredClone(renders.get(id) || null),
      claimJob: async () => null, renewJob: async (id, token) => validLease(id, token),
      checkpointJob: async (id, token, result) => {
        if (!validLease(id, token)) return false;
        if (active.kind === "guide") guide.result = structuredClone({ ...guide.result, ...result });
        return true;
      },
      finishJob: async (id, token, status, result) => {
        if (!validLease(id, token)) return false;
        if (active.kind === "guide") { guide.result = structuredClone({ ...guide.result, ...result }); guide.status = status === "completed" ? "ready" : status; }
        if (active.kind === "validate_take") { const take = takes.get(active.target_id)!; take.result = structuredClone({ ...take.result, ...result }); take.status = String(result.status); }
        if (active.kind === "render") { const render = renders.get(active.target_id)!; render.result = structuredClone(result); render.status = status; }
        return true;
      },
    },
    storage: {
      download: async (path, destination) => { const bytes = assets.get(path); if (!bytes) throw new Error("Demo asset missing"); await writeFile(destination, bytes, { flag: "wx", mode: 0o600 }); },
      upload: async (path, source) => { if (assets.has(path)) throw new Error("Demo object already exists"); assets.set(path, await readFile(source)); },
      remove: async (paths) => { for (const path of paths) assets.delete(path); },
    },
    media: {
      probe: probeMedia, normalize: normalizeRecording, compose: composeDubbingVideo, tts: synthesizeGuideLine,
      downloadSource: async ({ destinationPath }) => { await writeFile(destinationPath, sourceBytes, { flag: "wx", mode: 0o600 }); return { bytes: sourceBytes.length, sha256: hash(sourceBytes) }; },
    },
  };
  const execute = async (kind: DubbingWorkerJob["kind"], targetId: string) => {
    active = { id: randomUUID(), kind, target_id: targetId, guide_id: guide.id, lease_token: randomUUID(), result: {} };
    await executeDubbingJob(active, deps, new AbortController().signal);
  };
  process.env.DUBBING_TTS_MODE = "mock";
  guide.result.requestDigest = await guideRequestDigest(guide.pipeline_job_id, guide.plan.scriptDigest);
  await execute("guide", guide.id);
  if (guide.status !== "ready") throw new Error("Synthetic guide unexpectedly needs duration confirmation");
  await writeFile(join(outputDirectory, "guide.mp4"), assets.get(String(guide.result.videoPath))!, { flag: "wx", mode: 0o600 });
  const take: WorkerTake = {
    id: randomUUID(), guide_id: guide.id, session_id: randomUUID(), line_id: "line-1", owner_id: participants.yellowDogId,
    role: "yellow_dog", status: "validating", visibility: "private", result: { originalPath: "uploads/synthetic/recording.webm" },
  };
  assets.set(String(take.result.originalPath), await readFile(recordingPath)); takes.set(take.id, take);
  await execute("validate_take", take.id);
  if (take.status !== "ready") throw new Error("Synthetic recording failed its fixed line window");
  await writeFile(join(outputDirectory, "recording-fixture.wav"), assets.get(String(take.result.path))!, { flag: "wx", mode: 0o600 });
  const guideAudio = guide.result.guideAudio as { lineId: string; sha256: string }[];
  const manifest = await buildDubbingRenderManifest({ sessionId: take.session_id, participants,
    actor: { ...participants, userId: participants.yellowDogId, role: "yellow_dog" }, mode: "solo",
    timeline: guide.result.timeline as DubbingTimeline, durationConfirmed: false, sourceVideoSha256: String(guide.result.sourceSha256),
    guideAudioSha256: Object.fromEntries(guideAudio.map((line) => [line.lineId, line.sha256])),
    submissions: [{ ownerId: participants.yellowDogId, role: "yellow_dog", revision: 1, choices: { "line-1": { kind: "take", takeId: take.id } } }],
    takes: [{ id: take.id, sessionId: take.session_id, planDigest: plan.scriptDigest, lineId: take.line_id, ownerId: take.owner_id, role: "yellow_dog", sha256: String(take.result.sha256), durationMs: Number(take.result.durationMs), status: "ready", visibility: "private" }],
  });
  const render: WorkerRender = { id: randomUUID(), guide_id: guide.id, session_id: take.session_id, status: "running", manifest, result: {} };
  renders.set(render.id, render);
  await execute("render", render.id);
  const soloPath = join(outputDirectory, "solo.mp4");
  await writeFile(soloPath, assets.get(String(render.result.videoPath))!, { flag: "wx", mode: 0o600 });
  await writeFile(join(outputDirectory, "subtitles.vtt"), dubbingTimelineToVtt(guide.result.timeline as DubbingTimeline), { flag: "wx", mode: 0o600 });
  const probe = await probeMedia(soloPath);
  await writeFile(join(outputDirectory, "manifest.json"), JSON.stringify({
    synthetic: true, speech: "All guide voices are test tones, not Spanish speech.",
    recording: "The selected user recording is an 880 Hz synthetic fixture, not a person's voice.",
    verification: "Real FFmpeg guide, WebM decoding, fixed-window role replacement, H264/AAC export; in-memory storage and job state.",
    notVerified: ["Live TTS voice quality", "Database authorization", "Browser microphone permissions", "Deployment"],
    files: ["source.mp4", "guide.mp4", "recording-fixture.webm", "recording-fixture.wav", "solo.mp4", "subtitles.vtt"],
    timeline: guide.result.timeline, manifestDigest: manifest.digest, output: probe,
  }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.info(`Synthetic demo saved to ${outputDirectory}`);
  console.info("guide.mp4 and solo.mp4 contain test tones, not speech. See manifest.json for verified and unverified behavior.");
}

main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  console.error(code === "EEXIST" ? "Output already exists; choose a new --output directory." : `Synthetic demo failed${/^[A-Z_]+$/.test(code) ? ` (${code})` : ""}. Check FFmpeg, ffprobe and the output directory.`);
  process.exitCode = 1;
});
