import { createHash, randomUUID } from "node:crypto";

import {
  completeRehearsalStage,
  createRehearsalRunState,
  failRehearsalStage,
  retryFailedRehearsalStage,
  startRehearsalStage,
} from "./rehearsalRunState";
import type { RehearsalRunState } from "./types";

export type RehearsalScriptInput = {
  userText: string;
  imageDescription: string;
  userImageDataUrl: string;
  userImageUrl: string;
  contextAchievements: string;
  contextTravel: string;
  contextWishes: string;
};

export const REHEARSAL_SCRIPT_STALE_AFTER_MS = 3 * 60 * 1000;

export function normalizeRehearsalIdempotencyKey(
  value: unknown,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ValueError("idempotency_key must be a string");
  }
  const key = value.trim();
  if (!key) return undefined;
  if (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new ValueError("idempotency_key must use 1-128 URL-safe characters");
  }
  return key;
}

export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}

export function rehearsalRequestFingerprint(
  input: RehearsalScriptInput,
): string {
  const canonical = JSON.stringify({
    contextAchievements: input.contextAchievements,
    contextTravel: input.contextTravel,
    contextWishes: input.contextWishes,
    imageDescription: input.imageDescription,
    userImageDataUrl: input.userImageDataUrl,
    userImageUrl: input.userImageUrl,
    userText: input.userText,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function createRunningScriptRun(input: {
  coupleId: string;
  authorId: string;
  now: string;
  id?: string;
}): RehearsalRunState {
  let run = createRehearsalRunState({
    id: input.id ?? randomUUID(),
    coupleId: input.coupleId,
    authorId: input.authorId,
    now: input.now,
  });
  run = startRehearsalStage(run, "context", input.now);
  run = completeRehearsalStage(run, "context", input.now);
  return startRehearsalStage(run, "script", input.now);
}

export function resumeFailedScriptRun(
  run: RehearsalRunState,
  now: string,
): RehearsalRunState {
  if (run.stages.script.status !== "failed") {
    throw new ValueError(
      `script stage must be failed before retry, got ${run.stages.script.status}`,
    );
  }
  return retryFailedRehearsalStage(run, "script", now);
}

export function isStaleRunningScriptRun(
  run: RehearsalRunState,
  now: string,
  staleAfterMs = REHEARSAL_SCRIPT_STALE_AFTER_MS,
): boolean {
  if (run.stages.script.status !== "running") return false;
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    throw new ValueError("script stale timeout must be a positive duration");
  }
  const nowMs = Date.parse(now);
  const startedMs = Date.parse(run.stages.script.startedAt ?? "");
  const updatedMs = Date.parse(run.updatedAt);
  if (![nowMs, startedMs, updatedMs].every(Number.isFinite)) {
    throw new ValueError("script recovery requires valid timestamps");
  }
  return nowMs - Math.max(startedMs, updatedMs) >= staleAfterMs;
}

export function resumeStaleScriptRun(
  run: RehearsalRunState,
  now: string,
  staleAfterMs = REHEARSAL_SCRIPT_STALE_AFTER_MS,
): RehearsalRunState {
  if (!isStaleRunningScriptRun(run, now, staleAfterMs)) {
    throw new ValueError("script stage is not stale enough to recover");
  }
  const interrupted = failRehearsalStage(
    run,
    "script",
    "Previous script generation was interrupted",
    now,
  );
  return retryFailedRehearsalStage(interrupted, "script", now);
}
