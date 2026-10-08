import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { composeDubbingVideo, normalizeRecording, probeMedia } from "./media.server";

const directories: string[] = [];
const run = promisify(execFile);
async function directory() {
  const path = await mkdtemp(join(tmpdir(), "dubbing-media-test-")); directories.push(path); return path;
}
async function fixture(dir: string, name: string, duration: number, silent = false) {
  const path = join(dir, name);
  await run(process.env.DUBBING_FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-f", "lavfi", "-i",
    silent ? "anullsrc=r=48000:cl=mono" : "sine=frequency=440:sample_rate=48000", "-t", String(duration), path]);
  return path;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("media boundaries without external binaries", () => {
  it("rejects network paths before probing", async () => {
    await expect(probeMedia("https://example.com/a.mp4")).rejects.toMatchObject({ code: "INVALID_MEDIA_PATH" });
  });
  it("rejects invalid windows before decoding", async () => {
    await expect(normalizeRecording({ inputPath: "/unused.wav", outputPath: "/unused-out.wav", windowDurationSec: NaN })).rejects.toMatchObject({ code: "INVALID_LINE_WINDOW" });
  });
});

describe.runIf(process.env.DUBBING_MEDIA_SMOKE === "1")("real FFmpeg synthetic media smoke", () => {
  it("normalizes browser audio and keeps over-window audio as private needs_trim", async () => {
    const dir = await directory();
    const inputPath = await fixture(dir, "recording.webm", 2.5);
    const result = await normalizeRecording({ inputPath, outputPath: join(dir, "normalized.wav"), windowDurationSec: 2 });
    expect(result.status).toBe("needs_trim");
    expect(result.durationSec).toBeCloseTo(2.5, 1);
    expect((await readFile(join(dir, "normalized.wav"))).subarray(0, 4).toString()).toBe("RIFF");
  });

  it("uses an explicitly selected trim without changing speed", async () => {
    const dir = await directory();
    const inputPath = await fixture(dir, "recording.webm", 3);
    const result = await normalizeRecording({ inputPath, outputPath: join(dir, "trimmed.wav"), windowDurationSec: 2, trimStartSec: 0.5, trimEndSec: 2.5 });
    expect(result.status).toBe("ready");
    expect(result.durationSec).toBe(2);
  });

  it("rejects silence and clips beyond the ten-second safety limit", async () => {
    const dir = await directory();
    await expect(normalizeRecording({ inputPath: await fixture(dir, "silence.wav", 1, true), outputPath: join(dir, "silent-out.wav"), windowDurationSec: 2 })).rejects.toMatchObject({ code: "RECORDING_SILENT" });
    await expect(normalizeRecording({ inputPath: await fixture(dir, "long.webm", 11), outputPath: join(dir, "long-out.wav"), windowDurationSec: 10 })).rejects.toMatchObject({ code: "RECORDING_DURATION_INVALID" });
  });

  it("rejects playlists and corrupted uploads", async () => {
    const dir = await directory();
    const path = join(dir, "playlist.wav");
    await writeFile(path, "#EXTM3U\nhttps://127.0.0.1/private.ts\n");
    await expect(probeMedia(path)).rejects.toMatchObject({ code: "INVALID_MEDIA" });
  });

  it("composes fixed windows, omits source audio and verifies H264/AAC output", async () => {
    const dir = await directory();
    const source = join(dir, "source.mp4");
    await run(process.env.DUBBING_FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=30",
      "-f", "lavfi", "-i", "sine=frequency=1700:sample_rate=48000", "-t", "4", "-c:v", "libx264", "-c:a", "aac", source]);
    const clip = await fixture(dir, "line.wav", 1);
    const result = await composeDubbingVideo({ videoPath: source, outputPath: join(dir, "result.mp4"), durationSec: 5, segments: [
      { path: clip, startSec: 0.15, endSec: 2.15 }, { path: clip, startSec: 2.3, endSec: 4.3 },
    ] });
    expect(result).toMatchObject({ videoCodec: "h264", audioCodec: "aac", audioStreams: 1, videoStreams: 1 });
    expect(result.durationSec).toBeCloseTo(5, 1);
    // The gap must be quiet; source audio is not mixed into the new track.
    const gap = join(dir, "gap.pcm");
    await run(process.env.DUBBING_FFMPEG_PATH || "ffmpeg", ["-v", "error", "-i", join(dir, "result.mp4"), "-ss", "1.5", "-t", "0.5", "-ac", "1", "-ar", "48000", "-f", "s16le", gap]);
    const data = await readFile(gap);
    let peak = 0; for (let i = 0; i < data.length; i += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
    expect(peak).toBeLessThan(50);
    await expect(composeDubbingVideo({ videoPath: source, outputPath: join(dir, "too-long.mp4"), durationSec: 7, segments: [{ path: clip, startSec: 0, endSec: 2 }] })).rejects.toMatchObject({ code: "TIMELINE_DURATION_EXCEEDED" });
    await expect(composeDubbingVideo({ videoPath: source, outputPath: join(dir, "overlap.mp4"), durationSec: 4, segments: [
      { path: clip, startSec: 0, endSec: 2 }, { path: clip, startSec: 1, endSec: 3 },
    ] })).rejects.toMatchObject({ code: "INVALID_LINE_WINDOW" });
  }, 30_000);
});
