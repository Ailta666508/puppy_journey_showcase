import { dubbingDigest } from "./plan";

/** Stable configuration identity shared by the API and worker; excludes credentials. */
export async function guideRequestDigest(pipelineId: string, scriptDigest: string) {
  return dubbingDigest(JSON.stringify({ pipelineId, scriptDigest, tts: {
    mode: process.env.DUBBING_TTS_MODE || "disabled", version: 1,
    voices: [process.env.DUBBING_VOICE_YELLOW_DOG || "", process.env.DUBBING_VOICE_WHITE_DOG || "", process.env.DUBBING_VOICE_NPC || ""],
  } }));
}
