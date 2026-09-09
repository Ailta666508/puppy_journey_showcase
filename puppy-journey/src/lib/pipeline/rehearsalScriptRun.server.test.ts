import { describe, expect, it } from "vitest";

import {
  createRunningScriptRun,
  isStaleRunningScriptRun,
  normalizeRehearsalIdempotencyKey,
  rehearsalRequestFingerprint,
  resumeFailedScriptRun,
  resumeStaleScriptRun,
} from "./rehearsalScriptRun.server";
import { failRehearsalStage } from "./rehearsalRunState";

const input = {
  userText: "Practise ordering coffee",
  imageDescription: "A quiet café",
  userImageDataUrl: "",
  userImageUrl: "",
  contextAchievements: "lesson 1",
  contextTravel: "Madrid",
  contextWishes: "Speak confidently",
};

describe("rehearsal script run", () => {
  it("normalizes safe idempotency keys and rejects ambiguous values", () => {
    expect(normalizeRehearsalIdempotencyKey("  run:2026-09-04.1  ")).toBe(
      "run:2026-09-04.1",
    );
    expect(normalizeRehearsalIdempotencyKey("")).toBeUndefined();
    expect(() => normalizeRehearsalIdempotencyKey("contains spaces")).toThrow(
      "URL-safe characters",
    );
  });

  it("fingerprints canonical request fields and detects changed input", () => {
    const first = rehearsalRequestFingerprint(input);
    const repeated = rehearsalRequestFingerprint({ ...input });
    const changed = rehearsalRequestFingerprint({
      ...input,
      userText: "Order dinner",
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(repeated).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("persists context completion before starting script generation", () => {
    const run = createRunningScriptRun({
      id: "run-1",
      coupleId: "couple-1",
      authorId: "profile-1",
      now: "2026-09-04T09:00:00.000Z",
    });

    expect(run.status).toBe("running");
    expect(run.stages.context).toMatchObject({
      status: "completed",
      attempt: 1,
    });
    expect(run.stages.script).toMatchObject({ status: "running", attempt: 1 });
    expect(run.stages.image.status).toBe("pending");
  });

  it("retries the failed script attempt without repeating context", () => {
    const running = createRunningScriptRun({
      id: "run-1",
      coupleId: "couple-1",
      authorId: "profile-1",
      now: "2026-09-04T09:00:00.000Z",
    });
    const failed = failRehearsalStage(
      running,
      "script",
      "provider timeout",
      "2026-09-04T09:01:00.000Z",
    );
    const retried = resumeFailedScriptRun(failed, "2026-09-04T09:02:00.000Z");

    expect(retried.status).toBe("running");
    expect(retried.stages.context).toMatchObject({
      status: "completed",
      attempt: 1,
    });
    expect(retried.stages.script).toMatchObject({
      status: "running",
      attempt: 2,
    });
    expect(retried.stages.script.error).toBeUndefined();
  });

  it("rejects retrying a script stage that has not failed", () => {
    const running = createRunningScriptRun({
      id: "run-1",
      coupleId: "couple-1",
      authorId: "profile-1",
      now: "2026-09-04T09:00:00.000Z",
    });

    expect(() =>
      resumeFailedScriptRun(running, "2026-09-04T09:02:00.000Z"),
    ).toThrow("script stage must be failed");
  });

  it("recovers a stale interrupted script without repeating context", () => {
    const running = createRunningScriptRun({
      id: "run-1",
      coupleId: "couple-1",
      authorId: "profile-1",
      now: "2026-09-04T09:00:00.000Z",
    });

    expect(
      isStaleRunningScriptRun(running, "2026-09-04T09:02:59.999Z"),
    ).toBe(false);
    expect(
      isStaleRunningScriptRun(running, "2026-09-04T09:03:00.000Z"),
    ).toBe(true);

    const recovered = resumeStaleScriptRun(
      running,
      "2026-09-04T09:03:00.000Z",
    );
    expect(recovered.status).toBe("running");
    expect(recovered.stages.context).toMatchObject({
      status: "completed",
      attempt: 1,
    });
    expect(recovered.stages.script).toMatchObject({
      status: "running",
      attempt: 2,
      startedAt: "2026-09-04T09:03:00.000Z",
    });
  });

  it("does not recover a script request that may still be active", () => {
    const running = createRunningScriptRun({
      id: "run-1",
      coupleId: "couple-1",
      authorId: "profile-1",
      now: "2026-09-04T09:00:00.000Z",
    });

    expect(() =>
      resumeStaleScriptRun(running, "2026-09-04T09:01:00.000Z"),
    ).toThrow("not stale enough");
  });
});
