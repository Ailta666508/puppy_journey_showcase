import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

const TTS_ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";
const RATE = 24_000;
const MAX_PCM_BYTES = RATE * 2 * 10;

export class DubbingTtsError extends Error {
  constructor(public readonly code: string, public readonly outcome: "not_sent" | "rejected" | "unknown") {
    super(code);
    this.name = "DubbingTtsError";
  }
}

export type GuideVoicePreset = "yellow_dog" | "white_dog" | "npc";
export type GuideTtsInput = {
  text: string;
  voicePreset: GuideVoicePreset;
  locale: "es-ES";
  requestId: string;
  outputPath: string;
  signal?: AbortSignal;
};

function voiceId(preset: GuideVoicePreset) {
  const names = {
    yellow_dog: "DUBBING_VOICE_YELLOW_DOG", white_dog: "DUBBING_VOICE_WHITE_DOG", npc: "DUBBING_VOICE_NPC",
  } as const;
  const voice = process.env[names[preset]]?.trim();
  if (!voice || !/^zh_[a-z0-9_]+_uranus_bigtts$/.test(voice)) {
    throw new DubbingTtsError("TTS_SPANISH_VOICE_NOT_CONFIGURED", "not_sent");
  }
  return voice;
}

function wave(pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Synthetic tones exercise media handling; they are not speech or a Spanish pronunciation example. */
function mockPcm(input: GuideTtsInput) {
  const duration = Math.min(2.8, Math.max(0.5, input.text.trim().split(/\s+/).length * 0.18));
  const samples = Math.round(duration * RATE);
  const pcm = Buffer.alloc(samples * 2);
  const frequency = { yellow_dog: 440, white_dog: 554, npc: 330 }[input.voicePreset];
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, i / 240, (samples - i - 1) / 240);
    pcm.writeInt16LE(Math.round(5000 * fade * Math.sin(2 * Math.PI * frequency * i / RATE)), i * 2);
  }
  return pcm;
}

/** The provider's HTTP stream is newline-delimited JSON, not SSE or raw HTTP transfer chunks. */
export async function readDoubaoPcm(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: Buffer[] = [];
  let pending = "";
  let received = 0;
  let audioBytes = 0;
  let complete = false;
  let usageCharacters: number | undefined;
  const processLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as { code?: number; data?: string; usage?: { text_words?: number } };
    if (complete) throw new DubbingTtsError("TTS_TRAILING_RESPONSE", "unknown");
    if (event.code === 20000000) complete = true;
    else if (event.code !== 0) throw new DubbingTtsError("TTS_PROVIDER_REJECTED", audioBytes ? "unknown" : "rejected");
    if (typeof event.usage?.text_words === "number" && Number.isSafeInteger(event.usage.text_words) && event.usage.text_words >= 0) {
      usageCharacters = event.usage.text_words;
    }
    if (event.data) {
      if (typeof event.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.data)) {
        throw new DubbingTtsError("TTS_INVALID_AUDIO", "unknown");
      }
      const audio = Buffer.from(event.data, "base64");
      audioBytes += audio.length;
      if (audioBytes > MAX_PCM_BYTES) throw new DubbingTtsError("TTS_LINE_TOO_LONG", "unknown");
      chunks.push(audio);
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > 2 * 1024 * 1024) throw new DubbingTtsError("TTS_RESPONSE_TOO_LARGE", "unknown");
      pending += decoder.decode(value, { stream: true });
      if (pending.length > 1024 * 1024) throw new DubbingTtsError("TTS_RESPONSE_TOO_LARGE", "unknown");
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        processLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) processLine(pending);
    // A clean TCP EOF can still be a truncated provider response. Never publish partial speech.
    if (!complete || audioBytes < RATE * 2 * 0.15 || audioBytes % 2) throw new DubbingTtsError("TTS_INCOMPLETE_RESPONSE", "unknown");
    return { pcm: Buffer.concat(chunks), usageCharacters };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof DubbingTtsError) throw error;
    throw new DubbingTtsError("TTS_INCOMPLETE_RESPONSE", "unknown");
  } finally {
    reader.releaseLock();
  }
}

/** https://docs.volcengine.com/docs/DoubaoVoice/unidirectional-streaming-text-to-speech-http */
export async function synthesizeGuideLine(input: GuideTtsInput) {
  if (input.locale !== "es-ES" || !["yellow_dog", "white_dog", "npc"].includes(input.voicePreset) ||
    !input.text.trim() || input.text.length > 240 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(input.text) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId) ||
    !isAbsolute(input.outputPath) || input.outputPath.includes("\0")) {
    throw new DubbingTtsError("TTS_INVALID_INPUT", "not_sent");
  }
  if (input.signal?.aborted) throw new DubbingTtsError("TTS_CANCELLED", "not_sent");
  const mode = process.env.DUBBING_TTS_MODE || "disabled";
  if (mode !== "mock" && mode !== "doubao") throw new DubbingTtsError("TTS_DISABLED", "not_sent");
  let pcm: Buffer;
  let usageCharacters: number | undefined;
  let logId: string | undefined;
  if (mode === "mock") {
    pcm = mockPcm(input);
  } else {
    const apiKey = process.env.DOUBAO_TTS_API_KEY?.trim();
    if (!apiKey) throw new DubbingTtsError("TTS_CREDENTIALS_MISSING", "not_sent");
    const speaker = voiceId(input.voicePreset);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const abort = () => controller.abort();
    input.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(TTS_ENDPOINT, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: {
          "Content-Type": "application/json", "X-Api-Key": apiKey,
          "X-Api-Resource-Id": "seed-tts-2.0", "X-Api-Request-Id": input.requestId,
          "X-Control-Require-Usage-Tokens-Return": "*",
        },
        body: JSON.stringify({ req_params: {
          text: input.text, speaker,
          audio_params: { format: "pcm", sample_rate: RATE },
          additions: JSON.stringify({ explicit_language: "es-es" }),
        } }),
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new DubbingTtsError("TTS_HTTP_FAILED", [400, 401, 403, 422].includes(response.status) ? "rejected" : "unknown");
      }
      const result = await readDoubaoPcm(response.body);
      pcm = result.pcm;
      usageCharacters = result.usageCharacters;
      const id = response.headers.get("x-tt-logid");
      if (id && /^[a-zA-Z0-9-]{1,128}$/.test(id)) logId = id;
    } catch (error) {
      if (error instanceof DubbingTtsError) throw error;
      throw new DubbingTtsError("TTS_DELIVERY_UNKNOWN", "unknown");
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
    }
  }
  const audio = wave(pcm);
  try {
    await writeFile(input.outputPath, audio, { flag: "wx", mode: 0o600 });
  } catch {
    // Speech may already have been billed even when local persistence fails.
    throw new DubbingTtsError("TTS_PERSISTENCE_FAILED", mode === "mock" ? "not_sent" : "unknown");
  }
  return {
    provider: mode, requestId: input.requestId, bytes: audio.length,
    durationSec: pcm.length / (RATE * 2), sha256: createHash("sha256").update(audio).digest("hex"),
    contentType: "audio/wav" as const, synthetic: mode === "mock", usageCharacters, logId,
  };
}
