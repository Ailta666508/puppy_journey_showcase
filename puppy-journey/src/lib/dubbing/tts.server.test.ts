import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDoubaoPcm, synthesizeGuideLine } from "./tts.server";

const directories: string[] = [];
const requestId = "331d5c95-5619-411f-85c3-f8e188336683";
async function input() {
  const directory = await mkdtemp(join(tmpdir(), "dubbing-tts-test-"));
  directories.push(directory);
  return { text: "Hola, buenos días.", voicePreset: "yellow_dog" as const, locale: "es-ES" as const, requestId, outputPath: join(directory, "line.wav") };
}
function stream(text: string, split = 29) {
  const data = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < data.length; i += split) controller.enqueue(data.slice(i, i + split));
    controller.close();
  } });
}
const pcm = Buffer.alloc(24_000, 4);
const frames = `${JSON.stringify({ code: 0, data: pcm.toString("base64") })}\n${JSON.stringify({ code: 20000000, usage: { text_words: 18 } })}\n`;

afterEach(async () => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("guide speech adapter", () => {
  it("is disabled by default and never silently substitutes mock speech", async () => {
    vi.stubEnv("DUBBING_TTS_MODE", "");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(synthesizeGuideLine(await input())).rejects.toMatchObject({ code: "TTS_DISABLED", outcome: "not_sent" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("generates explicitly synthetic local WAV in mock mode without network", async () => {
    vi.stubEnv("DUBBING_TTS_MODE", "mock");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const args = await input();
    const result = await synthesizeGuideLine(args);
    const file = await readFile(args.outputPath);
    expect(result.synthetic).toBe(true);
    expect(result.contentType).toBe("audio/wav");
    expect(file.subarray(0, 4).toString()).toBe("RIFF");
    expect(file.readUInt32LE(24)).toBe(24_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires configured Spanish voices before sending paid requests", async () => {
    vi.stubEnv("DUBBING_TTS_MODE", "doubao"); vi.stubEnv("DOUBAO_TTS_API_KEY", "test-key");
    vi.stubEnv("DUBBING_VOICE_YELLOW_DOG", "not-a-supported-spanish-voice");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(synthesizeGuideLine(await input())).rejects.toMatchObject({ code: "TTS_SPANISH_VOICE_NOT_CONFIGURED", outcome: "not_sent" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends only the line, approved voice and explicit locale and persists complete audio", async () => {
    vi.stubEnv("DUBBING_TTS_MODE", "doubao"); vi.stubEnv("DOUBAO_TTS_API_KEY", "test-key");
    vi.stubEnv("DUBBING_VOICE_YELLOW_DOG", "zh_male_test_uranus_bigtts");
    const fetch = vi.fn().mockResolvedValue(new Response(stream(frames), { headers: { "x-tt-logid": "test-log-1" } }));
    vi.stubGlobal("fetch", fetch);
    const args = await input();
    const result = await synthesizeGuideLine(args);
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(fetch.mock.calls[0][0]).toBe("https://openspeech.bytedance.com/api/v3/tts/unidirectional");
    expect(JSON.parse(String(init.body))).toEqual({ req_params: {
      text: args.text, speaker: "zh_male_test_uranus_bigtts", audio_params: { format: "pcm", sample_rate: 24_000 },
      additions: JSON.stringify({ explicit_language: "es-es" }),
    } });
    expect(result).toMatchObject({ synthetic: false, provider: "doubao", usageCharacters: 18, durationSec: 0.5 });
    expect((await readFile(args.outputPath)).subarray(44)).toEqual(pcm);
  });

  it("marks network delivery uncertain and does not retry", async () => {
    vi.stubEnv("DUBBING_TTS_MODE", "doubao"); vi.stubEnv("DOUBAO_TTS_API_KEY", "test-key");
    vi.stubEnv("DUBBING_VOICE_YELLOW_DOG", "zh_male_test_uranus_bigtts");
    const fetch = vi.fn().mockRejectedValue(new Error("socket closed")); vi.stubGlobal("fetch", fetch);
    await expect(synthesizeGuideLine(await input())).rejects.toMatchObject({ code: "TTS_DELIVERY_UNKNOWN", outcome: "unknown" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("Doubao chunk parsing", () => {
  it("reassembles arbitrarily split NDJSON and base64 frames", async () => {
    const result = await readDoubaoPcm(stream(frames, 7));
    expect(result.pcm).toEqual(pcm);
    expect(result.usageCharacters).toBe(18);
  });
  it("rejects a clean EOF without completion instead of publishing partial speech", async () => {
    await expect(readDoubaoPcm(stream(JSON.stringify({ code: 0, data: pcm.toString("base64") })))).rejects.toMatchObject({ code: "TTS_INCOMPLETE_RESPONSE", outcome: "unknown" });
  });
  it("rejects an invalid base64 event", async () => {
    await expect(readDoubaoPcm(stream('{"code":0,"data":"not-valid!!"}\n'))).rejects.toMatchObject({ code: "TTS_INVALID_AUDIO" });
  });
  it("rejects provider errors without leaking message text", async () => {
    await expect(readDoubaoPcm(stream('{"code":45000001,"message":"private text"}\n'))).rejects.toMatchObject({ message: "TTS_PROVIDER_REJECTED" });
  });
  it("rejects audio over the single-line safety bound", async () => {
    const long = JSON.stringify({ code: 0, data: Buffer.alloc(480_002).toString("base64") });
    await expect(readDoubaoPcm(stream(long, 64_000))).rejects.toMatchObject({ code: "TTS_LINE_TOO_LONG" });
  });
});
