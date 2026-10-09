import {
  DUBBING_LIMITS,
  type DubbingAudioMeasurement,
  type DubbingPlan,
  type DubbingTimeline,
  type DubbingTimelineLine,
} from "./contracts";
import { dubbingDigest } from "./plan";

/** No estimated model timestamps are used; durations must come from decoded guide audio. */
export function buildDubbingTimeline(
  plan: DubbingPlan,
  measurements: readonly DubbingAudioMeasurement[],
  sourceDurationMs: number,
): DubbingTimeline {
  if (!Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0 || sourceDurationMs > DUBBING_LIMITS.maxSourceDurationMs) {
    throw new Error("源视频时长无效或超过 30 秒，无法制作配音示范。");
  }
  const durations = new Map<string, number>();
  const lineIds = new Set(plan.lines.map((line) => line.lineId));
  if (plan.lines.length === 0 || lineIds.size !== plan.lines.length) throw new Error("配音方案句子编号无效。");
  for (const measured of measurements) {
    if (!lineIds.has(measured.lineId) || durations.has(measured.lineId) || !Number.isFinite(measured.durationMs) || measured.durationMs <= 0) {
      throw new Error("示范音频时长缺失、重复或无效，请重新验证音频。");
    }
    durations.set(measured.lineId, Math.ceil(measured.durationMs));
  }
  if (durations.size !== plan.lines.length) throw new Error("尚未测量全部示范音频，不能开始录音。");
  let cursorMs = 150;
  const lines: DubbingTimelineLine[] = plan.lines.map((line) => {
    const audioDurationMs = durations.get(line.lineId)!;
    const windowMs = Math.ceil(line.dubbable ? Math.max(2000, audioDurationMs * 1.25 + 250) : audioDurationMs + 250);
    const startMs = cursorMs;
    const endMs = startMs + windowMs;
    cursorMs = endMs + 150;
    return { ...line, startMs, endMs, windowMs, audioDurationMs };
  });
  // cursor already includes the final 150 ms tail, as well as gaps between lines.
  const sourceMs = Math.ceil(sourceDurationMs);
  const durationMs = Math.max(sourceMs, cursorMs);
  const extensionMs = durationMs - sourceMs;
  const overflowReasons: DubbingTimeline["overflowReasons"] = [];
  if (lines.some((line) => line.windowMs > DUBBING_LIMITS.maxWindowMs)) overflowReasons.push("LINE_TOO_LONG");
  if (extensionMs > Math.min(DUBBING_LIMITS.maxExtensionMs, sourceMs * 0.5)) overflowReasons.push("EXTENSION_TOO_LONG");
  if (durationMs > DUBBING_LIMITS.maxOutputDurationMs) overflowReasons.push("OUTPUT_TOO_LONG");
  return {
    algorithmVersion: 1,
    scriptDigest: plan.scriptDigest,
    sourceDurationMs: sourceMs,
    durationMs,
    extensionMs,
    status: overflowReasons.length ? "overflow" : extensionMs > 0 ? "needs_confirmation" : "ready",
    overflowReasons,
    lines,
  };
}

/** Binds a duration confirmation to the exact immutable timeline. */
export function digestDubbingTimeline(timeline: DubbingTimeline): Promise<string> {
  return dubbingDigest(JSON.stringify({
    algorithmVersion: timeline.algorithmVersion,
    scriptDigest: timeline.scriptDigest,
    sourceDurationMs: timeline.sourceDurationMs,
    durationMs: timeline.durationMs,
    lines: timeline.lines.map((line) => ({
      lineId: line.lineId,
      startMs: line.startMs,
      endMs: line.endMs,
      audioDurationMs: line.audioDurationMs,
    })),
  }));
}

function timestamp(ms: number): string {
  const hours = Math.floor(ms / 3_600_000).toString().padStart(2, "0");
  const minutes = Math.floor(ms / 60_000 % 60).toString().padStart(2, "0");
  const seconds = Math.floor(ms / 1000 % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}.${(ms % 1000).toString().padStart(3, "0")}`;
}

function caption(text: string): string {
  return text.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Saved script captions, not a transcription or a pronunciation assessment. */
export function dubbingTimelineToVtt(timeline: DubbingTimeline, includeTranslation = true): string {
  if (timeline.status === "overflow") throw new Error("配音时间线超出时长限制，不能发布字幕。");
  return `WEBVTT\n\n${timeline.lines.map((line, index) => [
    String(index + 1),
    `${timestamp(line.startMs)} --> ${timestamp(line.endMs)}`,
    caption(line.text),
    ...(includeTranslation && line.translation ? [caption(line.translation)] : []),
  ].join("\n")).join("\n\n")}\n`;
}
