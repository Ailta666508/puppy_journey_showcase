import { createHash, randomUUID } from "node:crypto";

import {
  completeRehearsalStage,
  createRehearsalRunState,
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
