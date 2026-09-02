import { describe, expect, it } from "vitest";

import {
  completeRehearsalStage,
  createRehearsalRunState,
  failRehearsalStage,
  retryFailedRehearsalStage,
  startRehearsalStage,
} from "./rehearsalRunState";

const initial = () =>
  createRehearsalRunState({
    id: "run-1",
    coupleId: "couple-1",
    authorId: "profile-1",
    now: "2026-09-02T09:00:00.000Z",
  });

describe("rehearsal run state", () => {
  it("starts with only context ready", () => {
    const run = initial();

    expect(run.status).toBe("queued");
    expect(run.stages.context).toEqual({ status: "ready", attempt: 0 });
    expect(run.stages.script.status).toBe("pending");
  });

  it("unlocks stages in pipeline order", () => {
    const started = startRehearsalStage(initial(), "context", "2026-09-02T09:01:00.000Z");
    const completed = completeRehearsalStage(
      started,
      "context",
      "2026-09-02T09:02:00.000Z",
    );

    expect(completed.stages.context.status).toBe("completed");
    expect(completed.stages.script).toEqual({ status: "ready", attempt: 0 });
    expect(() => startRehearsalStage(completed, "image", completed.updatedAt)).toThrow(
      "Cannot start image from pending",
    );
  });

  it("retries only the failed stage and preserves completed work", () => {
    const contextStarted = startRehearsalStage(initial(), "context", "2026-09-02T09:01:00.000Z");
    const contextCompleted = completeRehearsalStage(
      contextStarted,
      "context",
      "2026-09-02T09:02:00.000Z",
    );
    const scriptStarted = startRehearsalStage(
      contextCompleted,
      "script",
      "2026-09-02T09:03:00.000Z",
    );
    const failed = failRehearsalStage(
      scriptStarted,
      "script",
      "provider timeout",
      "2026-09-02T09:04:00.000Z",
    );
    const retried = retryFailedRehearsalStage(
      failed,
      "script",
      "2026-09-02T09:05:00.000Z",
    );

    expect(failed.status).toBe("failed");
    expect(failed.stages.script.error).toBe("provider timeout");
    expect(retried.status).toBe("running");
    expect(retried.stages.context.status).toBe("completed");
    expect(retried.stages.script).toMatchObject({ status: "running", attempt: 2 });
    expect(retried.stages.script.error).toBeUndefined();
  });

  it("marks the run completed after the final stage", () => {
    let run = initial();
    for (const stage of ["context", "script", "image", "video", "learning"] as const) {
      run = startRehearsalStage(run, stage, "2026-09-02T09:10:00.000Z");
      run = completeRehearsalStage(run, stage, "2026-09-02T09:11:00.000Z");
    }

    expect(run.status).toBe("completed");
    expect(Object.values(run.stages).every((stage) => stage.status === "completed")).toBe(true);
  });
});
