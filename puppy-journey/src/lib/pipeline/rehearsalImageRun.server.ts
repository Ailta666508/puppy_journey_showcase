import {
  completeRehearsalStage,
  failRehearsalStage,
  retryFailedRehearsalStage,
  startRehearsalStage,
} from "./rehearsalRunState";
import type { RehearsalRunState } from "./types";

export const REHEARSAL_IMAGE_STAGE_STALE_AFTER_MS = 2 * 60 * 1000;

export function beginImageStage(
  run: RehearsalRunState,
  now: string,
): RehearsalRunState {
  const status = run.stages.image.status;
  if (status === "ready") return startRehearsalStage(run, "image", now);
  if (status === "failed") return retryFailedRehearsalStage(run, "image", now);
  throw new Error(`Cannot begin image from ${status}`);
}

export function completeImageStage(
  run: RehearsalRunState,
  now: string,
): RehearsalRunState {
  return completeRehearsalStage(run, "image", now);
}

export function isStaleImageStage(
  run: RehearsalRunState,
  now: string,
  staleAfterMs = REHEARSAL_IMAGE_STAGE_STALE_AFTER_MS,
): boolean {
  if (run.stages.image.status !== "running") return false;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new Error("image stage stale timeout must be positive");
  }
  const nowMs = Date.parse(now);
  const startedMs = Date.parse(run.stages.image.startedAt ?? "");
  const updatedMs = Date.parse(run.updatedAt);
  if (![nowMs, startedMs, updatedMs].every(Number.isFinite)) {
    throw new Error("image stage recovery requires valid timestamps");
  }
  return nowMs - Math.max(startedMs, updatedMs) >= staleAfterMs;
}

export function resumeStaleImageStage(
  run: RehearsalRunState,
  now: string,
  staleAfterMs = REHEARSAL_IMAGE_STAGE_STALE_AFTER_MS,
): RehearsalRunState {
  if (!isStaleImageStage(run, now, staleAfterMs)) {
    throw new Error("image stage is not stale enough to recover");
  }
  const interrupted = failRehearsalStage(
    run,
    "image",
    "Previous image generation was interrupted",
    now,
  );
  return retryFailedRehearsalStage(interrupted, "image", now);
}
