import {
  completeRehearsalStage,
  retryFailedRehearsalStage,
  startRehearsalStage,
} from "./rehearsalRunState";
import type { RehearsalRunState } from "./types";

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
