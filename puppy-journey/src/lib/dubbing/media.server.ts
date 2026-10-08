import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const runFile = promisify(execFile);
const SAMPLE_RATE = 48_000;
const MAX_RECORDING_BYTES = 3 * 1024 * 1024;
const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
const FORMATS = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,wav,ogg,mp3,aac";
const INPUT_FLAGS = ["-protocol_whitelist", "file", "-format_whitelist", FORMATS];

export class DubbingMediaError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DubbingMediaError";
  }
}

export type MediaProbe = {
  durationSec: number | null;
  sizeBytes: number;
  audioStreams: number;
  videoStreams: number;
  audioCodec?: string;
  videoCodec?: string;
  width?: number;
  height?: number;
};

type ExecutionOptions = { signal?: AbortSignal };

async function localInput(path: string, maxBytes: number): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0")) throw new DubbingMediaError("INVALID_MEDIA_PATH");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0 || info.size > maxBytes) {
    throw new DubbingMediaError("INVALID_MEDIA_SIZE");
  }
  return realpath(path);
}

async function outputPath(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0")) throw new DubbingMediaError("INVALID_MEDIA_PATH");
  await realpath(dirname(path));
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return path;
    throw error;
  }
  throw new DubbingMediaError("OUTPUT_ALREADY_EXISTS");
}

async function ffmpeg(args: string[], options: ExecutionOptions = {}) {
  try {
    return await runFile(process.env.DUBBING_FFMPEG_PATH || "ffmpeg", [
      "-hide_banner", "-nostdin", "-v", "error", "-n", "-threads", "2",
      "-filter_threads", "1", "-filter_complex_threads", "1", "-max_alloc", "67108864",
      ...args,
    ], { timeout: 120_000, maxBuffer: 1024 * 1024, signal: options.signal, killSignal: "SIGKILL" });
  } catch {
    // Decoder diagnostics can contain local filenames or embedded metadata.
    throw new DubbingMediaError(options.signal?.aborted ? "MEDIA_CANCELLED" : "MEDIA_PROCESSING_FAILED");
  }
}

/** Inputs are regular local files, never URLs or playlists. Worker containers still need OS resource limits. */
export async function probeMedia(path: string, options: ExecutionOptions = {}): Promise<MediaProbe> {
  const input = await localInput(path, MAX_VIDEO_BYTES);
  try {
    const { stdout } = await runFile(process.env.DUBBING_FFPROBE_PATH || "ffprobe", [
      "-v", "error", ...INPUT_FLAGS, "-max_alloc", "67108864", "-probesize", "5000000",
      "-analyzeduration", "5000000", "-show_entries",
      "format=duration,size:stream=codec_type,codec_name,width,height", "-of", "json", input,
    ], { timeout: 15_000, maxBuffer: 256 * 1024, signal: options.signal, killSignal: "SIGKILL" });
    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
    };
    const audio = (data.streams || []).filter((s) => s.codec_type === "audio");
    const video = (data.streams || []).filter((s) => s.codec_type === "video");
    const duration = Number(data.format?.duration);
    const width = video[0]?.width;
    const height = video[0]?.height;
    if (video.length && (!width || !height || width > 4096 || height > 4096 || width * height > 4096 * 2160)) {
      throw new DubbingMediaError("VIDEO_DIMENSIONS_EXCEEDED");
    }
    return {
      durationSec: Number.isFinite(duration) && duration > 0 ? duration : null,
      sizeBytes: (await lstat(input)).size,
      audioStreams: audio.length, videoStreams: video.length,
      audioCodec: audio[0]?.codec_name, videoCodec: video[0]?.codec_name, width, height,
    };
  } catch (error) {
    if (error instanceof DubbingMediaError) throw error;
    throw new DubbingMediaError(options.signal?.aborted ? "MEDIA_CANCELLED" : "INVALID_MEDIA");
  }
}

function wavFromPcm(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function validatePcm(pcm: Buffer): number {
  const duration = pcm.length / (SAMPLE_RATE * 2);
  if (pcm.length % 2 || duration < 0.15 || duration > 10) throw new DubbingMediaError("RECORDING_DURATION_INVALID");
  let squares = 0;
  let peak = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const value = pcm.readInt16LE(i) / 32768;
    squares += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  if (peak < 0.003 || Math.sqrt(squares / (pcm.length / 2)) < 0.001) {
    throw new DubbingMediaError("RECORDING_SILENT");
  }
  return duration;
}

export async function normalizeRecording(args: {
  inputPath: string;
  outputPath: string;
  windowDurationSec: number;
  trimStartSec?: number;
  trimEndSec?: number;
  signal?: AbortSignal;
}) {
  if (!Number.isFinite(args.windowDurationSec) || args.windowDurationSec <= 0 || args.windowDurationSec > 10) {
    throw new DubbingMediaError("INVALID_LINE_WINDOW");
  }
  const input = await localInput(args.inputPath, MAX_RECORDING_BYTES);
  const output = await outputPath(args.outputPath);
  const info = await probeMedia(input, args);
  if (info.audioStreams !== 1 || info.videoStreams !== 0) throw new DubbingMediaError("AUDIO_ONLY_REQUIRED");
  const rawPath = join(dirname(output), `${randomUUID()}.pcm`);
  try {
    // Browser WebM often omits duration. Decode a bounded extra tenth second to detect overlong input.
    await ffmpeg([...INPUT_FLAGS, "-i", input, "-map", "0:a:0", "-vn", "-sn", "-dn",
      "-t", "10.1", "-ac", "1", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le",
      "-f", "s16le", "-fs", "1000000", rawPath], args);
    const decoded = await readFile(rawPath);
    const originalDuration = validatePcm(decoded);
    const start = args.trimStartSec ?? 0;
    const end = args.trimEndSec ?? originalDuration;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > originalDuration + 0.001 || end <= start) {
      throw new DubbingMediaError("INVALID_TRIM_RANGE");
    }
    const pcm = decoded.subarray(Math.round(start * SAMPLE_RATE) * 2, Math.min(decoded.length, Math.round(end * SAMPLE_RATE) * 2));
    const durationSec = validatePcm(pcm);
    const wav = wavFromPcm(pcm);
    await writeFile(output, wav, { flag: "wx", mode: 0o600 });
    return {
      durationSec, originalDurationSec: originalDuration, sizeBytes: wav.length,
      sha256: createHash("sha256").update(wav).digest("hex"),
      status: Math.ceil(durationSec * 1000) <= Math.floor(args.windowDurationSec * 1000) ? "ready" as const : "needs_trim" as const,
    };
  } finally {
    await rm(rawPath, { force: true });
  }
}

export type DubbingMediaSegment = { path: string; startSec: number; endSec: number };

export async function composeDubbingVideo(args: {
  videoPath: string;
  outputPath: string;
  segments: DubbingMediaSegment[];
  durationSec: number;
  signal?: AbortSignal;
}) {
  const video = await localInput(args.videoPath, MAX_VIDEO_BYTES);
  const output = await outputPath(args.outputPath);
  const info = await probeMedia(video, args);
  if (info.videoStreams !== 1 || !info.durationSec || info.durationSec > 30) throw new DubbingMediaError("INVALID_SOURCE_VIDEO");
  const duration = args.durationSec;
  const extension = Math.max(0, duration - info.durationSec);
  if (!Number.isFinite(duration) || duration < info.durationSec - 0.04 || duration > 30 || extension > Math.min(4, info.durationSec * 0.5) + 0.001) {
    throw new DubbingMediaError("TIMELINE_DURATION_EXCEEDED");
  }
  if (args.segments.length < 1 || args.segments.length > 20) throw new DubbingMediaError("INVALID_SEGMENTS");
  const inputs = [...INPUT_FLAGS, "-i", video];
  const filters: string[] = [];
  let previousEnd = 0;
  for (const [index, segment] of args.segments.entries()) {
    if (!Number.isFinite(segment.startSec) || !Number.isFinite(segment.endSec) || segment.startSec < previousEnd ||
      segment.endSec <= segment.startSec || segment.endSec > duration || segment.endSec - segment.startSec > 10) {
      throw new DubbingMediaError("INVALID_LINE_WINDOW");
    }
    const path = await localInput(segment.path, MAX_RECORDING_BYTES);
    const clip = await probeMedia(path, args);
    if (clip.audioStreams !== 1 || clip.videoStreams || !clip.durationSec || clip.durationSec > segment.endSec - segment.startSec + 0.0001) {
      throw new DubbingMediaError("RECORDING_EXCEEDS_WINDOW");
    }
    inputs.push(...INPUT_FLAGS, "-i", path);
    filters.push(`[${index + 1}:a:0]aresample=${SAMPLE_RATE},aformat=channel_layouts=mono,asetpts=PTS-STARTPTS,adelay=${Math.round(segment.startSec * 1000)}:all=1[a${index}]`);
    previousEnd = segment.endSec;
  }
  filters.push(`${args.segments.map((_, i) => `[a${i}]`).join("")}amix=inputs=${args.segments.length}:normalize=0:dropout_transition=0,apad,atrim=duration=${duration}[audio]`);
  filters.push(`[0:v:0]setpts=PTS-STARTPTS,scale=trunc(iw/2)*2:trunc(ih/2)*2,tpad=stop_mode=clone:stop_duration=${extension},trim=duration=${duration},format=yuv420p[video]`);
  try {
    await ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", "[video]", "-map", "[audio]",
      "-map_metadata", "-1", "-map_chapters", "-1", "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-threads", "2", "-r", "30", "-c:a", "aac", "-b:a", "128k", "-ar", String(SAMPLE_RATE),
      "-movflags", "+faststart", "-t", String(duration), "-fs", String(MAX_VIDEO_BYTES), "-f", "mp4", output], args);
    const result = await probeMedia(output, args);
    if (result.videoCodec !== "h264" || result.audioCodec !== "aac" || result.audioStreams !== 1 || result.videoStreams !== 1 ||
      !result.durationSec || Math.abs(result.durationSec - duration) > 0.12 || result.sizeBytes >= MAX_VIDEO_BYTES) {
      throw new DubbingMediaError("INVALID_COMPOSED_VIDEO");
    }
    return { ...result, durationSec: result.durationSec, sha256: createHash("sha256").update(await readFile(output)).digest("hex") };
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}
