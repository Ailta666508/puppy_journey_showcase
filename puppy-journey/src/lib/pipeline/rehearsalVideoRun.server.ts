import {
  completeRehearsalStage,
  failRehearsalStage,
  retryFailedRehearsalStage,
  startRehearsalStage,
} from "./rehearsalRunState";
import type { RehearsalRunState } from "./types";

export const REHEARSAL_VIDEO_SUBMISSION_STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * Claims the video stage for its first provider submission or a failed-stage
 * retry. Running and completed stages must be replayed by the route instead of
 * creating another billable provider task.
 */
export function beginVideoStage(
  run: RehearsalRunState,
  now: string,
): RehearsalRunState {
  const status = run.stages.video.status;
  if (status === "ready") return startRehearsalStage(run, "video", now);
  if (status === "failed") return retryFailedRehearsalStage(run, "video", now);
  throw new Error(`Cannot begin video from ${status}`);
}

/**
 * A completed video makes the script-derived vocabulary cards available
 * immediately. Advancing the deterministic learning stage here keeps the
 * persisted run aligned with what the client can render after polling.
 */
export function completeVideoRun(
  run: RehearsalRunState,
  now: string,
): RehearsalRunState {
  const videoCompleted = completeRehearsalStage(run, "video", now);
  const learningStarted = startRehearsalStage(videoCompleted, "learning", now);
  return completeRehearsalStage(learningStarted, "learning", now);
}

/** Backfills run_state for jobs completed by the pre-stage-tracking route. */
export function reconcileCompletedVideoRun(
  run: RehearsalRunState,
  now: string,
): RehearsalRunState {
  if (run.stages.video.status === "completed") return run;
  const running =
    run.stages.video.status === "running" ? run : beginVideoStage(run, now);
  return completeVideoRun(running, now);
}

export function isStaleVideoSubmission(
  run: RehearsalRunState,
  hasProviderTaskId: boolean,
  now: string,
  staleAfterMs = REHEARSAL_VIDEO_SUBMISSION_STALE_AFTER_MS,
): boolean {
  if (run.stages.video.status !== "running" || hasProviderTaskId) return false;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new Error("video submission stale timeout must be positive");
  }
  const nowMs = Date.parse(now);
  const startedMs = Date.parse(run.stages.video.startedAt ?? "");
  const updatedMs = Date.parse(run.updatedAt);
  if (![nowMs, startedMs, updatedMs].every(Number.isFinite)) {
    throw new Error("video submission recovery requires valid timestamps");
  }
  return nowMs - Math.max(startedMs, updatedMs) >= staleAfterMs;
}

export function resumeStaleVideoSubmission(
  run: RehearsalRunState,
  now: string,
  staleAfterMs = REHEARSAL_VIDEO_SUBMISSION_STALE_AFTER_MS,
): RehearsalRunState {
  if (!isStaleVideoSubmission(run, false, now, staleAfterMs)) {
    throw new Error("video submission is not stale enough to recover");
  }
  const interrupted = failRehearsalStage(
    run,
    "video",
    "Previous video submission was interrupted",
    now,
  );
  return retryFailedRehearsalStage(interrupted, "video", now);
}
