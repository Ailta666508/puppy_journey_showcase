/** Shared, serializable contracts. These modules can run in the browser or server. */
export type DogSpeakerKey = "yellow_dog" | "white_dog";
export type DubbingSpeakerKey = DogSpeakerKey | `npc:${string}`;
export type DubbingVoicePreset = DogSpeakerKey | "npc";

export const DUBBING_LIMITS = {
  maxLines: 12,
  maxLineCharacters: 180,
  maxTotalCharacters: 1200,
  maxTranslationCharacters: 300,
  maxWindowMs: 10_000,
  maxSourceDurationMs: 30_000,
  maxOutputDurationMs: 30_000,
  maxExtensionMs: 4_000,
} as const;

export type DubbingPlanLine = {
  lineId: string;
  ordinal: number;
  speakerKey: DubbingSpeakerKey;
  dubbable: boolean;
  text: string;
  translation?: string;
  voicePreset: DubbingVoicePreset;
};

export type DubbingPlan = {
  planVersion: 1;
  locale: "es-ES";
  /** SHA-256 of the normalized script and role plan, not an authorization token. */
  scriptDigest: string;
  lines: DubbingPlanLine[];
};

export type DubbingPlanErrorCode =
  | "INVALID_SCRIPT"
  | "INVALID_LINE_ID"
  | "DUPLICATE_LINE_ID"
  | "INVALID_TEXT"
  | "SCRIPT_TOO_LONG"
  | "ROLE_CONFIRMATION_REQUIRED"
  | "ROLE_CONFLICT"
  | "MISSING_DOG_ROLE";

export class DubbingPlanError extends Error {
  readonly code: DubbingPlanErrorCode;
  readonly lineId?: string;

  constructor(code: DubbingPlanErrorCode, message: string, lineId?: string) {
    super(message);
    this.name = "DubbingPlanError";
    this.code = code;
    this.lineId = lineId;
  }
}

export type DubbingAudioMeasurement = { lineId: string; durationMs: number };

export type DubbingTimelineLine = DubbingPlanLine & {
  startMs: number;
  endMs: number;
  windowMs: number;
  audioDurationMs: number;
};

export type DubbingTimeline = {
  algorithmVersion: 1;
  scriptDigest: string;
  sourceDurationMs: number;
  durationMs: number;
  extensionMs: number;
  status: "ready" | "needs_confirmation" | "overflow";
  overflowReasons: ("LINE_TOO_LONG" | "EXTENSION_TOO_LONG" | "OUTPUT_TOO_LONG")[];
  lines: DubbingTimelineLine[];
};
